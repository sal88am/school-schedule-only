const express = require("express");
const db = require("../db");
const router = express.Router();

const upsert = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
const get = (k) => { const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(k); return r ? r.value : ""; };

function info() {
  return { school_name: get("school_name"), school_logo: get("school_logo"), school_year: get("school_year") };
}
router.get("/school-info", (req, res) => res.json(info()));
router.put("/school-info", (req, res) => {
  ["school_name", "school_logo", "school_year"].forEach((k) => { if (req.body[k] !== undefined) upsert.run(k, req.body[k] || ""); });
  res.json({ ok: true });
});
module.exports = router;
module.exports.info = info;
