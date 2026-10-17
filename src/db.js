const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const dbPath = process.env.DB_PATH || path.join(__dirname, "..", "data", "school.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  specialty TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

-- علاقة متعددة: معلم واحد يقدر يدرّس أكثر من مادة (وبالتالي أكثر من مرحلة تلقائياً بالتوليد)
CREATE TABLE IF NOT EXISTS teacher_subjects (
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  PRIMARY KEY (teacher_id, subject_id)
);

-- الصف = مرحلة (الأول..السادس) + شعبة (أ، ب، ج...) تتولد تلقائياً
CREATE TABLE IF NOT EXISTS school_classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,       -- مثال: "الأول أ"
  grade TEXT NOT NULL,             -- مثال: "الأول"
  section TEXT NOT NULL,           -- مثال: "أ"
  periods_per_day INTEGER NOT NULL DEFAULT 6
);

-- توقيت كل رقم حصة — يمكن يكون نفسه لكل الأيام، أو مختلف ليوم معيّن (day_of_week = -1 يعني "افتراضي لكل الأيام")
CREATE TABLE IF NOT EXISTS period_times (
  day_of_week INTEGER NOT NULL,   -- -1 = توقيت افتراضي يطبّق على كل الأيام، أو 0..6 ليوم محدد فقط
  period_number INTEGER NOT NULL,
  start_time TEXT,
  end_time TEXT,
  PRIMARY KEY (day_of_week, period_number)
);

-- إعدادات عامة (مثل أيام الدوام) بصيغة مفتاح/قيمة
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  class_id INTEGER NOT NULL REFERENCES school_classes(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL,     -- 0=الأحد .. 6=السبت
  period_number INTEGER NOT NULL,
  UNIQUE(class_id, day_of_week, period_number),
  UNIQUE(teacher_id, day_of_week, period_number)
);
`);

// ترحيل تلقائي: أي معلم عنده تخصص قديم (حقل نصي) بس ما عنده صفوف بجدول teacher_subjects بعد
// يُربط تلقائياً بالمادة المطابقة لاسم تخصصه (مرة وحدة فقط، لضمان التوافق مع البيانات القديمة)
const subjectsAlreadyTenant = db.prepare("PRAGMA table_info(subjects)").all().some((c) => c.name === "school_id");
const legacyTeachers = subjectsAlreadyTenant ? [] : db
  .prepare(
    `SELECT t.id, t.specialty FROM teachers t
     WHERE t.specialty IS NOT NULL AND t.specialty != ''
     AND NOT EXISTS (SELECT 1 FROM teacher_subjects ts WHERE ts.teacher_id = t.id)`
  )
  .all();
if (legacyTeachers.length > 0) {
  const linkStmt = db.prepare(
    "INSERT OR IGNORE INTO teacher_subjects (teacher_id, subject_id) SELECT ?, id FROM subjects WHERE name = ?"
  );
  legacyTeachers.forEach((t) => linkStmt.run(t.id, t.specialty));
}

// ---------- ترحيل آمن (إضافة فقط — بدون DROP ولا حذف بيانات) ----------
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("teachers", "class_teacher_of", "INTEGER");
ensureColumn("subjects", "color", "TEXT");
ensureColumn("school_classes", "custom_periods_per_day", "INTEGER");

db.exec(`
CREATE TABLE IF NOT EXISTS schedule_shifts (
  shift_type TEXT PRIMARY KEY,            -- morning | evening
  label TEXT NOT NULL,
  start_time TEXT NOT NULL,
  period_count INTEGER NOT NULL DEFAULT 6,
  period_minutes INTEGER NOT NULL DEFAULT 40,
  break_minutes INTEGER NOT NULL DEFAULT 5
);

-- كل يوم يتبع شفت (morning/evening) أو NULL = عطلة
CREATE TABLE IF NOT EXISTS day_shift_config (
  day_of_week INTEGER PRIMARY KEY,
  shift_type TEXT REFERENCES schedule_shifts(shift_type)
);

-- مواد كل صف + عدد حصصها الأسبوعي + هل يُسمح بتكرارها في نفس اليوم
CREATE TABLE IF NOT EXISTS class_subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL REFERENCES school_classes(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  weekly_periods INTEGER NOT NULL DEFAULT 1,
  allow_same_day_repeat INTEGER NOT NULL DEFAULT 0,
  max_per_day INTEGER NOT NULL DEFAULT 1,
  UNIQUE(class_id, subject_id)
);

-- ربط المعلم بالصف والمادة
CREATE TABLE IF NOT EXISTS teacher_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  class_id INTEGER NOT NULL REFERENCES school_classes(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  UNIQUE(teacher_id, class_id, subject_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

const PALETTE = ["#2F4858", "#C98A3E", "#4C7A6B", "#8E5B45", "#5B6EA8", "#8B6F9E", "#B4533C", "#5D8A6E"];
module.exports = db;
module.exports.ensureColumn = ensureColumn;
module.exports.PALETTE = PALETTE;

// ---------- Phase 9: تعدد المدارس (ترحيل آمن + أول مدرسة) ----------
require("./migrations/multiTenant").run(db, ensureColumn, PALETTE);

// ---------- v5: عدد دروس لكل يوم + دروس مثبتة ----------
require("./migrations/scheduling").run(db, ensureColumn);
