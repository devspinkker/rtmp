const spawn = require('child_process').spawn;
const cmd = process.env.FFMPEG_PATH;
const cloudinary = require('cloudinary');
const fs = require('fs');
const axios = require("axios");
const path = require('path');
const baseURL = process.env.BACKEND_URL;
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



function cleanOldHLS() {
    const baseDir = path.join(__dirname, '../media', 'storage', 'live2');
    const now = Date.now();
    const maxAge = 6 * 24 * 60 * 60 * 1000; // 6 días en milisegundos
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

// Función para generar el contenido de un archivo .m3u8  (clips)
function generateM3u8Content(tsFiles, duration = 10) {
    if (tsFiles.length === 0) {
        throw new Error('No hay archivos .ts disponibles.');
    }

    const content = [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXT-X-ALLOW-CACHE:YES',
        '#EXT-X-TARGETDURATION:10',
        '#EXT-X-MEDIA-SEQUENCE:0'
    ];

    tsFiles.forEach(file => {
        content.push(`#EXTINF:${duration},`);
        content.push(path.basename(file));
    });

    content.push('#EXT-X-ENDLIST');
    return content.join('\n');
}
// Función para obtener los últimos archivos .ts de un archivo .m3u8 (clips)
async function getLastTsFiles(mediaFolder, maxFiles = 10) {
    try {
        const m3u8Path = path.join(mediaFolder, 'index.m3u8');
        const m3u8Content = await fs.promises.readFile(m3u8Path, 'utf8');
        const lines = m3u8Content.split('\n');

        const tsFiles = lines.filter(line => line.endsWith('.ts')).map(line => path.join(mediaFolder, line.trim()));
        return tsFiles.slice(-maxFiles);
    } catch (error) {
        throw new Error(`Error leyendo el archivo .m3u8: ${error.message}`);
    }
}
export async function getStreamByUserName(userName) {
    try {
        const response = await axios.get(`${baseURL}/stream/getStreamByNameUser?Streamer=${userName}`)
        return response.data
    } catch (error) {
        return error
    }
}
export async function validate_stream_access(token, idStreamer) {
    try {
        const response = await axios.get(
            `${baseURL}/stream/getStreamByNameUser?idStreamer=${idStreamer}`,
            {
                headers: {
                    Authorization: `Bearer ${token}`, // Enviar el token en el encabezado Authorization
                },
            }
        );
        return response.data;
    } catch (error) {
        console.error('Error en validate_stream_access:', error.message);
        return error.response?.data || error;
    }
}
module.exports = {
    generateStreamThumbnail: generateStreamThumbnail,
    uploadStream: uploadStream,
    cleanOldHLS: cleanOldHLS,
    generateM3u8Content: generateM3u8Content,
    getLastTsFiles: getLastTsFiles,
    getStreamByUserName,
    validate_stream_access
};
