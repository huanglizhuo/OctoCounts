FROM rust:1.90-bookworm AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/octocount-service /usr/local/bin/octocount-service
ENV BIND_ADDR=0.0.0.0:8080
ENV DATABASE_URL=sqlite:///data/sloc.db
VOLUME ["/data"]
EXPOSE 8080
CMD ["octocount-service"]
