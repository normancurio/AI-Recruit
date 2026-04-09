# 单镜像：内含 Vite 构建的管理端静态资源 + 两套 Node 入口（server/index.ts 与 server.ts）
#
# 基础镜像说明：
# - 避免仅用 node:22-slim：部分镜像站对 manifest 解析异常会出现 “content size of zero: invalid argument”
# - bookworm-slim 为 Debian 12，标签更稳定；国内可 build 前设置：export NODE_IMAGE=docker.m.daocloud.io/library/node:22-bookworm-slim
ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE}

WORKDIR /app

COPY package.json package-lock.json ./
COPY miniapp-candidate/package.json miniapp-candidate/package-lock.json ./miniapp-candidate/

RUN npm ci

COPY . .

# 管理端 Vite 在构建期注入（浏览器访问的 API 公网地址，勿用容器内主机名）
ARG VITE_API_BASE=http://47.102.85.156:3011
ARG VITE_ADMIN_API_TOKEN=
ENV VITE_API_BASE=${VITE_API_BASE}
ENV VITE_ADMIN_API_TOKEN=${VITE_ADMIN_API_TOKEN}

RUN npm run build

ENV NODE_ENV=production
EXPOSE 3010 3011

# 可被 docker-compose command 覆盖
CMD ["npx", "tsx", "server/index.ts"]
