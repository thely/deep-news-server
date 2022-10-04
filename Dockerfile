FROM node:12-alpine
WORKDIR /usr/fofa/server
COPY ./package.json .
RUN npm install
COPY . .