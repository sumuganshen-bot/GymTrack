const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool, initialize } = require('./database');

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
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'missing credentials' });
  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  const u = rows[0];
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

// --- Users list ---
app.get('/api/users', auth, async (req, res) => {
  if (req.user.role === 'sc') return res.status(403).json({ error: 'forbidden' });
  const { rows } = await pool.query('SELECT username, role, display_name, branches FROM users');
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

app.get('/api/leads', auth, async (req, res) => {
  const role = req.user.role;
  let rows;
  if (role === 'abm') {
    ({ rows } = await pool.query('SELECT * FROM leads ORDER BY id DESC'));
  } else if (role === 'cm') {
    const branches = userBranches(req.user);
    const placeholders = branches.map((_, i) => `$${i + 1}`).join(',');
    ({ rows } = await pool.query(`SELECT * FROM leads WHERE branch IN (${placeholders}) ORDER BY id DESC`, branches));
  } else {
    ({ rows } = await pool.query('SELECT * FROM leads WHERE owner = $1 ORDER BY id DESC', [req.user.username]));
  }
  res.json(rows.map(leadRow));
});

app.post('/api/leads', auth, async (req, res) => {
  const b = req.body || {};
  const branch = b.branch || userBranches(req.user)[0];
  if (req.user.role === 'cm' && !canSeeBranch(req.user, branch)) return res.status(403).json({ error: 'branch not allowed' });
  const today = nowIso().slice(0, 10);
  const trail = JSON.stringify([{ at: nowIso(), by: req.user.username, action: 'created' }]);
  const owner = (req.user.role === 'sc') ? req.user.username : (b.owner || req.user.username);
  const { rows } = await pool.query(
    `INSERT INTO leads (name, phone, source, stage, temperature, date_added, last_touched, notes, owner, branch, audit_trail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [b.name || 'Unnamed', b.phone || '', b.source || 'Walk-in',
     b.stage || 'New', b.temperature || 'Cold',
     b.dateAdded || today, today, b.notes || '', owner, branch, trail]
  );
  res.status(201).json(leadRow(rows[0]));
});

app.put('/api/leads/:id', auth, async (req, res) => {
  const id = Number(req.params.id);
  const { rows: existingRows } = await pool.query('SELECT * FROM leads WHERE id = $1', [id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: 'not found' });

  const role = req.user.role;
  if (role === 'sc' && existing.owner !== req.user.username) return res.status(403).json({ error: 'forbidden' });
  if (role === 'cm' && !canSeeBranch(req.user, existing.branch)) return res.status(403).json({ error: 'forbidden' });

  const b = req.body || {};
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

  const { rows } = await pool.query(
    `UPDATE leads SET name=$1, phone=$2, source=$3, stage=$4, temperature=$5, notes=$6, owner=$7, branch=$8, last_touched=$9, audit_trail=$10
     WHERE id=$11 RETURNING *`,
    [next.name, next.phone, next.source, next.stage, next.temperature,
     next.notes, next.owner, next.branch, nowIso().slice(0, 10),
     JSON.stringify(trail), id]
  );
  res.json(leadRow(rows[0]));
});

app.delete('/api/leads/:id', auth, async (req, res) => {
  if (req.user.role === 'sc') return res.status(403).json({ error: 'sc cannot delete' });
  const id = Number(req.params.id);
  const { rows } = await pool.query('SELECT * FROM leads WHERE id = $1', [id]);
  const existing = rows[0];
  if (!existing) return res.status(404).json({ error: 'not found' });
  if (req.user.role === 'cm' && !canSeeBranch(req.user, existing.branch)) return res.status(403).json({ error: 'forbidden' });
  await pool.query('DELETE FROM leads WHERE id = $1', [id]);
  res.json({ ok: true });
});

// --- Appointments ---
// statuses that mean the lead physically showed up
const SHOWED_STATUSES = ['trial', 'joined', 'notjoined', 'showed'];

// Adjust the owner's daily ratio counters (appointments set / showed / closed)
async function bumpRatios(owner, deltas) {
  const { appts = 0, showed = 0, closed = 0 } = deltas;
  if (!appts && !showed && !closed) return;
  const period = nowIso().slice(0, 10);
  await pool.query(`
    INSERT INTO ratios (owner, period, period_type, calls_placed, picked_up, appts_set, showed_up, closed)
    VALUES ($1, $2, 'daily', 0, 0, GREATEST($3, 0), GREATEST($4, 0), GREATEST($5, 0))
    ON CONFLICT (owner, period, period_type) DO UPDATE SET
      appts_set = GREATEST(0, ratios.appts_set + $3),
      showed_up = GREATEST(0, ratios.showed_up + $4),
      closed    = GREATEST(0, ratios.closed + $5)
  `, [owner, period, appts, showed, closed]);
}

function apptRow(r) {
  return {
    id: r.id, leadName: r.lead_name, phone: r.phone,
    date: r.date, time: r.time, type: r.type,
    reminderDays: r.reminder_days, notes: r.notes || '',
    status: r.status, owner: r.owner, branch: r.branch,
  };
}

app.get('/api/appointments', auth, async (req, res) => {
  const role = req.user.role;
  let rows;
  if (role === 'abm') {
    ({ rows } = await pool.query('SELECT * FROM appointments ORDER BY date, time'));
  } else if (role === 'cm') {
    const branches = userBranches(req.user);
    const placeholders = branches.map((_, i) => `$${i + 1}`).join(',');
    ({ rows } = await pool.query(`SELECT * FROM appointments WHERE branch IN (${placeholders}) ORDER BY date, time`, branches));
  } else {
    ({ rows } = await pool.query('SELECT * FROM appointments WHERE owner = $1 ORDER BY date, time', [req.user.username]));
  }
  res.json(rows.map(apptRow));
});

app.post('/api/appointments', auth, async (req, res) => {
  const b = req.body || {};
  const branch = b.branch || userBranches(req.user)[0];
  const owner = (req.user.role === 'sc') ? req.user.username : (b.owner || req.user.username);
  const { rows } = await pool.query(
    `INSERT INTO appointments (lead_name, phone, date, time, type, reminder_days, notes, status, owner, branch)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [b.leadName || 'Unnamed', b.phone || '', b.date, b.time,
     b.type || 'tour', Number(b.reminderDays ?? 1),
     b.notes || '', b.status || 'booked', owner, branch]
  );

  // If this phone number isn't in the system yet, auto-create a lead for it
  let createdLead = false;
  const digits = String(b.phone || '').replace(/\D/g, '');
  if (digits) {
    // match both local (01x...) and international (601x...) stored formats
    const local = digits.startsWith('60') ? '0' + digits.slice(2) : digits;
    const intl = local.startsWith('0') ? '6' + local : local;
    const { rows: found } = await pool.query(
      `SELECT id FROM leads WHERE regexp_replace(coalesce(phone,''), '\\D', '', 'g') = ANY($1)`,
      [[local, intl]]
    );
    if (found.length === 0) {
      const STAGE_FROM_APPT = {
        booked: 'APPT', confirmed: 'APPT', followup: 'Follow Up', trial: 'Show',
        joined: 'Joined', notjoined: 'Not Interested', noshow: 'No Show',
      };
      const today = nowIso().slice(0, 10);
      const trail = JSON.stringify([{ at: nowIso(), by: req.user.username, action: 'auto-created from new appointment' }]);
      await pool.query(
        `INSERT INTO leads (name, phone, source, stage, temperature, date_added, last_touched, notes, owner, branch, audit_trail)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [b.leadName || 'Unnamed', b.phone, b.leadSource || 'Walk-in',
         STAGE_FROM_APPT[b.status] || 'APPT', 'Hot', today, today, '', owner, branch, trail]
      );
      createdLead = true;
    }
  }

  // every new appointment counts toward ratios, regardless of how it was created
  const initialStatus = b.status || 'booked';
  await bumpRatios(owner, {
    appts: 1,
    showed: SHOWED_STATUSES.includes(initialStatus) ? 1 : 0,
    closed: initialStatus === 'joined' ? 1 : 0,
  });

  res.status(201).json({ ...apptRow(rows[0]), createdLead });
});

app.put('/api/appointments/:id', auth, async (req, res) => {
  const id = Number(req.params.id);
  const { rows: existingRows } = await pool.query('SELECT * FROM appointments WHERE id = $1', [id]);
  const existing = existingRows[0];
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
  const { rows } = await pool.query(
    `UPDATE appointments SET lead_name=$1, phone=$2, date=$3, time=$4, type=$5, reminder_days=$6, notes=$7, status=$8, owner=$9, branch=$10
     WHERE id=$11 RETURNING *`,
    [next.lead_name, next.phone, next.date, next.time, next.type, next.reminder_days,
     next.notes, next.status, next.owner, next.branch, id]
  );

  // status transitions adjust showed/closed ratio counters (with corrections)
  if (next.status !== existing.status) {
    const dShowed = Number(SHOWED_STATUSES.includes(next.status)) - Number(SHOWED_STATUSES.includes(existing.status));
    const dClosed = Number(next.status === 'joined') - Number(existing.status === 'joined');
    await bumpRatios(next.owner, { showed: dShowed, closed: dClosed });
  }

  res.json(apptRow(rows[0]));
});

app.delete('/api/appointments/:id', auth, async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await pool.query('SELECT * FROM appointments WHERE id = $1', [id]);
  const existing = rows[0];
  if (!existing) return res.status(404).json({ error: 'not found' });
  if (req.user.role === 'sc' && existing.owner !== req.user.username) return res.status(403).json({ error: 'forbidden' });
  if (req.user.role === 'cm' && !canSeeBranch(req.user, existing.branch)) return res.status(403).json({ error: 'forbidden' });
  await pool.query('DELETE FROM appointments WHERE id = $1', [id]);

  // deleting an appointment reverses its ratio contribution
  await bumpRatios(existing.owner, {
    appts: -1,
    showed: SHOWED_STATUSES.includes(existing.status) ? -1 : 0,
    closed: existing.status === 'joined' ? -1 : 0,
  });

  res.json({ ok: true });
});

// --- Targets ---
app.get('/api/targets', auth, async (req, res) => {
  let rows;
  if (req.user.role === 'sc') {
    ({ rows } = await pool.query('SELECT * FROM targets WHERE owner = $1', [req.user.username]));
  } else {
    ({ rows } = await pool.query('SELECT * FROM targets'));
  }
  res.json(rows.map(r => ({ owner: r.owner, month: r.month, leadsTarget: r.leads_target })));
});

app.put('/api/targets', auth, async (req, res) => {
  if (req.user.role === 'sc') return res.status(403).json({ error: 'sc cannot set targets' });
  const { owner, month, leadsTarget = 0 } = req.body || {};
  if (!owner || !month) return res.status(400).json({ error: 'owner and month required' });
  await pool.query(
    `INSERT INTO targets (owner, month, leads_target) VALUES ($1, $2, $3)
     ON CONFLICT(owner, month) DO UPDATE SET leads_target = $3`,
    [owner, month, leadsTarget]
  );
  res.json({ ok: true });
});

// --- Ratios ---
app.get('/api/ratios', auth, async (req, res) => {
  const { period_type, month } = req.query;
  const role = req.user.role;
  let rows;
  if (role === 'sc') {
    if (period_type && month) {
      ({ rows } = await pool.query('SELECT * FROM ratios WHERE owner = $1 AND period_type = $2 AND period LIKE $3', [req.user.username, period_type, month + '%']));
    } else {
      ({ rows } = await pool.query('SELECT * FROM ratios WHERE owner = $1', [req.user.username]));
    }
  } else {
    if (period_type && month) {
      ({ rows } = await pool.query('SELECT * FROM ratios WHERE period_type = $1 AND period LIKE $2', [period_type, month + '%']));
    } else {
      ({ rows } = await pool.query('SELECT * FROM ratios'));
    }
  }
  res.json(rows.map(r => ({
    owner: r.owner, period: r.period, periodType: r.period_type,
    callsPlaced: r.calls_placed, pickedUp: r.picked_up,
    apptsSet: r.appts_set, showedUp: r.showed_up, closed: r.closed,
  })));
});

app.put('/api/ratios', auth, async (req, res) => {
  const { owner, period, periodType, callsPlaced, pickedUp, apptsSet, showedUp, closed } = req.body || {};
  if (!owner || !period || !periodType) return res.status(400).json({ error: 'owner, period, periodType required' });
  if (req.user.role === 'sc' && owner !== req.user.username) return res.status(403).json({ error: 'forbidden' });
  await pool.query(
    `INSERT INTO ratios (owner, period, period_type, calls_placed, picked_up, appts_set, showed_up, closed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT(owner, period, period_type) DO UPDATE SET
       calls_placed = $4, picked_up = $5, appts_set = $6, showed_up = $7, closed = $8`,
    [owner, period, periodType, callsPlaced || 0, pickedUp || 0, apptsSet || 0, showedUp || 0, closed || 0]
  );
  res.json({ ok: true });
});

// --- Period Data ---
app.get('/api/period-data', auth, async (req, res) => {
  const branches = userBranches(req.user);
  if (branches.length === 0) return res.json([]);
  const placeholders = branches.map((_, i) => `$${i + 1}`).join(',');
  const { rows } = await pool.query(`SELECT * FROM period_data WHERE branch IN (${placeholders})`, branches);
  res.json(rows);
});

app.put('/api/period-data', auth, async (req, res) => {
  const { branch, month, key, value } = req.body || {};
  if (!branch || !month || !key) return res.status(400).json({ error: 'branch, month, key required' });
  if (!canSeeBranch(req.user, branch)) return res.status(403).json({ error: 'forbidden' });
  await pool.query(
    `INSERT INTO period_data (branch, month, key, value) VALUES ($1, $2, $3, $4)
     ON CONFLICT(branch, month, key) DO UPDATE SET value = $4`,
    [branch, month, key, String(value ?? '')]
  );
  res.json({ ok: true });
});

// SPA fallback
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server after DB init
initialize().then(() => {
  app.listen(PORT, () => {
    console.log(`GymTrack listening on :${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
