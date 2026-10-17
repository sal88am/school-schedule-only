// ينشئ الحسابات الأولية فقط إذا لم تكن موجودة. لا يغيّر كلمات مرور موجودة.
const crypto = require("crypto");
const db = require("./db");
const { hashPassword } = require("./auth");

function pickPassword(envValue, label, username) {
  if (envValue && envValue.length >= 8) return envValue;
  const generated = crypto.randomBytes(9).toString("base64url");
  console.log(`⚠️  تم توليد كلمة مرور لـ ${label} (${username}): ${generated}  — احفظها الآن وغيّرها بعد أول دخول`);
  return generated;
}

function ensureBootstrapUsers() {
  if (!db.prepare("SELECT 1 FROM users WHERE role = 'super_admin'").get()) {
    const username = process.env.SUPER_ADMIN_USERNAME || "superadmin";
    const pw = pickPassword(process.env.SUPER_ADMIN_PASSWORD, "المدير العام", username);
    db.prepare("INSERT INTO users (school_id, username, password_hash, role) VALUES (NULL, ?, ?, 'super_admin')").run(username, hashPassword(pw));
  }
  // مدير المدرسة الافتراضية (يأخذ ADMIN_PASSWORD القديم إن وُجد)
  const def = db.prepare("SELECT id FROM schools ORDER BY id LIMIT 1").get();
  if (def && !db.prepare("SELECT 1 FROM users WHERE school_id = ? AND role = 'school_admin'").get(def.id)) {
    const username = process.env.DEFAULT_SCHOOL_ADMIN_USERNAME || "admin";
    if (!db.prepare("SELECT 1 FROM users WHERE username = ?").get(username)) {
      const pw = pickPassword(process.env.ADMIN_PASSWORD, "مدير المدرسة الافتراضية", username);
      db.prepare("INSERT INTO users (school_id, username, password_hash, role) VALUES (?, ?, ?, 'school_admin')").run(def.id, username, hashPassword(pw));
    }
  }
}
module.exports = { ensureBootstrapUsers };
