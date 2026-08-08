const express = require("express");
const db = require("../db");

const router = express.Router();

router.get("/", (req, res) => {
  res.json(db.prepare("SELECT * FROM teachers ORDER BY name").all());
});

router.post("/", (req, res) => {
  const { name, phone, specialty } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "اسم المعلم مطلوب" });
  }
  const result = db
    .prepare("INSERT INTO teachers (name, phone, specialty) VALUES (?, ?, ?)")
    .run(name.trim(), phone || null, specialty || null);
  res.status(201).json(db.prepare("SELECT * FROM teachers WHERE id = ?").get(result.lastInsertRowid));
});

router.put("/:id", (req, res) => {
  const { name, phone, specialty } = req.body;
  const teacher = db.prepare("SELECT * FROM teachers WHERE id = ?").get(req.params.id);
  if (!teacher) return res.status(404).json({ error: "المعلم غير موجود" });

  db.prepare("UPDATE teachers SET name = ?, phone = ?, specialty = ? WHERE id = ?").run(
    name ?? teacher.name,
    phone ?? teacher.phone,
    specialty ?? teacher.specialty,
    req.params.id
  );
  res.json(db.prepare("SELECT * FROM teachers WHERE id = ?").get(req.params.id));
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
