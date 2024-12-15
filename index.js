require('dotenv').config()
const NodeMediaServer = require('node-media-server');
const cors = require("cors");
const express = require("express");
const axios = require("axios");
const app = express();
const helpers = require('./helpers/helpers');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = process.env.FFMPEG_PATH;
ffmpeg.setFfmpegPath(ffmpegPath);
const { router } = require('./routes/routes');


const { getUserByKey, AverageViewers, GetUserBanInstream } = require("./controllers/userCtrl");
const useExtractor = require("./middlewares/auth.middleware")
var fs = require('fs');
const spawn = require('child_process').spawn;
const exec = require('child_process').exec;

app.use(cors());

const config = {
  rtmp: {
    port: 1935,
    chunk_size: 4096,
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
        hlsFlags: "[hls_time=1:hls_list_size=10]",
        hlsKeep: false,
        vc: "libx264",
        h264_profile: "main",
        h264_level: "4.1",
        hls_wait_keyframe: true,
        dashKeep: false,
        vf: "60", // fps
        gop: "120",
        flags: "-b:v 6000k",
      },
      {
        app: "live",
        hls: true,
        hlsFlags: "[hls_time=1:hls_list_size=10]",
        hlsKeep: false,
        vc: "h264_nvenc",
        h264_profile: "main",
        h264_level: "4.1",
        gpu: 0,
        hls_wait_keyframe: true,
        dashKeep: false,
        vf: "60", // fps
        gop: "120",
        flags: "-b:v 6000k",
      },
      {
        app: "live",
        hls: true,
        hlsFlags: "[hls_time=1:hls_list_size=10]",
        hlsKeep: false,
        vc: "hevc_nvenc",
        hevc_profile: "main",
        hevc_level: "4.1",
        gpu: 0,
        hls_wait_keyframe: true,
        vf: "60", // fps
        gop: "120",
        dashKeep: false,
        flags: "-b:v 6000k",
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
            vf: "60",
            gop: "120",
            preset: "veryfast",
            crf: "27",
          },
          {
            ab: "96k",
            vb: "1000k",
            vs: "854x480",
            vf: "24",
            gop: "48",
            preset: "veryfast",
            crf: "27",
          },
          {
            ab: "96k",
            vb: "600k",
            vs: "640x360",
            vf: "20",
            gop: "40",
            preset: "veryfast",
            crf: "27",
          },
        ],
      },
    ],
  }
};
var nms = new NodeMediaServer(config);

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

async function getStreamingsOnline() {
  try {
    const data = await axios.get(process.env.BACKEND_URL + `/stream/get_streamings_online`);
    if (data != null && data != undefined) {
      return data.data;
    }
  } catch (error) {
    return data.data;
  }
}





nms.on('preConnect', (id, args) => {
  console.log('[Pinkker] [NodeEvent on preConnect]', `id=${id} args=${JSON.stringify(args)}`);

});
nms.on('doneConnect', (id, args) => {
  console.log('doneConnect');
});

