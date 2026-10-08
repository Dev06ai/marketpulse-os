FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

# Install production dependencies before copying application source.
COPY --chown=node:node package*.json ./
RUN npm install --omit=dev --ignore-scripts --no-fund

COPY --chown=node:node . .

RUN node --check server.js && node --check auth.js && node --check public/app.js

# A compromise in the web process should not grant root inside its container.
USER node
EXPOSE 3000
CMD ["npm","start"]
