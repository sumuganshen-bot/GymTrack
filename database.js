const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'gymtrack.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    branches TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    source TEXT,
    stage TEXT NOT NULL DEFAULT 'New',
    temperature TEXT NOT NULL DEFAULT 'Cold',
    date_added TEXT NOT NULL,
    last_touched TEXT NOT NULL,
    notes TEXT DEFAULT '',
    owner TEXT NOT NULL,
    branch TEXT NOT NULL,
    audit_trail TEXT DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_name TEXT NOT NULL,
    phone TEXT,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'tour',
    reminder_days INTEGER NOT NULL DEFAULT 1,
    notes TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'scheduled',
    owner TEXT NOT NULL,
    branch TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS targets (
    branch TEXT NOT NULL,
    month TEXT NOT NULL,
    leads_target INTEGER DEFAULT 0,
    appointments_target INTEGER DEFAULT 0,
    joins_target INTEGER DEFAULT 0,
    PRIMARY KEY (branch, month)
  );

  CREATE TABLE IF NOT EXISTS period_data (
    branch TEXT NOT NULL,
    month TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT,
    PRIMARY KEY (branch, month, key)
  );
`);

function seedUsers() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count > 0) return;

  const seed = [
    ['eden',    'eden123',   'owner', 'sb,bg,os'],
    ['sam',     'sam123',    'md',    'bg,os'],
    ['fauzi',   'fauzi123',  'abm',   'sb,bg,os'],
    ['shamin',  'shamin123', 'cm',    'sb'],
    ['faiz',    'faiz123',   'cm',    'bg'],
    ['bob',     'bob123',    'cm',    'os'],
    ['sumugan', 'sc123',     'sc',    'sb'],
    ['sc2',     'sc456',     'sc',    'sb'],
    ['scbg',    'sc789',     'sc',    'bg'],
    ['scos',    'sc000',     'sc',    'os'],
  ];

  const insert = db.prepare(
    'INSERT INTO users (username, password_hash, role, branches) VALUES (?, ?, ?, ?)'
  );
  const tx = db.transaction((rows) => {
    for (const [u, p, r, b] of rows) {
      insert.run(u, bcrypt.hashSync(p, 10), r, b);
    }
  });
  tx(seed);
  console.log(`Seeded ${seed.length} users`);
}

function seedLeads() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM leads').get().c;
  if (count > 0) return;

  const today = new Date().toISOString().slice(0, 10);
  const leads = [
    ['10/6.1',        '0115-144-1092','Walk-in',      'New',                'Hot',  '2026-06-10', ''],
    ['10/6.2',        '017-588-1528', 'Walk-in',      'New',                'Hot',  '2026-06-10', ''],
    ['10/6.3',        '011-7001-6797','Walk-in',      'New',                'Cold', '2026-06-10', ''],
    ['Ahmad Faizal',  '012-3456789',  'Walk-in',      'Appointment booked', 'Hot',  '2026-06-10', 'Interested in 12-month plan. Works night shift.'],
    ['Nurul Ain',     '011-2233445',  'Referral',     'Contacted',          'Hot',  '2026-06-09', 'Budget conscious. Friend is existing member.'],
    ['Raj Kumar',     '019-8877665',  'Social media', 'Contacted',          'Hot',  '2026-06-11', 'Saw Instagram promo. Wants to lose weight.'],
    ['Siti Hajar',    '017-5544332',  'Phone call',   'New',                'Cold', '2026-06-14', 'Called about student pricing.'],
    ['Kevin Lim',     '016-9988776',  'Walk-in',      'Joined',             'Hot',  '2026-06-10', 'Signed 6-month plan. Referred 1 friend.'],
    ['Priya Devi',    '013-4455667',  'Event',        'New',                'Hot',  '2026-06-10', 'Met at Sungai Besi roadshow.'],
  ];

  const insert = db.prepare(`
    INSERT INTO leads (name, phone, source, stage, temperature, date_added, last_touched, notes, owner, branch, audit_trail)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction((rows) => {
    for (const r of rows) {
      const [name, phone, source, stage, temp, date, notes] = r;
      const trail = JSON.stringify([{ at: date, by: 'seed', action: 'created' }]);
      insert.run(name, phone, source, stage, temp, date, date, notes, 'sumugan', 'sb', trail);
    }
  });
  tx(leads);
  console.log(`Seeded ${leads.length} leads`);
}

function seedAppointments() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM appointments').get().c;
  if (count > 0) return;

  const appts = [
    ['Ahmad Faizal',  '012-3456789', '2026-06-10', '10:00', 'tour',     2, 'Gym tour'],
    ['Nurul Ain',     '011-2233445', '2026-06-09', '14:00', 'followup', 1, 'Discuss pricing'],
    ['Marcus Tan',    '017-1122334', '2026-06-18', '16:00', 'call',     2, 'Callback on student rates'],
    ['Lim Wei Xin',   '016-5566778', '2026-06-22', '10:00', 'tour',     7, 'Referred by Kevin Lim'],
    ['Hafizah Yusof', '011-9988776', '2026-06-25', '13:00', 'followup', 3, '2nd follow-up'],
    ['David Chen',    '012-7766554', '2026-07-03', '11:00', 'tour',     3, 'Corporate membership query'],
  ];

  const insert = db.prepare(`
    INSERT INTO appointments (lead_name, phone, date, time, type, reminder_days, notes, status, owner, branch)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', 'sumugan', 'sb')
  `);
  const tx = db.transaction((rows) => {
    for (const r of rows) insert.run(...r);
  });
  tx(appts);
  console.log(`Seeded ${appts.length} appointments`);
}

seedUsers();
seedLeads();
seedAppointments();

module.exports = db;
