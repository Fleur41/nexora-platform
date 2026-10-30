# Targets: "dev" (docker-compose.yml, hot reload) and "prod" (the default; deploy/).
FROM node:24-alpine AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS dev
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0"]

FROM deps AS build
# Rewrites are fixed at build time. In production the TLS proxy sends /api/* straight to
# Django; this is the fallback for anything that reaches Next instead.
ARG NEXORA_API_ORIGIN=http://backend:8000
ENV NEXORA_API_ORIGIN=${NEXORA_API_ORIGIN}
COPY . .
RUN npm run build

FROM node:24-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node /app/.next/standalone ./
COPY --from=build --chown=node /app/.next/static ./.next/static
COPY --from=build --chown=node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
