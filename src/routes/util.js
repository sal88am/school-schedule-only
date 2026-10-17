const db = require("../db");

function audit(schoolId, action, details) {
  try {
    db.prepare("INSERT INTO audit_logs (school_id, action, details) VALUES (?, ?, ?)").run(schoolId ?? null, action, details ? JSON.stringify(details) : null);
  } catch (e) { /* ignore */ }
}
function getSetting(sid, key, fallback = "") {
  const r = db.prepare("SELECT value FROM school_settings WHERE school_id = ? AND key = ?").get(sid, key);
  return r ? r.value : fallback;
}
function setSetting(sid, key, value) {
  db.prepare("INSERT INTO school_settings (school_id, key, value) VALUES (?,?,?) ON CONFLICT(school_id, key) DO UPDATE SET value = excluded.value").run(sid, key, value);
}
const getStatus = (sid) => getSetting(sid, "schedule_status", "draft");
const setStatus = (sid, v) => setSetting(sid, "schedule_status", v);

// يمنع التعديل إذا الجدول معتمد
function requireDraft(req, res, next) {
  if (getStatus(req.schoolId) === "approved") return res.status(409).json({ error: "الجدول معتمد ومقفل — اضغط «فتح التعديل» أولاً" });
  next();
}

// التحقق أن سجلاً ما يخص المدرسة (يمنع الوصول عبر id مدرسة أخرى)
const OWNED = { teachers: "teachers", subjects: "subjects", classes: "school_classes", schedule: "schedule", class_subjects: "class_subjects", teacher_assignments: "teacher_assignments", users: "users" };
function owned(kind, id, sid) {
  const table = OWNED[kind];
  if (!table || id === undefined || id === null || id === "") return undefined;
  return db.prepare(`SELECT * FROM ${table} WHERE id = ? AND school_id = ?`).get(id, sid);
}

module.exports = { audit, getSetting, setSetting, getStatus, setStatus, requireDraft, owned };
