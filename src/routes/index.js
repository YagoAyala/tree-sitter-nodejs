const express = require("express");
const router = express.Router();

const analyzerRoutes = require("./analyzerRoutes");

router.use("/analyze", analyzerRoutes);

module.exports = router;
