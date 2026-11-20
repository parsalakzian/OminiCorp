# nginx:1.30.7-alpine-slim, pinned to the multi-platform manifest.
FROM nginx:1.30.7-alpine-slim@sha256:8c950211a641ec5b23f265450517001f6bcca533666120ebe36cb4cff3d00a55

LABEL org.opencontainers.image.source="https://github.com/parsalakzian/OminiCorp"
COPY deploy/nginx.conf /etc/nginx/nginx.conf
COPY index.html en.html /srv/ominicorp/
COPY assets/ /srv/ominicorp/assets/

USER nginx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/healthz"]
ENTRYPOINT ["nginx", "-g", "daemon off;"]
