const express = require("express");
const db = require("../db");

const router = express.Router();

function getWorkingDays() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'working_days'").get();
  return row ? JSON.parse(row.value) : [0, 1, 2, 3, 4];
}

function fetchFullSchedule() {
  return db
    .prepare(
      `SELECT s.id, s.teacher_id, s.class_id, s.subject_id, s.day_of_week, s.period_number,
              t.name AS teacher_name, c.name AS class_name, c.grade, c.section,
              sub.name AS subject_name,
              COALESCE(pt_day.start_time, pt_default.start_time) AS start_time,
              COALESCE(pt_day.end_time, pt_default.end_time) AS end_time
       FROM schedule s
       JOIN teachers t ON t.id = s.teacher_id
       JOIN school_classes c ON c.id = s.class_id
       JOIN subjects sub ON sub.id = s.subject_id
       LEFT JOIN period_times pt_day ON pt_day.day_of_week = s.day_of_week AND pt_day.period_number = s.period_number
       LEFT JOIN period_times pt_default ON pt_default.day_of_week = -1 AND pt_default.period_number = s.period_number
       ORDER BY s.day_of_week, s.period_number, c.name`
    )
    .all();
}

// الجدول الكامل (كل الأسبوع، كل الصفوف) — يحتاج تسجيل دخول إدارة
router.get("/", (req, res) => {
  res.json(fetchFullSchedule());
});

// إضافة حصة يدوياً — مع كشف التعارض (نفس المعلم أو نفس الصف بنفس الوقت)
router.post("/", (req, res) => {
  const { teacher_id, class_id, subject_id, day_of_week, period_number } = req.body;
  if (!teacher_id || !class_id || !subject_id || day_of_week === undefined || !period_number) {
    return res.status(400).json({ error: "كل الحقول مطلوبة (المعلم، الصف، المادة، اليوم، رقم الحصة)" });
  }

  const teacherConflict = db
    .prepare("SELECT * FROM schedule WHERE teacher_id = ? AND day_of_week = ? AND period_number = ?")
    .get(teacher_id, day_of_week, period_number);
  if (teacherConflict) {
    return res.status(409).json({ error: "هذا المعلم عنده حصة أخرى بنفس التوقيت" });
  }

  const classConflict = db
    .prepare("SELECT * FROM schedule WHERE class_id = ? AND day_of_week = ? AND period_number = ?")
    .get(class_id, day_of_week, period_number);
  if (classConflict) {
    return res.status(409).json({ error: "هذا الصف عنده مادة أخرى مجدولة بنفس التوقيت" });
  }

  const result = db
    .prepare(
      "INSERT INTO schedule (teacher_id, class_id, subject_id, day_of_week, period_number) VALUES (?, ?, ?, ?, ?)"
    )
    .run(teacher_id, class_id, subject_id, day_of_week, period_number);

  res.status(201).json(
    db
      .prepare(
        `SELECT s.*, t.name AS teacher_name, c.name AS class_name, sub.name AS subject_name
         FROM schedule s
         JOIN teachers t ON t.id = s.teacher_id
         JOIN school_classes c ON c.id = s.class_id
         JOIN subjects sub ON sub.id = s.subject_id
         WHERE s.id = ?`
      )
      .get(result.lastInsertRowid)
  );
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM schedule WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// حذف كل الجدول (تصفير قبل إعادة التوليد يدوياً لو احتاج المستخدم)
router.delete("/", (req, res) => {
  db.prepare("DELETE FROM schedule").run();
  res.json({ ok: true });
});

// ---------- التوليد التلقائي للجدول ----------
router.post("/auto-generate", (req, res) => {
  const workingDays = getWorkingDays().slice().sort((a, b) => a - b);
  const classes = db.prepare("SELECT * FROM school_classes ORDER BY id").all();
  const subjects = db.prepare("SELECT * FROM subjects ORDER BY id").all();

  if (classes.length === 0) {
    return res.status(400).json({ error: "ضيف الصفوف أولاً (من صفحة الصفوف والشعب)" });
  }

  // كل مادة → قائمة المعلمين اللي يقدرون يدرّسونها (معلم واحد يقدر يظهر تحت أكثر من مادة)
  const teacherSubjectRows = db
    .prepare(
      `SELECT ts.teacher_id, ts.subject_id FROM teacher_subjects ts
       JOIN teachers t ON t.id = ts.teacher_id`
    )
    .all();
  const teachersBySubject = {};
  subjects.forEach((s) => {
    teachersBySubject[s.id] = teacherSubjectRows.filter((r) => r.subject_id === s.id).map((r) => r.teacher_id);
  });
  const usableSubjects = subjects.filter((s) => teachersBySubject[s.id].length > 0);

  if (usableSubjects.length === 0) {
    return res.status(400).json({
      error: "ما فيه أي معلم مرتبط بمادة — أضف مادة واحدة على الأقل لكل معلم من صفحة الكادر التدريسي",
    });
  }

  db.prepare("DELETE FROM schedule").run();
  const insert = db.prepare(
    "INSERT INTO schedule (teacher_id, class_id, subject_id, day_of_week, period_number) VALUES (?, ?, ?, ?, ?)"
  );

  const teacherBusy = new Set();
  const subjectTeacherPointer = {};
  usableSubjects.forEach((s) => (subjectTeacherPointer[s.id] = 0));

  let filled = 0;
  let unfilled = 0;

  classes.forEach((cls) => {
    let subjectPointer = 0;

    workingDays.forEach((day) => {
      let lastSubjectId = null;

      for (let period = 1; period <= cls.periods_per_day; period++) {
        let assigned = false;

        for (let attempt = 0; attempt < usableSubjects.length; attempt++) {
          const subj = usableSubjects[(subjectPointer + attempt) % usableSubjects.length];
          if (subj.id === lastSubjectId && usableSubjects.length > 1) continue;

          const subjTeachers = teachersBySubject[subj.id];
          for (let tAttempt = 0; tAttempt < subjTeachers.length; tAttempt++) {
            const tIdx = (subjectTeacherPointer[subj.id] + tAttempt) % subjTeachers.length;
            const teacherId = subjTeachers[tIdx];
            const key = `${teacherId}-${day}-${period}`;
            if (!teacherBusy.has(key)) {
              insert.run(teacherId, cls.id, subj.id, day, period);
              teacherBusy.add(key);
              subjectTeacherPointer[subj.id] = (tIdx + 1) % subjTeachers.length;
              subjectPointer = (subjectPointer + attempt + 1) % usableSubjects.length;
              lastSubjectId = subj.id;
              assigned = true;
              filled++;
              break;
            }
          }
          if (assigned) break;
        }

        if (!assigned) unfilled++;
      }
    });
  });

  res.json({ filled, unfilled, schedule: fetchFullSchedule() });
});

module.exports = router;
module.exports.fetchFullSchedule = fetchFullSchedule;
