FROM node:18.18.2-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS install
COPY package.json ./
RUN pnpm install
COPY . .
ENV NODE_ENV=production
USER node
EXPOSE 5151/tcp
CMD [ "node", "./server.js" ]
