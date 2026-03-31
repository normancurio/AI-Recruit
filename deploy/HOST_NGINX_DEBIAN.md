# Debian：宿主机 Nginx + Docker 只跑业务（具体步骤）

架构：**用户 → 443/80（本机 Nginx，HTTPS）→ `127.0.0.1:3001` / `3000`（Docker 映射的端口）**

---

## 一、准备 Docker 业务（目录、`.env`、构建、自检）

### 1.1 进入目录与配置 `.env`

```bash
cd /opt/AI-Recruit   # 按你实际路径
ls -la .env          # 没有则：cp .env.example .env
nano .env            # 填写 MYSQL_*、WECHAT_*、ADMIN_API_TOKEN 等
```

`docker-compose.yml` 里 `env_file: .env` 表示 **容器运行时** 会加载该文件；这与下面「构建前 export」是两套变量，别混用。

### 1.2 构建前为什么要 `export` 两个变量？

它们只作用于 **`docker compose build` 执行 Dockerfile 里的 `npm run build`**，会被 Vite **写进管理端前端静态文件**：

| 变量 | 含义 |
|------|------|
| `PUBLIC_API_BASE` | 浏览器里打开管理后台时，前端请求 API 用的**根地址**。请填你最终对外的地址，例如 **`https://api.你的域名.com`**（与后面 Nginx 里 API 的 `server_name`、HTTPS 一致）。**不要**填 `http://127.0.0.1:3001`，否则管理员在自己电脑上打开页面时，浏览器会去访问**访客电脑本机**的 3001。 |
| `VITE_ADMIN_API_TOKEN_BUILD` | 必须与 **`.env` 中的 `ADMIN_API_TOKEN` 完全一致**，否则调用 `/api/admin/*` 会 401。 |

示例（请换成真实域名与 token）：

```bash
export PUBLIC_API_BASE=https://api.example.com
export VITE_ADMIN_API_TOKEN_BUILD='你的ADMIN_API_TOKEN与.env里相同'
```

若曾设错，可先 `unset PUBLIC_API_BASE VITE_ADMIN_API_TOKEN_BUILD` 再重新 `export`。

### 1.3 `docker compose build` 与 `up -d`

```bash
docker compose build
docker compose up -d
```

- **build**：按 `Dockerfile` 安装依赖并执行 `npm run build`（使用上一步的 `PUBLIC_API_BASE` 等），生成镜像 `ai-recruit-app`。  
- **up -d**：启动 **api**（容器 3001 → 宿主机默认 **3001**）和 **admin**（容器 3000 → 宿主机默认 **3000**），后台运行。

查看状态与日志：

```bash
docker compose ps
docker compose logs -f api
```

### 1.4 用 `curl` 在本机自检（直连 Docker 映射端口）

在**服务器本机**执行，测的是 **127.0.0.1**，不经过 Nginx：

**① API 健康检查**

```bash
curl -sS http://127.0.0.1:3001/api/health
```

- **`-sS`**：`-s` 少显示进度；`-S` 在失败时仍打印错误。  
- 正常连库时常见返回：`{"ok":true,"db":true}`，HTTP **200**。  
- 若 MySQL 未连通，可能 **503** 且 `"db":false`，需检查 `.env` 里 `MYSQL_HOST`（容器访问宿主机数据库时 **不要** 用 `127.0.0.1` 表示宿主机，除非你把 MySQL 也放进同一 Compose 网络）。

**② 管理端是否返回页面**

```bash
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/
```

- **`-o /dev/null`**：丢弃响应体。  
- **`-w "%{http_code}\n"`**：只输出一行 **HTTP 状态码**。  
- 生产模式一般期望 **200**（返回 `dist/index.html`）。

也可看首页前几字节：

```bash
curl -sS http://127.0.0.1:3000/ | head -c 200
```

### 1.5 改宿主机端口时

`docker-compose.yml` 支持 `API_PORT`、`ADMIN_PORT`（默认 3001、3000）。例如：

```bash
export API_PORT=13001
export ADMIN_PORT=13000
docker compose up -d
```

则 `curl` 改为 `127.0.0.1:13001`、`127.0.0.1:13000`，Nginx `proxy_pass` 也要一致。

### 1.6 首次克隆仓库时

