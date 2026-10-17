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
function getPeriodsPerDayForClass(sid, cls, day) {
  const shift = getDayShiftMap(sid)[day];
  if (!shift) return 0;
  return cls.custom_periods_per_day || shift.period_count;
}
function computeDayPeriods(sid, day, count) {
  const shift = getDayShiftMap(sid)[day];
  return shift ? buildPeriods(shift, count) : [];
}
function getPeriodTime(sid, day, period) {
  const p = computeDayPeriods(sid, day, Math.max(period, 1)).find((x) => x.period === period);
  return p ? { start_time: p.start, end_time: p.end } : { start_time: null, end_time: null };
}

module.exports = { buildPeriods, getShifts, getDayShiftMap, getWorkingDays, getPeriodsPerDayForClass, computeDayPeriods, getPeriodTime, toMinutes, toTime };
