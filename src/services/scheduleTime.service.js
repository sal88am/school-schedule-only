const db = require("../db");

function toMinutes(t) { const [h, m] = String(t).split(":").map(Number); return h * 60 + m; }
function toTime(total) { return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`; }

// دالة نقية: تحسب حصص الشفت (08:00 + 40 + 5 → 08:00–08:40, 08:45–09:25 ...)
function buildPeriods(shift, count) {
  const n = count || shift.period_count;
  const out = [];
  let cursor = toMinutes(shift.start_time);
  for (let i = 1; i <= n; i++) {
    const end = cursor + shift.period_minutes;
    out.push({ period: i, start: toTime(cursor), end: toTime(end) });
    cursor = end + shift.break_minutes;
  }
  return out;
}

// كل الدوال مقيّدة بمدرسة (schoolId)
function getShifts(sid) {
  return db.prepare("SELECT * FROM school_shifts WHERE school_id = ?").all(sid);
}
function getDayShiftMap(sid) {
  const shifts = Object.fromEntries(getShifts(sid).map((s) => [s.shift_type, s]));
  const map = {};
  db.prepare("SELECT * FROM school_day_config WHERE school_id = ? ORDER BY day_of_week").all(sid).forEach((r) => {
    map[r.day_of_week] = r.shift_type ? shifts[r.shift_type] || null : null;
  });
  return map;
}
function getWorkingDays(sid) {
  const m = getDayShiftMap(sid);
  return Object.keys(m).map(Number).filter((d) => m[d]).sort((a, b) => a - b);
}
// تجاوزات عدد الدروس: صف+يوم > يوم لكل الصفوف > إعداد الصف العام > عدد دروس الشفت
function getOverrides(sid) {
  const byDay = {}, byClassDay = {};
  db.prepare("SELECT * FROM period_overrides WHERE school_id = ?").all(sid).forEach((r) => {
    if (r.class_id) byClassDay[`${r.class_id}-${r.day_of_week}`] = r.period_count;
    else byDay[r.day_of_week] = r.period_count;
  });
  return { byDay, byClassDay };
}
// مُحلّل جاهز (يقرأ القاعدة مرة واحدة) — يُستعمل في التوليد والتقارير
function periodsResolver(sid) {
  const dayMap = getDayShiftMap(sid), ov = getOverrides(sid);
  return (cls, day) => {
    const shift = dayMap[day];
    if (!shift) return 0;
    return ov.byClassDay[`${cls.id}-${day}`] || ov.byDay[day] || cls.custom_periods_per_day || shift.period_count;
  };
}
function getPeriodsPerDayForClass(sid, cls, day) { return periodsResolver(sid)(cls, day); }
// أكبر عدد دروس في اليوم عبر كل الصفوف (عدد أعمدة/صفوف الجدول)
function getDayMaxPeriods(sid, day) {
  const shift = getDayShiftMap(sid)[day];
  if (!shift) return 0;
  const res = periodsResolver(sid);
  const classes = db.prepare("SELECT * FROM school_classes WHERE school_id = ?").all(sid);
  if (!classes.length) return res({ id: 0 }, day);
  return Math.max(...classes.map((c) => res(c, day)));
}
function computeDayPeriods(sid, day, count) {
  const shift = getDayShiftMap(sid)[day];
  return shift ? buildPeriods(shift, count || getDayMaxPeriods(sid, day)) : [];
}
// عدد دروس كل صف في كل يوم دوام (للواجهة والطباعة)
function classPeriodsMap(sid) {
  const res = periodsResolver(sid), days = getWorkingDays(sid);
  const out = {};
  db.prepare("SELECT * FROM school_classes WHERE school_id = ?").all(sid).forEach((c) => {
    out[c.id] = {};
    days.forEach((d) => (out[c.id][d] = res(c, d)));
  });
  return out;
}
function getPeriodTime(sid, day, period) {
  const p = computeDayPeriods(sid, day, Math.max(period, 1)).find((x) => x.period === period);
  return p ? { start_time: p.start, end_time: p.end } : { start_time: null, end_time: null };
}

module.exports = { periodsResolver, getOverrides, getDayMaxPeriods, classPeriodsMap, buildPeriods, getShifts, getDayShiftMap, getWorkingDays, getPeriodsPerDayForClass, computeDayPeriods, getPeriodTime, toMinutes, toTime };
