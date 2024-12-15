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

var nms = new NodeMediaServer(config);

const { getUserByKey, AverageViewers, GetUserBanInstream } = require("./controllers/userCtrl");
const useExtractor = require("./middlewares/auth.middleware")
var fs = require('fs');
const spawn = require('child_process').spawn;
const exec = require('child_process').exec;

app.use(cors());
app.use('/media', async (req, res, next) => {
  const streamKey = req.path.split('/')[2]; // Obtener clave del stream desde la ruta
  const authToken = req.query.token; // Token proporcionado por el cliente
  const session = nms.getSessionByStreamPath(`/live/${streamKey}`); // Obtener sesión del stream

  if (!session) {
    return res.status(404).send('Stream no encontrado.');
  }
  console.log("paso algo")
  // Verificar si el stream requiere autorización
  if (session.user?.authorization) {
    if (!authToken) {
      return res.status(403).send('Acceso denegado: Falta token.');
    }

    // Validar token en el backend
    try {
      const response = await helpers.validate_stream_access(authToken)

      if (!response.data || !response.data.valid) {
        return res.status(403).send('Acceso denegado: Token inválido o sin autorización.');
      }
    } catch (error) {
      return res.status(500).send('Error interno del servidor.');
    }
  }

  next(); // Continuar si no requiere autorización o si la validación fue exitosa
});

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
    console.log(resgetStreamByUserName);

    session.user = {
      ffmpegProcess, // Guarda el proceso para poder matarlo luego
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

  // Llamada a la función que convierte los archivos .ts en todas las carpetas
  // await convertAllTsToMp4InAllFolders();

  const user = await getUserByKey(key);

  if (user && user.keyTransmission) {
    const res = await updateOnline(user.keyTransmission, false);

    console.log(`[Pinkker] [donePublish] Stream apagado con la clave ${totalKey}`);

    if (id && nms.getSession(id) && nms.getSession(id).publisher) {
      nms.getSession(id).publisher.stop();
    }
  }
  const session = nms.getSession(id);
  if (session) {
    const user = session.user;

    // Detener el proceso de FFmpeg si está grabando el stream
    if (user && user.ffmpegProcess) {
      const ffmpegProcess = user.ffmpegProcess;
      ffmpegProcess.kill();  // Terminar el proceso de FFmpeg
      console.log(`[Pinkker] [donePublish] FFmpeg detenido`);
    }

    // Eliminar los intervalos de actualización de miniaturas y promedio de espectadores
    if (user && user.interval) {
      clearInterval(user.interval);
      clearInterval(user.secondInterval);
      console.log(`[Pinkker] [donePublish] Intervalos de actualización detenidos`);
    }

    // Eliminar la carpeta de medios generada durante el stream (si es necesario)
    const mediaFolder = path.join(__dirname, 'media', 'live', user.keyTransmission);
    if (fs.existsSync(mediaFolder)) {
      fs.rmdirSync(mediaFolder, { recursive: true });
      console.log(`[Pinkker] [donePublish] Archivos de transmisión eliminados`);
    }

    // Limpiar la sesión del usuario
    session.user = null;  // Limpiar cualquier referencia de usuario
  }
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