# 公开展示站 · Cloudflare Pages（主链接）

主站地址（部署成功后）：

**https://sci-teaching-studio.pages.dev/**

GitHub Pages（`github.io`，国内常不可用）仅作镜像，见 `.github/workflows/pages-demo.yml`。

## 一次性：Cloudflare 侧

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)（免费账号即可）。
2. 记下 **Account ID**（Workers & Pages → 右侧概览）。
3. 创建 API Token：**My Profile → API Tokens → Create Token → Edit Cloudflare Workers** 模板，权限需包含 **Account → Cloudflare Pages → Edit**。
4. 本机（可选，用于手动发版）：

```powershell
cd frontend
npm install
npx wrangler login
npx wrangler pages project create sci-teaching-studio --production-branch main
```

若项目已存在，可跳过 `project create`。

## 一次性：GitHub Actions 自动部署

在仓库 **Settings → Secrets and variables → Actions** 添加：

| Secret | 内容 |
|--------|------|
| `CLOUDFLARE_API_TOKEN` | 见下方「API Token 权限」 |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID |

### API Token 权限（Actions 失败 Authentication error 10000 时必查）

在 [API Tokens](https://dash.cloudflare.com/profile/api-tokens) → **创建令牌** → **自定义令牌**：

| 权限 | 级别 |
|------|------|
| Account → **Cloudflare Pages** | **Edit** |
| Account → Account Settings | Read |

**账户资源**：包含 → 选你的账户（`13781679184@163.com`）。

保存后，到 GitHub 把 `CLOUDFLARE_API_TOKEN` **更新**为新 Token（旧 Token 权限不够会部署失败）。

仅「Workers 模板」有时不含 Pages API，请用上面自定义权限。

推送 `main` 且 `frontend/**` 有变更时，workflow `Deploy demo (Cloudflare Pages)` 会构建并 `wrangler pages deploy`。

## 本机手动部署

```powershell
cd sci-teaching-studio\frontend
npm install
npm run deploy:pages
```

等价于 `build:demo` + `wrangler pages deploy dist --project-name=sci-teaching-studio`。

## 构建说明

| 命令 | `base` | 用途 |
|------|--------|------|
| `npm run build:demo` | `/` | Cloudflare Pages（默认） |
| `npm run build:demo:github` | `/sci-teaching-studio/` | GitHub Pages 镜像 |

展示快照仍在 `frontend/public/showcase/my-ppt/`；更新课件后先跑 `scripts/pack_showcase.py` 再提交并部署。

## 自定义域名（可选）

Cloudflare Pages → 项目 **sci-teaching-studio** → **Custom domains** 绑定你的域名，然后把简历/对外材料里的链接改为该域名。
