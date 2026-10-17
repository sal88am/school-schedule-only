const express = require("express");
const db = require("../db");
const { owned } = require("./util");
const router = express.Router();

const SELECT = `SELECT ta.*, t.name AS teacher_name, c.name AS class_name, c.grade, sub.name AS subject_name
  FROM teacher_assignments ta JOIN teachers t ON t.id = ta.teacher_id JOIN school_classes c ON c.id = ta.class_id JOIN subjects sub ON sub.id = ta.subject_id`;

router.get("/", (req, res) => {
  const w = ["ta.school_id = ?"], p = [req.schoolId];
  ["teacher_id", "class_id", "subject_id"].forEach((k) => { if (req.query[k]) { w.push(`ta.${k} = ?`); p.push(req.query[k]); } });
  res.json(db.prepare(`${SELECT} WHERE ${w.join(" AND ")} ORDER BY c.id, sub.id`).all(...p));
});

router.post("/", (req, res) => {
  const { teacher_id, class_id, subject_id } = req.body;
  if (!teacher_id || !class_id || !subject_id) return res.status(400).json({ error: "المعلم والصف والمادة مطلوبة" });
  if (!owned("teachers", teacher_id, req.schoolId) || !owned("classes", class_id, req.schoolId) || !owned("subjects", subject_id, req.schoolId))
    return res.status(404).json({ error: "المعلم أو الصف أو المادة غير موجودة" });
  const ok = db.prepare("SELECT 1 FROM teacher_subjects WHERE teacher_id = ? AND subject_id = ?").get(teacher_id, subject_id);
  if (!ok) return res.status(400).json({ error: "هذا المعلم غير مرتبط بهذه المادة — أضفها له من صفحة الكادر التدريسي" });
  db.prepare("INSERT OR IGNORE INTO teacher_assignments (school_id, teacher_id, class_id, subject_id) VALUES (?,?,?,?)").run(req.schoolId, teacher_id, class_id, subject_id);
  res.status(201).json(db.prepare(`${SELECT} WHERE ta.school_id = ? AND ta.teacher_id = ? AND ta.class_id = ? AND ta.subject_id = ?`).get(req.schoolId, teacher_id, class_id, subject_id));
});

// إسناد تلقائي: لكل (صف، مادة) بلا معلم يُختار المؤهل الأقل حملاً
router.post("/auto", (req, res) => {
  const sid = req.schoolId;
  const pairs = db.prepare(`SELECT cs.class_id, cs.subject_id, cs.weekly_periods FROM class_subjects cs WHERE cs.school_id = ? AND cs.weekly_periods > 0
    AND NOT EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.class_id = cs.class_id AND ta.subject_id = cs.subject_id)`).all(sid);
  const load = {};
  db.prepare(`SELECT ta.teacher_id, SUM(cs.weekly_periods) AS n FROM teacher_assignments ta
    JOIN class_subjects cs ON cs.class_id = ta.class_id AND cs.subject_id = ta.subject_id WHERE ta.school_id = ? GROUP BY ta.teacher_id`).all(sid)
    .forEach((r) => (load[r.teacher_id] = r.n));
  const ins = db.prepare("INSERT OR IGNORE INTO teacher_assignments (school_id, teacher_id, class_id, subject_id) VALUES (?,?,?,?)");
  let assigned = 0; const unassigned = [];
  db.transaction(() => pairs.forEach((p) => {
    const ts = db.prepare("SELECT ts.teacher_id FROM teacher_subjects ts JOIN teachers t ON t.id = ts.teacher_id WHERE ts.subject_id = ? AND t.school_id = ?")
      .all(p.subject_id, sid).map((r) => r.teacher_id);
    if (!ts.length) { unassigned.push({ class_id: p.class_id, subject_id: p.subject_id }); return; }
    ts.sort((a, b) => (load[a] || 0) - (load[b] || 0));
    ins.run(sid, ts[0], p.class_id, p.subject_id);
    load[ts[0]] = (load[ts[0]] || 0) + p.weekly_periods;
    assigned++;
  }))();
  res.json({ assigned, unassigned });
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM teacher_assignments WHERE id = ? AND school_id = ?").run(req.params.id, req.schoolId);
  res.json({ ok: true });
});
module.exports = router;
