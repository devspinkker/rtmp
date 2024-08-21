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

const { getUserByKey, AverageViewers, GetUserBanInstream } = require("./controllers/userCtrl");
const useExtractor = require("./middlewares/auth.middleware")
var fs = require('fs');
const spawn = require('child_process').spawn;

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
        hlsFlags: "[hls_time=1:hls_list_size=10:hls_flags=delete_segments]",
        hlsKeep: false,
        vc: "libx264",
        h264_profile: "main",
        h264_level: "4.1",
        hls_wait_keyframe: true,
        dashKeep: false,
        gop: 60,
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
        hls_wait_keyframe: true,
        gop: 60,
        dashKeep: false,
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
        hls_wait_keyframe: true,
        gop: 60,
        dashKeep: false,
      },
      {
        app: 'live',
        mp4: true,
        mp4Flags: '[movflags=frag_keyframe+empty_moov]',
      }


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
            gop: "60",
            preset: "ultrafast",
            crf: "27",
          },
          // {
          //   ab: "96k",
          //   vb: "1000k",
          //   vs: "854x480",
          //   vf: "24",
          //   gop: "48",
          //   preset: "ultrafast",
          //   crf: "27",
          // },
          // {
          //   ab: "96k",
          //   vb: "600k",
          //   vs: "640x360",
          //   vf: "20",
          //   gop: "40",
          //   preset: "ultrafast",
          //   crf: "27",
          // },
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
    return data.data;
  }
}
async function TimeOutClipCreate(token) {
  const config = {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };
  try {
    const data = await axios.get(process.env.BACKEND_URL + `/clips/TimeOutClipCreate`,
      config
    );
    if (data != null && data != undefined) {
      return data.data;
    }
  } catch (error) {
    return error;
  }
}

const { PassThrough } = require('stream');
const { log } = require('console');


var nms = new NodeMediaServer(config);


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
  if ((!user.verified && streamingsOnline.data >= 20) || (user.verified && streamingsOnline.data >= 50)) {
    console.log("[Pinkker] Máximo de streamings online alcanzado");
    session.reject();
    return;
  }
  if (user.NameUser !== "") {
    const mediaFolder = path.join(__dirname, 'media', 'live', totalKey);

    if (!fs.existsSync(mediaFolder)) {
      fs.mkdirSync(mediaFolder, { recursive: true });
    }
    // Actualizar estado del usuario y comenzar la transmisión
    let date = new Date().getTime();
    await updateOnline(user.keyTransmission, true);
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


// Función para mover archivos con reintentos
const moveFileWithRetry = (sourceFile, destFile, attempts = 5, delay = 500) => {
  let attempt = 0;
  const moveFile = () => {
    attempt++;
    try {
      fs.renameSync(sourceFile, destFile);
      console.log(`[Pinkker] [donePublish] Archivo movido de ${sourceFile} a ${destFile}`);
    } catch (error) {
      if (error.code === 'EBUSY' && attempt < attempts) {
        console.log(`[Pinkker] [donePublish] Intento ${attempt} fallido, reintentando en ${delay}ms...`);
        setTimeout(moveFile, delay);
      } else {
        console.error(`[Pinkker] [donePublish] Error al mover archivo ${sourceFile} a ${destFile}:`, error);
      }
    }
  };
  moveFile();
};

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

  // Directorios fuente y destino
  const sourceDirs = [
    path.join(__dirname, 'media', 'live', totalKey),
    path.join(__dirname, 'media', 'live', totalKey + '_720'),
    path.join(__dirname, 'media', 'live', totalKey + '_360'),
    path.join(__dirname, 'media', 'live', totalKey + '_480')
  ];

  const liveDirClear = path.join(__dirname, 'media', 'storage', 'live');

  // Mover archivos al directorio correcto basado en `res.data.data`
  const user = await getUserByKey(key);

  if (user && user.keyTransmission) {
    const res = await updateOnline(user.keyTransmission, false);

    console.log(`[Pinkker] [donePublish] Stream apagado con la clave ${totalKey}`);
    if (res.data.data) {
      const idStreamSu = res.data.data
      const destDir = path.join(__dirname, 'media', 'storage', 'live', idStreamSu);

      try {
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }

        // Mover archivos .mp4 desde sourceDirs a destDir
        sourceDirs.forEach(sourceDir => {
          if (fs.existsSync(sourceDir)) {
            const files = fs.readdirSync(sourceDir);
            files.forEach(file => {
              if (file.endsWith('.mp4')) {
                let resolution = '';
                if (sourceDir.includes('_720')) {
                  resolution = '_720';
                } else if (sourceDir.includes('_360')) {
                  resolution = '_360';
                } else if (sourceDir.includes('_480')) {
                  resolution = '_480';
                }

                const newFileName = resolution ? `${idStreamSu}${resolution}.mp4` : `${idStreamSu}.mp4`;
                const tempFile = path.join(sourceDir, file);
                const destFile = path.join(destDir, newFileName);

                if (fs.existsSync(tempFile)) {
                  try {
                    fs.renameSync(tempFile, destFile);
                    console.log(`[Pinkker] [donePublish] Archivo movido de ${tempFile} a ${destFile}`);
                  } catch (error) {
                    console.error(`[Pinkker] [donePublish] Error al mover archivo ${tempFile} a ${destFile}:`, error);
                  }
                } else {
                  console.error(`[Pinkker] [donePublish] El archivo ${tempFile} no existe.`);
                }
              }
            });
          }
        });

        console.log(`[Pinkker] [donePublish] Transmisión movida a ${destDir} con la clave ${res.data.data}`);
      } catch (error) {
        console.error('[Pinkker] [donePublish] Error al mover transmisión:', error);
      }
    }

    if (id && nms.getSession(id) && nms.getSession(id).user && nms.getSession(id).user.interval) {
      clearInterval(nms.getSession(id).user.interval);
    }
  }

  // Limpiar directorios antiguos
  const directories = fs.readdirSync(liveDirClear, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => path.join(liveDirClear, dirent.name));

  directories.forEach(dir => {
    fs.stat(dir, (err, stats) => {
      if (err) {
        console.error(`[Pinkker] [donePublish] Error al obtener estadísticas del directorio ${dir}:`, err);
        return;
      }

      const creationTime = new Date(stats.birthtime);
      const now = new Date();
      const diffTime = Math.abs(now - creationTime);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays > 30) {
        fs.rmdir(dir, { recursive: true }, (err) => {
          if (err) {
            console.error(`[Pinkker] [donePublish] Error al eliminar el directorio ${dir}:`, err);
          } else {
            console.log(`[Pinkker] [donePublish] Directorio eliminado ${dir} porque tenía más de 30 días`);
          }
        });
      }
    });
  });
});

