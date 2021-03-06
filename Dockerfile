# Docker image for the primary terria map application server
FROM node:14

RUN apt-get update && apt-get install -y gdal-bin

RUN mkdir -p /usr/src/app && mkdir -p /etc/config/client
# WORKDIR /usr/src/app/component
WORKDIR /usr/src/app
COPY . /usr/src/app
# RUN rm wwwroot/config.json && ln -s /etc/config/client/config.json wwwroot/config.json
RUN export NODE_OPTIONS=--max_old_space_size=8192
RUN yarn install
RUN yarn gulp

EXPOSE 3001

CMD [ "node", "./node_modules/terriajs-server/lib/app.js", "--config-file", "devserverconfig.json" ]
