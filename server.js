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
  const payload = { id: u.id, username: u.username, role: u.role, branches: u.branches, displayName: u.display_name };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL });
  res.json({
    token,
    user: { username: u.username, role: u.role, displayName: u.display_name, branches: userBranches(u) },
  });
});

// --- Users list (for ABM/CM to see SCs) ---
app.get('/api/users', auth, (req, res) => {
  if (req.user.role === 'sc') return res.status(403).json({ error: 'forbidden' });
  const rows = db.prepare('SELECT username, role, display_name, branches FROM users').all();
  res.json(rows.map(r => ({
    username: r.username,
    role: r.role,
    displayName: r.display_name,
    branches: r.branches.split(',').map(s => s.trim()).filter(Boolean),
  })));
});

// --- Leads ---
function leadRow(r) {
  return {
    id: r.id, name: r.name, phone: r.phone, source: r.source,
    stage: r.stage, temperature: r.temperature,
    dateAdded: r.date_added, lastTouched: r.last_touched,
    notes: r.notes || '', owner: r.owner, branch: r.branch,
    auditTrail: JSON.parse(r.audit_trail || '[]'),
  };
}

app.get('/api/leads', auth, (req, res) => {
  const role = req.user.role;
  let rows;
  if (role === 'abm') {
    rows = db.prepare('SELECT * FROM leads ORDER BY id DESC').all();
  } else if (role === 'cm') {
    const branches = userBranches(req.user);
    const placeholders = branches.map(() => '?').join(',');
    rows = db.prepare(`SELECT * FROM leads WHERE branch IN (${placeholders}) ORDER BY id DESC`).all(...branches);
  } else {
    rows = db.prepare('SELECT * FROM leads WHERE owner = ? ORDER BY id DESC').all(req.user.username);
  }
  res.json(rows.map(leadRow));
});

app.post('/api/leads', auth, (req, res) => {
  const b = req.body || {};
  const branch = b.branch || userBranches(req.user)[0];
  if (req.user.role === 'cm' && !canSeeBranch(req.user, branch)) return res.status(403).json({ error: 'branch not allowed' });
  const today = nowIso().slice(0, 10);
  const trail = JSON.stringify([{ at: nowIso(), by: req.user.username, action: 'created' }]);
  const owner = (req.user.role === 'sc') ? req.user.username : (b.owner || req.user.username);
  const info = db.prepare(`
    INSERT INTO leads (name, phone, source, stage, temperature, date_added, last_touched, notes, owner, branch, audit_trail)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    b.name || 'Unnamed', b.phone || '', b.source || 'Walk-in',
    b.stage || 'New', b.temperature || 'Cold',
    b.dateAdded || today, today, b.notes || '', owner, branch, trail
  );
  const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(leadRow(row));
});

app.put('/api/leads/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not found' });

  const role = req.user.role;
  if (role === 'sc' && existing.owner !== req.user.username) return res.status(403).json({ error: 'forbidden' });
  if (role === 'cm' && !canSeeBranch(req.user, existing.branch)) return res.status(403).json({ error: 'forbidden' });

  const b = req.body || {};

  // SC cannot reassign
  if (role === 'sc' && b.owner && b.owner !== req.user.username) return res.status(403).json({ error: 'sc cannot reassign' });

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
  if (req.user.role === 'sc') return res.status(403).json({ error: 'sc cannot delete' });
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  if (req.user.role === 'cm' && !canSeeBranch(req.user, existing.branch)) return res.status(403).json({ error: 'forbidden' });
  db.prepare('DELETE FROM leads WHERE id = ?').run(id);
  res.json({ ok: true });
});

// --- Appointments ---
function apptRow(r) {
  return {
    id: r.id, leadName: r.lead_name, phone: r.phone,
    date: r.date, time: r.time, type: r.type,
    reminderDays: r.reminder_days, notes: r.notes || '',
    status: r.status, owner: r.owner, branch: r.branch,
  };
}

app.get('/api/appointments', auth, (req, res) => {
  const role = req.user.role;
  let rows;
  if (role === 'abm') {
    rows = db.prepare('SELECT * FROM appointments ORDER BY date, time').all();
  } else if (role === 'cm') {
    const branches = userBranches(req.user);
    const placeholders = branches.map(() => '?').join(',');
    rows = db.prepare(`SELECT * FROM appointments WHERE branch IN (${placeholders}) ORDER BY date, time`).all(...branches);
  } else {
    rows = db.prepare('SELECT * FROM appointments WHERE owner = ? ORDER BY date, time').all(req.user.username);
  }
  res.json(rows.map(apptRow));
});

app.post('/api/appointments', auth, (req, res) => {
  const b = req.body || {};
  const branch = b.branch || userBranches(req.user)[0];
  const owner = (req.user.role === 'sc') ? req.user.username : (b.owner || req.user.username);
  const info = db.prepare(`
    INSERT INTO appointments (lead_name, phone, date, time, type, reminder_days, notes, status, owner, branch)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    b.leadName || 'Unnamed', b.phone || '', b.date, b.time,
    b.type || 'tour', Number(b.reminderDays || 1),
    b.notes || '', b.status || 'scheduled', owner, branch
  );
  const row = db.prepare('SELECT * FROM appointments WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(apptRow(row));
});

app.put('/api/appointments/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  if (req.user.role === 'sc' && existing.owner !== req.user.username) return res.status(403).json({ error: 'forbidden' });
  if (req.user.role === 'cm' && !canSeeBranch(req.user, existing.branch)) return res.status(403).json({ error: 'forbidden' });
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
  if (req.user.role === 'sc' && existing.owner !== req.user.username) return res.status(403).json({ error: 'forbidden' });
  if (req.user.role === 'cm' && !canSeeBranch(req.user, existing.branch)) return res.status(403).json({ error: 'forbidden' });
  db.prepare('DELETE FROM appointments WHERE id = ?').run(id);
  res.json({ ok: true });
});

