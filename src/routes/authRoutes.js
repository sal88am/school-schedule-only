const express = require("express");
const db = require("../db");
const A = require("../auth");
const router = express.Router();

// تسجيل الدخول — عام
router.post("/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  if (!username || !password) return res.status(400).json({ error: "أدخل اسم المستخدم وكلمة المرور" });
  const key = A.throttleKey(req, username);
  if (A.isLocked(key)) return res.status(429).json({ error: "محاولات كثيرة — انتظر 5 دقائق ثم حاول من جديد" });
  const u = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  const ok = u && u.is_active && A.verifyPassword(password, u.password_hash);
  if (!ok) { A.recordFail(key); return res.status(401).json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة" }); }
  if (u.school_id) {
    const s = db.prepare("SELECT is_active, subscription_status FROM schools WHERE id = ?").get(u.school_id);
    if (!s.is_active || ["suspended", "expired"].includes(s.subscription_status)) return res.status(403).json({ error: "حساب المدرسة موقوف — تواصل مع الإدارة" });
  }
  A.clearFails(key);
  res.json({ token: A.createSession(u.id), user: publicUser(u) });
});

function publicUser(u) {
  const school = u.school_id ? db.prepare("SELECT id, name, share_code FROM schools WHERE id = ?").get(u.school_id) : null;
  return { id: u.id, username: u.username, role: u.role, teacher_id: u.teacher_id, school };
}

router.get("/me", A.authenticate, (req, res) => {
  const u = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  res.json(publicUser(u));
});

router.post("/logout", A.authenticate, (req, res) => { A.destroySession(req.token); res.json({ ok: true }); });

router.post("/change-password", A.authenticate, (req, res) => {
  const { old_password, new_password } = req.body;
  if (!new_password || String(new_password).length < 8) return res.status(400).json({ error: "كلمة المرور الجديدة 8 أحرف على الأقل" });
  const u = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!A.verifyPassword(String(old_password || ""), u.password_hash)) return res.status(400).json({ error: "كلمة المرور الحالية غير صحيحة" });
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(A.hashPassword(new_password), u.id);
  db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").run(u.id, require("crypto").createHash("sha256").update(req.token).digest("hex"));
  res.json({ ok: true });
});

module.exports = router;
