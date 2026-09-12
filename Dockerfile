FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PORT=7860

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 7860

CMD ["node", "server.js"]
