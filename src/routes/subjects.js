const express = require("express");
const db = require("../db");
const { PALETTE } = db;
const { owned } = require("./util");
const router = express.Router();

router.get("/", (req, res) => res.json(db.prepare("SELECT * FROM subjects WHERE school_id = ? ORDER BY id").all(req.schoolId)));

router.post("/", (req, res) => {
  const name = (req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "اسم المادة مطلوب" });
  try {
    const n = db.prepare("SELECT COUNT(*) AS n FROM subjects WHERE school_id = ?").get(req.schoolId).n;
    const r = db.prepare("INSERT INTO subjects (school_id, name, color) VALUES (?, ?, ?)").run(req.schoolId, name, req.body.color || PALETTE[n % PALETTE.length]);
    res.status(201).json(db.prepare("SELECT * FROM subjects WHERE id = ?").get(r.lastInsertRowid));
  } catch (e) { res.status(400).json({ error: "المادة موجودة مسبقاً" }); }
});

router.put("/:id", (req, res) => {
  const s = owned("subjects", req.params.id, req.schoolId);
  if (!s) return res.status(404).json({ error: "المادة غير موجودة" });
  try {
    db.prepare("UPDATE subjects SET name = ?, color = ? WHERE id = ? AND school_id = ?").run((req.body.name || s.name).trim(), req.body.color || s.color, s.id, req.schoolId);
  } catch (e) { return res.status(400).json({ error: "الاسم مستخدم لمادة أخرى" }); }
  res.json(db.prepare("SELECT * FROM subjects WHERE id = ?").get(s.id));
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM subjects WHERE id = ? AND school_id = ?").run(req.params.id, req.schoolId);
  res.json({ ok: true });
});
module.exports = router;
