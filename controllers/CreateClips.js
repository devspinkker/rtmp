const { recortarYSubirClip } = require("../helpers/helpers")


const CreateClips = async (req, res) => {
    try {
        const { inicio, fin, streamerKey } = req.body;
        const resultado = await recortarYSubirClip(streamerKey, inicio, fin)

        res.status(200).json({ success: true, resultado });
    } catch (error) {
        console.error('Error en la ruta /recortarYSubirClip:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
}
module.exports = CreateClips 