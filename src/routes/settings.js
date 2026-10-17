const express = require("express");
const { getSetting, setSetting } = require("./util");
const router = express.Router();

function info(sid) {
  return { school_name: getSetting(sid, "school_name"), school_logo: getSetting(sid, "school_logo"), school_year: getSetting(sid, "school_year") };
}
router.get("/school-info", (req, res) => res.json(info(req.schoolId)));
router.put("/school-info", (req, res) => {
  ["school_name", "school_logo", "school_year"].forEach((k) => { if (req.body[k] !== undefined) setSetting(req.schoolId, k, String(req.body[k] || "")); });
  res.json({ ok: true });
});
module.exports = router;
module.exports.info = info;
