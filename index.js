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

  // if (user.NameUser) {
  //   if ((!user.Partner.Active && streamingsOnline.data >= 20) || (user.Partner.Active && streamingsOnline.data >= 50)) {
  //     console.log("[Pinkker] Máximo de streamings online alcanzado");
  //     session.reject();
  //     return;
  //   }
  // }

  // por ahora asi tiene que estar
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

    ffmpegProcess.stderr.on('data', (data) => {
      console.log(`[FFmpeg] ${data}`);
    });

    ffmpegProcess.on('close', (code) => {
      console.log(`[Pinkker] [PrePublish] FFmpeg finalizado con código: ${code}`);
    });

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

const convertTsToMp4InFolder = async (dir) => {
  const tsFiles = [];

  // Verificar si la carpeta existe y leer los archivos
  if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir);

    // Buscar todos los archivos .ts en la carpeta
    files.forEach(file => {
      if (file.endsWith('.ts') && file !== 'concatenated.ts') {
        tsFiles.push(path.join(dir, file));
      }
    });

    if (tsFiles.length > 0) {
      const tsListFile = path.join(dir, 'ts-list.txt');
      const concatenatedTsFile = path.join(dir, 'concatenated.ts');
      const mp4File = path.join(dir, 'stream.mp4'); // Nombre fijo para el archivo .mp4

      // Eliminar todos los archivos .mp4 existentes en la carpeta
      const mp4Files = files.filter(file => file.endsWith('.mp4'));
      mp4Files.forEach(mp4 => {
        fs.unlinkSync(path.join(dir, mp4)); // Eliminar cada archivo .mp4 encontrado
      });

      // Crear un archivo de lista para concatenar los .ts
      const tsListContent = tsFiles.map(tsFile => `file '${tsFile}'`).join('\n');
      fs.writeFileSync(tsListFile, tsListContent);

      // Usar FFmpeg para concatenar y convertir a .mp4 directamente
      exec(
        `ffmpeg -f concat -safe 0 -i ${tsListFile} -c:v copy -c:a copy -y ${mp4File}`, // No recodifica
        (err, stdout, stderr) => {
          if (err) {
            console.error(`[Pinkker] Error al convertir los archivos .ts en ${dir} a .mp4:`, stderr);
            return;
          }

          console.log(`[Pinkker] Archivo .mp4 generado exitosamente: ${mp4File}`);

          // Eliminar los archivos temporales y .ts
          try {
            tsFiles.forEach(tsFile => fs.unlinkSync(tsFile)); // Eliminar cada archivo .ts
            fs.unlinkSync(tsListFile); // Eliminar el archivo de lista
            if (fs.existsSync(concatenatedTsFile)) {
              fs.unlinkSync(concatenatedTsFile); // Eliminar el archivo concatenado si existe
            }
            console.log(`[Pinkker] Archivos .ts y temporales eliminados en ${dir}.`);
          } catch (deleteError) {
            console.error(`[Pinkker] Error al eliminar archivos temporales en ${dir}:`, deleteError);
          }
        }
      );

    }
  }
};


const convertAllTsToMp4InAllFolders = async () => {
  const liveDirClear = path.join(__dirname, 'media', 'storage', 'live2');

  // Obtener las primeras 3 carpetas en storage/live
  const directories = fs.readdirSync(liveDirClear, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => path.join(liveDirClear, dirent.name))
  // .slice(0, 3); // Limitar a las primeras 3 carpetas para pruebas

  // Iterar sobre todas las carpetas y convertir los archivos .ts a .mp4 en cada una
  for (const dir of directories) {
    console.log(`[Pinkker] Procesando carpeta: ${dir}`);
    await convertTsToMp4InFolder(dir);
  }

  console.log('[Pinkker] Conversión de todas las carpetas completada.');
};

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
        .outputOptions(['-preset', 'fast'])
        .outputOptions(['-crf', '25'])
        .outputOptions(['-maxrate', '2000k', '-bufsize', '4000k'])
        .outputOptions(['-s', '1280x720'])
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


