# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# adapter-node reads these at runtime, so compose env alone configures the app.
ENV PORT=8100
ENV HOST=0.0.0.0

# adapter-node bundles its own dependencies — verified by running build/ with no
# node_modules present — so the runtime image needs nothing but the output.
COPY --from=build /app/build ./build
COPY --from=build /app/package.json ./package.json

# Preferences only (§8). Watch state is never stored here.
RUN mkdir -p /data && chown -R node:node /data
USER node

EXPOSE 8100
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
	CMD node -e "fetch('http://127.0.0.1:8100/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "build"]
