# Preserve DNS-01 support; pin a Go toolchain that rejects compromised CA keys.
FROM docker.io/library/caddy:2.11.7-builder@sha256:bf6a7d38add2508b7d2e3e3f40cf2af399214f143c0fa3daa51f254e01f8d293 AS builder
RUN apk upgrade --no-cache ca-certificates ca-certificates-bundle
ENV GOTOOLCHAIN=go1.27.3
ENV GOMAXPROCS=2
RUN xcaddy build v2.11.7 --with github.com/caddy-dns/cloudflare@v0.2.4

FROM docker.io/library/caddy:2.11.7@sha256:5e5286cb37d44086d651a5363f05f43a692ce4d649d88fb1bd844579f45fa9e8
RUN apk upgrade --no-cache ca-certificates ca-certificates-bundle
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
