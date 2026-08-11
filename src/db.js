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

// توقيت افتراضي للحصص أول مرة فقط: صباحي (8:00) افتراضياً لكل الأيام،
// مع استثناء مسائي (1:00pm) للأربعاء والخميس — كل حصة 40 دقيقة واستراحة 5 دقائق، 6 حصص باليوم
const periodTimeCount = db.prepare("SELECT COUNT(*) AS n FROM period_times").get().n;
if (periodTimeCount === 0) {
  const upsert = db.prepare(
    "INSERT INTO period_times (day_of_week, period_number, start_time, end_time) VALUES (?, ?, ?, ?)"
  );

  function buildPeriods(startHour, startMinute, count, periodMinutes, breakMinutes) {
    const rows = [];
    let cursor = startHour * 60 + startMinute;
    for (let i = 1; i <= count; i++) {
      const start = cursor;
      const end = start + periodMinutes;
      rows.push([i, minutesToTime(start), minutesToTime(end)]);
      cursor = end + breakMinutes;
    }
    return rows;
  }
  function minutesToTime(total) {
    const h = String(Math.floor(total / 60)).padStart(2, "0");
    const m = String(total % 60).padStart(2, "0");
    return `${h}:${m}`;
  }

  // افتراضي لكل الأيام: صباحي من 8:00
  buildPeriods(8, 0, 6, 40, 5).forEach(([num, start, end]) => upsert.run(-1, num, start, end));
  // استثناء: الأربعاء (3) والخميس (4) مسائي من 1:00pm
  [3, 4].forEach((day) => {
    buildPeriods(13, 0, 6, 40, 5).forEach(([num, start, end]) => upsert.run(day, num, start, end));
  });
}

// ترحيل تلقائي: أي معلم عنده تخصص قديم (حقل نصي) بس ما عنده صفوف بجدول teacher_subjects بعد
// يُربط تلقائياً بالمادة المطابقة لاسم تخصصه (مرة وحدة فقط، لضمان التوافق مع البيانات القديمة)
const legacyTeachers = db
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

module.exports = db;
