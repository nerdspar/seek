# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app
# better-sqlite3 is a native module; if no prebuilt binary matches this
# platform, npm compiles it, which needs a toolchain.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime dependencies only. adapter-node bundles most of the app but leaves
# package.json `dependencies` external (web-push, whose transitive deps do not
# bundle cleanly, and better-sqlite3, a native module that cannot be bundled), so
# the runtime image needs their node_modules — not just the build output. Built
# on the same Alpine base as the runtime, so the native binary matches.
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# adapter-node reads these at runtime, so compose env alone configures the app.
ENV PORT=8100
ENV HOST=0.0.0.0
# Book uploads arrive in 8 MB chunks (adapter-node's default cap is 512 KB).
ENV BODY_SIZE_LIMIT=10M
# The commit this image was built from, passed by CI. Surfaced at /api/health so
# "am I running the latest?" has an answer. Defaults to "dev" for local builds.
ARG GIT_SHA=dev
ENV SEEK_BUILD_SHA=$GIT_SHA

COPY --from=build /app/build ./build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

# Seek's own state: accounts, settings, what each person tracks and every play
# (seek.db), plus the legacy preferences/push JSON it migrates from.
RUN mkdir -p /data && chown -R node:node /data
USER node

EXPOSE 8100
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
	CMD node -e "fetch('http://127.0.0.1:8100/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "build"]
