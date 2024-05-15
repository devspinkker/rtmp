require('dotenv').config()
const NodeMediaServer = require('node-media-server');
const cors = require("cors");
const express = require("express");
const axios = require("axios");
const app = express();
const helpers = require('./helpers/helpers');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
const streams = new Map();
const keys = new Map();

const { getUserByKey, AverageViewers } = require("./controllers/userCtrl");

var fs = require('fs');
const spawn = require('child_process').spawn;

app.use(cors());

const config = {
  rtmp: {
    port: 1935,
    chunk_size: 60000,
    gop_cache: true,
    ping: 30,
    ping_timeout: 60
  },
  http: {
    port: 8000,
    mediaroot: './media',
    allow_origin: '*'
  },
  auth: {
    api: true,
    api_user: 'admin',
    api_pass: process.env.API_PASS,
  },
  trans: {
    ffmpeg: process.env.FFMPEG_PATH,
    tasks: [
      {
        app: "live",
        hls: true,
        hlsFlags: "[hls_time=1:hls_list_size=10:hls_flags=delete_segments]",
        hlsKeep: true,
        vc: "libx264",
        h264_profile: "main",
        h264_level: "4.1",
        hls_wait_keyframe: true, // Agregar esta línea para esperar fotograma clave en HLS
        gop: 1, // Agregar esta línea para ajustar el GOP a 1 segundo
      },
      {
        app: "live",
        hls: true,
        hlsFlags: "[hls_time=1:hls_list_size=10:hls_flags=delete_segments]",
        hlsKeep: false,
        vc: "h264_nvenc",
        h264_profile: "main",
        h264_level: "4.1",
        gpu: 0,
        hls_wait_keyframe: true, // Agregar esta línea para esperar fotograma clave en HLS
        gop: 1, // Agregar esta línea para ajustar el GOP a 1 segundo
      },
      {
        app: "live",
        hls: true,
        hlsFlags: "[hls_time=1:hls_list_size=10:hls_flags=delete_segments]",
        hlsKeep: false,
        vc: "hevc_nvenc",
        hevc_profile: "main",
        hevc_level: "4.1",
        gpu: 0,
        hls_wait_keyframe: true, // Agregar esta línea para esperar fotograma clave en HLS
        gop: 1, // Agregar esta línea para ajustar el GOP a 1 segundo
      },
    ],
    MediaRoot: "./media",
  },
  fission: {
    ffmpeg: process.env.FFMPEG_PATH,
    tasks: [
      {
        rule: "live/*",
        model: [
          {
            ab: "128k",
            vb: "1500k",
            vs: "1280x720",
            vf: "30",
          },
          {
            ab: "96k",
            vb: "1000k",
            vs: "854x480",
            vf: "24",
          },
          {
            ab: "96k",
            vb: "600k",
            vs: "640x360",
            vf: "20",
          },
        ],
      },
    ],
  }
};


let url = process.env.BACKEND_URL + "/stream";

async function updateOnline(Key, online) {
  console.log(Key, online);
  try {
    const res = await axios.post(`${url}/update_online`, { Key, State: online });
    return res;
  } catch (error) {
    console.log('Error en updateOnline:', error);
    throw new Error('Error en updateOnline');
  }
}

async function updateTimeStart({ keyTransmission, date }) {
  try {
    const res = await axios.post(`${url}/update_start_date`, { keyTransmission, date })
    return res;
  } catch (error) {
    console.log('Error while calling updateOnline', error);
  }
}

async function addHistoryViewers(streamer) {
  try {
    const viewers = await axios.post(process.env.BACKEND_URL + `/history/add_history_viewers?streamer=${streamer}`);
    console.log("Agregado historial de viewers de " + streamer);
  } catch (error) {
    console.log('Error while calling getViewers', error);
  }
}

async function resumeStream(streamer) {
  try {
    await axios.post(process.env.BACKEND_URL + `/history/add_history_stream?streamer=${streamer}`);
    console.log("Resumen de  " + streamer);
  } catch (error) {
    console.log('Error while calling getViewers', error);
  }
}

async function getStreamingsOnline() {
  try {
    const data = await axios.get(process.env.BACKEND_URL + `/stream/get_streamings_online`);
    if (data != null && data != undefined) {
      return data.data;
    }
  } catch (error) {
    console.log('Error while calling getStreamingsOnline', error);
  }
}

const { PassThrough } = require('stream');

function convertToMP4(chunks, totalKeyreq) {
  return new Promise((resolve, reject) => {
    try {
      const mediaDir = path.join(__dirname, 'media');
      const clipsDir = path.join(mediaDir, 'clips');

      if (!fs.existsSync(mediaDir)) {
        fs.mkdirSync(mediaDir);
      }

      if (!fs.existsSync(clipsDir)) {
        fs.mkdirSync(clipsDir);
      }

      const ffmpegProcess = ffmpeg();
      const inputStream = new PassThrough();
      chunks.forEach(chunk => inputStream.write(chunk));
      inputStream.end();

      const outputFilePath = path.join(clipsDir, `salida_${totalKeyreq}.mp4`);

      ffmpegProcess
        .input(inputStream)
        .inputFormat('mpegts')
        .videoCodec('libx264')
        .audioCodec('aac')
        .toFormat('mp4')
        .outputOptions(['-movflags', 'frag_keyframe+empty_moov'])
        .outputOptions(['-bsf:a', 'aac_adtstoasc'])
        .outputOptions(['-t', '20'])
        .outputOptions(['-preset', 'fast'])
        .output(outputFilePath)
        .on('end', () => {
          resolve(outputFilePath);
        })
        .on('error', (err, stdout, stderr) => {
          reject(stderr);
        })
        .run();


    } catch (error) {
      reject(error);
    }
  });
}


