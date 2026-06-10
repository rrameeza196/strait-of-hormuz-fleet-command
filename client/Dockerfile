FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci && npm cache clean --force

COPY . .

ARG VITE_SOCKET_URL=http://localhost:5050
ENV VITE_SOCKET_URL=$VITE_SOCKET_URL

RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
