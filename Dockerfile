FROM node:22

RUN apt-get update && apt-get install -y graphicsmagick && apt-get clean

WORKDIR /app

COPY package.json /app/package.json
COPY package-lock.json /app/package-lock.json
COPY packages/rustplus-ts /app/packages/rustplus-ts
RUN npm ci
COPY . /app
RUN npm run build

VOLUME [ "/app/credentials" ]
VOLUME [ "/app/guildInstances" ]
VOLUME [ "/app/logs" ]
VOLUME [ "/app/maps" ]

CMD ["node", "dist/index.js"]
