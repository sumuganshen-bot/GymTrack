const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./database');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'gymtrack-dev-secret-change-me';
const TOKEN_TTL = '12h';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'invalid or expired token' });
  }
}

function userBranches(u) {
  return (u.branches || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function canSeeBranch(user, branch) {
  if (!branch) return true;
  return userBranches(user).includes(branch);
}

function nowIso() {
  return new Date().toISOString();
}

// --- Auth ---
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'missing credentials' });
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!u) return res.status(401).json({ error: 'invalid credentials' });
  if (!bcrypt.compareSync(password, u.password_hash)) {
    return res.status(401).json({ error: 'invalid credentials' });
  }
  const payload = { id: u.id, username: u.username, role: u.role, branches: u.branches };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL });
  res.json({
    token,
    user: { username: u.username, role: u.role, branches: userBranches(u) },
  });
});

// --- Leads ---
function leadRow(r) {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    source: r.source,
    stage: r.stage,
    temperature: r.temperature,
    dateAdded: r.date_added,
    lastTouched: r.last_touched,
    notes: r.notes || '',
    owner: r.owner,
    branch: r.branch,
    auditTrail: JSON.parse(r.audit_trail || '[]'),
  };
}

app.get('/api/leads', auth, (req, res) => {
  const branches = userBranches(req.user);
  if (branches.length === 0) return res.json([]);
  const placeholders = branches.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM leads WHERE branch IN (${placeholders}) ORDER BY id DESC`).all(...branches);
  res.json(rows.map(leadRow));
});

app.post('/api/leads', auth, (req, res) => {
  const b = req.body || {};
  const branch = b.branch || userBranches(req.user)[0];
  if (!canSeeBranch(req.user, branch)) return res.status(403).json({ error: 'branch not allowed' });
  const today = nowIso().slice(0, 10);
  const trail = JSON.stringify([{ at: nowIso(), by: req.user.username, action: 'created' }]);
  const info = db
    .prepare(`
      INSERT INTO leads (name, phone, source, stage, temperature, date_added, last_touched, notes, owner, branch, audit_trail)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      b.name || 'Unnamed',
      b.phone || '',
      b.source || 'Walk-in',
      b.stage || 'New',
      b.temperature || 'Cold',
      b.dateAdded || today,
      today,
      b.notes || '',
      b.owner || req.user.username,
      branch,
      trail
    );
  const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(leadRow(row));
});

app.put('/api/leads/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  if (!canSeeBranch(req.user, existing.branch)) return res.status(403).json({ error: 'forbidden' });

  const b = req.body || {};
  const trail = JSON.parse(existing.audit_trail || '[]');
  const changes = [];

  const next = {
    name:        b.name        ?? existing.name,
    phone:       b.phone       ?? existing.phone,
    source:      b.source      ?? existing.source,
    stage:       b.stage       ?? existing.stage,
    temperature: b.temperature ?? existing.temperature,
    notes:       b.notes       ?? existing.notes,
    owner:       b.owner       ?? existing.owner,
    branch:      b.branch      ?? existing.branch,
  };

  if (next.branch !== existing.branch && !canSeeBranch(req.user, next.branch)) {
    return res.status(403).json({ error: 'target branch not allowed' });
  }
  if (next.stage !== existing.stage) changes.push(`stage ${existing.stage} → ${next.stage}`);
  if (next.owner !== existing.owner) changes.push(`reassigned ${existing.owner} → ${next.owner}`);
  if (next.branch !== existing.branch) changes.push(`branch ${existing.branch} → ${next.branch}`);
  if (changes.length) {
    trail.push({ at: nowIso(), by: req.user.username, action: changes.join('; ') });
  }

  db.prepare(`
    UPDATE leads
       SET name=?, phone=?, source=?, stage=?, temperature=?, notes=?, owner=?, branch=?, last_touched=?, audit_trail=?
     WHERE id=?
  `).run(
    next.name, next.phone, next.source, next.stage, next.temperature,
    next.notes, next.owner, next.branch, nowIso().slice(0, 10),
    JSON.stringify(trail), id
  );

  const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  res.json(leadRow(row));
});

app.delete('/api/leads/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  if (!canSeeBranch(req.user, existing.branch)) return res.status(403).json({ error: 'forbidden' });
  db.prepare('DELETE FROM leads WHERE id = ?').run(id);
  res.json({ ok: true });
});

// --- Appointments ---
function apptRow(r) {
  return {
    id: r.id,
    leadName: r.lead_name,
    phone: r.phone,
    date: r.date,
    time: r.time,
    type: r.type,
    reminderDays: r.reminder_days,
    notes: r.notes || '',
    status: r.status,
    owner: r.owner,
    branch: r.branch,
  };
}