async function getChunksFromFolder(folderPath) {
  try {
    const isFolderExists = await fs.promises.access(folderPath, fs.constants.F_OK)
      .then(() => true)
      .catch(() => false);

    if (!isFolderExists) {
      console.log('La carpeta no existe:', folderPath);
      return null;
    }

    const files = await fs.promises.readdir(folderPath);
    const tsFiles = files.filter(file => file.endsWith('.ts'));

    // Obtener los archivos .ts ordenados por fecha de modificación ascendente
    const tsFilesWithStats = await Promise.all(tsFiles.map(async file => {
      const filePath = path.join(folderPath, file);
      const stats = await fs.promises.stat(filePath);
      return { file, stats };
    }));


    tsFilesWithStats.sort((a, b) => a.stats.mtime.getTime() - b.stats.mtime.getTime());

    const chunks = [];
    let totalDuration = 0;
    const selectedFiles = [];

    for (let i = tsFilesWithStats.length - 1; i >= 0; i--) {
      const tsFile = tsFilesWithStats[i];
      const filePath = path.join(folderPath, tsFile.file);
      const fileContent = await fs.promises.readFile(filePath);
      chunks.push(fileContent);
      selectedFiles.push(tsFile.file);

      // Obtener la duración del archivo .ts en segundos
      const durationInSeconds = await getVideoDurationInSeconds(filePath);

      // Sumar la duración del archivo al total
      totalDuration += durationInSeconds;

      // Si alcanzamos aproximadamente 30 segundos o más, salir del bucle
      if (totalDuration >= 30) {
        break;
      }
    }

    // Ordenar los chunks y archivos seleccionados en orden ascendente
    selectedFiles.reverse();
    chunks.reverse();

    console.log('Archivos seleccionados:', selectedFiles);
    return chunks;
  } catch (error) {
    console.error('Error al obtener chunks:', error);
    throw error;
  }
}

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

      const inputStream = new PassThrough();
      chunks.forEach(chunk => inputStream.write(chunk));
      inputStream.end();

      const outputFilePath = path.join(clipsDir, `salida_${totalKeyreq}.mp4`);

      const ffmpegProcess = ffmpeg();
      ffmpegProcess
        .input(inputStream)
        .inputFormat('mpegts')
        .videoCodec('libx264')
        .audioCodec('aac')
        .toFormat('mp4')
        .outputOptions(['-movflags', 'frag_keyframe+empty_moov'])
        .outputOptions(['-bsf:a', 'aac_adtstoasc'])
        .outputOptions(['-preset', 'ultrafast'])  // Mantén ultrafast si el uso de CPU es una preocupación principal
        .outputOptions(['-crf', '30'])  // Aumenta CRF para reducir aún más el uso de CPU
        .outputOptions(['-maxrate', '1500k', '-bufsize', '3000k'])  // Reduce maxrate y bufsize para controlar el uso de recursos
        .outputOptions(['-s', '854x480'])  // Considera bajar la resolución para ahorrar CPU
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


