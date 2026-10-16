const express = require("express");
const db = require("../db");
const { PALETTE } = db;
const router = express.Router();

router.get("/", (req, res) => res.json(db.prepare("SELECT * FROM subjects ORDER BY id").all()));

router.post("/", (req, res) => {
  const name = (req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "اسم المادة مطلوب" });
  try {
    const n = db.prepare("SELECT COUNT(*) AS n FROM subjects").get().n;
    const r = db.prepare("INSERT INTO subjects (name, color) VALUES (?, ?)").run(name, req.body.color || PALETTE[n % PALETTE.length]);
    res.status(201).json(db.prepare("SELECT * FROM subjects WHERE id=?").get(r.lastInsertRowid));
  } catch (e) { res.status(400).json({ error: "المادة موجودة مسبقاً" }); }
});

router.put("/:id", (req, res) => {
  const s = db.prepare("SELECT * FROM subjects WHERE id=?").get(req.params.id);
  if (!s) return res.status(404).json({ error: "المادة غير موجودة" });
  db.prepare("UPDATE subjects SET name=?, color=? WHERE id=?").run((req.body.name || s.name).trim(), req.body.color || s.color, s.id);
  res.json(db.prepare("SELECT * FROM subjects WHERE id=?").get(s.id));
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM subjects WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});
module.exports = router;