// --- Targets (per SC per month) ---
app.get('/api/targets', auth, (req, res) => {
  let rows;
  if (req.user.role === 'sc') {
    rows = db.prepare('SELECT * FROM targets WHERE owner = ?').all(req.user.username);
  } else {
    rows = db.prepare('SELECT * FROM targets').all();
  }
  res.json(rows.map(r => ({ owner: r.owner, month: r.month, leadsTarget: r.leads_target })));
});

app.put('/api/targets', auth, (req, res) => {
  if (req.user.role === 'sc') return res.status(403).json({ error: 'sc cannot set targets' });
  const { owner, month, leadsTarget = 0 } = req.body || {};
  if (!owner || !month) return res.status(400).json({ error: 'owner and month required' });
  db.prepare(`
    INSERT INTO targets (owner, month, leads_target)
    VALUES (?, ?, ?)
    ON CONFLICT(owner, month) DO UPDATE SET leads_target = excluded.leads_target
  `).run(owner, month, leadsTarget);
  res.json({ ok: true });
});

// --- Ratios ---
app.get('/api/ratios', auth, (req, res) => {
  const { period_type, month } = req.query;
  const role = req.user.role;
  let rows;
  if (role === 'sc') {
    if (period_type && month) {
      rows = db.prepare('SELECT * FROM ratios WHERE owner = ? AND period_type = ? AND period LIKE ?').all(req.user.username, period_type, month + '%');
    } else {
      rows = db.prepare('SELECT * FROM ratios WHERE owner = ?').all(req.user.username);
    }
  } else {
    if (period_type && month) {
      rows = db.prepare('SELECT * FROM ratios WHERE period_type = ? AND period LIKE ?').all(period_type, month + '%');
    } else {
      rows = db.prepare('SELECT * FROM ratios').all();
    }
  }
  res.json(rows.map(r => ({
    owner: r.owner, period: r.period, periodType: r.period_type,
    callsPlaced: r.calls_placed, pickedUp: r.picked_up,
    apptsSet: r.appts_set, showedUp: r.showed_up, closed: r.closed,
  })));
});

app.put('/api/ratios', auth, (req, res) => {
  const { owner, period, periodType, callsPlaced, pickedUp, apptsSet, showedUp, closed } = req.body || {};
  if (!owner || !period || !periodType) return res.status(400).json({ error: 'owner, period, periodType required' });
  // SC can only edit own ratios
  if (req.user.role === 'sc' && owner !== req.user.username) return res.status(403).json({ error: 'forbidden' });
  db.prepare(`
    INSERT INTO ratios (owner, period, period_type, calls_placed, picked_up, appts_set, showed_up, closed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner, period, period_type) DO UPDATE SET
      calls_placed = excluded.calls_placed, picked_up = excluded.picked_up,
      appts_set = excluded.appts_set, showed_up = excluded.showed_up, closed = excluded.closed
  `).run(owner, period, periodType, callsPlaced || 0, pickedUp || 0, apptsSet || 0, showedUp || 0, closed || 0);
  res.json({ ok: true });
});

// --- Period Data ---
app.get('/api/period-data', auth, (req, res) => {
  const branches = userBranches(req.user);
  if (branches.length === 0) return res.json([]);
  const placeholders = branches.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM period_data WHERE branch IN (${placeholders})`).all(...branches);
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
