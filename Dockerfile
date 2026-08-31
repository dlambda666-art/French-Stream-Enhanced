FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PORT=7000

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 7000

CMD ["node", "server.js"]
