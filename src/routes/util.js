const db = require("../db");
function audit(action, details) {
  try { db.prepare("INSERT INTO audit_logs (action, details) VALUES (?, ?)").run(action, details ? JSON.stringify(details) : null); } catch (e) { /* ignore */ }
}
function getStatus() {
  const r = db.prepare("SELECT value FROM settings WHERE key='schedule_status'").get();
  return r ? r.value : "draft";
}
function setStatus(v) {
  db.prepare("INSERT INTO settings (key,value) VALUES ('schedule_status',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(v);
}
// يمنع التعديل إذا الجدول معتمد
function requireDraft(req, res, next) {
  if (getStatus() === "approved") {
    return res.status(409).json({ error: "الجدول معتمد ومقفل — اضغط «فتح التعديل» أولاً" });
  }
  next();
}
module.exports = { audit, getStatus, setStatus, requireDraft };
