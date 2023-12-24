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
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir);
        }

        // Guardar el video completo en un archivo temporal
        const videoPath = path.join(tempDir, 'input.mp4');
        fs.writeFileSync(videoPath, Buffer.from(video, 'base64'));

        // Definir el nombre y la ubicación del archivo de salida recortado
        const outputFilePath = path.join(tempDir, 'output.mp4');

        // Realizar el recorte utilizando fluent-ffmpeg
        await new Promise((resolve, reject) => {
            ffmpeg(videoPath)
                .setStartTime(0)
                .setDuration(46)
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

        // Subir el video recortado a Cloudinary
        const cloudinaryResponse = await cloudinary.uploader.upload(outputFilePath, {
            resource_type: 'video',
            folder: 'recortes',
            overwrite: true,
        });

        // Imprimir la URL desde la respuesta de Cloudinary
        console.log(cloudinaryResponse.secure_url);

        // Enviar la URL de Cloudinary como respuesta
        res.status(200).json({ url: cloudinaryResponse.secure_url });
    } catch (error) {
        console.error('Error en la ruta de recorte:', error);
        res.status(500).send('Error interno en la ruta de recorte.');
    }
}

module.exports = CreateClips;
