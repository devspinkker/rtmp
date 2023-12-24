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

const getUserByKey = require("./controllers/userCtrl");

var fs = require('fs');
const spawn = require('child_process').spawn;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use(cors());

app.use("/recortarYSubirClip", require("./routes/index.routes"))


const config = {
  rtmp: {
    port: 1935,
    chunk_size: 4000,
    gop_cache: true,
    ping: 60,
    ping_timeout: 30
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
        app: 'live',
        ac: 'aac',
        vc: 'libx264',
        vcParams: [
          '-vf',
          'scale=1280:720'
        ],
        hls: true,
        hlsFlags: '[hls_time=1:hls_list_size=15:hls_flags=delete_segments]',
        dash: false,
      }
    ]
  }

  // fission: {
  //   ffmpeg: process.env.FFMPEG_PATH,
  //   tasks: [
  //     {
  //       rule: "live/*",
  //       model: [
  //         {
  //           ab: "128k",
  //           vb: "1500k",
  //           vs: "1280x720",
  //           vf: "30",
  //         },
  //         {
  //           ab: "96k",
  //           vb: "1000k",
  //           vs: "854x480",
  //           vf: "24",
  //         },
  //         {
  //           ab: "96k",
  //           vb: "600k",
  //           vs: "640x360",
  //           vf: "20",
  //         },
  //       ]
  //     },
  //   ]
  // }
};

let url = process.env.BACKEND_URL + "/stream";


async function updateOnline(Key, online) {
  try {
    const res = await axios.post(`${url}/update_online`, { Key, State: online })
    return res;
  } catch (error) {
    console.log('Error while calling updateOnline', error)
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
    const ffmpegProcess = ffmpeg();
    const inputStream = new PassThrough();
    chunks.forEach(chunk => inputStream.write(chunk));
    inputStream.end();

    const outputFilePath = path.join(__dirname, 'media', 'clips', `salida_${totalKeyreq}.mp4`);

    ffmpegProcess
      .input(inputStream)
      .inputFormat('mpegts')
      .videoCodec('copy')
      .audioCodec('copy')
      .toFormat('mp4')
      .outputOptions(['-movflags', 'frag_keyframe+empty_moov'])
      .outputOptions(['-bsf:a', 'aac_adtstoasc'])
      .output(outputFilePath)
      .on('end', () => {
        resolve(outputFilePath);
      })
      .on('error', (err, stdout, stderr) => {
        console.error(`Error al convertir a MP4: ${err.message || err}`);
        console.error(`Salida de error detallada: ${stderr}`);
        reject(new Error(`Error al convertir a MP4: ${err.message || err}`));
      })
      .run();
  });
}

// En tu ruta
app.get('/getBuffer/:totalKey', async (req, res) => {
  const totalKeyreq = req.params.totalKey;
  const currentFolder = process.cwd();
  const mediaFolder = path.join(currentFolder, 'media', 'live', totalKeyreq);

  const chunks = getChunksFromFolder(mediaFolder);

  if (chunks.length > 0) {
    try {
      const mp4Buffer = await convertToMP4(chunks, totalKeyreq);

      const fileStream = fs.createReadStream(mp4Buffer);
      fileStream.pipe(res);

    } catch (error) {
      console.error('Error al convertir a MP4:', error);
      res.status(500).send('Error interno al convertir a MP4.');
    }
  } else {
    res.status(404).send('No hay búfer para la transmisión especificada.');
  }
});







function getChunksFromFolder(folderPath) {
  const files = fs.readdirSync(folderPath);
  const tsFiles = files.filter(file => file.endsWith('.ts'));

  return tsFiles.map(file => {
    const filePath = path.join(folderPath, file);
    return fs.readFileSync(filePath);
  });
}

// app.get('/getBuffer/:totalKey', async (req, res) => {
//   const totalKeyreq = req.params.totalKey;
//   const currentFolder = process.cwd();
//   const outputFolder = path.join(currentFolder, 'media', 'clips');
//   const outputFilePath = path.join(outputFolder, `output_${totalKeyreq}.ts`);

//   if (videoBuffers.has(totalKeyreq)) {
//     let resFunc = await generateVideoInBackground(totalKeyreq, outputFilePath);
//     console.log(resFunc);
//     console.log(resFunc);
//     res.status(200).json({ "ok": "ok" });
//   } else {
//     res.status(404).send('No hay búfer para la transmisión especificada.');
//   }
// });
// const MAX_BUFFER_SIZE = 60;

// const captureAndProcessVideo = (totalKey) => {
//   if (!videoBuffers.has(totalKey)) {
//     videoBuffers.set(totalKey, new CircularBuffer(MAX_BUFFER_SIZE));
//   }
//   const currentFolder = process.cwd();
//   const newSecondOfVideo = path.join(currentFolder, 'media', 'live', totalKey, 'index.m3u8');
//   videoBuffers.get(totalKey).enq({ key: totalKey, timestamp: Date.now(), fragment: newSecondOfVideo });
// };

