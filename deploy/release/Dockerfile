FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS build
RUN npm install --global --ignore-scripts pnpm@11.19.0
WORKDIR /source
ENV CI=true
COPY . .
RUN pnpm install --frozen-lockfile --filter arden --filter @arden/api... --filter @arden/web...
RUN pnpm --filter @arden/api build && pnpm --filter @arden/web build
RUN pnpm --filter @arden/api deploy --prod --legacy /release/api

FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS api
ARG REVISION
ARG SOURCE_TREE
ARG MIGRATIONS
LABEL org.opencontainers.image.revision=$REVISION \
      io.arden.release.tree=$SOURCE_TREE \
      io.arden.release.migrations=$MIGRATIONS \
      io.arden.release.managed="1"
WORKDIR /app
COPY --from=build --chown=1000:1000 /release/api/package.json ./package.json
COPY --from=build --chown=1000:1000 /release/api/node_modules/ ./node_modules/
COPY --from=build --chown=1000:1000 /release/api/dist/ ./dist/
COPY --from=build --chown=1000:1000 /release/api/migrations/ ./migrations/
RUN mkdir -p /var/lib/arden/private && chown 1000:1000 /var/lib/arden/private
USER 1000:1000
ENV NODE_ENV=production ARDEN_API_HOST=0.0.0.0 ARDEN_API_PORT=3001
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 CMD node -e "fetch('http://127.0.0.1:3001/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]

FROM nginx:stable-alpine@sha256:47928bf67eb62a1863cb08d9ecb52d3e704304ba614eaee17884204677702951 AS web
ARG REVISION
ARG SOURCE_TREE
ARG MIGRATIONS
LABEL org.opencontainers.image.revision=$REVISION \
      io.arden.release.tree=$SOURCE_TREE \
      io.arden.release.migrations=$MIGRATIONS \
      io.arden.release.managed="1"
COPY --from=build /source/apps/web/dist/ /usr/share/nginx/html/
COPY deploy/release/web.conf /etc/nginx/nginx.conf
RUN printf '{"commit":"%s","tree":"%s"}\n' "$REVISION" "$SOURCE_TREE" > /usr/share/nginx/html/release.json
USER 101:101
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --retries=6 CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["nginx", "-g", "daemon off;"]
