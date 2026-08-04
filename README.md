# Sci Teaching Studio

把 **sci-teaching-deck** Skill 装进人在环 Web 工作台（交互参考 Jumpx PPT Studio）。

| 层 | 职责 |
|----|------|
| `backend/teaching_api.py` | 项目 / 门禁 / jobs |
| `frontend/` | Vite + React 门禁工作台 |
| `../sci-teaching-deck` | 真正的生成引擎（脚本不改写） |

**文档**

- 自己从 GitHub 装起来跑：[`RUN.md`](RUN.md)（含：仓库里没有什么、为何只下载不够）
- 临时公网分享本机 Studio：[`SHARE-HOURS.md`](SHARE-HOURS.md)（访客不必 clone）
- **在线演示站**（静态快照、无真实后端）：主链接 **[Cloudflare Pages](https://sci-teaching-studio.pages.dev/)**（见 [`CLOUDFLARE-PAGES.md`](CLOUDFLARE-PAGES.md)）。GitHub Pages 镜像国内常打不开，仅作备用。

### 演示站（Cloudflare Pages · 主）

公开展示站使用**真实项目快照**（`my-ppt`：小分子药物设计），界面与本机 Studio 一致，配图与页预览为真实文件。

**https://sci-teaching-studio.pages.dev/**

```powershell
# 从 workspace/my-ppt 重新打包快照（改课件后重跑）
cd sci-teaching-studio\backend
..\.venv\Scripts\python.exe ..\scripts\pack_showcase.py   # 若无此 venv：用 deck 的 python + PYTHONPATH

cd ..\frontend
npm install
npm run build:demo
npm run deploy:pages   # 需 wrangler login + Pages 项目 sci-teaching-studio
```

推送 `main` 后 Actions 会发布 Cloudflare Pages（需配置 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`，见 `CLOUDFLARE-PAGES.md`）。

GitHub Pages 镜像（可选）：`npm run build:demo:github` → https://13781679184-cxw.github.io/sci-teaching-studio/

依赖旁路引擎仓库 **[sci-teaching-deck](https://github.com/13781679184-cxw/sci-teaching-deck)**（Skill / CLI 管线）。两仓请放在同一父目录下：

```text
parent/
  sci-teaching-deck/      # https://github.com/13781679184-cxw/sci-teaching-deck
  sci-teaching-studio/    # 本仓库
```