async function getVideoDurationInSeconds(filePath) {
  return new Promise((resolve, reject) => {
    const ffprobeProcess = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ]);

    ffprobeProcess.stdout.on('data', (data) => {
      const duration = parseFloat(data.toString());
      resolve(duration);
    });

    ffprobeProcess.stderr.on('data', (data) => {
      reject(data.toString());
    });
  });
}

app.get('/stream/:streamKey', useExtractor, async (req, res) => {
  const streamKeyreq = req.params.streamKey;
  const { token } = req

  const time = await TimeOutClipCreate(token)
  if (time.message !== "StatusOK") {
    return res.status(500).send('demasiados intentos para  crear clips.');
  }
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
    } else {
      return res.status(404).send('El streamer está offline o no hay búfer disponible.');
    }
  } catch (error) {
    console.error('Error en la solicitud /stream:', error);
    return res.status(500).send('Error interno al procesar la solicitud.');
  }
});


app.get('/stream/vod/:streamKey/:resolution/index.m3u8', (req, res) => {
  const storageDir = path.join(__dirname, 'media', 'storage', 'live');
  const streamKey = req.params.streamKey;
  const resolution = req.params.resolution;

  // Define el directorio del VOD
  const vodFolder = path.join(storageDir, streamKey + (resolution === 'original' ? '' : `_${resolution}`));
  console.log("Ruta del directorio VOD:", vodFolder);

  // Verifica si el directorio existe antes de intentar leerlo
  if (fs.existsSync(vodFolder)) {
    console.log("El directorio existe");

    // Filtra los archivos MP4 que coinciden con la resolución dada
    const mp4Files = fs.readdirSync(vodFolder)
      .filter(file => file.endsWith('.mp4') && (resolution === 'original' ? !file.includes('_') : file.includes(`_${resolution}`)));
    console.log("El directorio existe2 ");

    if (mp4Files.length > 0) {
      console.log("El directorio existe 3");

      // Usa el primer archivo MP4 encontrado
      const mp4File = mp4Files[0];
      const filePath = path.join(vodFolder, mp4File);

      // Crea el contenido del m3u8

      const m3u8Content = [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXT-X-ALLOW-CACHE:YES',
        '#EXT-X-TARGETDURATION:10',
        '#EXT-X-MEDIA-SEQUENCE:0',
        '#EXTINF:10,',
        `${mp4File}` // Asegúrate de que el archivo esté disponible en la misma carpeta
      ];

      m3u8Content.push('#EXT-X-ENDLIST');
      console.log(fs.existsSync(filePath));

      // Envía el archivo m3u8
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Access-Control-Allow-Origin', '*'); // Permitir todas las solicitudes

      res.send(m3u8Content.join('\n'));
    } else {
      res.status(404).send('VOD no encontrado.');
    }
  } else {
    console.log("Directorio no encontrado:", vodFolder);
    res.status(404).send('Directorio no encontrado.');
  }
});

app.get('/stream/vod/:streamKey/:file', (req, res) => {
  console.log("A223");

  const storageDir = path.join(__dirname, 'media', 'storage', 'live');
  const streamKey = req.params.streamKey;
  const file = req.params.file;
  const filePath = path.join(storageDir, streamKey, file);

  // Verifica si el archivo existe antes de intentar leerlo
  if (fs.existsSync(filePath)) {
    // Establece el tipo MIME correcto basado en la extensión del archivo
    if (file.endsWith('.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    } else if (file.endsWith('.mp4')) {
      res.setHeader('Content-Type', 'video/mp4');
    }
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } else {
    res.status(404).send('Archivo no encontrado');
  }
});

nms.run();
app.listen(8002, () => {
  console.log(`server on port 8002`)
})