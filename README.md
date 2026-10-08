# AbsensiHub - Netlify Serverless Edition

Sistem Absensi Karyawan yang dioptimalkan untuk deployment di Netlify dengan PostgreSQL/Supabase sebagai database backend.

## Stack

- **Frontend**: HTML, CSS, JavaScript (Vanilla)
- **Backend**: Express.js via Netlify Functions (serverless)
- **Database**: PostgreSQL (Supabase)
- **Session**: cookie-session (persisten via HTTP cookie, tidak bergantung pada memori server)

## Setup

### 1. Persiapan Lokal

```bash
cd C:\Users\USER\Downloads\Absensi-netlify
npm install
```

### 2. Environment Variables (Netlify)

Di Netlify Dashboard → Site configuration → Environment variables, set:

- `DATABASE_URL`: PostgreSQL connection string dari Supabase
- `SESSION_SECRET`: Random string bebas

### 3. Deploy

```bash
git init
git add .
git commit -m "Initial commit: AbsensiHub Netlify serverless edition"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

Netlify akan auto-deploy. Tunggu selesai (~2 menit).

## Fitur

- ✅ Login/Logout dengan session berbasis cookie
- ✅ Admin Dashboard (stats, recap, detail, cuti, pengajuan, pengumuman)
- ✅ Karyawan Dashboard (lihat rekap pribadi, history cuti, pengajuan izin/cuti/sakit, notifikasi)
- ✅ Notifikasi real-time (polling setiap 30 detik)
- ✅ Leave Management (saldo cuti, history, batch set)
- ✅ Leave Applications (pengajuan izin/cuti/sakit)
- ✅ Announcements (pengumuman admin)

## API Endpoints

### Auth
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/session`
- `POST /api/auth/change-password`

### Admin
- `GET /api/admin/stats` - Dashboard statistics
- `GET /api/admin/months` - Available data months
- `GET /api/admin/recap` - Employee recap summary
- `GET /api/admin/detail` - Daily attendance details
- `GET /api/admin/employees-list` - Employee names
- `GET /api/admin/leave-balance` - Leave balance management
- `POST /api/admin/leave-balance` - Create/update leave balance
- `POST /api/admin/leave-balance/deduct` - Deduct leave days
- `POST /api/admin/leave-balance/batch` - Batch set leave for all employees
- `GET /api/admin/leave-history` - Leave usage history
- `DELETE /api/admin/leave-history` - Delete leave history record
- `GET /api/admin/applications` - Leave applications list
- `POST /api/admin/applications/:id/status` - Approve/reject application
- `DELETE /api/admin/applications/:id` - Delete application
- `POST /api/admin/announcements` - Create announcement
- `DELETE /api/admin/announcements/:id` - Delete announcement
- `GET /api/admin/notifications` - Admin notifications
- `POST /api/admin/notifications/read` - Mark notifications as read

### Karyawan
- `GET /api/karyawan/my-recap` - My attendance summary
- `GET /api/karyawan/my-detail` - My daily attendance
- `GET /api/karyawan/my-leave` - My leave balance & history
- `GET /api/karyawan/my-applications` - My leave applications
- `GET /api/karyawan/announcements` - Public announcements
- `GET /api/karyawan/notifications` - Notifications
- `POST /api/karyawan/notifications/read` - Mark as read

## Akun Default

- **Admin**: `admin` / `admin123`
- **Karyawan**: nama (dari database)

Ubah password setelah login.

## Deployment Notes

- Session berbasis cookie (HTTP-only, secure pada production)
- Database connection pool (max 5 concurrent connections)
- CORS enabled untuk production
- Secrets scanning enabled di Netlify (no hardcoded secrets)

---

Created: 2026-10-08
