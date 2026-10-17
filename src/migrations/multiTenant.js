// ترحيل تعدد المدارس — إضافة فقط: لا DROP TABLE ولا حذف بيانات.
// البيانات الحالية تصبح تابعة لـ «المدرسة الافتراضية».
const crypto = require("crypto");

const DEFAULT_SUBJECTS = ["عربي", "اسلامية", "رياضيات", "انكليزي", "علوم", "اجتماعيات", "رياضة", "فنية"];
const newShareCode = () => crypto.randomBytes(6).toString("hex");

// بيانات أولية لمدرسة جديدة (مواد، شفتات، أيام دوام، حالة الجدول)
function seedSchoolDefaults(db, sid, PALETTE, { withSubjects = true } = {}) {
  if (withSubjects) {
    const ins = db.prepare("INSERT OR IGNORE INTO subjects (school_id, name, color) VALUES (?,?,?)");
    DEFAULT_SUBJECTS.forEach((n, i) => ins.run(sid, n, PALETTE[(i + 1) % PALETTE.length]));
  }
  const sh = db.prepare("INSERT OR IGNORE INTO school_shifts (school_id, shift_type, label, start_time, period_count, period_minutes, break_minutes) VALUES (?,?,?,?,?,?,?)");
  sh.run(sid, "morning", "صباحي", "08:00", 6, 40, 5);
  sh.run(sid, "evening", "مسائي", "13:00", 6, 40, 5);
  const dc = db.prepare("INSERT OR IGNORE INTO school_day_config (school_id, day_of_week, shift_type) VALUES (?,?,?)");
  ["morning", "morning", "morning", "evening", "evening", null, null].forEach((t, d) => dc.run(sid, d, t));
  db.prepare("INSERT OR IGNORE INTO school_settings (school_id, key, value) VALUES (?, 'schedule_status', 'draft')").run(sid);
}

