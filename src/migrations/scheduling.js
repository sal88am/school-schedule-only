// ترحيل v5 (إضافة فقط): عدد دروس مخصص لكل يوم، دروس مثبتة، علامة تثبيت على الحصة
function run(db, ensureColumn) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS period_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER NOT NULL,
    day_of_week INTEGER NOT NULL,
    class_id INTEGER,                       -- NULL = كل الصفوف
    period_count INTEGER NOT NULL,
    FOREIGN KEY (class_id) REFERENCES school_classes(id) ON DELETE CASCADE
  );
  CREATE UNIQUE INDEX IF NOT EXISTS ux_period_overrides ON period_overrides(school_id, day_of_week, ifnull(class_id, 0));

  CREATE TABLE IF NOT EXISTS fixed_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER NOT NULL,
    class_id INTEGER,                       -- NULL = كل الصفوف
    day_of_week INTEGER NOT NULL,
    period_number INTEGER NOT NULL DEFAULT 0, -- 0 = الدرس الأخير
    subject_id INTEGER NOT NULL,
    teacher_id INTEGER,                     -- NULL = أي معلم مرتبط بالمادة
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (class_id) REFERENCES school_classes(id) ON DELETE CASCADE,
    FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
    FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE
  );
  `);
  ensureColumn("school_shifts", "breaks", "TEXT"); // JSON: مدة الاستراحة بعد كل درس [5,10,5,...] — NULL = break_minutes للكل
  ensureColumn("schedule", "lock_kind", "TEXT"); // NULL | 'manual' (تثبيت يدوي) | 'rule' (من قاعدة تثبيت)
}
module.exports = { run };
