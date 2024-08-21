FROM node:18.20.4-bookwor

WORKDIR /app
COPY . .
RUN npm i

CMD ["npm","run", "dev"]
