// مزامنة الجدول مع «ربط المعلم بالصف والمادة»:
// إذا تغيّر معلم (صف، مادة) تنتقل حصصه المجدولة تلقائياً إلى المعلم الجديد (إن كان فارغاً بذلك الوقت).
const db = require("../db");
const { getStatus } = require("../routes/util");

const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

function syncPair(sid, classId, subjectId) {
  const out = { moved: 0, conflicts: [], orphaned: 0, skipped: false };
  const rows = db.prepare("SELECT id, teacher_id, day_of_week, period_number FROM schedule WHERE school_id=? AND class_id=? AND subject_id=?").all(sid, classId, subjectId);
  const assigned = db.prepare("SELECT teacher_id FROM teacher_assignments WHERE school_id=? AND class_id=? AND subject_id=?").all(sid, classId, subjectId).map((r) => r.teacher_id);
  const stale = rows.filter((r) => !assigned.includes(r.teacher_id));
  if (!stale.length) return out;
  if (getStatus(sid) === "approved") { out.skipped = true; out.orphaned = stale.length; return out; }
  if (!assigned.length) { out.orphaned = stale.length; return out; }
  const busy = db.prepare("SELECT 1 FROM schedule WHERE school_id=? AND teacher_id=? AND day_of_week=? AND period_number=? AND id<>?");
  const load = db.prepare("SELECT COUNT(*) n FROM schedule WHERE school_id=? AND teacher_id=?");
  const upd = db.prepare("UPDATE schedule SET teacher_id=? WHERE id=? AND school_id=?");
  const name = db.prepare("SELECT name FROM teachers WHERE id=?");
  db.transaction(() => {
    stale.forEach((r) => {
      const cands = assigned.filter((t) => !busy.get(sid, t, r.day_of_week, r.period_number, r.id)).sort((a, b) => load.get(sid, a).n - load.get(sid, b).n);
      if (!cands.length) {
        out.conflicts.push({ id: r.id, day: DAYS[r.day_of_week], period: r.period_number, teacher: (name.get(r.teacher_id) || {}).name || "" });
        return;
      }
      upd.run(cands[0], r.id, sid);
      out.moved++;
    });
  })();
  return out;
}

const merge = (a, b) => ({ moved: a.moved + b.moved, conflicts: a.conflicts.concat(b.conflicts), orphaned: a.orphaned + b.orphaned, skipped: a.skipped || b.skipped });
const empty = () => ({ moved: 0, conflicts: [], orphaned: 0, skipped: false });

module.exports = { syncPair, merge, empty };