```bash
cd /opt
git clone <你的仓库> AI-Recruit
cd AI-Recruit
cp .env.example .env && nano .env
```

---

## 二、安装 Nginx（Debian）

```bash
sudo apt update
sudo apt install -y nginx
sudo systemctl enable nginx
```

---

## 三、放证书（示例路径）

假设你已有 **私钥** `xxx.key` 和 **证书** `xxx.pem`（或 `fullchain.pem` + `privkey.pem`）：

```bash
sudo mkdir -p /etc/nginx/ssl
sudo cp 你的证书.pem /etc/nginx/ssl/api.fullchain.pem
sudo cp 你的私钥.key   /etc/nginx/ssl/api.key
sudo chmod 640 /etc/nginx/ssl/api.*
sudo chown root:www-data /etc/nginx/ssl/api.*
```

文件名按你实际上传的改；若厂商给的是 `fullchain.pem` / `privkey.pem`，复制后可在下面配置里写对应名字。

---

## 四、站点配置（从仓库模板改域名）

```bash
sudo cp /path/to/AI-Recruit/deploy/nginx.example.conf /etc/nginx/sites-available/ai-recruit
sudo nano /etc/nginx/sites-available/ai-recruit
```

把其中：

- `api.你的域名.com` → 真实 API 子域名，如 `api.example.com`
- `admin.你的域名.com` → 真实后台子域名，如 `admin.example.com`
- `ssl_certificate` / `ssl_certificate_key` → 上一步 `/etc/nginx/ssl/` 下的实际文件名

启用站点并检查：

```bash
sudo ln -sf /etc/nginx/sites-available/ai-recruit /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 五、防火墙（若用 ufw）

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

**不要**对公网放行 3000、3001（只给本机 Nginx 反代即可）。

---

## 六、DNS

在域名解析里为 `api`、`admin`（或你用的主机名）添加 **A 记录** → 服务器公网 IP。等生效后再用浏览器访问 `https://api.xxx` 测。

---

## 七、与小程序 / 管理端配置的关系

| 位置 | 说明 |
|------|------|
| 管理端静态资源 | 构建时 `PUBLIC_API_BASE` 必须是 **`https://api.你的域名.com`**（无尾部斜杠，按你 Nginx 的 `server_name`） |
| 小程序 `TARO_APP_API_BASE` | 与上面 API 公网地址一致 |
| 微信公众平台 | 「服务器域名」里填 **API 域名**（仅域名） |

---

## 八、常见问题

1. **502 Bad Gateway**：Docker 未启动或端口不是 3001/3000 → `docker compose ps`、改 Nginx `proxy_pass` 或 compose 端口映射。  
2. **证书链错误**：浏览器报证书无效 → 用 `fullchain.pem` 作为 `ssl_certificate`，不要只用单张证书。  
3. **MySQL 连不上**：容器内 `MYSQL_HOST` 不能写 `127.0.0.1` 指宿主机数据库时，需写宿主机内网 IP 或 `host.docker.internal`（视 Docker 版本而定）。  
4. **`docker compose build` 拉基础镜像失败**（如 `unable to fetch descriptor` / `content size of zero`）：多为访问 **Docker Hub** 不稳定或被墙。可依次尝试：  
   - 仓库已默认使用 **`node:22-slim`**，先重新执行 `docker compose build`。  
   - 手动测拉取：`docker pull node:22-slim`。  
   - **国内服务器**配置镜像加速：新建或编辑 `/etc/docker/daemon.json`（示例，地址以云厂商控制台为准）：  
     ```json
     {
       "registry-mirrors": [
         "https://你的镜像加速地址.mirror.aliyuncs.com"
       ]
     }
     ```  
     然后 `sudo systemctl restart docker`，再构建。阿里云 / 腾讯云控制台搜索「容器镜像服务」「镜像加速」可拿到专属地址。  
   - 清理构建缓存后重试：`docker builder prune -f` 再 `docker compose build --no-cache`。

---

## 九、与本仓库 `nginx.example.conf` 的对应关系

模板文件：`deploy/nginx.example.conf` —— 按上文替换域名与证书路径即可，与 `docker-compose.yml` 默认 **3001（API）**、**3000（管理端）** 一致。
