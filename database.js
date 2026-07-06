const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false }
    : false,
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      branches TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
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
      id SERIAL PRIMARY KEY,
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
}

async function seedUsers() {
  await pool.query('DELETE FROM users');

  const seed = [
    ['fauzi',   'fauzi123',  'abm', 'Fauzi Yusuf',    'sb,bg,os'],
    ['shamin',  'shamin123', 'cm',  'Shamin Muzafar', 'sb'],
    ['sumugan', 'sc123',     'sc',  'Sumugan',        'sb'],
    ['fatihah', 'fat123',    'sc',  'Fatihah',        'sb'],
    ['faez',    'faez123',   'sc',  'Faez',           'sb'],
  ];

  for (const [u, p, r, dn, b] of seed) {
    const hash = bcrypt.hashSync(p, 10);
    await pool.query(
      'INSERT INTO users (username, password_hash, role, display_name, branches) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (username) DO UPDATE SET password_hash=$2, role=$3, display_name=$4, branches=$5',
      [u, hash, r, dn, b]
    );
  }
  console.log(`Seeded ${seed.length} users`);
}

async function seedLeads() {
  const { rows } = await pool.query('SELECT COUNT(*) AS c FROM leads');
  if (parseInt(rows[0].c) > 0) return;

  const leads = [
    ['Irfan', '011-1657-5778', 'Social Media', 'sumugan', 'APPT'],
    ['Wisdom Y', '017-957-7128', 'Social Media', 'sumugan', 'Not Interested'],
    ['Saif Alwani', '019-0531-2835', 'Social Media', 'sumugan', 'APPT'],
    ['Ena', '017-644-3584', 'Social Media', 'sumugan', 'Follow Up'],
    ['Chin Sim Yee', '016-445-6606', 'Social Media', 'sumugan', 'Follow Up'],
    ['Suzanne Wong', '016-2108465', 'Social Media', 'dalia', 'Joined'],
    ['Gan Ping', '012-218-6269', 'Social Media', 'sumugan', 'Follow Up'],
    ['Daniel', '010-469-0412', 'Social Media', 'sumugan', 'Follow Up'],
    ['Koh', '017-6865328', 'Social Media', 'dalia', 'Not Interested'],
    ['Aiman', '019-6140027', 'Social Media', 'dalia', 'Follow Up'],
    ['September Leads', '013-330-2841', 'Social Media', 'sumugan', 'Follow Up'],
    ['Stephy', '019-9530319', 'Social Media', 'dalia', 'APPT'],
    ['September Leads', '011-1496-5118', 'Social Media', 'sumugan', 'Follow Up'],
    ['Sai Mon', '016-259-8728', 'Social Media', 'sumugan', 'Follow Up'],
    ['September Leads', '016-519-2485', 'Social Media', 'sumugan', 'Follow Up'],
    ['Pian', '017-5659213', 'Social Media', 'dalia', 'Follow Up'],
    ['Ivy', '016-9808619', 'Social Media', 'dalia', 'Follow Up'],
    ['Faez', '012-3038130', 'Social Media', 'dalia', 'Follow Up'],
    ['Ali', '011-21746623', 'Social Media', 'dalia', 'Joined'],
    ['Shimah', '019-2717071', 'Social Media', 'dalia', 'Not Interested'],
    ['Arif', '013-3348600', 'Social Media', 'dalia', 'Follow Up'],
    ['Azima', '011-21667402', 'Social Media', 'dalia', 'Follow Up'],
    ['Rick', '017-261-8082', 'Social Media', 'syazwan', 'Not Interested'],
    ['Pratheep', '014-3611027', 'Social Media', 'syazwan', 'Follow Up'],
    ['Nor Safi', '016-285658', 'Social Media', 'syazwan', 'Follow Up'],
    ['Manimegamalai', '011-36663204', 'Social Media', 'syazwan', 'Follow Up'],
    ['Zulhaffiz Zariq', '012-2442466', 'Social Media', 'syazwan', 'Follow Up'],
    ['Adli', '019-3844417', 'Social Media', 'syazwan', 'Not Interested'],
    ['Nurshamimi', '011-21134162', 'Social Media', 'syazwan', 'Follow Up'],
    ['Faris', '013-2341780', 'Social Media', 'syazwan', 'Follow Up'],
    ['Ayden', '012-2630083', 'Social Media', 'syazwan', 'New'],
    ['YJ', '017-9383068', 'Social Media', 'syazwan', 'New'],
    ['Luthfan Aulia', '014-7657950', 'Social Media', 'syazwan', 'New'],
    ['Nor Atika', '011-65092834', 'Social Media', 'syazwan', 'New'],
    ['Muhammad Fairuz', '016-2049404', 'Social Media', 'syazwan', 'New'],
    ['Trisha', '012-6881101', 'Social Media', 'syazwan', 'New'],
    ['Mohd Rizal', '017-9645556', 'Social Media', 'syazwan', 'New'],
    ['Denise', '017-4198104', 'Social Media', 'syazwan', 'New'],
    ['James', '016-2834133', 'Social Media', 'syazwan', 'New'],
    ['Farah Nadiah', '019-5425961', 'Social Media', 'syazwan', 'New'],
    ['Sheng Teng Yee', '017-2867686', 'Social Media', 'syazwan', 'New'],
    ['Shiranjit Singh', '019-3333224', 'Social Media', 'syazwan', 'New'],
    ['Imran Aqil', '019-2087066', 'Social Media', 'syazwan', 'New'],
    ['Sazlin', '014-7193373', 'Social Media', 'syazwan', 'New'],
    ['Faezatul Aqmar', '013-7599559', 'Social Media', 'syazwan', 'New'],
    ['Nurin Athirah Azam', '011-10382980', 'Social Media', 'syazwan', 'New'],
    ['Olivia', '011-28180143', 'Social Media', 'syazwan', 'New'],
    ['Swee Yan Lee', '012-2816835', 'Social Media', 'syazwan', 'New'],
    ['Sing Yew', '010-2995434', 'Social Media', 'syazwan', 'New'],
    ['Fakhruddin', '019-6364781', 'Social Media', 'syazwan', 'New'],
    ['Har Li Wei', '017-4155805', 'Social Media', 'syazwan', 'New'],
    ['Wei Yuan', '014-6877907', 'Social Media', 'syazwan', 'New'],
    ['Christine Camilla', '012-5463151', 'Social Media', 'syazwan', 'New'],
    ['Norhayati', '013-2740342', 'Social Media', 'syazwan', 'New'],
    ['Hasnida', '017-2461425', 'Social Media', 'syazwan', 'New'],
    ['Punitha', '012-5010040', 'Social Media', 'syazwan', 'Follow Up'],
    ['Justhin Chin', '017-2282988', 'Social Media', 'syazwan', 'APPT'],
    ['Arham Shahid', '016-7246527', 'Outreach', 'syazwan', 'New'],
    ['Abner Goh', '013-7766616', 'Social Media', 'syazwan', 'New'],
    ['Julian Loke', '010-5364113', 'Social Media', 'syazwan', 'New'],
    ['Syazriena', '011-19186334', 'Social Media', 'syazwan', 'Not Interested'],
    ['Celine', '012-5137687', 'Social Media', 'syazwan', 'Follow Up'],
    ['Gabrielle Leong', '019-3151561', 'Social Media', 'syazwan', 'New'],
    ['Jia En', '012-5991371', 'Social Media', 'syazwan', 'Follow Up'],
    ['Azliza Yusuf', '019-3839311', 'Social Media', 'syazwan', 'Follow Up'],
    ['Fairuz', '016-2049404', 'Social Media', 'syazwan', 'Follow Up'],
    ['Belle', '017-6370367', 'Social Media', 'syazwan', 'Follow Up'],
    ['Lai Teng', '012-2242420', 'Social Media', 'syazwan', 'New'],
    ['Ashton Ng', '011-14320500', 'Social Media', 'syazwan', 'New'],
    ['Syamil', '013-3695285', 'Referral', 'syazwan', 'Follow Up'],
    ['CHINESE LEAD', '012-204-7741', 'Website', 'sumugan', 'Follow Up'],
    ['Syuhadah', '017-6286400', 'Website', 'dalia', 'Follow Up'],
    ['Afif', '016-9663644', 'Website', 'dalia', 'Not Interested'],
    ['Eriqa Feisal', '012-3835396', 'Website', 'dalia', 'Not Interested'],
    ['Danial', '014-9258295', 'Social Media', 'dalia', 'Follow Up'],
    ['Alec', '011-26760731', 'Social Media', 'dalia', 'Follow Up'],
    ['Ira', '014-8347998', 'Social Media', 'dalia', 'Follow Up'],
    ['Hanif', '017-8460529', 'Walk-in', 'sumugan', 'Joined'],
    ['Ahmad', '011-62574169', 'Website', 'sumugan', 'New'],
    ['Mohammed Saad', '011-39808121', '', 'aidil', 'APPT'],
    ['Faiz', '010-7101023', '', 'aidil', 'Follow Up'],
    ['Ain Zahari', '013-3938947', '', 'aidil', 'Closed'],
    ['Abdul Rahman', '017-7416468', '', 'aidil', 'APPT'],
    ['Barnabas Tan', '016-4101813', '', 'aidil', 'APPT'],
    ['Amgad Elmouez', '011-17856737', '', 'aidil', 'No Answer'],
    ['Bryan Yau', '010-4208625', '', 'aidil', 'Closed'],
    ['Elin', '017-9281918', '', 'aidil', 'No Answer'],
    ['Rose', '018-2181641', '', 'aidil', 'Follow Up'],
    ['Vee Yee Lim', '012-9038013', '', 'aidil', 'Follow Up'],
    ['Marcus', '017-6360388', '', 'aidil', 'Follow Up'],
    ['Bong', '017-9786632', '', 'aidil', 'Follow Up'],
    ['Jun Hong Tay', '011-10836296', '', 'aidil', 'Follow Up'],
    ['Michelle Lum', '012-6982488', '', 'aidil', 'Follow Up'],
    ['Awis', '012-9841104', '', 'aidil', 'APPT'],
    ['Irfan', '011-12345453', '', 'aidil', 'Follow Up'],
    ['Thrinnya', '017-6898482', '', 'aidil', 'Follow Up'],
    ['Vulcan Chong', '012-5444559', '', 'aidil', 'Follow Up'],
    ['Sherynne', '018-3132551', '', 'aidil', 'Follow Up'],
    ['Tihaa', '017-3334323', '', 'aidil', 'Not Interested'],
    ['Dila', '013-9998733', '', 'dalia', 'No Answer'],
    ['Sylvia Ganesan', '017-8713913', '', 'aidil', 'Not Interested'],
    ['Din', '014-7447268', '', 'aidil', 'Not Interested'],
    ['Muhammad Irfan', '016-9242517', '', 'aidil', 'APPT'],
    ['Leow En Ning', '018-4019817', '', 'aidil', 'Closed'],
    ['Edmund Lim Ming Jun', '017-5537898', '', 'aidil', 'Closed'],
    ['Harith Ajwad', '017-9408997', '', 'aidil', 'Follow Up'],
    ['Aween', '019-7782545', '', 'aidil', 'Not Interested'],
    ['Faiz Othman', '017-3488278', '', 'aidil', 'APPT'],
    ['Afiqah', '013-6869580', '', 'sumugan', 'Follow Up'],
    ['Khairul', '012-2248265', '', 'sumugan', 'Follow Up'],
    ['Nadirah', '011-73392896', '', 'aidil', 'Follow Up'],
    ['Hakim', '019-2221174', '', 'aidil', 'Follow Up'],
    ['Abdullah', '011-37700937', '', 'aidil', 'Follow Up'],
    ['Amin', '018-4019798', '', 'dalia', 'Follow Up'],
    ['Arasi', '012-3629107', '', 'aidil', 'No Answer'],
    ['Brian Tam', '010-8753806', '', 'aidil', 'No Answer'],
    ['Azaruddin', '010-4484085', '', 'aidil', 'No Answer'],
    ['Hakim Hisham', '013-3579833', '', 'aidil', 'Joined'],
    ['Hock Chye', '065-91397959', '', 'aidil', 'Not Interested'],
    ['Mahvendra Vishnu', '016-4173190', '', 'aidil', 'APPT'],
    ['Syuhadah', '018-9427568', '', 'aidil', 'Follow Up'],
    ['Farida', '010-2223518', '', 'aidil', 'APPT'],
    ['Lin', '013-9027372', '', 'aidil', 'Not Interested'],
    ['Farah', '013-9027372', '', 'aidil', 'Not Interested'],
    ['Syazwani', '013-9027372', '', 'aidil', 'Not Interested'],
    ['Nanasbee', '016-3176135', '', 'aidil', 'Follow Up'],
    ['Kalai', '016-2538869', '', 'aidil', 'Follow Up'],
    ['Nafisah Faraulah', '013-3069531', '', 'aidil', 'Not Interested'],
    ['Lim Vee Yee', '012-9038013', '', 'aidil', 'No Answer'],
    ['Faye', '011-26131164', '', 'aidil', 'Follow Up'],
    ['Desmond', '012-2332003', '', 'aidil', 'Follow Up'],
    ['Bahiuddin', '014-2621532', '', 'aidil', 'Follow Up'],
    ['Krishna Mugi', '011-16057443', '', 'aidil', 'Not Interested'],
    ['Edward Chau Jun Jie', '017-3481137', '', 'aidil', 'Follow Up'],
    ['Afza', '011-10141436', '', 'sumugan', 'Follow Up'],
    ['Nadyatul', '017-667957', '', 'nisya', 'No Show'],
    ['Salasiah', '018-2594824', '', 'dalia', 'APPT'],
    ['Fatiha', '017-470755', '', 'nisya', 'No Show'],
    ['Nur Farhani', '011-26930431', '', 'syazwan', 'Follow Up'],
    ['Hafiz', '013-5877949', '', 'nisya', 'Follow Up'],
    ['Zuhairi', '011-19806720', '', 'dalia', 'Closed'],
    ['Muhammad Syafiq Roslan', '018-4612234', '', 'dalia', 'Closed'],
    ['Khairul', '013-3595198', '', 'dalia', 'Follow Up'],
    ['Vivien Cheng', '016-6082330', '', 'dalia', 'Closed'],
    ['Seak Hoe Wah', '016-2500776', '', 'dalia', 'Closed'],
    ['Faris', '019-5735734', '', 'syazwan', 'APPT'],
    ['Firdaus', '010-3700300', '', 'nisya', 'Closed'],
    ['Zahar', '019-3706838', '', 'nisya', 'APPT'],
    ['Ahmad Azhar', '011-62574169', 'Instagram', 'sumugan', 'APPT'],
    ['Yong Hou Chen', '016-2276226', 'Instagram', 'sumugan', 'New'],
    ['Charlie', '016-2320238', 'WhatsApp', 'dalia', 'Follow Up'],
    ['Nur Raihan', '019-671597', 'Instagram', 'nisya', 'Closed'],
    ['Fatihah Nabeela', '011-10558949', 'WhatsApp', 'dalia', 'Closed'],
    ['Hanisha', '012-7125941', 'WhatsApp', 'dalia', 'APPT'],
    ['Azril', '013-4869066', 'WhatsApp', 'sumugan', 'APPT'],
    ['Imaa', '011-28358139', 'WhatsApp', 'sumugan', 'Follow Up'],
    ['Harianti', '010-2098729', 'WhatsApp', 'nisya', 'Follow Up'],
    ['Anne', '017-9981025', 'WhatsApp', 'nisya', 'Follow Up'],
    ['Zulaikha', '019-7672297', 'WhatsApp', 'syazwan', 'Follow Up'],
    ['Alex', '013-3129706', 'WhatsApp', 'nisya', 'APPT'],
    ['Wannini', '012-9206117', 'WhatsApp', 'sumugan', 'Follow Up'],
    ['Tan', '012-2943721', 'WhatsApp', 'dalia', 'Follow Up'],
    ['Hassan Raza', '011-16399511', 'WhatsApp', 'nisya', 'Closed'],
    ['Abdul Manaan', '011-16399511', 'WhatsApp', 'nisya', 'No Show'],
    ['Penzz De Sauza', '016-2155472', 'Website', 'sumugan', 'Not Interested'],
    ['Nor Najihah', '013-5343527', 'Referral', 'sumugan', 'APPT'],
    ['Awin', '011-15434570', 'WhatsApp', 'dalia', 'Follow Up'],
    ['Johan Haris', '017-4918781', 'Referral', 'syazwan', 'Follow Up'],
    ['Fendi', '016-4464365', 'Referral', 'syazwan', 'Follow Up'],
    ['Izat', '010-5054964', 'Website', 'syazwan', 'Not Interested'],
    ['Nur Alya Natasya', '017-6404639', 'Website', 'syazwan', 'Follow Up'],
    ['Ashraf Samsudin', '017-2532845', 'Instagram', 'nisya', 'APPT'],
    ['Syazana', '017-8731193', 'Website', 'syazwan', 'APPT'],
    ['Affyn Ramlan', '010-4122875', 'Website', 'syazwan', 'Follow Up'],
    ['Haitham', '017-4104616', 'Website', 'dalia', 'Closed'],
    ['Aula', '011-69652948', 'Website', 'syazwan', 'Follow Up'],
    ['Afifah', '017-9696024', 'Referral', 'sumugan', 'Follow Up'],
    ['Zul', '012-4066695', 'Walk-in', 'sumugan', 'Follow Up'],
    ['Jose', '016-7139593', 'Instagram', 'nisya', 'Not Interested'],
    ['Nessa', '014-9164322', 'Instagram', 'nisya', 'Follow Up'],
    ['Audruy', '012-2806720', 'Instagram', 'nisya', 'Show'],
    ['Artem', '010-5070879', 'Instagram', 'nisya', 'Show'],
    ['Wanee', '012-4836509', 'Instagram', '', 'New'],
    ['Fatin', '019-2844266', '', 'sumugan', 'Follow Up'],
    ['Shahrulrizal', '017-4051491', '', 'sumugan', 'Closed'],
    ['Ima Soffea', '011-31773868', '', 'sumugan', 'Follow Up'],
    ['Muhammad Adam Irfan', '019-5898607', '', 'sumugan', 'Not Interested'],
    ['Alice', '012-2102987', '', 'nisya', 'Not Interested'],
    ['Baharain', '011-29716110', 'Outreach', 'sumugan', 'Follow Up'],
    ['Harry', '011-11496526', 'Outreach', 'sumugan', 'Follow Up'],
    ['Amirul', '017-5295998', 'Outreach', 'sumugan', 'Follow Up'],
    ['Muhammad Syafiq', '018-2859041', 'Outreach', 'sumugan', 'Follow Up'],
    ['Riz', '016-2379191', 'Outreach', 'sumugan', 'Follow Up'],
    ['Mr Yong', '016-5766271', 'Outreach', 'sumugan', 'Follow Up'],
    ['Izzat', '017-3029152', 'Outreach', 'nisya', 'Follow Up'],
    ['Yoge', '011-37933660', 'Outreach', 'nisya', 'Not Interested'],
    ['Essah', '017-3899015', 'Outreach', 'nisya', 'Not Interested'],
    ['Siti', '017-3899015', 'Outreach', 'nisya', 'Not Interested'],
    ['Nur', '012-8931338', 'Outreach', 'nisya', 'Not Interested'],
    ['Syed Khan', '011-27093409', 'Outreach', 'nisya', 'Not Interested'],
    ['Fatin', '017-3542290', 'Outreach', 'nisya', 'Not Interested'],
    ['Qama', '011-65217362', 'Outreach', 'nisya', 'Not Interested'],
    ['Sofea Nadhirah', '012-6456937', 'Referral', 'nisya', 'Not Interested'],
    ['Syafaah', '013-9272121', 'Referral', 'nisya', 'Not Interested'],
    ['Syahirah', '013-9312121', 'Referral', 'nisya', 'Not Interested'],
    ['Hazrin', '013-4561501', 'Walk-in', 'nisya', 'Closed'],
    ['Norashimah', '013-4561501', 'Walk-in', 'nisya', 'Closed'],
    ['Dusyant', '016-2041437', 'Walk-in', 'nisya', 'Closed'],
    ['Ratheesan', '017-2286399', 'Walk-in', 'nisya', 'Closed'],
    ['Alim', '017-6320983', 'Outreach', 'sumugan', 'Follow Up'],
    ['Najlaa', '', 'Walk-in', 'nisya', 'Closed'],
    ['Najwa', '017-2898918', 'Walk-in', 'nisya', 'Follow Up'],
    ['Charmaine Tan', '017-2002980', 'Website', 'nisya', 'Closed'],
    ['Ola Ali', '018-3734031', 'Website', 'nisya', 'Not Interested'],
    ['Joseph Lim', '017-9328244', 'Website', 'nisya', 'Not Interested'],
    ['Akmal Aqil', '017-8485811', 'Website', 'nisya', 'Not Interested'],
    ['Hairie Quzaimi', '012-2500706', 'Website', 'nisya', 'Not Interested'],
    ['Nurin Jazlina', '011-75226843', 'Website', 'nisya', 'Not Interested'],
    ['William', '010-3943940', 'WhatsApp', 'nisya', 'Not Interested'],
    ['Ashley', '012-3330308', 'WhatsApp', 'nisya', 'Not Interested'],
    ['Amirul', '019-3609177', 'WhatsApp', 'nisya', 'Not Interested'],
  ];

  const date = '2026-06-23';
  const owners = ['sumugan', 'fatihah'];

  for (let i = 0; i < leads.length; i++) {
    const [name, phone, source, , stage] = leads[i];
    const assignedOwner = owners[i % 2];
    const temp = (stage === 'APPT' || stage === 'Follow Up' || stage === 'Show') ? 'Hot' : 'Cold';
    const trail = JSON.stringify([{ at: date, by: 'seed', action: 'created' }]);
    await pool.query(
      'INSERT INTO leads (name, phone, source, stage, temperature, date_added, last_touched, notes, owner, branch, audit_trail) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
      [name, phone, source || '', stage, temp, date, date, '', assignedOwner, 'sb', trail]
    );
  }
  console.log(`Seeded ${leads.length} leads`);
}

