# 约定时段 · 给同事用同一套网页

你这台电脑开着 API + 前端时，用 **临时公网隧道** 把本机 `5180` 暴露出去。同事浏览器打开链接，操作方式与你在本机相同（请求经 Vite 反代到本机 `:2025`）。

> 不是静态托管，也不是把整台电脑永久挂公网。约定几点到几点，开隧道；时段结束关掉即可。

## 你（主持人）每次开场

1. 照常启动 Studio（见 [RUN.md](RUN.md)）  
   - API `127.0.0.1:2025`  
   - 前端 `http://127.0.0.1:5180`
2. 另开一个终端，跑快速隧道（任选其一）：

```powershell
# 推荐：Cloudflare 快速隧道（无需账号也可试）
winget install --id Cloudflare.cloudflared -e
cloudflared tunnel --url http://127.0.0.1:5180
```

终端里会出现类似 `https://xxxx.trycloudflare.com` 的地址，**发给同事**。

或用 ngrok：

```powershell
ngrok http 5180
```

3. 时段结束：`Ctrl+C` 停隧道，并可关掉前后端。

一键脚本（会检查端口后启动 cloudflared）：

```powershell
.\scripts\share-hours.ps1
```

## 同事侧

- 浏览器打开你发的 `https://…` 链接  
- 像你一样：选/建项目 → 大纲 → 文献 → 配图 → 完成  
- **模型 Key**：在网页「服务配置」里填自己的，或用你本机已配置的（`workspace/_settings`，勿提交 Git）

## 注意

| 项 | 说明 |
|----|------|
| 安全 | 链接等于临时「谁有 URL 谁能进」。只发给信任的人；结束立刻关隧道 |
| 机器 | 你电脑休眠/断网，同事页面会挂 |
| 生图/检索 | 耗你本机额度与网络；大任务提前说一声 |
| LibreOffice | 预览导出仍在你本机跑 |

## 与 GitHub 的关系

代码在 GitHub 是为了备份与协作改代码；**同事上课/试用不必 clone**。试用靠本页隧道即可。
