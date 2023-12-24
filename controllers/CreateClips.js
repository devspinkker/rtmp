const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;

ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);

cloudinary.config({
    cloud_name: process.env.CLOUD_NAME,
    api_key: process.env.CLOUD_API_KEY,
    api_secret: process.env.CLOUD_API_SECRET
});

const CreateClips = async (req, res) => {
    const { video, start, end } = req.body;
    try {
        const tempDir = path.join(__dirname, 'temp');

        const directories = tempDir.split(path.sep);
        let currentDirectory = '';

        directories.forEach((directory) => {
            currentDirectory = path.join(currentDirectory, directory);
            if (!fs.existsSync(currentDirectory)) {
                fs.mkdirSync(currentDirectory);
            }
        });

        const videoPath = path.join(tempDir, 'input.mp4');
        fs.writeFileSync(videoPath, Buffer.from(video));

        const outputFilePath = path.join(tempDir, 'output.mp4');

        await new Promise((resolve, reject) => {
            ffmpeg(videoPath)
                .setStartTime(0)
                .setDuration(60)
                .output(outputFilePath)
                .on('end', () => {
                    resolve();
                })
                .on('error', (err) => {
                    console.error('Error al recortar el video:', err);
                    res.status(500).send('Error interno al recortar el video.');
                })
                .run();
        });

        const cloudinaryResponse = await cloudinary.uploader.upload(outputFilePath, {
            resource_type: 'video',
            folder: 'recortes',
            overwrite: true,
        });

        console.log(cloudinaryResponse.secure_url);

        res.status(200).json({ url: cloudinaryResponse.secure_url });
    } catch (error) {
        console.error('Error en la ruta de recorte:', error);
        res.status(500).send('Error interno en la ruta de recorte.');
    }
};

module.exports = CreateClips;
