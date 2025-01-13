const { Router } = require("express");
const { handleVodFile, handleVodDownload, handleLiveFile, handleVodIndexM3u8, handleVodIndexM3u8live, handleVodIndexM3u8liveFiles } = require("../controllers/Vods");
const { StreamStreamKey } = require("../controllers/GetClipsChunks");

const router = Router();

// clips
console.log("QEE");

// entregar index para los files 
router.get('/stream/:streamKey/index.m3u8', handleVodIndexM3u8live);
// files para los clips
router.get('/stream/:streamKey/:file', handleVodIndexM3u8liveFiles);

// vods
// convertir el mp4 a .ts para los vods
router.get('/stream/vod/:key/index.m3u8', handleVodIndexM3u8);
// entregar los .ts en cuestion
router.get("/stream/vod/:key/:file", handleVodFile);
router.get('/stream/download/vod/:key', handleVodDownload);

module.exports = { router }
