const express = require("express");
const db = require("../db");
const { audit } = require("./util");
const svc = require("../services/scheduleTime.service");

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
  const { name, phone, subject_ids, class_teacher_of } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "اسم المعلم مطلوب" });
  }
  const result = db.prepare("INSERT INTO teachers (name, phone, class_teacher_of) VALUES (?, ?, ?)").run(name.trim(), phone || null, class_teacher_of || null);
  audit("teacher_created", { name: name.trim() });
  setTeacherSubjects(result.lastInsertRowid, subject_ids);
  const teacher = db.prepare("SELECT * FROM teachers WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(attachSubjects([teacher])[0]);
});

// تعديل بيانات معلم (اسم، هاتف، والمواد اللي يدرّسها)
router.put("/:id", (req, res) => {
  const { name, phone, subject_ids, class_teacher_of } = req.body;
  const teacher = db.prepare("SELECT * FROM teachers WHERE id = ?").get(req.params.id);
  if (!teacher) return res.status(404).json({ error: "المعلم غير موجود" });

  db.prepare("UPDATE teachers SET name = ?, phone = ?, class_teacher_of = ? WHERE id = ?").run(
    name ?? teacher.name,
    phone ?? teacher.phone,
    class_teacher_of === undefined ? teacher.class_teacher_of : class_teacher_of || null,
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

// جدول حصص معلم معين (كل الأسبوع) مع الأوقات المحسوبة
router.get("/:id/schedule", (req, res) => {
  const rows = db
    .prepare(
      `SELECT s.id, s.day_of_week, s.period_number, c.name AS class_name, sub.name AS subject_name
       FROM schedule s
       JOIN school_classes c ON c.id = s.class_id
       JOIN subjects sub ON sub.id = s.subject_id
       WHERE s.teacher_id = ?
       ORDER BY s.day_of_week, s.period_number`
    )
    .all(req.params.id)
    .map((r) => ({ ...r, ...svc.getPeriodTime(r.day_of_week, r.period_number) }));
  res.json(rows);
});

module.exports = router;
