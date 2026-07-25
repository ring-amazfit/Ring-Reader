<p align="center">
  <img src="./icon.png" width="112" alt="环间阅读器图标">
</p>

<h1 align="center">环间阅读器</h1>

<p align="center">运行在 Amazfit Zepp OS 手表上的本地 TXT 阅读器，以科学计算器作为默认入口。</p>

<p align="center">
  <a href="https://github.com/ring-amazfit/Ring-Reader">GitHub 仓库</a>
</p>

## 功能

- **计算器入口**：提供基础运算、函数、三角函数和单位换算；输入默认密码 `123456` 后按 `=` 进入书架。
- **本地阅读**：内置测试文本，支持 UTF-8 TXT 文件、阅读进度、自动翻页、主题、字号、行距、亮度与常亮设置。
- **导航与书签**：支持触摸翻页、逐行滚动、跳页、书签和阅读时长统计。
- **多设备输入**：表冠旋转按方向逐事件翻页或滚动；带方向实体键的设备可使用方向键导航。
- **手机传书**：在 Zepp App 的应用设置中填写书名和 UTF-8 TXT 下载直链，由手机端下载后通过 BLE 传到手表。

> [!IMPORTANT]
> 入口密码仅用于界面跳转，并不提供加密、隐私保护或访问控制。

## 支持设备

`app.json` 当前声明支持以下圆形屏设备：

| 系列 | 分辨率目标 |
| --- | --- |
| Amazfit Balance | 480 × 480 |
| Amazfit T-Rex 3 | 480 × 480 |
| Amazfit Cheetah Pro | 480 × 480 |
| Amazfit GTR 4 | 466 × 466 |
| Amazfit Active 2 | 466 × 466 |

## 传书步骤

1. 在 Zepp App 中打开已安装应用的**应用设置**。
2. 填写书名，粘贴可直接下载的 UTF-8 `.txt` 文件链接。
3. 点击“开始上传到手表”，并保持手机端 App 在前台、手表保持连接。
4. 在手表中输入密码进入书架，等待接收完成后打开书籍。

## 开发与构建

### 前置条件

- Node.js（建议使用当前维护中的 LTS 版本）
- Zepp OS 开发环境与可访问的 npm 镜像

### 命令

```bash
npm ci
npm run build
```

构建产物会生成在 `dist/` 目录。可用下列命令启动 Zeus 预览：

```bash
npm run preview
```

Windows 下也可直接运行 `build.cmd` 或 `preview.cmd`。

## 项目结构

```text
app.js                 # 手表端 TransferFile 接收与书籍登记
app-side/index.js      # 手机端下载、队列与 BLE 传输
page/calculator.js     # 计算器默认页与入口密码
page/bookshelf.js      # 书架、书籍管理与传书状态
page/reader.js         # TXT 排版、阅读、书签与输入导航
setting/index.js       # Zepp App 应用设置页
utils/crown.js         # 表冠/方向键输入的共享纯逻辑
```

## 验证

```bash
node tests/crown.test.js
npm ci --dry-run
npm run build
```
