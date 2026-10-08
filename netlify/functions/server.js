const serverless = require('serverless-http');
const express = require('express');
const cors = require('cors');
const cookieSession = require('cookie-session');
const { query, initDb } = require('../../db');

const app = express();

// Initialize database once
let dbInitialized = false;
(async () => {
  if (!dbInitialized) {
    try {
      await initDb();
      dbInitialized = true;
      console.log('Database initialized');
    } catch (err) {
      console.error('Failed to initialize database:', err);
    }
  }
})();

// ─────────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────────

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(cookieSession({
  name: 'session',
  keys: [process.env.SESSION_SECRET || 'PLEASE_SET_SESSION_SECRET_IN_NETLIFY_UI'],
  maxAge: 24 * 60 * 60 * 1000,
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax'
}));

// ─────────────────────────────────────────────
// DEBUG & HEALTH
// ─────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    env: {
      DATABASE_URL: process.env.DATABASE_URL ? 'SET' : 'MISSING',
      SESSION_SECRET: process.env.SESSION_SECRET ? 'SET' : 'MISSING'
    }
  });
});

app.post('/api/admin/init-db', async (req, res) => {
  try {
    console.log('Starting database initialization...');
    await initDb();
    dbInitialized = true;
    res.json({ success: true, message: 'Database initialized successfully' });
  } catch (err) {
    console.error('Init DB error:', err);
    res.status(500).json({ error: err.message, details: err.toString() });
  }
});

// ─────────────────────────────────────────────
// AUTH MIDDLEWARE
// ─────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  res.status(401).json({ error: 'Login diperlukan' });
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.userRole === 'admin') {
    return next();
  }
  res.status(403).json({ error: 'Akses admin diperlukan' });
}

// ─────────────────────────────────────────────
// AUTH ROUTES
// ─────────────────────────────────────────────

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username dan password diperlukan' });
    }

    const result = await query('SELECT * FROM users WHERE username = $1', [username]);
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Username tidak ditemukan' });
    }

    if (user.password !== password) {
      return res.status(401).json({ error: 'Password salah' });
    }

    req.session.userId = user.id;
    req.session.userRole = user.role;
    req.session.username = user.username;

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
        shift_group: user.shift_group
      }
    });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Server error: ' + e.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session = null;
  res.json({ success: true });
});

