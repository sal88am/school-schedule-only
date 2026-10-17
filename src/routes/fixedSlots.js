const express = require("express");
const db = require("../db");
const svc = require("../services/scheduleTime.service");
const { expandRules } = require("../services/fixedRules.service");
const { audit, requireDraft, owned } = require("./util");
const router = express.Router();

const rulesOf = (sid) => db.prepare(
  `SELECT f.*, c.name AS class_name, sub.name AS subject_name, sub.color AS subject_color, t.name AS teacher_name
   FROM fixed_slots f LEFT JOIN school_classes c ON c.id=f.class_id JOIN subjects sub ON sub.id=f.subject_id LEFT JOIN teachers t ON t.id=f.teacher_id
   WHERE f.school_id = ? ORDER BY f.day_of_week, f.period_number, f.id`).all(sid);

router.get("/", (req, res) => res.json(rulesOf(req.schoolId)));

router.post("/", (req, res) => {
  const sid = req.schoolId, b = req.body;
  const day = Number(b.day_of_week), period = Number(b.period_number ?? 0);
  const classId = b.class_id ? Number(b.class_id) : null, teacherId = b.teacher_id ? Number(b.teacher_id) : null;
  if (!svc.getWorkingDays(sid).includes(day)) return res.status(400).json({ error: "اليوم المختار ليس يوم دوام" });
  if (!(period >= 0 && period <= 12)) return res.status(400).json({ error: "رقم الدرس غير صحيح" });
  if (!owned("subjects", b.subject_id, sid)) return res.status(404).json({ error: "المادة غير موجودة" });
  if (classId && !owned("classes", classId, sid)) return res.status(404).json({ error: "الصف غير موجود" });
  if (teacherId && !owned("teachers", teacherId, sid)) return res.status(404).json({ error: "المعلم غير موجود" });
  const dup = db.prepare("SELECT 1 FROM fixed_slots WHERE school_id=? AND ifnull(class_id,0)=? AND day_of_week=? AND period_number=?").get(sid, classId || 0, day, period);
  if (dup) return res.status(409).json({ error: "يوجد تثبيت بنفس الصف واليوم والدرس — احذفه أولاً" });
  const r = db.prepare("INSERT INTO fixed_slots (school_id, class_id, day_of_week, period_number, subject_id, teacher_id) VALUES (?,?,?,?,?,?)")
    .run(sid, classId, day, period, Number(b.subject_id), teacherId);
  audit(sid, "fixed_slot_add", { id: r.lastInsertRowid });
  const warning = !classId && teacherId
    ? "تنبيه: نفس المعلم لا يمكن أن يكون بكل الصفوف بنفس الوقت — سيُثبَّت لأول صف فقط. اختر «أي معلم مرتبط بالمادة» لتوزيع المعلمين على الصفوف."
    : null;
  res.status(201).json({ id: r.lastInsertRowid, warning });
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM fixed_slots WHERE id=? AND school_id=?").run(req.params.id, req.schoolId);
  // الحصص التي وُضعت من هذه القاعدة تبقى في الجدول لكن بدون علامة تثبيت
  db.prepare("UPDATE schedule SET lock_kind=NULL WHERE school_id=? AND lock_kind='rule'").run(req.schoolId);
  audit(req.schoolId, "fixed_slot_delete", { id: req.params.id });
  res.json({ ok: true });
});

// تطبيق التثبيتات على الجدول الحالي فوراً (بدون إعادة توليد كامل)
router.post("/apply", requireDraft, (req, res) => {
  const sid = req.schoolId;
  const classes = db.prepare("SELECT * FROM school_classes WHERE school_id=?").all(sid);
  const resolve = svc.periodsResolver(sid);
  const { fixed, issues } = expandRules(rulesOf(sid), classes, resolve);
  const names = {
    c: Object.fromEntries(classes.map((c) => [c.id, c.name])),
    t: Object.fromEntries(db.prepare("SELECT id,name FROM teachers WHERE school_id=?").all(sid).map((t) => [t.id, t.name])),
  };
  const assign = {};
  db.prepare("SELECT * FROM teacher_assignments WHERE school_id=?").all(sid).forEach((a) => ((assign[`${a.class_id}-${a.subject_id}`] = assign[`${a.class_id}-${a.subject_id}`] || []).push(a.teacher_id)));
  const out = { placed: 0, replaced: 0, skipped: issues.map((i) => `${names.c[i.class_id] || ""}: ${i.message}`) };
  db.transaction(() => {
    fixed.forEach((f) => {
      const here = db.prepare("SELECT * FROM schedule WHERE class_id=? AND day_of_week=? AND period_number=?").get(f.class_id, f.day_of_week, f.period_number);
      const tFree = (t) => !db.prepare("SELECT 1 FROM schedule WHERE teacher_id=? AND day_of_week=? AND period_number=? AND id<>?").get(t, f.day_of_week, f.period_number, here ? here.id : -1);
      let t = f.teacher_id;
      if (!t) t = (assign[`${f.class_id}-${f.subject_id}`] || []).find(tFree) || null;
      if (!t || !tFree(t)) { out.skipped.push(`${names.c[f.class_id]}: لا يوجد معلم متاح للدرس المثبّت`); return; }
      if (here && here.lock_kind === "manual") { out.skipped.push(`${names.c[f.class_id]}: الخانة مثبّتة يدوياً بحصة أخرى`); return; }
      if (here) { db.prepare("DELETE FROM schedule WHERE id=?").run(here.id); out.replaced++; }
      db.prepare("INSERT INTO schedule (school_id, teacher_id, class_id, subject_id, day_of_week, period_number, lock_kind) VALUES (?,?,?,?,?,?, 'rule')")
        .run(sid, t, f.class_id, f.subject_id, f.day_of_week, f.period_number);
      out.placed++;
    });
  })();
  audit(sid, "fixed_slots_applied", { placed: out.placed, replaced: out.replaced });
  res.json(out);
});

module.exports = router;
module.exports.rulesOf = rulesOf;
