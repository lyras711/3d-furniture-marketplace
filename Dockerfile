FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    ADMIN_HOST=0.0.0.0 \
    BLENDER_PATH=/usr/bin/blender \
    CHROMIUM_PATH=/usr/bin/chromium

RUN apt-get update \
  && apt-get install -y --no-install-recommends blender chromium ca-certificates fonts-liberation fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build

EXPOSE 8080
CMD ["npm", "run", "admin:server"]
