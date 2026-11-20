# EduERP API + worker image (one image, two commands). Build from the repository root:
#   docker build -f deploy/api.Dockerfile -t eduerp-api .
FROM node:22-bookworm-slim
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NODE_ENV=production
# Prisma's engines need OpenSSL; tini forwards stop signals so the API and worker shut down cleanly.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini && rm -rf /var/lib/apt/lists/* \
  && corepack enable && corepack prepare pnpm@10.34.9 --activate
WORKDIR /app

# Install only what the API needs (its workspace packages included), using the lockfile exactly.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --prod=false --filter "@eduerp/api..."

COPY packages/shared packages/shared
COPY packages/db packages/db
COPY apps/api apps/api
RUN pnpm --filter @eduerp/shared build && pnpm --filter @eduerp/db build && pnpm --filter @eduerp/api build

# Uploaded files live on a mounted volume.
ENV FILES_DIR=/data/files API_PORT=4000
RUN mkdir -p /data/files && chown -R node:node /data /app
USER node
WORKDIR /app/apps/api
EXPOSE 4000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
