const { Router } = require("express");
const { vodStreamKey } = require("../controllers/Vods");
const { StreamStreamKey } = require("../controllers/GetClipsChunks");

const router = Router();

// router.get("/stream/:streamKey", StreamStreamKey);
router.post("/vod/:streamKey", vodStreamKey);


module.exports = { router }
