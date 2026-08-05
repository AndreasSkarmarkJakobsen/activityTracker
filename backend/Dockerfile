FROM node:20-alpine

WORKDIR /app

COPY backend/package.json backend/package-lock.json* ./
RUN npm install --omit=dev

COPY backend/server.js ./
COPY backend/db ./db
COPY frontend ./public
COPY frontend/admin.html frontend/admin.js ./admin-public/

RUN mkdir -p /app/uploads

EXPOSE 3000 3001
CMD ["node", "server.js"]
