const streams = [];

const addStream = (key, file) => {
    const existingStream = streams.find(stream => stream.key === key);
    if (existingStream) {
        return;
    }
    const stream = { key, file };
    streams.push(stream);
}

const removeStream = (key) => {
    const index = streams.findIndex((stream) => stream.key === key);

    if (index !== -1) {
        return streams.splice(index, 1)[0];
    }
};

const getStream = (key) => {
    return streams.find((stream) => stream.key === key);
}

module.exports = {
    addStream,
    removeStream,
    getStream
}