const express = require("express");
const db = require("../db");
const { audit, owned } = require("./util");
const router = express.Router();

const SELECT = `SELECT cs.*, c.name AS class_name, c.grade, sub.name AS subject_name, sub.color AS subject_color
  FROM class_subjects cs JOIN school_classes c ON c.id = cs.class_id JOIN subjects sub ON sub.id = cs.subject_id`;

function parse(body, base = {}) {
  const weekly = Number(body.weekly_periods ?? base.weekly_periods ?? 1);
  const allow = body.allow_same_day_repeat !== undefined ? (body.allow_same_day_repeat ? 1 : 0) : (base.allow_same_day_repeat || 0);
  let max = Number(body.max_per_day ?? base.max_per_day ?? 1);
  if (!(weekly >= 0 && weekly <= 30)) return { error: "عدد الحصص الأسبوعي بين 0 و 30" };
  if (!allow) max = 1;
  else if (!(max >= 2 && max <= 6)) return { error: "الحد الأقصى اليومي عند السماح بالتكرار بين 2 و 6" };
  return { weekly, allow, max };
}

router.get("/", (req, res) => {
  const rows = req.query.class_id
    ? db.prepare(`${SELECT} WHERE cs.school_id = ? AND cs.class_id = ? ORDER BY sub.id`).all(req.schoolId, req.query.class_id)
    : db.prepare(`${SELECT} WHERE cs.school_id = ? ORDER BY c.id, sub.id`).all(req.schoolId);
  res.json(rows);
});

const upsert = db.prepare(`INSERT INTO class_subjects (school_id, class_id, subject_id, weekly_periods, allow_same_day_repeat, max_per_day)
  VALUES (?,?,?,?,?,?) ON CONFLICT(class_id, subject_id) DO UPDATE SET weekly_periods = excluded.weekly_periods,
  allow_same_day_repeat = excluded.allow_same_day_repeat, max_per_day = excluded.max_per_day`);

router.post("/", (req, res) => {
  const { class_id, subject_id } = req.body;
  if (!class_id || !subject_id) return res.status(400).json({ error: "الصف والمادة مطلوبان" });
  if (!owned("classes", class_id, req.schoolId) || !owned("subjects", subject_id, req.schoolId)) return res.status(404).json({ error: "الصف أو المادة غير موجودة" });
  const p = parse(req.body);
  if (p.error) return res.status(400).json({ error: p.error });
  upsert.run(req.schoolId, class_id, subject_id, p.weekly, p.allow, p.max);
  audit(req.schoolId, "class_subject_set", { class_id, subject_id, weekly: p.weekly, repeat: p.allow, max: p.max });
  res.status(201).json(db.prepare(`${SELECT} WHERE cs.school_id = ? AND cs.class_id = ? AND cs.subject_id = ?`).get(req.schoolId, class_id, subject_id));
});

router.post("/bulk-grade", (req, res) => {
  const { grade, subject_id } = req.body;
  if (!grade || !subject_id) return res.status(400).json({ error: "المرحلة والمادة مطلوبتان" });
  if (!owned("subjects", subject_id, req.schoolId)) return res.status(404).json({ error: "المادة غير موجودة" });
  const p = parse(req.body);
  if (p.error) return res.status(400).json({ error: p.error });
  const classes = db.prepare("SELECT id FROM school_classes WHERE grade = ? AND school_id = ?").all(grade, req.schoolId);
  if (!classes.length) return res.status(404).json({ error: "لا توجد شعب لهذه المرحلة" });
  db.transaction(() => classes.forEach((c) => upsert.run(req.schoolId, c.id, subject_id, p.weekly, p.allow, p.max)))();
  audit(req.schoolId, "class_subject_bulk", { grade, subject_id, weekly: p.weekly, repeat: p.allow, max: p.max });
  res.status(201).json({ updated: classes.length });
});

router.put("/:id", (req, res) => {
  const cs = owned("class_subjects", req.params.id, req.schoolId);
  if (!cs) return res.status(404).json({ error: "غير موجود" });
  const p = parse(req.body, cs);
  if (p.error) return res.status(400).json({ error: p.error });
  db.prepare("UPDATE class_subjects SET weekly_periods = ?, allow_same_day_repeat = ?, max_per_day = ? WHERE id = ? AND school_id = ?").run(p.weekly, p.allow, p.max, cs.id, req.schoolId);
  res.json(db.prepare(`${SELECT} WHERE cs.id = ?`).get(cs.id));
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM class_subjects WHERE id = ? AND school_id = ?").run(req.params.id, req.schoolId);
  res.json({ ok: true });
});
module.exports = router;
