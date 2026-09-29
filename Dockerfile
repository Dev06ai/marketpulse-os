FROM node:20-alpine
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

RUN node --check server.js
RUN node --check public/app.js

EXPOSE 3000
CMD ["npm","start"]
