# 单镜像：内含 Vite 构建的管理端静态资源 + 两套 Node 入口（server/index.ts 与 server.ts）
# 使用 node:22-slim（官方常用标签，拉取成功率高于 bookworm-slim；国内若仍失败请配置 Docker 镜像加速）
FROM docker.io/library/node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY miniapp-candidate/package.json miniapp-candidate/package-lock.json ./miniapp-candidate/

RUN npm ci

COPY . .

# 管理端 Vite 在构建期注入（浏览器访问的 API 公网地址，勿用容器内主机名）
ARG VITE_API_BASE=http://localhost:3011
ARG VITE_ADMIN_API_TOKEN=
ENV VITE_API_BASE=${VITE_API_BASE}
ENV VITE_ADMIN_API_TOKEN=${VITE_ADMIN_API_TOKEN}

RUN npm run build

ENV NODE_ENV=production
EXPOSE 3010 3011

# 可被 docker-compose command 覆盖
CMD ["npx", "tsx", "server/index.ts"]
