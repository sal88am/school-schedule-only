const express = require("express");
const db = require("../db");
const { hashPassword } = require("../auth");
const { audit, owned } = require("./util");
const router = express.Router();

const USERNAME_RE = /^[A-Za-z0-9_.-]{3,40}$/;

router.get("/", (req, res) => {
  res.json(db.prepare(`SELECT u.id, u.username, u.role, u.teacher_id, u.is_active, t.name AS teacher_name
    FROM users u LEFT JOIN teachers t ON t.id = u.teacher_id WHERE u.school_id = ? ORDER BY u.id`).all(req.schoolId));
});

// إنشاء حساب دخول لمعلم (دوره teacher فقط)
router.post("/", (req, res) => {
  const { teacher_id, username, password } = req.body;
  const t = owned("teachers", teacher_id, req.schoolId);
  if (!t) return res.status(404).json({ error: "المعلم غير موجود" });
  if (!USERNAME_RE.test(String(username || ""))) return res.status(400).json({ error: "اسم المستخدم: 3–40 حرفاً إنكليزياً أو أرقاماً (._-)" });
  if (String(password || "").length < 8) return res.status(400).json({ error: "كلمة المرور 8 أحرف على الأقل" });
  if (db.prepare("SELECT 1 FROM users WHERE teacher_id = ? AND role = 'teacher'").get(t.id)) return res.status(400).json({ error: "لهذا المعلم حساب مسبقاً" });
  if (db.prepare("SELECT 1 FROM users WHERE username = ?").get(username)) return res.status(400).json({ error: "اسم المستخدم مستخدم مسبقاً" });
  const r = db.prepare("INSERT INTO users (school_id, username, password_hash, role, teacher_id) VALUES (?, ?, ?, 'teacher', ?)").run(req.schoolId, username, hashPassword(password), t.id);
  audit(req.schoolId, "teacher_account_created", { teacher_id: t.id, username });
  res.status(201).json({ id: Number(r.lastInsertRowid), username, teacher_id: t.id });
});

// تغيير كلمة مرور/تفعيل-تعطيل حساب معلم من مدرسته فقط
router.put("/:id", (req, res) => {
  const u = owned("users", req.params.id, req.schoolId);
  if (!u || u.role !== "teacher") return res.status(404).json({ error: "الحساب غير موجود" });
  if (req.body.password !== undefined) {
    if (String(req.body.password).length < 8) return res.status(400).json({ error: "كلمة المرور 8 أحرف على الأقل" });
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(req.body.password), u.id);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(u.id);
  }
  if (req.body.is_active !== undefined) {
    db.prepare("UPDATE users SET is_active = ? WHERE id = ?").run(req.body.is_active ? 1 : 0, u.id);
    if (!req.body.is_active) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(u.id);
  }
  audit(req.schoolId, "teacher_account_updated", { id: u.id });
  res.json({ ok: true });
});

module.exports = router;
