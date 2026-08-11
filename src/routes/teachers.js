const express = require("express");
const db = require("../db");

const router = express.Router();

function attachSubjects(teachers) {
  const stmt = db.prepare(
    `SELECT sub.id, sub.name FROM teacher_subjects ts
     JOIN subjects sub ON sub.id = ts.subject_id
     WHERE ts.teacher_id = ? ORDER BY sub.name`
  );
  return teachers.map((t) => ({ ...t, subjects: stmt.all(t.id) }));
}

function setTeacherSubjects(teacherId, subjectIds) {
  db.prepare("DELETE FROM teacher_subjects WHERE teacher_id = ?").run(teacherId);
  if (!Array.isArray(subjectIds)) return;
  const insert = db.prepare("INSERT OR IGNORE INTO teacher_subjects (teacher_id, subject_id) VALUES (?, ?)");
  subjectIds.forEach((sid) => insert.run(teacherId, Number(sid)));
}

router.get("/", (req, res) => {
  const teachers = db.prepare("SELECT * FROM teachers ORDER BY name").all();
  res.json(attachSubjects(teachers));
});

// إضافة معلم جديد — يقدر يدرّس أكثر من مادة (subject_ids: مصفوفة)
router.post("/", (req, res) => {
  const { name, phone, subject_ids } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "اسم المعلم مطلوب" });
  }
  const result = db.prepare("INSERT INTO teachers (name, phone) VALUES (?, ?)").run(name.trim(), phone || null);
  setTeacherSubjects(result.lastInsertRowid, subject_ids);
  const teacher = db.prepare("SELECT * FROM teachers WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(attachSubjects([teacher])[0]);
});

// تعديل بيانات معلم (اسم، هاتف، والمواد اللي يدرّسها)
router.put("/:id", (req, res) => {
  const { name, phone, subject_ids } = req.body;
  const teacher = db.prepare("SELECT * FROM teachers WHERE id = ?").get(req.params.id);
  if (!teacher) return res.status(404).json({ error: "المعلم غير موجود" });

  db.prepare("UPDATE teachers SET name = ?, phone = ? WHERE id = ?").run(
    name ?? teacher.name,
    phone ?? teacher.phone,
    req.params.id
  );
  if (subject_ids !== undefined) setTeacherSubjects(req.params.id, subject_ids);

  const updated = db.prepare("SELECT * FROM teachers WHERE id = ?").get(req.params.id);
  res.json(attachSubjects([updated])[0]);
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM teachers WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// جدول حصص معلم معين (كل الأسبوع)
router.get("/:id/schedule", (req, res) => {
  const rows = db
    .prepare(
      `SELECT s.id, s.day_of_week, s.period_number,
              COALESCE(pt_day.start_time, pt_default.start_time) AS start_time,
              COALESCE(pt_day.end_time, pt_default.end_time) AS end_time,
              c.name AS class_name, sub.name AS subject_name
       FROM schedule s
       JOIN school_classes c ON c.id = s.class_id
       JOIN subjects sub ON sub.id = s.subject_id
       LEFT JOIN period_times pt_day ON pt_day.day_of_week = s.day_of_week AND pt_day.period_number = s.period_number
       LEFT JOIN period_times pt_default ON pt_default.day_of_week = -1 AND pt_default.period_number = s.period_number
       WHERE s.teacher_id = ?
       ORDER BY s.day_of_week, s.period_number`
    )
    .all(req.params.id);
  res.json(rows);
});

module.exports = router;
