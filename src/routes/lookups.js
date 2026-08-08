const express = require("express");
const db = require("../db");

// راوتر بسيط عام لأي جدول من نوع (id, name) أو مشابه — يقلل التكرار
function buildSimpleRouter(table, extraFields = []) {
  const router = express.Router();
  const fields = ["name", ...extraFields];

  router.get("/", (req, res) => {
    res.json(db.prepare(`SELECT * FROM ${table} ORDER BY id`).all());
  });

  router.post("/", (req, res) => {
    if (!req.body.name || !req.body.name.trim()) {
      return res.status(400).json({ error: "الاسم مطلوب" });
    }
    const cols = fields.join(", ");
    const placeholders = fields.map(() => "?").join(", ");
    const values = fields.map((f) => req.body[f] ?? null);
    try {
      const result = db
        .prepare(`INSERT INTO ${table} (${cols}) VALUES (${placeholders})`)
        .run(...values);
      res.status(201).json(db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(result.lastInsertRowid));
    } catch (err) {
      res.status(400).json({ error: "تعذّرت الإضافة (ربما الاسم مكرر)" });
    }
  });

  router.delete("/:id", (req, res) => {
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(req.params.id);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { buildSimpleRouter };
