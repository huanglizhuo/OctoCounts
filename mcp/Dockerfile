FROM node:22-slim
WORKDIR /app
COPY package.json ./
COPY src ./src
USER node
CMD ["node", "src/http.js"]
