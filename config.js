const config = {
    rtmp: {
        port: 1935,
        chunk_size: 1000,
        gop_cache: true,
        ping: 30,
        ping_timeout: 60
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
                app: "live",
                hls: true,
                hlsFlags: "[hls_time=1:hls_list_size=16:hls_flags=delete_segments]",
                hlsKeep: true,
                vc: "libx264",
                h264_profile: "main",
                h264_level: "4.1",
                hls_wait_keyframe: true, // Agregar esta línea para esperar fotograma clave en HLS
                gop: 1, // Agregar esta línea para ajustar el GOP a 1 segundo
            },
            {
                app: "live",
                hls: true,
                hlsFlags: "[hls_time=1:hls_list_size=16:hls_flags=delete_segments]",
                hlsKeep: false,
                vc: "h264_nvenc",
                h264_profile: "main",
                h264_level: "4.1",
                gpu: 0,
                hls_wait_keyframe: true, // Agregar esta línea para esperar fotograma clave en HLS
                gop: 1, // Agregar esta línea para ajustar el GOP a 1 segundo
            },
            {
                app: "live",
                hls: true,
                hlsFlags: "[hls_time=1:hls_list_size=16:hls_flags=delete_segments]",
                hlsKeep: false,
                vc: "hevc_nvenc",
                hevc_profile: "main",
                hevc_level: "4.1",
                gpu: 0,
                hls_wait_keyframe: true, // Agregar esta línea para esperar fotograma clave en HLS
                gop: 1, // Agregar esta línea para ajustar el GOP a 1 segundo
            },
        ],
        MediaRoot: "./media",
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
        ],
        MediaRoot: "./media",
    }
};
module.exports = { config }