nms.on('prePublish', async (id, StreamPath, args, cmt) => {
  const session = nms.getSession(id);
  const key = StreamPath.replace(/\//g, "");
  let totalKey = key.length === 49 ? key.substring(4, key.length) : key;
  console.log(key);
  const user = await getUserByKey("live" + totalKey);

  if (user?.Banned) {
    console.log("[Pinkker] Usuario no encontrado o prohibido");
    if (user.NameUser !== "") {
      session.reject();
      return;
    }
  }

  const streamingsOnline = await getStreamingsOnline();

  if (user.NameUser) {

    if ((!user.Partner.active && streamingsOnline.data >= 5) || (user.Partner.active && streamingsOnline.data >= 10)) {
      console.log("[Pinkker] Máximo de streamings online alcanzado");
      session.reject();
      return;
    }
  }

  if (user.NameUser !== "") {
    const mediaFolder = path.join(__dirname, 'media', 'live', totalKey);

    if (!fs.existsSync(mediaFolder)) {
      fs.mkdirSync(mediaFolder, { recursive: true });
    }
    let date = new Date().getTime();
    // Actualizar estado del usuario y comenzar la transmisión
    // almacenar mp4
    const resUpdateOnline = await updateOnline(user.keyTransmission, true);
    const destDir = path.join(__dirname, 'media', 'storage', 'live2', resUpdateOnline.data.data);

    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    // Generar el archivo .mp4 durante la transmisión
    const mp4OutputPath = path.join(destDir, 'stream.mp4');

    console.log(`[Pinkker] [PrePublish] Comenzando a grabar el stream en ${mp4OutputPath}`);

    const ffmpegProcess = spawn(ffmpegPath, [
      '-i', `rtmp://127.0.0.1:1935/live/${totalKey}`,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-preset', 'ultrafast',
      '-threads', '1',
      '-f', 'mp4',
      mp4OutputPath
    ]);

    // ffmpegProcess.stderr.on('data', (data) => {
    //   console.log(`[FFmpeg] ${data}`);
    // });

    ffmpegProcess.on('close', (code) => {
      console.log(`[Pinkker] [PrePublish] FFmpeg finalizado con código: ${code}`);
    });

    // establecer que se necesita auth
    const resgetStreamByUserName = await helpers.getStreamByUserName(user.NameUser)
    const authorizationToView = resgetStreamByUserName?.data?.AuthorizationToView || {}
    const requiresAuthorization =
      authorizationToView.pinkker_prime || authorizationToView.subscription;

    session.user = {
      ffmpegProcess, // Guarda el proceso para poder matarlo luego
      authorization: requiresAuthorization,
      streamerId: user._id,
    };



    // iniciar stream
    await updateTimeStart(user.keyTransmission, date);
    console.log(`[Pinkker] [PrePublish] Inicio del Stream para ${user.NameUser} con la clave ${user.keyTransmission}`);

    const bannedCheckInterval = setInterval(async () => {
      const Banned = await GetUserBanInstream("live" + totalKey);
      if (Banned) {
        console.log(`[Pinkker] Stream apagado debido a prohibición del usuario ${user.NameUser}`);
        session.reject();
        clearInterval(bannedCheckInterval);
        clearInterval(session.user?.interval);
        clearInterval(session.user?.secondInterval);
      }
    }, 3 * 60 * 1000);

    session.user = { bannedCheckInterval };

    if (cmt) {
      // Intervalo para actualizar el promedio de espectadores
      const interval = setInterval(async () => {
        await AverageViewers(user.id);
      }, 5 * 60 * 1000);
      session.user.interval = interval;

      // Intervalo para generar miniaturas del stream
      const secondInterval = setInterval(async () => {
        await helpers.generateStreamThumbnail(user.keyTransmission, cmt);
      }, 5 * 60 * 1000);
      session.user.secondInterval = secondInterval;
    }
  }
});


// Ejecutar la conversión al principio del flujo de trabajo
app.use('/media', async (req, res, next) => {
  const streamKey = req.path.split('/')[2]; // Obtener clave del stream desde la ruta
  const streamPath = `/live/${streamKey}`; // Definir el StreamPath en el formato esperado
  const session = nms.getSessionByStreamPath(streamPath); // Obtener la sesión del stream

  if (!session) {
    return res.status(404).send('Stream no encontrado.');
  }

  console.log(`[Middleware] Verificando autorización para el stream: ${streamPath}`);

  if (session.user?.authorization) {
    if (!req.query.token) {
      return res.status(403).send('Acceso denegado: Falta token.');
    }

    const streamerId = session.user.streamerId; // Obtener el ID del streamer desde la sesión

    try {
      const response = await helpers.validate_stream_access(req.query.token, streamerId);
      if (!response.data || !response.data.valid) {
        return res.status(403).send('Acceso denegado: Token inválido o sin autorización.');
      }
    } catch (error) {
      console.error(`[Middleware] Error al validar token: ${error.message}`);
      return res.status(500).send('Error interno del servidor.');
    }
  }

  next(); // Continuar si no requiere autorización o si la validación fue exitosa
});


app.use(router);

setInterval(() => {
  console.log('[Pinkker] Iniciando limpieza de carpetas HLS antiguas...');
  helpers.cleanOldHLS();
  // }, 1 * 60 * 1000);
}, 24 * 60 * 60 * 1000);

nms.run();
app.listen(8002, () => {
  console.log(`server on port 8002`)
})