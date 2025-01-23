const fs = require('fs');
const path = require('path');
const { GetCurrentStreamSummaryForToken } = require('../helpers/helpers');
const spawn = require('child_process').spawn;
const vodStreamKey = ('', async (req, res) => {
    const streamKeyreq = req.params.streamKey;
    const vodFolder = path.join(storageDir, streamKeyreq);

    try {
        if (fs.existsSync(vodFolder)) {
            const tsFiles = await fs.promises.readdir(vodFolder);
            const fileStreams = tsFiles.map(file => fs.createReadStream(path.join(vodFolder, file)));

            res.setHeader('Content-Type', 'video/MP2T');
            for (const fileStream of fileStreams) {
                fileStream.pipe(res, { end: false });
                fileStream.on('end', () => {
                    fileStream.close();
                });
            }
            res.on('end', () => {
                res.end();
            });
        } else {
            return res.status(404).send('VOD no encontrado.');
        }
    } catch (error) {
        console.error('Error al servir VOD:', error);
        return res.status(500).send('Error interno al procesar la solicitud.');
    }
});
// Handler para servir archivos individuales (.ts) de un VOD
function handleVodFile(req, res) {
    const { key, file } = req.params;
    const tempHLSDir = path.join(process.cwd(), '/media', 'storage', 'live2', key, 'hls');
    const filePath = path.join(tempHLSDir, file);

    if (fs.existsSync(filePath)) {
        res.setHeader('Content-Type', 'video/MP2T');
        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
    } else {
        res.status(404).send('Archivo .ts no encontrado');
    }
}

// Handler para generar y servir un archivo HLS (index.m3u8) a partir de un MP4
function handleVodIndexM3u8(req, res) {
    const { key } = req.params;
    const mp4Path = path.join(process.cwd(), 'media', 'storage', 'live2', key, 'stream.mp4');
    const tempHLSDir = path.join(process.cwd(), 'media', 'storage', 'live2', key, 'hls');
    const m3u8Path = path.join(tempHLSDir, 'index.m3u8');
    let responseSent = false;

    if (!fs.existsSync(mp4Path)) {
        return res.status(404).send('Archivo MP4 no encontrado.');
    }

    try {
        if (!fs.existsSync(tempHLSDir)) {
            fs.mkdirSync(tempHLSDir, { recursive: true });
            console.log(`[Pinkker] Directorio creado exitosamente: ${tempHLSDir}`);
        }
    } catch (err) {
        console.error(`[Pinkker] Error al crear el directorio ${tempHLSDir}:`, err);
        return res.status(500).send('Error interno al preparar el directorio HLS.');
    }

    if (fs.existsSync(m3u8Path)) {
        console.log(`[Pinkker] El archivo HLS ya existe para ${key}`);
        return res.sendFile(m3u8Path);
    }

    const ffmpeg = spawn('ffmpeg', [
        '-i', mp4Path,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-f', 'hls',
        '-hls_time', '10',
        '-hls_list_size', '0',
        '-hls_flags', 'independent_segments',
        m3u8Path,
    ]);

    ffmpeg.on('close', (code) => {
        if (responseSent) return;
        if (code === 0 && fs.existsSync(m3u8Path)) {
            console.log(`[Pinkker] HLS generado correctamente para ${key}`);
            responseSent = true;
            return res.sendFile(m3u8Path);
        } else {
            console.error(`[Pinkker] Error al generar HLS para ${key}. Código de salida: ${code}`);
            responseSent = true;
            return res.status(500).send('Error al generar HLS.');
        }
    });

    setTimeout(() => {
        if (responseSent) return;
        console.error(`[Pinkker] Tiempo de espera agotado para la generación de HLS para ${key}`);
        responseSent = true;
        res.status(500).send('El archivo HLS no se generó a tiempo.');
    }, 10000);
}

async function handleVodIndexM3u8live(req, res) {
    const streamKey = req.params.streamKey;

    const StreamSummary = await GetCurrentStreamSummaryForToken(streamKey)
    console.log(StreamSummary.id);
    console.log("StreamSummary");
    console.log(StreamSummary);
    console.log("StreamSummary");

    if (StreamSummary?.id) {
        // const mediaFolder = path.join(process.cwd(), 'media', 'live', streamKey);
        const mediaFolder = path.join(process.cwd(), 'media', 'storage', 'live2', StreamSummary.id, 'hls');

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
    } else {
        res.status(500).send('Error interno al procesar la solicitud.');
    }

}
async function handleVodIndexM3u8liveFiles(req, res) {
    const streamKey = req.params.streamKey;
    const file = req.params.file;


    const StreamSummary = await GetCurrentStreamSummaryForToken(streamKey)
    console.log(StreamSummary.id);
    if (StreamSummary?.id) {
        const mediaFolder = path.join(process.cwd(), 'media', 'storage', 'live2', StreamSummary.id, 'hls');

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
    } else {
        res.status(404).send('Archivo no encontrado');
    }
}
//descargar vod
function handleVodDownload(req, res) {
    const { key } = req.params;
    const mp4Path = path.join(process.cwd(), 'media', 'storage', 'live2', key, 'stream.mp4');
    if (fs.existsSync(mp4Path)) {
        console.log(`[Pinkker] Descargando VOD MP4 para ${key}`);
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', `attachment; filename="${key}.mp4"`);
        res.download(mp4Path);
    } else {
        console.error(`[Pinkker] Archivo MP4 no encontrado para ${key}`);
        res.status(404).send('El archivo MP4 no fue encontrado.');
    }
}


module.exports = {
    vodStreamKey,
    handleVodIndexM3u8liveFiles,
    handleVodFile,
    handleVodIndexM3u8,
    handleVodIndexM3u8live,
    handleVodDownload
}