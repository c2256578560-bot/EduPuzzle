# EduPuzzle GitHub Pages 部署说明

部署后你会得到：

| 地址 | 内容 |
|---|---|
| `https://<用户名>.github.io/<仓库名>/` | PWA 主程序（手机可「添加到主屏幕」） |
| `https://<用户名>.github.io/<仓库名>/download.html` | 分享下载页（项目介绍、截图、下载按钮、在线体验入口） |
| `https://<用户名>.github.io/<仓库名>/release/EduPuzzle.exe` | Windows EXE（放在仓库 `release/` 时） |
| `https://github.com/<用户名>/<仓库名>/releases/latest/download/EduPuzzle.exe` | Windows EXE（GitHub Release 版） |

---

## 1. 仓库初始化（只做一次）

1. 在 GitHub 新建一个**公开**仓库，例如 `EduPuzzle`（不要勾选自动生成 README）。
2. 在项目文件夹里执行：

```bash
git init -b main
```

```bash
git add .
```

```bash
git commit -m "EduPuzzle v4：PWA + Tauri + 分享页"
```

```bash
git remote add origin https://github.com/<用户名>/EduPuzzle.git
```

```bash
git push -u origin main
```

3. 打开仓库 **Settings → Pages → Build and deployment → Source**，选 **GitHub Actions**。
4. 打开 **Actions** 页面，等「部署到 GitHub Pages」变成绿色 ✓（约 1 分钟），点进去就能看到访问链接。

> `.gitignore` 已排除 `dist/`、`node_modules/`、`src-tauri/target/` 等构建产物。

---

## 2. 分支说明

| 分支 / 标签 | 用途 |
|---|---|
| `main` | 唯一主分支。推送到 main → 自动部署 Pages |
| `v*` 标签（如 `v4.0.0`） | 推送标签 → 自动在云端打包 EXE 并发布到 GitHub Release |

不需要 `gh-pages` 分支：新版 Pages 用 Actions 直接部署，网站文件不进仓库。

---

## 3. 更新代码的流程

```bash
git add .
```

```bash
git commit -m "说明这次改了什么"
```

```bash
git push
```

推送后 1 分钟左右网站自动更新。改了网页代码，记得同时修改 `service-worker.js` 的 `VERSION`，手机上已安装的 PWA 才会更新。

---

## 4. 发布 Windows EXE

### 方式 A：云端自动打包（推荐，本机不用装 Rust）

```bash
git tag v4.0.0
```

```bash
git push origin v4.0.0
```

`.github/workflows/release.yml` 会在 GitHub 的 Windows 服务器上：
1. 编译 `EduPuzzle.exe`（第一次约 10 分钟，之后有缓存更快）；
2. 创建 Release `v4.0.0` 并上传 EXE；
3. EXE 小于 100 MB 时，自动提交到 `main` 分支的 `release/EduPuzzle.exe`，触发 Pages 重新部署。

> 不想把 EXE 提交进仓库：把 `release.yml` 里的 `COMMIT_EXE_TO_REPO` 改成 `'false'`，只用 Release。
> 也可以在 Actions 页面手动运行「打包 Windows EXE」，EXE 会作为本次运行的附件供下载（不创建 Release）。

### 方式 B：本机打包后手动放进仓库

按《打包说明.md》编译，把 `src-tauri/target/release/edupuzzle.exe` 复制为 `release/EduPuzzle.exe`，然后提交推送。

### 下载页如何选择下载地址

`download.html` 打开时先检查网站上有没有 `release/EduPuzzle.exe`：
- 有 → 下载按钮指向它（还会显示文件大小）；
- 没有（比如超过 100 MB 只发了 Release）→ 自动指向 `github.com/<用户名>/<仓库名>/releases/latest/download/EduPuzzle.exe`。

仓库名会根据 Pages 地址自动推算；如果部署在其它网站，把 `download.html` 里的 `GITHUB_REPO` 改成 `'用户名/仓库名'`。

---

## 5. 常见问题

| 问题 | 解决 |
|---|---|
| Actions 报 `Get Pages site failed` | 第 1 步第 3 点没做：Settings → Pages → Source 选 GitHub Actions |
| 网站 404 | 等部署完成；仓库必须公开（免费账号私有仓库不能用 Pages） |
| release.yml 推送 EXE 失败（403） | Settings → Actions → General → Workflow permissions 选「Read and write permissions」 |
| release.yml 报 `npm ci` 失败 | 仓库里缺 `package-lock.json`：本机运行 `npm install` 后提交 |
| 国内访问慢 | GitHub Pages 在国内速度不稳定，可以把 `dist/` 同时部署到 Gitee Pages、Vercel、Netlify 等任意静态托管 |
| 手机上摄像头打不开 | 必须通过 HTTPS 地址访问（Pages 地址就是 HTTPS），并允许浏览器使用相机 |
