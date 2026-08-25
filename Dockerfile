FROM node:20-alpine
WORKDIR /app
COPY backend/package*.json ./backend/
RUN npm install --prefix backend --omit=dev
COPY backend ./backend
COPY frontend ./frontend
COPY public ./public
# Ensure public exists even if frontend is source
RUN mkdir -p public && cp -r frontend/* public/ 2>/dev/null || true
ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000
CMD ["node", "backend/server.js"]
