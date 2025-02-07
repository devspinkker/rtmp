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
const { createProxyMiddleware } = require('http-proxy-middleware');
const { router } = require('./routes/routes');


const { getUserByKey, AverageViewers, GetUserBanInstream } = require("./controllers/userCtrl");
var fs = require('fs');
const spawn = require('child_process').spawn;

const liveStreams = new Map();

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
        hlsFlags: "[hls_time=7:hls_list_size=10]",
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
        hlsFlags: "[hls_time=7:hls_list_size=10]",
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
        hlsFlags: "[hls_time=7:hls_list_size=10]",
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




app.use('/live/:streamKey', async (req, res, next) => {
  let { streamKey } = req.params;
  streamKey = streamKey.replace(/\.(flv|m3u8)$/, '');
  streamKey = streamKey.replace(/^live/, '');
  streamKey = streamKey.replace(/_\d+$/, '');

  const streamData = liveStreams.get(streamKey);

  if (!streamData) {
    return res.status(404).send('Stream no encontrado.');
  }
  if (streamData.requiresAuth) {
    try {
      const response = await helpers.validate_stream_access(req.query.token, streamData.streamerId);
      console.log(response);

      if (response?.message === "invalid") {
        return res.status(403).send('Acceso denegado: Token inválido.');
      }
    } catch (error) {
      console.error('Error al validar token:', error.message);
      return res.status(403).send('Error interno del servidor.');
    }
  }

  next(); // Continuar si todo está validado correctamente
});



app.use(
  '/live',
  createProxyMiddleware({
    target: 'http://127.0.0.1:8000', // NMS en el puerto interno
    changeOrigin: true,
    ws: true, // Asegura el soporte de WebSocket
    onProxyReq(proxyReq, req, res) {
      console.log(`[Proxy] ProxyReq para: ${req.url}`);
    },
    onProxyRes(proxyRes, req, res) {
      console.log(`[Proxy] ProxyRes recibido: ${req.url}`);
    },
    onError(err, req, res) {
      console.error(`[Proxy] Error en proxy: ${err.message}`);
      res.status(500).send('Error en el proxy.');
    },
    pathRewrite: (path) => {
      // Agregar la palabra "live" si no está presente

      if (!path.startsWith('/live')) {
        path = '/live/' + path;
      }
      return path.replace(/\.(flv|m3u8)$/, ''); // Reemplazar extensiones si es necesario
    },
  })
);

nms.on('preConnect', (id, args) => {
  console.log('[Pinkker] [NodeEvent on preConnect]', `id=${id} args=${JSON.stringify(args)}`);

});
nms.on('doneConnect', (id, args) => {
  console.log('doneConnect');
});

