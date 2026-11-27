# Pinned multi-platform Node 24 Alpine image. Nodemailer is pure JavaScript.
FROM --platform=$BUILDPLATFORM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && mkdir -m 700 data && touch data/.keep

FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5
LABEL org.opencontainers.image.source="https://github.com/parsalakzian/OminiCorp"
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies --chown=node:node /app/data ./data
COPY index.html en.html ./
COPY assets/ ./assets/
COPY server/ ./server/
COPY site/content.mjs site/forms.mjs site/icons.mjs site/render.mjs ./site/
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/healthz"]
CMD ["node", "server/start.mjs", "--port", "8080"]
