# Sci Teaching Studio

把 **sci-teaching-deck** Skill 装进人在环 Web 工作台（交互参考 Jumpx PPT Studio）。

| 层 | 职责 |
|----|------|
| `backend/teaching_api.py` | 项目 / 门禁 / jobs |
| `frontend/` | Vite + React 门禁工作台 |
| `../sci-teaching-deck` | 真正的生成引擎（脚本不改写） |

**文档**

- 自己从 GitHub 装起来跑：[`RUN.md`](RUN.md)（含：仓库里没有什么、为何只下载不够）
- 约定时段给同事用同一网页：[`SHARE-HOURS.md`](SHARE-HOURS.md)（对方不必 clone）
- **简历 / 公开展示站**（静态演示，无真实后端）：见下方「演示站」

### 演示站（GitHub Pages）

前端可打包为**纯静态演示**：预置 Wnt 样例课，可点「版式 / 大纲 / 文献 / 配图 / 完成」浏览 UI。

```powershell
cd sci-teaching-studio\frontend
npm install
npm run build:demo
```

产物在 `frontend/dist/`。推送到 `main` 后由 GitHub Actions 发布到 Pages：

https://13781679184-cxw.github.io/sci-teaching-studio/

（需在仓库 Settings → Pages 启用 GitHub Actions 作为源；首次打开该链接前请先跑通 workflow。）

依赖旁路引擎仓库 **[sci-teaching-deck](https://github.com/13781679184-cxw/sci-teaching-deck)**（Skill / CLI 管线）。两仓请放在同一父目录下：

```text
parent/
  sci-teaching-deck/      # https://github.com/13781679184-cxw/sci-teaching-deck
  sci-teaching-studio/    # 本仓库
```