// const generateVideoInBackground = (totalKey, outputFilePath) => {
//   const buffer = videoBuffers.get(totalKey);

//   if (buffer && buffer.size() >= MAX_BUFFER_SIZE) {
//     buffer.deq(buffer.size() - MAX_BUFFER_SIZE);

//     const ffmpegProcess = spawn(process.env.FFMPEG_PATH, [
//       '-y',
//       ...buffer.toarray().flatMap(entry => ['-i', entry.fragment]),
//       '-filter_complex', `concat=n=${buffer.size()}:v=1:a=1`,
//       '-c:v', 'libx264',
//       '-c:a', 'aac',
//       '-strict', 'experimental',
//       '-t', '60',
//       outputFilePath,
//     ]);

//     ffmpegProcess.on('close', (code) => {
//       if (code === 0) {
//         console.log("Generación de video exitosa.");
//       } else {
//         console.log(`Error en la generación de video. Código de salida: ${code}`);
//       }
//     });
//   } else {
//     console.log("No hay suficientes datos en el buffer para generar el video.");
//   }
// };

// setInterval(() => {
//   streams.forEach((totalKey, username) => {
//     console.log("c");
//     captureAndProcessVideo(totalKey);
//   });
// }, 1000);

var nms = new NodeMediaServer(config);

nms.on('preConnect', (id, args) => {
  console.log('[Pinkker] [NodeEvent on preConnect]', `id=${id} args=${JSON.stringify(args)}`);

});

nms.on('doneConnect', (id, args) => {
  console.log('doneConnect');
});

nms.on('prePublish', async (id, StreamPath, args) => {
  let date_pc = new Date();
  date_pc.setHours(date_pc.getHours() - 3);

  const key = StreamPath.replace(/\//g, "");

  let totalKey;

  if (key.length === 49) {
    totalKey = key.substring(4, key.length);
  } else {
    totalKey = key;
  }
  const user = await getUserByKey(key);

  const session = nms.getSession(id);

  if (!user) {
    console.log("[Pinkker] Usuario no encontrado");
  } else if (args.token == user.cmt) {
    console.log("[Pinkker] Token inválido para llave");
  } else {
    const streamingsOnline = await getStreamingsOnline();

    if (!user.verified && streamingsOnline.data >= 20) {
      console.log("[Pinkker] Maximo de streamings online para usuario no verificado");
    } else if (user.verified && streamingsOnline.data >= 50) {
      console.log("[Pinkker] Maximo de streamings online para usuario verificado");
    } else {
      streams.set(user.NameUser, totalKey);
      keys.set(totalKey, user.NameUser);

      let date = new Date().getTime();
      await updateOnline(user.keyTransmission, true);
      await updateTimeStart(user.keyTransmission, date);
      const rtmpUrl = `rtmp://localhost:1935/live/${totalKey}`;
      console.log(rtmpUrl);
      await helpers.generateStreamThumbnail(totalKey, user.cmt);
      console.log('[Pinkker] [PrePublish] Inicio del Stream para ' + user.NameUser + "con la clave " + totalKey);
      return;
    }
  }

  session.reject();
});



nms.on('prePublish', async (id, StreamPath, args) => {
  let date_pc = new Date();
  date_pc.setHours(date_pc.getHours() - 3);

  const key = StreamPath.replace(/\//g, '');

  let totalKey;

  if (key.length === 49) {
    totalKey = key.substring(4, key.length);
  } else {
    totalKey = key;
  }
  const user = await getUserByKey(key);

  const session = nms.getSession(id);

  if (!user) {
    console.log('[Pinkker] Usuario no encontrado');
  } else if (args.token == user.cmt) {
    console.log('[Pinkker] Token inválido para llave');
  } else {
    const streamingsOnline = await getStreamingsOnline();

    if (!user.verified && streamingsOnline.data >= 20) {
      console.log('[Pinkker] Maximo de streamings online para usuario no verificado');
    } else if (user.verified && streamingsOnline.data >= 50) {
      console.log('[Pinkker] Maximo de streamings online para usuario verificado');
    } else {
      streams.set(user.NameUser, totalKey);
      keys.set(totalKey, user.NameUser);

      let date = new Date().getTime();
      await updateOnline(user.keyTransmission, true);
      await updateTimeStart(user.keyTransmission, date);
      const rtmpUrl = `rtmp://localhost:1935/live/${totalKey}`;
      console.log(rtmpUrl);
      await helpers.generateStreamThumbnail(totalKey, user.cmt);
      console.log('[Pinkker] [PrePublish] Inicio del Stream para ' + user.NameUser + 'con la clave ' + totalKey);

      return;
    }
  }
  session.reject();
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