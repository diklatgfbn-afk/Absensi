const { Pool } = require('pg');

let pool;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return pool;
}

async function query(text, params) {
  const p = getPool();
  const res = await p.query(text, params);
  return res;
}

async function initDb() {
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL DEFAULT 'password123',
      role VARCHAR(50) CHECK(role IN ('admin','karyawan')) NOT NULL DEFAULT 'karyawan',
      full_name VARCHAR(255) NOT NULL,
      shift_group VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS attendance_daily (
      id SERIAL PRIMARY KEY,
      employee_name VARCHAR(255) NOT NULL,
      month VARCHAR(7) NOT NULL DEFAULT '2024-06',
      day_number INTEGER NOT NULL,
      day_name VARCHAR(50),
      check_in VARCHAR(10),
      check_out VARCHAR(10),
      shift_detected VARCHAR(50),
      late_minutes INTEGER DEFAULT 0,
      status VARCHAR(100),
      imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(employee_name, day_number, month)
    );

    CREATE TABLE IF NOT EXISTS attendance_recap (
      id SERIAL PRIMARY KEY,
      employee_name VARCHAR(255) NOT NULL,
      month VARCHAR(7) NOT NULL DEFAULT '2024-06',
      days_recorded INTEGER DEFAULT 0,
      days_on_time INTEGER DEFAULT 0,
      days_late_toleransi INTEGER DEFAULT 0,
      days_late_potongan INTEGER DEFAULT 0,
      days_early_leave INTEGER DEFAULT 0,
      days_no_checkin INTEGER DEFAULT 0,
      days_no_checkout INTEGER DEFAULT 0,
      total_late_minutes INTEGER DEFAULT 0,
      no_schedule INTEGER DEFAULT 0,
      imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(employee_name, month)
    );

    CREATE TABLE IF NOT EXISTS import_history (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) NOT NULL,
      month VARCHAR(7) NOT NULL,
      total_employees INTEGER,
      total_records INTEGER,
      imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS leave_balance (
      id SERIAL PRIMARY KEY,
      employee_name VARCHAR(255) UNIQUE NOT NULL,
      total_days INTEGER NOT NULL DEFAULT 12,
      used_days INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS leave_history (
      id SERIAL PRIMARY KEY,
      employee_name VARCHAR(255) NOT NULL,
      days_used INTEGER NOT NULL DEFAULT 1,
      reason TEXT,
      used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS leave_applications (
      id SERIAL PRIMARY KEY,
      employee_name VARCHAR(255) NOT NULL,
      application_type VARCHAR(50) NOT NULL CHECK(application_type IN ('izin','cuti','sakit')),
      start_date VARCHAR(10) NOT NULL,
      end_date VARCHAR(10) NOT NULL,
      reason TEXT,
      screenshot_path TEXT,
      status VARCHAR(50) DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      admin_note TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      message TEXT,
      target_role VARCHAR(50) DEFAULT 'all' CHECK(target_role IN ('all','admin','karyawan')),
      type VARCHAR(50) DEFAULT 'info' CHECK(type IN ('info','warning','success')),
      is_read INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      content TEXT NOT NULL,
      created_by VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Pastikan admin ada
  const adminCheck = await p.query("SELECT id FROM users WHERE username = 'admin'");
  if (adminCheck.rows.length === 0) {
    await p.query(
      "INSERT INTO users (username, password, role, full_name) VALUES ('admin', 'admin123', 'admin', 'Administrator')"
    );
    console.log('Admin user initialized: admin / admin123');
  }
}

module.exports = { query, initDb, getPool };