function run(db, ensureColumn, PALETTE) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS schools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    share_code TEXT NOT NULL UNIQUE,
    is_active INTEGER NOT NULL DEFAULT 1,
    subscription_status TEXT NOT NULL DEFAULT 'active',   -- active | trial | suspended | expired (بنية فقط، بدون فوترة)
    subscription_ends TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER REFERENCES schools(id),
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('super_admin','school_admin','teacher')),
    teacher_id INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS school_settings (
    school_id INTEGER NOT NULL REFERENCES schools(id),
    key TEXT NOT NULL,
    value TEXT,
    PRIMARY KEY (school_id, key)
  );
  CREATE TABLE IF NOT EXISTS school_shifts (
    school_id INTEGER NOT NULL REFERENCES schools(id),
    shift_type TEXT NOT NULL,
    label TEXT NOT NULL,
    start_time TEXT NOT NULL,
    period_count INTEGER NOT NULL DEFAULT 6,
    period_minutes INTEGER NOT NULL DEFAULT 40,
    break_minutes INTEGER NOT NULL DEFAULT 5,
    PRIMARY KEY (school_id, shift_type)
  );
  CREATE TABLE IF NOT EXISTS school_day_config (
    school_id INTEGER NOT NULL REFERENCES schools(id),
    day_of_week INTEGER NOT NULL,
    shift_type TEXT,
    PRIMARY KEY (school_id, day_of_week)
  );
  `);

  // ---- المدرسة الافتراضية ----
  let def = db.prepare("SELECT id FROM schools ORDER BY id LIMIT 1").get();
  let isNewDefault = false;
  if (!def) {
    const legacyName = db.prepare("SELECT value FROM settings WHERE key='school_name'").get();
    const r = db.prepare("INSERT INTO schools (name, share_code) VALUES (?, ?)").run((legacyName && legacyName.value) || "المدرسة الافتراضية", newShareCode());
    def = { id: Number(r.lastInsertRowid) };
    isNewDefault = true;
  }
  const D = def.id;

  // ---- إعادة بناء subjects و school_classes (كانت UNIQUE على الاسم عالمياً) ----
  // بدون DROP: إعادة تسمية القديم إلى *_pre_mt (يبقى كنسخة احتياطية) ثم إنشاء الجديد ونسخ البيانات بنفس الـ id.
  const hasCol = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some((x) => x.name === c);
  if (!hasCol("subjects", "school_id") || !hasCol("school_classes", "school_id")) {
    db.pragma("foreign_keys = OFF");
    db.pragma("legacy_alter_table = ON");
    try {
      db.exec("BEGIN");
      if (!hasCol("subjects", "school_id")) {
        db.exec(`ALTER TABLE subjects RENAME TO subjects_pre_mt;
          CREATE TABLE subjects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            school_id INTEGER NOT NULL REFERENCES schools(id),
            name TEXT NOT NULL,
            color TEXT,
            UNIQUE (school_id, name)
          );
          INSERT INTO subjects (id, school_id, name, color) SELECT id, ${D}, name, color FROM subjects_pre_mt;`);
      }
      if (!hasCol("school_classes", "school_id")) {
        db.exec(`ALTER TABLE school_classes RENAME TO school_classes_pre_mt;
          CREATE TABLE school_classes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            school_id INTEGER NOT NULL REFERENCES schools(id),
            name TEXT NOT NULL,
            grade TEXT NOT NULL,
            section TEXT NOT NULL,
            periods_per_day INTEGER NOT NULL DEFAULT 6,
            custom_periods_per_day INTEGER,
            UNIQUE (school_id, name)
          );
          INSERT INTO school_classes (id, school_id, name, grade, section, periods_per_day, custom_periods_per_day)
            SELECT id, ${D}, name, grade, section, periods_per_day, custom_periods_per_day FROM school_classes_pre_mt;`);
      }
      db.exec("COMMIT");
    } catch (e) {
      try { db.exec("ROLLBACK"); } catch (x) { /* ignore */ }
      throw e;
    } finally {
      db.pragma("legacy_alter_table = OFF");
      db.pragma("foreign_keys = ON");
    }
  }

  // ---- school_id على بقية الجداول ----
  ["teachers", "class_subjects", "teacher_assignments", "schedule", "audit_logs"].forEach((t) => {
    ensureColumn(t, "school_id", "INTEGER");
    db.prepare(`UPDATE ${t} SET school_id = ? WHERE school_id IS NULL`).run(D);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_${t}_school ON ${t}(school_id)`);
  });
  db.exec("CREATE INDEX IF NOT EXISTS idx_subjects_school ON subjects(school_id); CREATE INDEX IF NOT EXISTS idx_classes_school ON school_classes(school_id);");

  // ---- نسخ إعدادات النظام القديم (العالمية) إلى المدرسة الافتراضية ----
  const hasShifts = db.prepare("SELECT COUNT(*) AS n FROM school_shifts WHERE school_id=?").get(D).n > 0;
  if (!hasShifts) {
    const legacyShifts = db.prepare("SELECT * FROM schedule_shifts").all();
    if (legacyShifts.length) {
      const ins = db.prepare("INSERT OR IGNORE INTO school_shifts (school_id, shift_type, label, start_time, period_count, period_minutes, break_minutes) VALUES (?,?,?,?,?,?,?)");
      legacyShifts.forEach((s) => ins.run(D, s.shift_type, s.label, s.start_time, s.period_count, s.period_minutes, s.break_minutes));
      const insd = db.prepare("INSERT OR IGNORE INTO school_day_config (school_id, day_of_week, shift_type) VALUES (?,?,?)");
      db.prepare("SELECT * FROM day_shift_config").all().forEach((d) => insd.run(D, d.day_of_week, d.shift_type));
    }
    const insSet = db.prepare("INSERT OR IGNORE INTO school_settings (school_id, key, value) VALUES (?,?,?)");
    db.prepare("SELECT * FROM settings WHERE key != 'working_days'").all().forEach((r) => insSet.run(D, r.key, r.value));
  }
  // أي نقص (تثبيت جديد أو بيانات ناقصة) يُكمَّل بالقيم الافتراضية
  const hasSubjects = db.prepare("SELECT COUNT(*) AS n FROM subjects WHERE school_id=?").get(D).n > 0;
  seedSchoolDefaults(db, D, PALETTE, { withSubjects: isNewDefault && !hasSubjects });

  db.prepare("SELECT id FROM subjects WHERE color IS NULL").all().forEach((s) =>
    db.prepare("UPDATE subjects SET color = ? WHERE id = ?").run(PALETTE[s.id % PALETTE.length], s.id)
  );
}

module.exports = { run, seedSchoolDefaults, newShareCode };
