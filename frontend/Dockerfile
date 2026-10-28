FROM node:22.23.4-bookworm-slim AS builder
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend ./
COPY extension/package.json /extension/package.json
ARG VITE_API_BASE=/api
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

# Local static/SPA preview; production uses Cloudflare Pages plus frontend/functions.
FROM nginx:stable-alpine
RUN apk upgrade --no-cache ca-certificates ca-certificates-bundle
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
