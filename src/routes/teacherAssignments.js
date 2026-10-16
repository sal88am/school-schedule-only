const express = require("express");
const db = require("../db");
const router = express.Router();

const SELECT = `SELECT ta.*, t.name AS teacher_name, c.name AS class_name, c.grade, sub.name AS subject_name
  FROM teacher_assignments ta JOIN teachers t ON t.id=ta.teacher_id JOIN school_classes c ON c.id=ta.class_id JOIN subjects sub ON sub.id=ta.subject_id`;

router.get("/", (req, res) => {
  const w = [], p = [];
  ["teacher_id", "class_id", "subject_id"].forEach((k) => { if (req.query[k]) { w.push(`ta.${k}=?`); p.push(req.query[k]); } });
  res.json(db.prepare(`${SELECT} ${w.length ? "WHERE " + w.join(" AND ") : ""} ORDER BY c.id, sub.id`).all(...p));
});

router.post("/", (req, res) => {
  const { teacher_id, class_id, subject_id } = req.body;
  if (!teacher_id || !class_id || !subject_id) return res.status(400).json({ error: "المعلم والصف والمادة مطلوبة" });
  const ok = db.prepare("SELECT 1 FROM teacher_subjects WHERE teacher_id=? AND subject_id=?").get(teacher_id, subject_id);
  if (!ok) return res.status(400).json({ error: "هذا المعلم غير مرتبط بهذه المادة — أضفها له من صفحة الكادر التدريسي" });
  db.prepare("INSERT OR IGNORE INTO teacher_assignments (teacher_id, class_id, subject_id) VALUES (?,?,?)").run(teacher_id, class_id, subject_id);
  res.status(201).json(db.prepare(`${SELECT} WHERE ta.teacher_id=? AND ta.class_id=? AND ta.subject_id=?`).get(teacher_id, class_id, subject_id));
});

// إسناد تلقائي: لكل (صف، مادة) بلا معلم يُختار المؤهل الأقل حملاً
router.post("/auto", (req, res) => {
  const pairs = db.prepare(`SELECT cs.class_id, cs.subject_id FROM class_subjects cs WHERE cs.weekly_periods > 0
    AND NOT EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.class_id=cs.class_id AND ta.subject_id=cs.subject_id)`).all();
  const load = {};
  db.prepare("SELECT teacher_id, SUM(cs.weekly_periods) AS n FROM teacher_assignments ta JOIN class_subjects cs ON cs.class_id=ta.class_id AND cs.subject_id=ta.subject_id GROUP BY teacher_id")
    .all().forEach((r) => (load[r.teacher_id] = r.n));
  const ins = db.prepare("INSERT OR IGNORE INTO teacher_assignments (teacher_id, class_id, subject_id) VALUES (?,?,?)");
  const weekly = db.prepare("SELECT weekly_periods FROM class_subjects WHERE class_id=? AND subject_id=?");
  let assigned = 0; const unassigned = [];
  db.transaction(() => pairs.forEach((p) => {
    const ts = db.prepare("SELECT teacher_id FROM teacher_subjects WHERE subject_id=?").all(p.subject_id).map((r) => r.teacher_id);
    if (!ts.length) { unassigned.push(p); return; }
    ts.sort((a, b) => (load[a] || 0) - (load[b] || 0));
    ins.run(ts[0], p.class_id, p.subject_id);
    load[ts[0]] = (load[ts[0]] || 0) + weekly.get(p.class_id, p.subject_id).weekly_periods;
    assigned++;
  }))();
  res.json({ assigned, unassigned });
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM teacher_assignments WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});
module.exports = router;