// One-time migration: the original seed stamped every lead 2026-06-23.
// Spread those historical leads over real time: Sumugan from Sep 2025,
// Fatihah (started Apr 2026) gets a significantly smaller share from Apr 2026.
// July 2026 stays empty. Leads added by users (different dates) are untouched.
async function redistributeSeedLeads() {
  const { rows } = await pool.query(
    "SELECT id, last_touched FROM leads WHERE date_added = '2026-06-23' ORDER BY id"
  );
  if (rows.length === 0) return;

  const fatCount = Math.round(rows.length * 0.23);
  const fatMonths = ['2026-04', '2026-05', '2026-06'];
  const sumMonths = ['2025-09','2025-10','2025-11','2025-12','2026-01','2026-02','2026-03','2026-04','2026-05','2026-06'];

  // pick every ~4th lead for Fatihah so both keep a mix of stages/sources
  const fatIds = new Set();
  const step = rows.length / fatCount;
  for (let k = 0; k < fatCount; k++) fatIds.add(rows[Math.floor(k * step)].id);

  const sumTotal = rows.length - fatIds.size;
  let si = 0, fi = 0;
  for (const r of rows) {
    const isFat = fatIds.has(r.id);
    const months = isFat ? fatMonths : sumMonths;
    const idx = isFat ? fi++ : si++;
    const total = isFat ? fatIds.size : sumTotal;
    const month = months[Math.min(months.length - 1, Math.floor(idx * months.length / total))];
    const day = String(1 + ((idx * 7) % 28)).padStart(2, '0');
    const date = `${month}-${day}`;
    await pool.query(
      `UPDATE leads SET owner = $1, date_added = $2,
         last_touched = CASE WHEN last_touched = '2026-06-23' THEN $2 ELSE last_touched END
       WHERE id = $3`,
      [isFat ? 'fatihah' : 'sumugan', date, r.id]
    );
  }
  console.log(`Redistributed ${rows.length} seed leads: ${sumTotal} to sumugan (Sep 2025 - Jun 2026), ${fatIds.size} to fatihah (Apr - Jun 2026)`);
}

async function seedTargets() {
  const { rows } = await pool.query('SELECT COUNT(*) AS c FROM targets');
  if (parseInt(rows[0].c) > 0) return;

  const month = '2026-07';
  await pool.query('INSERT INTO targets (owner, month, leads_target) VALUES ($1, $2, $3) ON CONFLICT (owner, month) DO UPDATE SET leads_target = $3', ['sumugan', month, 20]);
  await pool.query('INSERT INTO targets (owner, month, leads_target) VALUES ($1, $2, $3) ON CONFLICT (owner, month) DO UPDATE SET leads_target = $3', ['fatihah', month, 20]);
  console.log('Seeded targets');
}

async function initialize() {
  await initDB();
  await seedUsers();
  await seedLeads();
  await redistributeSeedLeads();
  await seedTargets();
}

module.exports = { pool, initialize };
