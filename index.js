require('dotenv').config()
const NodeMediaServer = require('node-media-server');
const cors = require("cors");
const express = require("express");
const request = require("request");
const axios = require("axios");
const spawn = require('child_process').spawn, cmd = process.env.FFMPEG_PATH;
const app = express();

const helpers = require('./helpers/helpers');

const streams = new Map();
const keys = new Map();

const getUserByKey = require("./controllers/userCtrl");

const { addStream, removeStream, getStream } = require('./helpers/livestreamHelper');
var fs = require('fs');
const { log } = require('console');

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cors());

const config = {
  rtmp: {
    port: 1935,
    chunk_size: 1000,
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
        // vc for libx264 and libx265
        vc: 'libx264',
        vcParams: [
          '-vf',
          'scale=1280:720' // Cambiar a la resolución deseada
        ],

        hls: true,
        hlsFlags: '[hls_time=2:hls_list_size=3:hls_flags=delete_segments]',
        dash: false,
      }
    ]
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
        ]
      },
    ]
  }
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
    console.log("Se llega sin errores");
    const streamingsOnline = await getStreamingsOnline();

    if (!user.verified && streamingsOnline.data >= 20) {
      console.log("[Pinkker] Maximo de streamings online para usuario no verificado");
    } else if (user.verified && streamingsOnline.data >= 50) {
      console.log("[Pinkker] Maximo de streamings online para usuario verificado");
    } else {
      streams.set(user.NameUser, totalKey);
      keys.set(totalKey, user.NameUser);

      let date = new Date().getTime();
      let fileName = date_pc.getFullYear() + "-" + date_pc.getMonth() + "-" + date_pc.getDate() + "-" + date_pc.getHours() + "-" + date_pc.getMinutes() + "-" + date_pc.getSeconds();
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



nms.on('donePublish', async (id, StreamPath, args) => {

  const key = StreamPath.replace(/\//g, "");
  //const user = keys.get(key);
  const user = await getUserByKey(key);
  if (!user) {
    console.log("usuario no encontrado");
    return
  }
  //await resumeStream(user._id)

  await updateOnline(user.keyTransmission, false);
  //console.log(args);

  keys.delete(key);
  streams.delete(user);


  /*await fs.readdir("./media/live/" + key.substring(4, key.length), function (err, archivos) {
    if (err) { throw console.log(err); }
    var videoFile = getNewestFile(archivos, "./media/live/" + key.substring(4, key.length));
    helpers.uploadStream(videoFile, key.substring(4, key.length));
  });*/

  console.log("[Pinkker] [DonePublish] End stream for " + user + " with key " + key);
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