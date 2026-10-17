const express = require("express");
const { teacherSchedule } = require("./teachers");
const svc = require("../services/scheduleTime.service");
const router = express.Router();

// المعلم يرى جدوله هو فقط (المعرّف يأتي من الجلسة، لا من الطلب)
router.get("/schedule", (req, res) => {
  if (!req.user.teacher_id || !req.user.school_id) return res.status(404).json({ error: "لا يوجد جدول مرتبط بحسابك" });
  const sid = req.user.school_id;
  const periods = {};
  svc.getWorkingDays(sid).forEach((d) => (periods[d] = svc.computeDayPeriods(sid, d)));
  res.json({ rows: teacherSchedule(sid, req.user.teacher_id), day_periods: periods });
});

module.exports = router;
