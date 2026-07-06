const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
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
    display_name TEXT NOT NULL DEFAULT '',
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
    owner TEXT NOT NULL,
    month TEXT NOT NULL,
    leads_target INTEGER DEFAULT 0,
    PRIMARY KEY (owner, month)
  );

  CREATE TABLE IF NOT EXISTS ratios (
    owner TEXT NOT NULL,
    period TEXT NOT NULL,
    period_type TEXT NOT NULL DEFAULT 'daily',
    calls_placed INTEGER DEFAULT 0,
    picked_up INTEGER DEFAULT 0,
    appts_set INTEGER DEFAULT 0,
    showed_up INTEGER DEFAULT 0,
    closed INTEGER DEFAULT 0,
    PRIMARY KEY (owner, period, period_type)
  );

  CREATE TABLE IF NOT EXISTS period_data (
    branch TEXT NOT NULL,
    month TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT,
    PRIMARY KEY (branch, month, key)
  );
`);

// Add display_name column if missing (migration for existing DBs)
try { db.exec('ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT ""'); } catch(e) {}
// Migrate targets table if it has old schema
try { db.exec('ALTER TABLE targets ADD COLUMN owner TEXT NOT NULL DEFAULT ""'); } catch(e) {}

function seedUsers() {
  // Always reseed: drop all users and re-insert the correct 5
  db.exec('DELETE FROM users');

  const seed = [
    ['fauzi',   'fauzi123',  'abm', 'Fauzi Yusuf',    'sb,bg,os'],
    ['shamin',  'shamin123', 'cm',  'Shamin Muzafar', 'sb'],
    ['sumugan', 'sc123',     'sc',  'Sumugan',        'sb'],
    ['fatihah', 'fat123',    'sc',  'Fatihah',        'sb'],
    ['faez',    'faez123',   'sc',  'Faez',           'sb'],
  ];

  const insert = db.prepare(
    'INSERT INTO users (username, password_hash, role, display_name, branches) VALUES (?, ?, ?, ?, ?)'
  );
  const tx = db.transaction((rows) => {
    for (const [u, p, r, dn, b] of rows) {
      insert.run(u, bcrypt.hashSync(p, 10), r, dn, b);
    }
  });
  tx(seed);
  console.log(`Seeded ${seed.length} users`);
}

function seedLeads() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM leads').get().c;
  if (count > 0) return;

  const leads = [
    // Sumugan (9)
    ['10/6.1',        '0115-144-1092','Walk-in',      'New',                'Hot',  '2026-06-10', '', 'sumugan'],
    ['10/6.2',        '017-588-1528', 'Walk-in',      'New',                'Hot',  '2026-06-10', '', 'sumugan'],
    ['10/6.3',        '011-7001-6797','Walk-in',      'New',                'Cold', '2026-06-10', '', 'sumugan'],
    ['Ahmad Faizal',  '012-3456789',  'Walk-in',      'Appointment booked', 'Hot',  '2026-06-10', 'Interested in 12-month plan, works night shift', 'sumugan'],
    ['Nurul Ain',     '011-2233445',  'Referral',     'Contacted',          'Hot',  '2026-06-09', 'Budget conscious, friend is member', 'sumugan'],
    ['Raj Kumar',     '019-8877665',  'Social media', 'Contacted',          'Hot',  '2026-06-11', 'Instagram promo, lose weight', 'sumugan'],
    ['Siti Hajar',    '017-5544332',  'Phone call',   'New',                'Cold', '2026-06-14', 'Student pricing', 'sumugan'],
    ['Kevin Lim',     '016-9988776',  'Walk-in',      'Joined',             'Hot',  '2026-06-10', 'Signed 6-month, referred 1 friend', 'sumugan'],
    ['Priya Devi',    '013-4455667',  'Event',        'New',                'Hot',  '2026-06-10', 'Sungai Besi roadshow', 'sumugan'],
    // Fatihah (5)
    ['Zara Iman',     '011-5566778',  'Walk-in',      'New',                'Hot',  '2026-07-06', '', 'fatihah'],
    ['Hafiz Azmi',    '012-6677889',  'Referral',     'Contacted',          'Hot',  '2026-07-05', '', 'fatihah'],
    ['Tan Mei Ling',  '016-7788990',  'Social media', 'Appointment booked', 'Hot',  '2026-07-04', '', 'fatihah'],
    ['Roshini',       '019-3344556',  'Walk-in',      'New',                'Cold', '2026-07-06', '', 'fatihah'],
    ['Jason Wong',    '017-4455667',  'Phone call',   'Contacted',          'Hot',  '2026-07-03', '', 'fatihah'],
    // Faez (5)
    ['Amirul Hakim',  '013-8899001',  'Walk-in',      'Contacted',          'Hot',  '2026-07-06', '', 'faez'],
    ['Nur Syafiqah',  '011-9900112',  'Referral',     'Appointment booked', 'Hot',  '2026-07-05', '', 'faez'],
    ['Daniel Lau',    '012-0011223',  'Event',        'New',                'Hot',  '2026-07-06', '', 'faez'],
    ['Salmah Rus',    '016-1122334',  'Walk-in',      'New',                'Cold', '2026-07-04', '', 'faez'],
    ['Bryan Chong',   '017-2233445',  'Social media', 'Joined',             'Hot',  '2026-07-01', '', 'faez'],
  ];

  const insert = db.prepare(`
    INSERT INTO leads (name, phone, source, stage, temperature, date_added, last_touched, notes, owner, branch, audit_trail)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction((rows) => {
    for (const r of rows) {
      const [name, phone, source, stage, temp, date, notes, owner] = r;
      const trail = JSON.stringify([{ at: date, by: 'seed', action: 'created' }]);
      insert.run(name, phone, source, stage, temp, date, date, notes, owner, 'sb', trail);
    }
  });
  tx(leads);
  console.log(`Seeded ${leads.length} leads`);
}

