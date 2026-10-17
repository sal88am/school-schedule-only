const crypto = require("crypto");
const db = require("./db");

const SESSION_DAYS = 7;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(pw), salt, 64);
  return `scrypt$${salt.toString("hex")}$${h.toString("hex")}`;
}
function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored || "").split("$");
  if (alg !== "scrypt" || !saltHex || !hashHex) return false;
  const calc = crypto.scryptSync(String(pw), Buffer.from(saltHex, "hex"), 64);
  const hb = Buffer.from(hashHex, "hex");
  return hb.length === calc.length && crypto.timingSafeEqual(hb, calc);
}
const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");

function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)").run(sha(token), userId, expires);
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString()); // تنظيف المنتهية فقط
  return token;
}
function destroySession(token) { db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha(token)); }

function bearer(req) {
  const h = req.header("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

// يتحقق من الجلسة، حالة المستخدم، وحالة المدرسة (مفعّلة/غير موقوفة)
function authenticate(req, res, next) {
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: "سجّل الدخول أولاً" });
  const row = db.prepare(
    `SELECT u.id, u.username, u.role, u.school_id, u.teacher_id, u.is_active,
            s.is_active AS school_active, s.subscription_status
     FROM sessions se JOIN users u ON u.id = se.user_id LEFT JOIN schools s ON s.id = u.school_id
     WHERE se.token_hash = ? AND se.expires_at > ?`
  ).get(sha(token), new Date().toISOString());
  if (!row || !row.is_active) return res.status(401).json({ error: "انتهت الجلسة — سجّل الدخول من جديد" });
  if (row.school_id && (!row.school_active || row.subscription_status === "suspended" || row.subscription_status === "expired"))
    return res.status(403).json({ error: "حساب المدرسة موقوف — تواصل مع الإدارة" });
  req.user = { id: row.id, username: row.username, role: row.role, school_id: row.school_id, teacher_id: row.teacher_id };
  req.token = token;
  next();
}

const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: "ليست لديك صلاحية لهذا الإجراء" });

// يحدد المدرسة الحالية: مستخدم المدرسة مقيّد بمدرسته دائماً (لا يمكن تجاوزها بأي header)،
// المدير العام فقط يختار مدرسة عبر x-school-id
function tenant(req, res, next) {
  if (req.user.role === "super_admin") {
    const sid = Number(req.header("x-school-id"));
    const s = sid ? db.prepare("SELECT id FROM schools WHERE id = ?").get(sid) : null;
    if (!s) return res.status(400).json({ error: "اختر مدرسة أولاً" });
    req.schoolId = s.id;
  } else {
    req.schoolId = req.user.school_id;
  }
  next();
}

// ---- تحديد محاولات الدخول الفاشلة ----
const attempts = new Map();
const MAX_FAILS = 5, LOCK_MS = 5 * 60 * 1000;
function throttleKey(req, username) { return `${req.ip || "?"}|${String(username).toLowerCase()}`; }
function isLocked(key) { const a = attempts.get(key); return a && a.until && a.until > Date.now(); }
function recordFail(key) {
  const a = attempts.get(key) || { n: 0, until: 0 };
  a.n++; if (a.n >= MAX_FAILS) { a.until = Date.now() + LOCK_MS; a.n = 0; }
  attempts.set(key, a);
}
function clearFails(key) { attempts.delete(key); }

module.exports = { hashPassword, verifyPassword, createSession, destroySession, authenticate, requireRole, tenant, bearer, throttleKey, isLocked, recordFail, clearFails };
