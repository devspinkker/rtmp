require('dotenv').config()
const fs = require('fs');
const path = require('path');
const { PassThrough } = require('stream');
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
const spawn = require('child_process').spawn;

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

            const durationInSeconds = await getVideoDurationInSeconds(filePath);
            totalDuration += durationInSeconds;

            if (totalDuration >= 30) {
                break;
            }
        }

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
            const mediaDir = path.join(__dirname, '..', 'media');
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

const StreamStreamKey = async (req, res) => {
    const streamKeyreq = req.params.streamKey;
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
};

module.exports = { StreamStreamKey };
