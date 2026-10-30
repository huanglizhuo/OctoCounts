FROM node:26.12.0-bookworm-slim
WORKDIR /app
COPY package.json ./
COPY src ./src
USER node
CMD ["node", "src/http.js"]
