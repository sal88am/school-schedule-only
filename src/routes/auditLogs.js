const express = require("express");
const db = require("../db");
const router = express.Router();
router.get("/", (req, res) => res.json(db.prepare("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100").all()));
module.exports = router;
