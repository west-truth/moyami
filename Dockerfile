FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY server ./server
COPY client ./client
COPY scripts ./scripts
COPY vendor ./vendor
COPY public ./public
RUN npm run build:client && npm prune --omit=dev && npm cache clean --force

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/public ./public
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4173
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4173)+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "server/index.ts"]
