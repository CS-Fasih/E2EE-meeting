# Self-hosted Baithak: relay plus the web app on one port.
# Build from the repository root:  docker build -f server/Dockerfile -t baithak .
FROM node:22-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/relay.js ./
COPY --from=web /src/web/dist ./web
USER node
EXPOSE 8080
CMD ["node", "relay.js", "--port", "8080", "--web", "./web"]