app.get('/api/appointments', auth, (req, res) => {
  const branches = userBranches(req.user);
  if (branches.length === 0) return res.json([]);
  const placeholders = branches.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT * FROM appointments WHERE branch IN (${placeholders}) ORDER BY date, time`)
    .all(...branches);
  res.json(rows.map(apptRow));
});

app.post('/api/appointments', auth, (req, res) => {
  const b = req.body || {};
  const branch = b.branch || userBranches(req.user)[0];
  if (!canSeeBranch(req.user, branch)) return res.status(403).json({ error: 'branch not allowed' });
  const info = db.prepare(`
    INSERT INTO appointments (lead_name, phone, date, time, type, reminder_days, notes, status, owner, branch)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    b.leadName || 'Unnamed',
    b.phone || '',
    b.date,
    b.time,
    b.type || 'tour',
    Number(b.reminderDays || 1),
    b.notes || '',
    b.status || 'scheduled',
    b.owner || req.user.username,
    branch
  );
  const row = db.prepare('SELECT * FROM appointments WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(apptRow(row));
});

app.put('/api/appointments/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  if (!canSeeBranch(req.user, existing.branch)) return res.status(403).json({ error: 'forbidden' });
  const b = req.body || {};
  const next = {
    lead_name:     b.leadName     ?? existing.lead_name,
    phone:         b.phone        ?? existing.phone,
    date:          b.date         ?? existing.date,
    time:          b.time         ?? existing.time,
    type:          b.type         ?? existing.type,
    reminder_days: b.reminderDays ?? existing.reminder_days,
    notes:         b.notes        ?? existing.notes,
    status:        b.status       ?? existing.status,
    owner:         b.owner        ?? existing.owner,
    branch:        b.branch       ?? existing.branch,
  };
  if (next.branch !== existing.branch && !canSeeBranch(req.user, next.branch)) {
    return res.status(403).json({ error: 'target branch not allowed' });
  }
  db.prepare(`
    UPDATE appointments
       SET lead_name=?, phone=?, date=?, time=?, type=?, reminder_days=?, notes=?, status=?, owner=?, branch=?
     WHERE id=?
  `).run(
    next.lead_name, next.phone, next.date, next.time, next.type, next.reminder_days,
    next.notes, next.status, next.owner, next.branch, id
  );
  const row = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  res.json(apptRow(row));
});

app.delete('/api/appointments/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  if (!canSeeBranch(req.user, existing.branch)) return res.status(403).json({ error: 'forbidden' });
  db.prepare('DELETE FROM appointments WHERE id = ?').run(id);
  res.json({ ok: true });
});

// --- Targets ---
app.get('/api/targets', auth, (req, res) => {
  const branches = userBranches(req.user);
  if (branches.length === 0) return res.json([]);
  const placeholders = branches.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT * FROM targets WHERE branch IN (${placeholders})`)
    .all(...branches);
  res.json(rows.map((r) => ({
    branch: r.branch,
    month: r.month,
    leadsTarget: r.leads_target,
    appointmentsTarget: r.appointments_target,
    joinsTarget: r.joins_target,
  })));
});

app.put('/api/targets', auth, (req, res) => {
  const { branch, month, leadsTarget = 0, appointmentsTarget = 0, joinsTarget = 0 } = req.body || {};
  if (!branch || !month) return res.status(400).json({ error: 'branch and month required' });
  if (!canSeeBranch(req.user, branch)) return res.status(403).json({ error: 'forbidden' });
  db.prepare(`
    INSERT INTO targets (branch, month, leads_target, appointments_target, joins_target)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(branch, month) DO UPDATE SET
      leads_target = excluded.leads_target,
      appointments_target = excluded.appointments_target,
      joins_target = excluded.joins_target
  `).run(branch, month, leadsTarget, appointmentsTarget, joinsTarget);
  res.json({ ok: true });
});

// --- Period Data (flexible key/value per branch+month) ---
app.get('/api/period-data', auth, (req, res) => {
  const branches = userBranches(req.user);
  if (branches.length === 0) return res.json([]);
  const placeholders = branches.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT * FROM period_data WHERE branch IN (${placeholders})`)
    .all(...branches);
  res.json(rows);
});

app.put('/api/period-data', auth, (req, res) => {
  const { branch, month, key, value } = req.body || {};
  if (!branch || !month || !key) return res.status(400).json({ error: 'branch, month, key required' });
  if (!canSeeBranch(req.user, branch)) return res.status(403).json({ error: 'forbidden' });
  db.prepare(`
    INSERT INTO period_data (branch, month, key, value)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(branch, month, key) DO UPDATE SET value = excluded.value
  `).run(branch, month, key, String(value ?? ''));
  res.json({ ok: true });
});

// SPA fallback
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`GymTrack listening on :${PORT}`);
});
