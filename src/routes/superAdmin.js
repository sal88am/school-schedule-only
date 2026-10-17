const express = require("express");
const db = require("../db");
const { hashPassword } = require("../auth");
const { seedSchoolDefaults, newShareCode } = require("../migrations/multiTenant");
const { audit } = require("./util");
const router = express.Router();

const USERNAME_RE = /^[A-Za-z0-9_.-]{3,40}$/;
const STATUSES = ["active", "trial", "suspended", "expired"];

const LIST = `SELECT s.id, s.name, s.share_code, s.is_active, s.subscription_status, s.subscription_ends, s.created_at,
  (SELECT COUNT(*) FROM teachers t WHERE t.school_id = s.id) AS teachers_count,
  (SELECT COUNT(*) FROM school_classes c WHERE c.school_id = s.id) AS classes_count,
  (SELECT u.username FROM users u WHERE u.school_id = s.id AND u.role = 'school_admin' ORDER BY u.id LIMIT 1) AS admin_username
  FROM schools s`;

router.get("/schools", (req, res) => res.json(db.prepare(`${LIST} ORDER BY s.id`).all()));

router.post("/schools", (req, res) => {
  const name = String(req.body.name || "").trim();
  const username = String(req.body.admin_username || "").trim();
  const password = String(req.body.admin_password || "");
  if (!name) return res.status(400).json({ error: "اسم المدرسة مطلوب" });
  if (!USERNAME_RE.test(username)) return res.status(400).json({ error: "اسم المستخدم: 3–40 حرفاً إنكليزياً أو أرقاماً (._-)" });
  if (password.length < 8) return res.status(400).json({ error: "كلمة المرور 8 أحرف على الأقل" });
  if (db.prepare("SELECT 1 FROM users WHERE username = ?").get(username)) return res.status(400).json({ error: "اسم المستخدم مستخدم مسبقاً" });
  let id;
  db.transaction(() => {
    id = Number(db.prepare("INSERT INTO schools (name, share_code) VALUES (?, ?)").run(name, newShareCode()).lastInsertRowid);
    seedSchoolDefaults(db, id, db.PALETTE);
    db.prepare("INSERT INTO school_settings (school_id, key, value) VALUES (?, 'school_name', ?)").run(id, name);
    db.prepare("INSERT INTO users (school_id, username, password_hash, role) VALUES (?, ?, ?, 'school_admin')").run(id, username, hashPassword(password));
  })();
  audit(id, "school_created", { name, admin: username, by: req.user.username });
  res.status(201).json(db.prepare(`${LIST} WHERE s.id = ?`).get(id));
});

router.put("/schools/:id", (req, res) => {
  const s = db.prepare("SELECT * FROM schools WHERE id = ?").get(req.params.id);
  if (!s) return res.status(404).json({ error: "المدرسة غير موجودة" });
  const b = req.body;
  const status = b.subscription_status ?? s.subscription_status;
  if (!STATUSES.includes(status)) return res.status(400).json({ error: "حالة الاشتراك غير صحيحة" });
  const name = b.name !== undefined ? String(b.name).trim() : s.name;
  if (!name) return res.status(400).json({ error: "اسم المدرسة مطلوب" });
  const active = b.is_active !== undefined ? (b.is_active ? 1 : 0) : s.is_active;
  const ends = b.subscription_ends !== undefined ? (b.subscription_ends || null) : s.subscription_ends;
  db.prepare("UPDATE schools SET name = ?, is_active = ?, subscription_status = ?, subscription_ends = ? WHERE id = ?").run(name, active, status, ends, s.id);
  if (!active) db.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE school_id = ?)").run(s.id); // يُنهي الجلسات الحالية (البيانات تبقى)
  audit(s.id, "school_updated", { name, active, status, by: req.user.username });
  res.json(db.prepare(`${LIST} WHERE s.id = ?`).get(s.id));
});

router.post("/schools/:id/reset-admin-password", (req, res) => {
  const s = db.prepare("SELECT id FROM schools WHERE id = ?").get(req.params.id);
  if (!s) return res.status(404).json({ error: "المدرسة غير موجودة" });
  const pw = String(req.body.password || "");
  if (pw.length < 8) return res.status(400).json({ error: "كلمة المرور 8 أحرف على الأقل" });
  const u = db.prepare("SELECT id FROM users WHERE school_id = ? AND role = 'school_admin' ORDER BY id LIMIT 1").get(s.id);
  if (!u) return res.status(404).json({ error: "لا يوجد مدير لهذه المدرسة" });
  db.prepare("UPDATE users SET password_hash = ?, is_active = 1 WHERE id = ?").run(hashPassword(pw), u.id);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(u.id);
  audit(s.id, "admin_password_reset", { by: req.user.username });
  res.json({ ok: true });
});

module.exports = router;
