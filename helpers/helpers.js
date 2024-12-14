const spawn = require('child_process').spawn;
const cmd = process.env.FFMPEG_PATH;
const cloudinary = require('cloudinary');
const fs = require('fs');
const axios = require("axios");
const path = require('path');

const ffmpeg = require('fluent-ffmpeg');

ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);


cloudinary.config({
    cloud_name: process.env.CLOUD_NAME,
    api_key: process.env.CLOUD_API_KEY,
    api_secret: process.env.CLOUD_API_SECRET
});

let url_stream = process.env.BACKEND_URL + "/stream";

async function updateThumbnail(image, cmt) {
    try {
        const res = await axios.post(`${url_stream}/update_thumbnail`, { image: image, cmt: cmt });
        return res;
    } catch (error) {
        console.error('Error while calling updateThumbnail', error.message);
        return
    }
}

let url_vod = process.env.BACKEND_URL + "/vods";

async function createVod(url, stream_key) {
    try {
        const res = await axios.post(`${url_vod}/createVod`, { url, stream_key });
        return res;
    } catch (error) {
        console.error('Error while calling createVod', error.message);
    }
}

const BASE_UPLOAD_PATH = process.env.BASE_UPLOAD_PATH

const generateStreamThumbnail = async (key, cmt) => {
    setTimeout(async () => {
        const stream_key = key.substring(4, key.length);

        // Crear un nombre basado en `cmt` y la fecha actual
        const timestamp = Date.now(); // Marca de tiempo en milisegundos
        const randomFilename = `${timestamp}.png`;

        // Crear la ruta completa para guardar la miniatura
        const folderPath = path.join(BASE_UPLOAD_PATH,);
        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
        }

        const thumbnailPath = path.join(folderPath, randomFilename);

        const args = [
            '-y',
            '-i', `${process.env.LIVE_URL}/live/${stream_key}.flv`,
            '-ss', '00:00:05',
            '-s', '1920x1080',
            '-vframes', '1',
            '-vf', 'scale=-2:300',
            thumbnailPath,
        ];

        try {
            // Ejecutar FFmpeg para generar la miniatura
            await spawn('ffmpeg', args, {
                detached: true,
                stdio: 'ignore'
            }).unref();

            setTimeout(async () => {
                const thumbnailUrl = `${process.env.MediaBaseURL}/${randomFilename}`;
                try {

                    // Actualizar miniatura con la URL
                    await updateThumbnail(thumbnailUrl, cmt);

                } catch (error) {
                    console.error('Error al actualizar la miniatura o eliminar el archivo:', error);
                }
            }, 10000);
        } catch (error) {
            fs.unlinkSync(thumbnailPath);
            console.error('Error al generar la miniatura: Eliminada');
        }
    }, 30000);
};

const uploadStream = async (file_name, stream_key) => {
    const filePath = process.env.MEDIA_FOLDER + stream_key + "/" + file_name;

    // Verificar si el archivo existe
    if (!fs.existsSync(filePath)) {
        return;
    }

    setTimeout(() => {
        console.log("Subiendo el vod " + file_name);
        cloudinary.v2.uploader.upload(filePath, {
            folder: 'vods',
            resource_type: 'video',
            video_resolution: '480p',
            format: 'mp4',
            audio_codec: 'aac',
            audio_bitrate: '128k',
            audio_channels: 2,
            audio_samplerate: 44100,
            audio_volume: '-10dB'
        }, async (err, result) => {
            if (err) {
            } else {
                try {
                    await createVod(result.secure_url, stream_key);
                } catch (error) {
                }
            }
        });
    }, 10000);
};


function getNewestFile(files, path) {

    var out = [];
    var files = files.filter(function (file) {
        return file.indexOf(".mp4") !== -1;
    });

    files.forEach(function (file) {
        var stats = fs.statSync(path + "/" + file);
        if (stats.isFile()) {
            out.push({ "file": file, "mtime": stats.mtime.getTime() });
        }
    });
    out.sort(function (a, b) {
        return b.mtime - a.mtime;
    });
    return (out.length > 0) ? out[0].file : "";
}

const removeTmp = (path) => {
    fs.unlink(path, err => {
        if (err) {
            console.error('Error removing temporary file:', err.message);
        }
    });
};

const uploadClipToCloudinary = async (filePath) => {
    return new Promise((resolve, reject) => {
        cloudinary.v2.uploader.upload(filePath, {
            folder: 'clips',
            resource_type: 'video',
            format: 'mp4',
            audio_codec: 'aac',
            audio_bitrate: '128k',
            audio_channels: 2,
            audio_samplerate: 44100,
            audio_volume: '-10dB'
        }, (err, result) => {
            if (err) {
                console.error('Error uploading to Cloudinary:', err.message);
                reject(new Error('Error uploading to Cloudinary: ' + err.message));
            } else {
                resolve(result.secure_url);
            }
        });
    });
}


module.exports = {
    generateStreamThumbnail: generateStreamThumbnail,
    uploadStream: uploadStream,

};
