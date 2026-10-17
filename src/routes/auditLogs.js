const express = require("express");
const db = require("../db");
const router = express.Router();
router.get("/", (req, res) => res.json(db.prepare("SELECT id, action, details, created_at FROM audit_logs WHERE school_id = ? ORDER BY id DESC LIMIT 100").all(req.schoolId)));
module.exports = router;