app.get('/stream/:streamKey', async (req, res) => {
  const streamKeyreq = req.params.streamKey;
  const currentFolder = process.cwd();
  const mediaFolder = path.join(currentFolder, 'media', 'live', streamKeyreq);

  try {
    const chunks = await getChunksFromFolder(mediaFolder);

    if (chunks !== null && chunks.length > 0) {
      const mp4Buffer = await convertToMP4(chunks, streamKeyreq);

      const fileStream = fs.createReadStream(mp4Buffer);
      fileStream.on('error', (error) => {
        return res.status(500).send('Error interno al procesar la solicitud.');
      });

      fileStream.pipe(res);
      return
    } else {
      return res.status(404).send('El streamer está offline o no hay búfer disponible.');
    }
  } catch (error) {
    return res.status(500).send('Error interno al procesar la solicitud.');
  }

});

function getChunksFromFolder(folderPath) {
  return new Promise(async (resolve, reject) => {
    try {
      const isFolderExists = await fs.promises.access(folderPath, fs.constants.F_OK)
        .then(() => true)
        .catch(() => false);

      if (!isFolderExists) {
        resolve(null);
        return;
      }

      const files = await fs.promises.readdir(folderPath);
      const tsFiles = files.filter(file => file.endsWith('.ts'));

      const chunks = await Promise.all(tsFiles.map(async file => {
        const filePath = path.join(folderPath, file);
        return fs.promises.readFile(filePath);
      }));

      resolve(chunks);
      return

    } catch (error) {
      reject(error);
      return
    }
  });
}

var nms = new NodeMediaServer(config);


nms.on('preConnect', (id, args) => {
  console.log('[Pinkker] [NodeEvent on preConnect]', `id=${id} args=${JSON.stringify(args)}`);

});
nms.on('doneConnect', (id, args) => {
  console.log('doneConnect');
});

nms.on('prePublish', async (id, StreamPath, args, cmt) => {
  const session = nms.getSession(id);
  let date_pc = new Date();
  date_pc.setHours(date_pc.getHours() - 3);

  const key = StreamPath.replace(/\//g, "");

  const user = await getUserByKey(key);

  let totalKey;

  if (key.length === 49) {
    totalKey = key.substring(4, key.length);
  } else {
    totalKey = key;
  }
  if (!user?.keyTransmission) {
    console.log("[Pinkker] Usuario no encontrado");
    return;
  }

  const mediaFolder = path.join(__dirname, 'media', 'live', totalKey);
  if (!fs.existsSync(mediaFolder)) {
    fs.mkdirSync(mediaFolder, { recursive: true });
  }

  const streamingsOnline = await getStreamingsOnline();

  if (!user.verified && streamingsOnline.data >= 20) {
    console.log("[Pinkker] Máximo de streamings online para usuario no verificado");
  } else if (user.verified && streamingsOnline.data >= 50) {
    console.log("[Pinkker] Máximo de streamings online para usuario verificado");
  } else {
    streams.set(user.NameUser, totalKey);
    keys.set(totalKey, user.NameUser);

    let date = new Date().getTime();
    await updateOnline(user.keyTransmission, true);
    await updateTimeStart(user.keyTransmission, date);
    const rtmpUrl = `rtmp://localhost:1935/live/${user.keyTransmission}`;
    console.log(rtmpUrl);
    console.log('[Pinkker] [PrePublish] Inicio del Stream para ' + user.NameUser + " con la clave " + user.keyTransmission);

    if (cmt) {
      const interval = setInterval(async () => {
        await helpers.generateStreamThumbnail(user.keyTransmission, cmt);
        await AverageViewers(user.id);
      }, 3 * 60 * 3000);
      session.user = { interval };
    }

    return;
  }

  session.reject();
});



nms.on('donePublish', async (id, StreamPath, args) => {
  const key = StreamPath.replace(/\//g, '');

  let totalKey;

  if (key.length === 49) {
    totalKey = key.substring(4, key.length);
  } else {
    totalKey = key;
  }
  const user = await getUserByKey(key);
  if (user) {
    const streamerName = keys.get(totalKey);
    if (streamerName) {
      streams.delete(streamerName);
      keys.delete(totalKey);

      await updateOnline(user.keyTransmission, false);

      console.log('[Pinkker] [donePublish] Stream apagado para ' + streamerName + ' con la clave ' + totalKey);
      const clipsDir = path.join(__dirname, 'media', 'clips');
      const mp4FilePath = path.join(clipsDir, `salida_${totalKey}.mp4`);
      if (fs.existsSync(mp4FilePath)) {
        try {
          fs.unlinkSync(mp4FilePath);
        } catch (unlinkError) {
          console.error('[Pinkker] [donePublish] Error al eliminar el archivo MP4:', unlinkError.message);
        }
      }
    }

    if (id && nms.getSession(id) && nms.getSession(id).user && nms.getSession(id).user.interval) {
      clearInterval(nms.getSession(id).user.interval);
    }
  }
});





function getNewestFile(files, path) {
  var out = [];
  var files = files.filter(function (file) {
    return file.indexOf(".mp4") !== -1;
  })

  files.forEach(function (file) {
    var stats = fs.statSync(path + "/" + file);
    if (stats.isFile()) {
      out.push({ "file": file, "mtime": stats.mtime.getTime() });
    }
  });
  out.sort(function (a, b) {
    return b.mtime - a.mtime;
  })
  return (out.length > 0) ? out[0].file : "";
}

nms.run();
app.listen(8002, () => {
  console.log(`server on port 8002`)
})