app.get('/stream/:streamKey/index.m3u8', async (req, res) => {
  const streamKey = req.params.streamKey;
  const mediaFolder = path.join(process.cwd(), 'media', 'live', streamKey);

  try {
    // Leer el archivo index.m3u8
    const m3u8Content = await fs.promises.readFile(path.join(mediaFolder, 'index.m3u8'), 'utf8');
    const lines = m3u8Content.split('\n');

    // Filtrar solo los archivos .ts
    const tsFiles = lines
      .filter(line => line.endsWith('.ts'))
      .map(line => path.join(mediaFolder, line.trim()));

    // Obtener los últimos 10 archivos .ts 
    const last10Files = tsFiles.slice(-10);

    if (last10Files.length === 0) {
      return res.status(404).send('No hay archivos .ts disponibles.');
    }

    // Crear el contenido del m3u8
    const m3u8ContentResponse = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-ALLOW-CACHE:YES',
      '#EXT-X-TARGETDURATION:10',
      '#EXT-X-MEDIA-SEQUENCE:0'
    ];

    last10Files.forEach(file => {
      const duration = 10; // Ajusta según la duración real de cada archivo
      m3u8ContentResponse.push(`#EXTINF:${duration},`);
      m3u8ContentResponse.push(path.basename(file));
    });

    m3u8ContentResponse.push('#EXT-X-ENDLIST');

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.send(m3u8ContentResponse.join('\n'));
  } catch (error) {
    console.error('Error al generar el archivo .m3u8:', error);
    res.status(500).send('Error interno al procesar la solicitud.');
  }
});
app.get('/stream/:streamKey/:file', (req, res) => {
  const streamKey = req.params.streamKey;
  const file = req.params.file;
  const mediaFolder = path.join(process.cwd(), 'media', 'live', streamKey);
  const filePath = path.join(mediaFolder, file);

  if (fs.existsSync(filePath)) {
    if (file.endsWith('.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    } else if (file.endsWith('.ts')) {
      res.setHeader('Content-Type', 'video/MP2T');
    }
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } else {
    res.status(404).send('Archivo no encontrado');
  }
});

// consumir vods
// Ruta para generar y servir los archivos .ts a partir de un .mp4


app.get('/stream/vod/:key/index.m3u8', (req, res) => {
  const { key } = req.params;
  const mp4Path = path.join(__dirname, 'media', 'storage', 'live2', key, 'stream.mp4');
  const tempHLSDir = path.join(__dirname, 'media', 'storage', 'live2', key, 'hls');
  const m3u8Path = path.join(tempHLSDir, 'index.m3u8');
  let responseSent = false; // Flag para evitar múltiples respuestas

  // Verificar si el archivo MP4 existe
  if (!fs.existsSync(mp4Path)) {
    return res.status(404).send('Archivo MP4 no encontrado.');
  }

  // Crear directorio temporal para HLS si no existe
  try {
    if (!fs.existsSync(tempHLSDir)) {
      fs.mkdirSync(tempHLSDir, { recursive: true });
      console.log(`[Pinkker] Directorio creado exitosamente: ${tempHLSDir}`);
    }
  } catch (err) {
    console.error(`[Pinkker] Error al crear el directorio ${tempHLSDir}:`, err);
    return res.status(500).send('Error interno al preparar el directorio HLS.');
  }

  // Verificar si ya existe el archivo .m3u8
  if (fs.existsSync(m3u8Path)) {
    console.log(`[Pinkker] El archivo HLS ya existe para ${key}`);
    return res.sendFile(m3u8Path);
  }

  // Iniciar generación de HLS en tiempo real
  const ffmpeg = spawn('ffmpeg', [
    '-i', mp4Path,                        // Ruta de entrada
    '-c:v', 'copy',                       // Copiar video sin recodificación
    '-c:a', 'aac',                        // Codificar audio con AAC
    '-f', 'hls',                          // Formato de salida HLS
    '-hls_time', '10',                    // Duración de segmentos (10 segundos)
    '-hls_list_size', '0',                // Incluir todos los segmentos
    '-hls_flags', 'independent_segments', // Mantener segmentos independientes
    m3u8Path,
  ]);

  // ffmpeg.stderr.on('data', (data) => {
  //   console.error(`FFmpeg error: ${data.toString()}`);
  // });
  // ffmpeg.stdout.on('data', (data) => {
  //   console.log(`FFmpeg info: ${data.toString()}`);
  // });

  ffmpeg.on('close', (code) => {
    if (responseSent) return; // Evitar enviar respuesta duplicada
    if (code === 0 && fs.existsSync(m3u8Path)) {
      console.log(`[Pinkker] HLS generado correctamente para ${key}`);
      responseSent = true;
      return res.sendFile(m3u8Path); // Enviar el archivo completo al cliente
    } else {
      console.error(`[Pinkker] Error al generar HLS para ${key}. Código de salida: ${code}`);
      responseSent = true;
      return res.status(500).send('Error al generar HLS.');
    }
  });


  // Tiempo de espera para evitar que el cliente quede esperando indefinidamente
  setTimeout(() => {
    if (responseSent) return; // Evitar enviar respuesta duplicada
    console.error(`[Pinkker] Tiempo de espera agotado para la generación de HLS para ${key}`);
    responseSent = true;
    return res.status(500).send('El archivo HLS no se generó a tiempo.');
  }, 10000); // 10 segundos de límite
});

// Ruta para servir los archivos .ts
app.get('/stream/vod/:key/:file', (req, res) => {
  const { key, file } = req.params;
  const tempHLSDir = path.join(__dirname, 'media', 'storage', 'live2', key, 'hls');
  const filePath = path.join(tempHLSDir, file);

  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'video/MP2T');
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } else {
    res.status(404).send('Archivo .ts no encontrado');
  }
});
function cleanOldHLS() {
  const baseDir = path.join(__dirname, 'media', 'storage', 'live2');
  const now = Date.now();
  const maxAge = 20 * 24 * 60 * 60 * 1000; // 20 días en milisegundos
  // const maxAge = 1 * 60 * 1000; // 1 minuto en milisegundos


  fs.readdir(baseDir, (err, keys) => {
    if (err) {
      return console.error('Error leyendo directorio base:', err);
    }

    keys.forEach((key) => {
      const hlsPath = path.join(baseDir, key, 'hls');
      if (fs.existsSync(hlsPath)) {
        fs.stat(hlsPath, (err, stats) => {
          if (err) {
            return console.error(`Error obteniendo stats para ${hlsPath}:`, err);
          }

          const folderAge = now - stats.mtimeMs;
          if (folderAge > maxAge) {
            fs.rm(hlsPath, { recursive: true, force: true }, (err) => {
              if (err) {
                console.error(`Error eliminando carpeta ${hlsPath}:`, err);
              } else {
                console.log(`[Pinkker] Carpeta eliminada: ${hlsPath}`);
              }
            });
          }
        });
      }
    });
  });
}

setInterval(() => {
  console.log('[Pinkker] Iniciando limpieza de carpetas HLS antiguas...');
  cleanOldHLS();
  // }, 1 * 60 * 1000);
}, 24 * 60 * 60 * 1000);
nms.run();
app.listen(8002, () => {
  console.log(`server on port 8002`)
})