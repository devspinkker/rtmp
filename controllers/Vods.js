const fs = require('fs');
const path = require('path');

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
module.exports = { vodStreamKey }