# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime dependencies only. adapter-node bundles most of the app but leaves a
# few packages external (web-push, whose transitive deps do not bundle cleanly),
# so the runtime image needs their node_modules — not just the build output.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# adapter-node reads these at runtime, so compose env alone configures the app.
ENV PORT=8100
ENV HOST=0.0.0.0
# The commit this image was built from, passed by CI. Surfaced at /api/health so
# "am I running the latest?" has an answer. Defaults to "dev" for local builds.
ARG GIT_SHA=dev
ENV SEEK_BUILD_SHA=$GIT_SHA

COPY --from=build /app/build ./build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

# Preferences only (§8). Watch state is never stored here.
RUN mkdir -p /data && chown -R node:node /data
USER node

EXPOSE 8100
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
	CMD node -e "fetch('http://127.0.0.1:8100/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "build"]
