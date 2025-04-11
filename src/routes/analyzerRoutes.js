const express = require("express");
const router = express.Router();
const { analyseReactRepository } = require("../controllers/analyzerController");

router.get("/repository", analyseReactRepository);


module.exports = router
