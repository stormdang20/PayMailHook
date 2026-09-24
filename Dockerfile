# Self-host image: the server is bundled into one file, so the runtime stage needs no node_modules.
FROM oven/bun:1.3 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build \
 && bun build src/server.ts --target=bun --outfile=dist/server.js

FROM oven/bun:1.3-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3010
COPY --from=build /app/dist/server.js ./server.js
COPY --from=build /app/dist/client ./dist/client
COPY --from=build /app/migrations ./migrations
USER bun
EXPOSE 3010
CMD ["bun", "server.js"]