function seedAppointments() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM appointments').get().c;
  if (count > 0) return;

  const appts = [
    ['Ahmad Faizal',  '012-3456789', '2026-06-10', '10:00', 'tour',     2, '', 'sumugan'],
    ['Marcus Tan',    '017-1122334', '2026-06-18', '16:00', 'call',     2, '', 'sumugan'],
    ['Lim Wei Xin',   '016-5566778', '2026-06-22', '10:00', 'tour',     7, '', 'sumugan'],
    ['Hafizah Yusof', '011-9988776', '2026-06-25', '13:00', 'followup', 3, '', 'sumugan'],
    ['David Chen',    '012-7766554', '2026-07-03', '11:00', 'tour',     3, '', 'sumugan'],
    ['Tan Mei Ling',  '016-7788990', '2026-07-06', '14:00', 'tour',     2, '', 'fatihah'],
    ['Nur Syafiqah',  '011-9900112', '2026-07-07', '10:00', 'tour',     2, '', 'faez'],
  ];

  const insert = db.prepare(`
    INSERT INTO appointments (lead_name, phone, date, time, type, reminder_days, notes, status, owner, branch)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, 'sb')
  `);
  const tx = db.transaction((rows) => {
    for (const r of rows) insert.run(...r);
  });
  tx(appts);
  console.log(`Seeded ${appts.length} appointments`);
}

function seedTargets() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM targets').get().c;
  if (count > 0) return;

  const month = '2026-07';
  const insert = db.prepare('INSERT OR REPLACE INTO targets (owner, month, leads_target) VALUES (?, ?, ?)');
  insert.run('sumugan', month, 20);
  insert.run('fatihah', month, 15);
  insert.run('faez', month, 15);
  console.log('Seeded targets');
}

seedUsers();
seedLeads();
seedAppointments();
seedTargets();

module.exports = db;
