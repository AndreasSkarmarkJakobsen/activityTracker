FROM node:20-alpine

WORKDIR /app

COPY backend/package.json backend/package-lock.json* ./
RUN npm install --omit=dev

COPY backend/server.js ./
COPY backend/db ./db
COPY frontend ./public

RUN mkdir -p /app/uploads

EXPOSE 3000
CMD ["node", "server.js"]
