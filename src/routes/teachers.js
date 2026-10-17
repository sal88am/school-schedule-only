const express = require("express");
const db = require("../db");
const { audit, owned } = require("./util");
const svc = require("../services/scheduleTime.service");

const router = express.Router();

function attachExtras(teachers) {
  const subs = db.prepare(
    `SELECT sub.id, sub.name FROM teacher_subjects ts JOIN subjects sub ON sub.id = ts.subject_id
     WHERE ts.teacher_id = ? ORDER BY sub.name`);
  const acct = db.prepare("SELECT username, is_active FROM users WHERE teacher_id = ? AND role = 'teacher' LIMIT 1");
  return teachers.map((t) => {
    const a = acct.get(t.id);
    return { ...t, subjects: subs.all(t.id), account_username: a ? a.username : null, account_active: a ? !!a.is_active : null };
  });
}

// يُربط فقط بمواد تخص نفس المدرسة
function setTeacherSubjects(sid, teacherId, subjectIds) {
  db.prepare("DELETE FROM teacher_subjects WHERE teacher_id = ?").run(teacherId);
  if (!Array.isArray(subjectIds)) return;
  const insert = db.prepare("INSERT OR IGNORE INTO teacher_subjects (teacher_id, subject_id) VALUES (?, ?)");
  subjectIds.forEach((id) => { if (owned("subjects", Number(id), sid)) insert.run(teacherId, Number(id)); });
}

router.get("/", (req, res) => {
  res.json(attachExtras(db.prepare("SELECT * FROM teachers WHERE school_id = ? ORDER BY name").all(req.schoolId)));
});

router.post("/", (req, res) => {
  const { name, phone, subject_ids } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "اسم المعلم مطلوب" });
  const cto = req.body.class_teacher_of && owned("classes", req.body.class_teacher_of, req.schoolId) ? req.body.class_teacher_of : null;
  const r = db.prepare("INSERT INTO teachers (school_id, name, phone, class_teacher_of) VALUES (?, ?, ?, ?)").run(req.schoolId, name.trim(), phone || null, cto);
  setTeacherSubjects(req.schoolId, r.lastInsertRowid, subject_ids);
  audit(req.schoolId, "teacher_created", { name: name.trim() });
  res.status(201).json(attachExtras([db.prepare("SELECT * FROM teachers WHERE id = ?").get(r.lastInsertRowid)])[0]);
});

router.put("/:id", (req, res) => {
  const teacher = owned("teachers", req.params.id, req.schoolId);
  if (!teacher) return res.status(404).json({ error: "المعلم غير موجود" });
  const { name, phone, subject_ids } = req.body;
  let cto = teacher.class_teacher_of;
  if (req.body.class_teacher_of !== undefined) cto = req.body.class_teacher_of && owned("classes", req.body.class_teacher_of, req.schoolId) ? req.body.class_teacher_of : null;
  db.prepare("UPDATE teachers SET name = ?, phone = ?, class_teacher_of = ? WHERE id = ? AND school_id = ?").run(name ?? teacher.name, phone ?? teacher.phone, cto, teacher.id, req.schoolId);
  if (subject_ids !== undefined) setTeacherSubjects(req.schoolId, teacher.id, subject_ids);
  res.json(attachExtras([db.prepare("SELECT * FROM teachers WHERE id = ?").get(teacher.id)])[0]);
});

router.delete("/:id", (req, res) => {
  const t = owned("teachers", req.params.id, req.schoolId);
  if (!t) return res.status(404).json({ error: "المعلم غير موجود" });
  db.prepare("UPDATE users SET is_active = 0 WHERE teacher_id = ? AND school_id = ?").run(t.id, req.schoolId); // يُعطَّل حسابه ولا يُحذف
  db.prepare("DELETE FROM teachers WHERE id = ? AND school_id = ?").run(t.id, req.schoolId);
  audit(req.schoolId, "teacher_deleted", { id: t.id, name: t.name });
  res.json({ ok: true });
});

function teacherSchedule(sid, teacherId) {
  return db.prepare(
    `SELECT s.id, s.day_of_week, s.period_number, c.name AS class_name, sub.name AS subject_name
     FROM schedule s JOIN school_classes c ON c.id = s.class_id JOIN subjects sub ON sub.id = s.subject_id
     WHERE s.teacher_id = ? AND s.school_id = ? ORDER BY s.day_of_week, s.period_number`)
    .all(teacherId, sid)
    .map((r) => ({ ...r, ...svc.getPeriodTime(sid, r.day_of_week, r.period_number) }));
}

router.get("/:id/schedule", (req, res) => {
  if (!owned("teachers", req.params.id, req.schoolId)) return res.status(404).json({ error: "المعلم غير موجود" });
  res.json(teacherSchedule(req.schoolId, req.params.id));
});

module.exports = router;
module.exports.teacherSchedule = teacherSchedule;