nms.on('prePublish', async (id, StreamPath, args, cmt) => {

  const key = StreamPath.replace(/\//g, "");
  let totalKey = key.length === 49 ? key.substring(4, key.length) : key;
  console.log(key);
  const user = await getUserByKey("live" + totalKey);

  if (user?.Banned) {
    console.log("[Pinkker] Usuario no encontrado o prohibido");
    if (user.NameUser !== "") {

      return;
    }
  }

  const streamingsOnline = await getStreamingsOnline();

  if (user.NameUser) {

    if ((!user.Partner.active && streamingsOnline.data >= 5) || (user.Partner.active && streamingsOnline.data >= 10)) {
      console.log("[Pinkker] Máximo de streamings online alcanzado");

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
    const HlsOutputPath = path.join(destDir, "hls");

    if (!fs.existsSync(path.dirname(HlsOutputPath))) {
      fs.mkdirSync(path.dirname(HlsOutputPath), { recursive: true });
    }


    console.log(`[Pinkker] [PrePublish] Comenzando a grabar el stream en ${mp4OutputPath}`);
    const ffmpegProcess = spawn(ffmpegPath, [
      '-i', `rtmp://127.0.0.1:1935/live/${totalKey}`, // Entrada RTMP
      '-map', '0:v', '-map', '0:a',  // Mapea video y audio para ambas salidas
      '-c:v', 'copy',                // Copia el video sin re-codificar para MP4
      '-c:a', 'aac',                 // Transcodifica el audio a AAC
      '-b:a', '128k',                // Bitrate del audio
      '-preset', 'ultrafast',        // Usa el preset más rápido
      '-flush_packets', '1',         // Vaciar paquetes inmediatamente
      mp4OutputPath,
    ]);

    helpers.startHLSWatcher(mediaFolder, HlsOutputPath);

    ffmpegProcess.stderr.on('data', (data) => {
      console.log(`[FFmpeg] ${data.toString()}`);
    });
    ffmpegProcess.on('exit', (code, signal) => {
      console.log(`[FFmpeg] Proceso finalizado con código: ${code}, señal: ${signal}`);
    });

    ffmpegProcess.on('close', (code) => {
      console.log(`[Pinkker] [PrePublish] FFmpeg finalizado con código: ${code}`);
    });

    // establecer que se necesita auth
    const resgetStreamByUserName = await helpers.getStreamByUserName(user.NameUser)
    const authorizationToView = resgetStreamByUserName?.data?.AuthorizationToView || {}
    const requiresAuth =
      authorizationToView.pinkker_prime || authorizationToView.subscription;

    liveStreams.set(totalKey, {
      streamerId: user.id,
      ffmpegProcess: ffmpegProcess,
      intervals: [],
      requiresAuth,
    });


    // iniciar stream
    await updateTimeStart(user.keyTransmission, date);
    console.log(`[Pinkker] [PrePublish] Inicio del Stream para ${user.NameUser} con la clave ${user.keyTransmission}`);

    const bannedCheckInterval = setInterval(async () => {
      const Banned = await GetUserBanInstream("live" + totalKey);
      if (Banned) {
        console.log(`[Pinkker] Stream apagado debido a prohibición del usuario ${user.NameUser}`);
      }
    }, 3 * 60 * 1000);
    liveStreams.get(totalKey).intervals.push(bannedCheckInterval);


    if (cmt) {
      // Intervalo para actualizar el promedio de espectadores
      const AverageViewersInterval = setInterval(async () => {
        await AverageViewers(user.id);
      }, 5 * 60 * 1000);
      liveStreams.get(totalKey).intervals.push(AverageViewersInterval);


      const thumbnailId = Date.now();  // Generar un ID único constante
      setTimeout(async () => {

        await helpers.generateStreamThumbnail(user.keyTransmission, cmt, thumbnailId);

        const secondInterval = setInterval(async () => {
          await helpers.generateStreamThumbnail(user.keyTransmission, cmt, thumbnailId);
        }, 5 * 60 * 1000);
        const streamData = liveStreams.get(totalKey);

        if (streamData && Array.isArray(streamData.intervals)) {
          streamData.intervals.push(secondInterval);
        } else {
          console.error(`Stream data not found or intervals is not an array for key: ${totalKey}`);
        }
      }, 30 * 1000)
    }
  }
});

// Ejecutar la conversión al principio del flujo de trabajo
nms.on('donePublish', async (id, StreamPath, args) => {
  let totalKey;
  const key = StreamPath.replace(/\//g, '');

  if (key.length === 49) {
    totalKey = key.substring(4, key.length);
  } else {
    totalKey = key;
  }
  if (totalKey.includes('_')) {
    return;
  }

  const user = await getUserByKey(key);
  if (user && user.keyTransmission) {
    await updateOnline(user.keyTransmission, false);
    console.log(`[Pinkker] [donePublish] Stream apagado con la clave ${totalKey}`);
    if (id && nms.getSession(id) && nms.getSession(id).publisher) {
      nms.getSession(id).publisher.stop();
    }
  }
  const streamData = liveStreams.get(totalKey);

  if (streamData) {
    if (streamData.ffmpegProcess) {
      streamData.ffmpegProcess.kill();
      console.log(`[donePublish] FFmpeg detenido para ${totalKey}`);
    }

    if (streamData?.intervals?.length) {
      streamData.intervals.forEach(clearInterval);
    }

    liveStreams.delete(totalKey);
  }


  const mediaFolder = path.join(__dirname, 'media', 'live2', user.keyTransmission);
  if (fs.existsSync(mediaFolder)) {
    fs.rmdirSync(mediaFolder, { recursive: true });
    console.log(`[Pinkker] [donePublish] Archivos de transmisión eliminados`);
  }

});


app.use(router);

nms.run();
app.listen(8002, () => {
  console.log(`server on port 8002`)
})