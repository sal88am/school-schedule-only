const path = require("path");
const Database = require("better-sqlite3");

const dbPath = path.join(__dirname, "..", "data", "school.db");
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

// القيمة الافتراضية لأيام الدوام (الأحد-الخميس) إذا ما محددة
const existingDays = db.prepare("SELECT value FROM settings WHERE key = 'working_days'").get();
if (!existingDays) {
  db.prepare("INSERT INTO settings (key, value) VALUES ('working_days', ?)").run(
    JSON.stringify([0, 1, 2, 3, 4])
  );
}

// مواد افتراضية تُضاف تلقائياً أول مرة فقط (المستخدم يقدر يحذفها أو يضيف غيرها)
const subjectCount = db.prepare("SELECT COUNT(*) AS n FROM subjects").get().n;
if (subjectCount === 0) {
  const defaultSubjects = [
    "عربي", "اسلامية", "رياضيات", "انكليزي", "علوم", "اجتماعيات", "رياضة", "فنية",
  ];
  const insertSubject = db.prepare("INSERT OR IGNORE INTO subjects (name) VALUES (?)");
  defaultSubjects.forEach((name) => insertSubject.run(name));
}

module.exports = db;
