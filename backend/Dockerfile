FROM rust:1.90-bookworm AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY assets ./assets
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
# The OG renderer embeds DejaVu Sans Mono (see backend/assets/fonts), so the
# runtime image no longer needs fonts-dejavu-core or fontconfig.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/octocount-service /usr/local/bin/octocount-service
ENV BIND_ADDR=0.0.0.0:8080
EXPOSE 8080
CMD ["octocount-service"]
