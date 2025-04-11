const express = require("express");
const router = express.Router();
const { analyseReactRepository } = require("../controllers/analyzerController");
const basicAuth = require("../middleware/basicAuth");

router.get("/repository", basicAuth, analyseReactRepository)

module.exports = router
