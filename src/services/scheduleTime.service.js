const db = require("../db");

function toMinutes(t) {
  const [h, m] = String(t).split(":").map(Number);
  return h * 60 + m;
}
function toTime(total) {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// دالة نقية: تحسب حصص الشفت (مثال 08:00 + 40 + 5 → 08:00–08:40, 08:45–09:25 ...)
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

function getShifts() {
  return db.prepare("SELECT * FROM schedule_shifts").all();
}

function getDayShiftMap() {
  const shifts = Object.fromEntries(getShifts().map((s) => [s.shift_type, s]));
  const map = {};
  db.prepare("SELECT * FROM day_shift_config ORDER BY day_of_week").all().forEach((r) => {
    map[r.day_of_week] = r.shift_type ? shifts[r.shift_type] || null : null;
  });
  return map;
}

function getWorkingDays() {
  const m = getDayShiftMap();
  return Object.keys(m).map(Number).filter((d) => m[d]).sort((a, b) => a - b);
}

// عدد حصص الصف في يوم معين: استثناء الصف إن وُجد، وإلا عدد حصص الشفت
function getPeriodsPerDayForClass(cls, day) {
  const shift = getDayShiftMap()[day];
  if (!shift) return 0;
  return cls.custom_periods_per_day || shift.period_count;
}

function computeDayPeriods(day, count) {
  const shift = getDayShiftMap()[day];
  if (!shift) return [];
  return buildPeriods(shift, count);
}

function getPeriodTime(day, period) {
  const p = computeDayPeriods(day, Math.max(period, 1)).find((x) => x.period === period);
  return p ? { start_time: p.start, end_time: p.end } : { start_time: null, end_time: null };
}

module.exports = { buildPeriods, getShifts, getDayShiftMap, getWorkingDays, getPeriodsPerDayForClass, computeDayPeriods, getPeriodTime, toMinutes, toTime };