app.get('/api/auth/session', async (req, res) => {
  try {
    if (req.session && req.session.userId) {
      const result = await query('SELECT id, username, full_name, role, shift_group FROM users WHERE id = $1', [req.session.userId]);
      const user = result.rows[0];
      if (user) {
        return res.json({ authenticated: true, user });
      }
    }
    res.json({ authenticated: false });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: 'Password lama dan baru diperlukan' });
    }
    if (newPassword.length < 4) {
      return res.status(400).json({ error: 'Password baru minimal 4 karakter' });
    }

    const userResult = await query('SELECT * FROM users WHERE id = $1', [req.session.userId]);
    const user = userResult.rows[0];

    if (!user) {
      return res.status(404).json({ error: 'User tidak ditemukan' });
    }

    if (user.password !== oldPassword) {
      return res.status(401).json({ error: 'Password lama salah' });
    }

    await query('UPDATE users SET password = $1 WHERE id = $2', [newPassword, req.session.userId]);
    res.json({ success: true, message: 'Password berhasil diubah' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// ADMIN - MONTHS LIST
// ─────────────────────────────────────────────

app.get('/api/admin/months', requireAdmin, async (req, res) => {
  try {
    const result = await query('SELECT DISTINCT month FROM import_history ORDER BY month DESC');
    res.json({ success: true, data: result.rows.map(m => m.month) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// ADMIN - DASHBOARD STATS
// ─────────────────────────────────────────────

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const { month } = req.query;

    let recapResult;
    if (month) {
      recapResult = await query('SELECT * FROM attendance_recap WHERE month = $1', [month]);
    } else {
      recapResult = await query('SELECT * FROM attendance_recap');
    }

    const recap = recapResult.rows;

    const empResult = await query('SELECT COUNT(*) as cnt FROM users WHERE role = $1', ['karyawan']);
    const totalEmployees = parseInt(empResult.rows[0].cnt);

    const totalOnTime = recap.reduce((s, r) => s + (r.days_on_time || 0), 0);
    const totalLateToleransi = recap.reduce((s, r) => s + (r.days_late_toleransi || 0), 0);
    const totalLatePotongan = recap.reduce((s, r) => s + (r.days_late_potongan || 0), 0);
    const totalEarlyLeave = recap.reduce((s, r) => s + (r.days_early_leave || 0), 0);
    const totalNoCheckin = recap.reduce((s, r) => s + (r.days_no_checkin || 0), 0);
    const totalNoCheckout = recap.reduce((s, r) => s + (r.days_no_checkout || 0), 0);
    const totalDays = recap.reduce((s, r) => s + (r.days_recorded || 0), 0);
    const totalLateMinutes = recap.reduce((s, r) => s + (r.total_late_minutes || 0), 0);

    let importHistoryResult;
    if (month) {
      importHistoryResult = await query('SELECT * FROM import_history WHERE month = $1 ORDER BY imported_at DESC', [month]);
    } else {
      importHistoryResult = await query('SELECT * FROM import_history ORDER BY imported_at DESC');
    }

    res.json({
      success: true,
      totalEmployees,
      totalDays,
      totalOnTime,
      totalLateToleransi,
      totalLatePotongan,
      totalEarlyLeave,
      totalNoCheckin,
      totalNoCheckout,
      totalLateMinutes,
      importHistory: importHistoryResult.rows,
      attendanceRate: totalDays > 0 ? Math.round((totalOnTime / totalDays) * 1000) / 10 : 0
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// ADMIN - RECAP PER KARYAWAN
// ─────────────────────────────────────────────

app.get('/api/admin/recap', requireAdmin, async (req, res) => {
  try {
    const { search, sort = 'employee_name', order = 'asc', month } = req.query;

    let query_str = 'SELECT * FROM attendance_recap WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (month) {
      query_str += ` AND month = $${paramIndex++}`;
      params.push(month);
    }
    if (search) {
      query_str += ` AND employee_name ILIKE $${paramIndex++}`;
      params.push(`%${search}%`);
    }

    const allowedSorts = ['employee_name', 'days_recorded', 'days_on_time', 'days_late_toleransi', 'days_late_potongan', 'total_late_minutes'];
    if (allowedSorts.includes(sort)) {
      const sortOrder = order === 'desc' ? 'DESC' : 'ASC';
      query_str += ` ORDER BY ${sort} ${sortOrder}`;
    } else {
      query_str += ' ORDER BY employee_name ASC';
    }

    const result = await query(query_str, params);
    res.json({ success: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// ADMIN - DETAIL HARIAN
// ─────────────────────────────────────────────

app.get('/api/admin/detail', requireAdmin, async (req, res) => {
  try {
    const { employee, day, month } = req.query;

    let query_str = 'SELECT * FROM attendance_daily WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (month) {
      query_str += ` AND month = $${paramIndex++}`;
      params.push(month);
    }
    if (employee) {
      query_str += ` AND employee_name = $${paramIndex++}`;
      params.push(employee);
    }
    if (day) {
      query_str += ` AND day_number = $${paramIndex++}`;
      params.push(parseInt(day));
    }
    query_str += ' ORDER BY employee_name, day_number';

    const result = await query(query_str, params);
    res.json({ success: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/employees-list', requireAdmin, async (req, res) => {
  try {
    const result = await query('SELECT DISTINCT employee_name FROM attendance_recap ORDER BY employee_name');
    res.json({ success: true, data: result.rows.map(d => d.employee_name) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// ADMIN - LEAVE BALANCE
// ─────────────────────────────────────────────

app.get('/api/admin/leave-balance', requireAdmin, async (req, res) => {
  try {
    const { search } = req.query;
    let query_str = 'SELECT * FROM leave_balance WHERE 1=1';
    const params = [];

    if (search) {
      query_str += ' AND employee_name ILIKE $1';
      params.push('%' + search + '%');
    }
    query_str += ' ORDER BY employee_name ASC';

    const result = await query(query_str, params);
    res.json({ success: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/leave-balance', requireAdmin, async (req, res) => {
  try {
    const { employee_name, total_days } = req.body;
    if (!employee_name) {
      return res.status(400).json({ error: 'Nama karyawan wajib diisi' });
    }

    const days = parseInt(total_days) || 12;
    const existingResult = await query('SELECT * FROM leave_balance WHERE employee_name = $1', [employee_name]);
    const existing = existingResult.rows[0];

    if (existing) {
      await query('UPDATE leave_balance SET total_days = $1, updated_at = CURRENT_TIMESTAMP WHERE employee_name = $2', [days, employee_name]);
    } else {
      await query('INSERT INTO leave_balance (employee_name, total_days) VALUES ($1, $2)', [employee_name, days]);
    }

    res.json({ success: true, message: 'Data cuti berhasil disimpan' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/leave-balance/deduct', requireAdmin, async (req, res) => {
  try {
    const { employee_name, days, month, year, reason } = req.body;
    if (!employee_name) {
      return res.status(400).json({ error: 'Nama karyawan wajib diisi' });
    }

    const deductDays = parseInt(days) || 1;
    const balResult = await query('SELECT * FROM leave_balance WHERE employee_name = $1', [employee_name]);
    const bal = balResult.rows[0];

    if (!bal) {
      return res.status(404).json({ error: 'Data cuti tidak ditemukan untuk karyawan ini' });
    }

    if ((bal.used_days || 0) + deductDays > bal.total_days) {
      return res.status(400).json({ error: 'Sisa cuti tidak mencukupi (sisa: ' + (bal.total_days - (bal.used_days || 0)) + ' hari)' });
    }

    const m = parseInt(month) || (new Date().getMonth() + 1);
    const y = parseInt(year) || new Date().getFullYear();
    const usedAt = y + '-' + String(m).padStart(2, '0') + '-01';

    await query('UPDATE leave_balance SET used_days = (COALESCE(used_days, 0) + $1), updated_at = CURRENT_TIMESTAMP WHERE employee_name = $2', [deductDays, employee_name]);
    await query('INSERT INTO leave_history (employee_name, days_used, reason, used_at) VALUES ($1, $2, $3, $4)', [employee_name, deductDays, reason || '-', usedAt]);

    res.json({ success: true, message: 'Cuti berhasil dikurangi ' + deductDays + ' hari' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/leave-balance', requireAdmin, async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) {
      return res.status(400).json({ error: 'ID tidak valid' });
    }

    const rowResult = await query('SELECT employee_name FROM leave_balance WHERE id = $1', [id]);
    const row = rowResult.rows[0];

    if (row) {
      await query('DELETE FROM leave_history WHERE employee_name = $1', [row.employee_name]);
    }

    await query('DELETE FROM leave_balance WHERE id = $1', [id]);
    res.json({ success: true, message: 'Data cuti berhasil dihapus' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/leave-history', requireAdmin, async (req, res) => {
  try {
    const { employee_name } = req.query;
    let query_str = 'SELECT * FROM leave_history WHERE 1=1';
    const params = [];

    if (employee_name) {
      query_str += ' AND employee_name = $1';
      params.push(employee_name);
    }
    query_str += ' ORDER BY used_at DESC';

    const result = await query(query_str, params);
    res.json({ success: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/leave-history', requireAdmin, async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) {
      return res.status(400).json({ error: 'ID tidak valid' });
    }

    const rowResult = await query('SELECT * FROM leave_history WHERE id = $1', [id]);
    const row = rowResult.rows[0];

    if (!row) {
      return res.status(404).json({ error: 'Riwayat tidak ditemukan' });
    }

    const balResult = await query('SELECT * FROM leave_balance WHERE employee_name = $1', [row.employee_name]);
    const bal = balResult.rows[0];

    if (bal) {
      const newUsed = Math.max(0, (bal.used_days || 0) - row.days_used);
      await query('UPDATE leave_balance SET used_days = $1, updated_at = CURRENT_TIMESTAMP WHERE employee_name = $2', [newUsed, row.employee_name]);
    }

    await query('DELETE FROM leave_history WHERE id = $1', [id]);
    res.json({ success: true, message: 'Riwayat cuti berhasil dihapus' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/leave-balance/batch', requireAdmin, async (req, res) => {
  try {
    const { total_days } = req.body;
    const days = parseInt(total_days) || 12;

    const empResult = await query('SELECT DISTINCT full_name FROM users WHERE role = $1', ['karyawan']);
    const employees = empResult.rows;

    for (const emp of employees) {
      const existingResult = await query('SELECT * FROM leave_balance WHERE employee_name = $1', [emp.full_name]);
      const existing = existingResult.rows[0];

      if (existing) {
        await query('UPDATE leave_balance SET total_days = $1, updated_at = CURRENT_TIMESTAMP WHERE employee_name = $2', [days, emp.full_name]);
      } else {
        await query('INSERT INTO leave_balance (employee_name, total_days) VALUES ($1, $2)', [emp.full_name, days]);
      }
    }

    res.json({ success: true, message: 'Jatah cuti ' + days + ' hari berhasil diatur untuk ' + employees.length + ' karyawan' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// KARYAWAN - MY ATTENDANCE
// ─────────────────────────────────────────────

app.get('/api/karyawan/my-recap', requireAuth, async (req, res) => {
  try {
    const userResult = await query('SELECT full_name FROM users WHERE id = $1', [req.session.userId]);
    const user = userResult.rows[0];
    const name = user ? user.full_name : req.session.username;
    const { month } = req.query;

    let recap;
    if (month) {
      const result = await query('SELECT * FROM attendance_recap WHERE LOWER(employee_name) = LOWER($1) AND month = $2', [name, month]);
      recap = result.rows[0];
    } else {
      const result = await query('SELECT * FROM attendance_recap WHERE LOWER(employee_name) = LOWER($1) ORDER BY month DESC LIMIT 1', [name]);
      recap = result.rows[0];
    }

    res.json({ success: true, data: recap || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/karyawan/my-leave', requireAuth, async (req, res) => {
  try {
    const userResult = await query('SELECT full_name FROM users WHERE id = $1', [req.session.userId]);
    const user = userResult.rows[0];
    const name = user ? user.full_name : req.session.username;

    const balResult = await query('SELECT * FROM leave_balance WHERE LOWER(employee_name) = LOWER($1)', [name]);
    const balance = balResult.rows[0];

    const histResult = await query('SELECT * FROM leave_history WHERE LOWER(employee_name) = LOWER($1) ORDER BY used_at DESC', [name]);
    const history = histResult.rows;

    res.json({
      success: true,
      balance: balance || { employee_name: name, total_days: 12, used_days: 0 },
      history
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/karyawan/my-detail', requireAuth, async (req, res) => {
  try {
    const userResult = await query('SELECT full_name FROM users WHERE id = $1', [req.session.userId]);
    const user = userResult.rows[0];
    const name = user ? user.full_name : req.session.username;
    const { month } = req.query;

    let data;
    if (month) {
      const result = await query('SELECT * FROM attendance_daily WHERE LOWER(employee_name) = LOWER($1) AND month = $2 ORDER BY day_number', [name, month]);
      data = result.rows;
    } else {
      const result = await query('SELECT * FROM attendance_daily WHERE LOWER(employee_name) = LOWER($1) ORDER BY month DESC, day_number', [name]);
      data = result.rows;
    }

    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// LEAVE APPLICATIONS
// ─────────────────────────────────────────────

app.get('/api/karyawan/my-applications', requireAuth, async (req, res) => {
  try {
    const userResult = await query('SELECT full_name FROM users WHERE id = $1', [req.session.userId]);
    const user = userResult.rows[0];
    const name = user ? user.full_name : req.session.username;

    const result = await query('SELECT * FROM leave_applications WHERE employee_name = $1 ORDER BY created_at DESC', [name]);
    res.json({ success: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/applications', requireAdmin, async (req, res) => {
  try {
    const { status, employee } = req.query;
    let query_str = 'SELECT * FROM leave_applications WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (status && status !== 'semua') {
      query_str += ` AND status = $${paramIndex++}`;
      params.push(status);
    }
    if (employee) {
      query_str += ` AND employee_name ILIKE $${paramIndex++}`;
      params.push('%' + employee + '%');
    }
    query_str += ' ORDER BY created_at DESC';

    const result = await query(query_str, params);
    res.json({ success: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/applications/:id/status', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { status, admin_note } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Status harus approved atau rejected' });
    }

    const appResult = await query('SELECT * FROM leave_applications WHERE id = $1', [id]);
    const app = appResult.rows[0];

    if (!app) {
      return res.status(404).json({ error: 'Pengajuan tidak ditemukan' });
    }

    await query('UPDATE leave_applications SET status = $1, admin_note = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3', [status, admin_note || '-', id]);

    const notifTitle = status === 'approved' ? 'Pengajuan Disetujui' : 'Pengajuan Ditolak';
    const notifMsg = 'Pengajuan ' + app.application_type + ' Anda (' + app.start_date + ' s/d ' + app.end_date + ') ' + (status === 'approved' ? 'disetujui' : 'ditolak') + '.' + (admin_note && admin_note !== '-' ? ' Catatan: ' + admin_note : '');

    await query('INSERT INTO notifications (title, message, target_role, type) VALUES ($1, $2, $3, $4)', [notifTitle, notifMsg, 'karyawan', status === 'approved' ? 'success' : 'warning']);

    res.json({ success: true, message: 'Pengajuan ' + status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/applications/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await query('DELETE FROM leave_applications WHERE id = $1', [id]);
    res.json({ success: true, message: 'Pengajuan berhasil dihapus' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// NOTIFICATIONS
// ─────────────────────────────────────────────

app.get('/api/admin/notifications', requireAdmin, async (req, res) => {
  try {
    const result = await query('SELECT * FROM notifications WHERE target_role IN ($1, $2) ORDER BY created_at DESC LIMIT 50', ['admin', 'all']);
    res.json({ success: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/karyawan/notifications', requireAuth, async (req, res) => {
  try {
    const result = await query('SELECT * FROM notifications WHERE target_role IN ($1, $2) ORDER BY created_at DESC LIMIT 50', ['karyawan', 'all']);
    res.json({ success: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/karyawan/notifications/read', requireAuth, async (req, res) => {
  try {
    await query('UPDATE notifications SET is_read = 1 WHERE target_role IN ($1, $2)', ['karyawan', 'all']);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/notifications/read', requireAdmin, async (req, res) => {
  try {
    await query('UPDATE notifications SET is_read = 1 WHERE target_role IN ($1, $2)', ['admin', 'all']);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/notifications/unread-count', requireAuth, async (req, res) => {
  try {
    const role = req.session.userRole || 'karyawan';
    const result = await query('SELECT COUNT(*) as cnt FROM notifications WHERE (target_role = $1 OR target_role = $2) AND is_read = 0', [role, 'all']);
    const count = parseInt(result.rows[0].cnt);
    res.json({ success: true, count });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// ANNOUNCEMENTS
// ─────────────────────────────────────────────

app.post('/api/admin/announcements', requireAdmin, async (req, res) => {
  try {
    const { title, content } = req.body;
    if (!title || !content) {
      return res.status(400).json({ error: 'Judul dan konten wajib diisi' });
    }

    const userResult = await query('SELECT full_name FROM users WHERE id = $1', [req.session.userId]);
    const user = userResult.rows[0];
    const name = user ? user.full_name : req.session.username;

    const insertResult = await query('INSERT INTO announcements (title, content, created_by) VALUES ($1, $2, $3) RETURNING id', [title, content, name]);

    await query('INSERT INTO notifications (title, message, target_role, type) VALUES ($1, $2, $3, $4)', ['Pengumuman Baru', content.length > 50 ? content.substring(0, 50) + '...' : content, 'karyawan', 'info']);

    res.json({ success: true, message: 'Pengumuman berhasil dibuat', announcementId: insertResult.rows[0].id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/karyawan/announcements', requireAuth, async (req, res) => {
  try {
    const result = await query('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 20');
    res.json({ success: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/announcements/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await query('DELETE FROM announcements WHERE id = $1', [id]);
    res.json({ success: true, message: 'Pengumuman dihapus' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// INIT DB & EXPORT HANDLER
// ─────────────────────────────────────────────

// Initialize database on cold start
initDb().catch(e => console.error('DB init error:', e));

module.exports.handler = serverless(app);
