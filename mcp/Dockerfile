FROM node:22.23.4-bookworm-slim
WORKDIR /app
COPY package.json ./
COPY src ./src
USER node
CMD ["node", "src/http.js"]
