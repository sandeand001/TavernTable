FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
# Skip development Git hooks; pinned native runtime packages are checked in the Linux smoke gate.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node src/ ./src/
COPY --chown=node:node tools/ ./tools/
COPY --chown=node:node assets/data/ ./assets/data/
COPY --chown=node:node assets/Items/d20-gold.glb ./assets/Items/d20-gold.glb
USER node
EXPOSE 8080
CMD ["node", "tools/cloud/production-host.js"]
