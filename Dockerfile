FROM node:18.20.4-bookworm

WORKDIR /app

# Copiar el código de la aplicación
COPY . .

# Instalar las dependencias
RUN npm install

# Instalar ffmpeg
RUN apt-get update && apt-get install -y ffmpeg

# Sobrescribir la librería modificada en node_modules
COPY ./node_modules/node-media-server ./node_modules/node-media-server

CMD ["npm", "run", "start"]
