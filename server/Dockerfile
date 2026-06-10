FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

ENV NODE_ENV=production
EXPOSE 5050

HEALTHCHECK --interval=15s --timeout=5s --start-period=45s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5050)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "index.js"]
