FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df
RUN npm install --global pnpm@11.19.0 \
    && mkdir -p /workspace/node_modules /workspace/apps/api/node_modules /pnpm/store \
    && chown -R node:node /workspace /pnpm
COPY --chown=node:node backend-entry.mjs /opt/arden/backend-entry.mjs
USER node
WORKDIR /workspace
ENV PNPM_HOME=/pnpm CI=true
CMD ["node", "/opt/arden/backend-entry.mjs"]
