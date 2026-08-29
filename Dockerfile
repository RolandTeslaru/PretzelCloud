# Built from the repo root: the workspace packages compile together.
FROM node:22-alpine AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY packages/control-plane/package.json ./packages/control-plane/
COPY packages/portal/package.json        ./packages/portal/
COPY packages/shared/package.json        ./packages/shared/
RUN npm ci

COPY packages ./packages
# Emits CommonJS, rewrites the `@/` aliases, and copies the migrations beside
# the code that reads them.
RUN npm run build --workspace=packages/control-plane

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY --from=build /repo/packages/control-plane/package.json ./packages/control-plane/
COPY --from=build /repo/packages/shared/package.json        ./packages/shared/
RUN npm ci --omit=dev --workspace=packages/control-plane --ignore-scripts

# Shared compiles into this tree and the aliases were rewritten to reach it, so
# the package itself is never resolved at runtime.
COPY --from=build /repo/packages/control-plane/dist ./packages/control-plane/dist

# Only the router is published; the API answers on loopback behind it.
EXPOSE 8080

# Answered before a host is resolved, so it reports the router rather than any
# workspace. start-period covers the migrations that run before it listens.
HEALTHCHECK --interval=10s --timeout=4s --start-period=40s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1

CMD ["node", "packages/control-plane/dist/control-plane/src/main.js"]
