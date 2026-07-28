<p align="center">
  <img src="./icon.png" width="112" alt="环间阅读器图标">
</p>

<h1 align="center">环间阅读器</h1>

<p align="center">一款运行在 Amazfit Zepp OS 圆形屏手表上的本地 TXT 阅读器，以完整可用的科学计算器作为默认入口。</p>

<p align="center">
  <a href="#功能概览">功能</a> ·
  <a href="#界面预览">界面预览</a> ·
  <a href="#传书步骤">传书</a> ·
  <a href="#开发与构建">开发</a> ·
  <a href="./README_EN.md">English</a> ·
  <a href="./LICENSE">MIT License</a>
</p>

> [!NOTE]
> 当前版本：`v3.0.1` · App ID：`83750` · 适用于 Zepp OS 3.0 及以上运行环境。

## 功能概览

### 计算器入口

- 默认展示为深色科学计算器，可完成基础运算、幂运算、阶乘、三角函数、对数函数和单位换算。
- 支持分页按键、表达式编辑、光标移动与计算历史。
- 输入默认密码 `123456` 后按 `=` 进入书架；可在书架中将密码改为 4–8 位数字。
- 密码仅用于应用内的页面跳转，不提供加密、隐私保护或访问控制。

### 本地阅读

- 内置测试文本，也可阅读从手机传入的 UTF-8 `.txt` 文件。
- 自动保存阅读位置、主题、字号、行距、亮度、自动翻页与滚动模式等设置。
- 支持夜间、护眼、纸张、黑色、暮色、雾、秋、冰共 8 款阅读主题。
- 支持 12–36 号字体、4 档行距、亮度调节、屏幕常亮和自动翻页速度。
- 支持 UTF-8 四字节字符显示，并根据圆形屏幕的实际弦宽逐行排版。

### 导航与书签

- 点击正文左右区域翻页；可切换为逐行滚动阅读。
- 支持进度条、百分比、跳页/跳转百分比、书签添加、书签删除与书签列表导航。
- 记录累计阅读时长、当日时长、阅读进度和近 7 天阅读趋势。
- 表冠按旋转方向直接翻页或逐行滚动；带方向实体键的设备可用 `UP/DOWN` 键完成同样导航。

### 手机传书

- 在 Zepp App 的应用设置页填写书名和可直接下载的 UTF-8 TXT 链接。
- 手机端按队列下载文件，并通过 BLE `TransferFile` 传到手表。
- 传输过程中显示下载/接收进度；网络、下载或传输失败时会安全释放当前任务并继续后续队列。
- 书架提供已接收书籍展示、长按/删除确认、阅读统计与在线传书指引。

## 界面预览

<table>
  <tr>
    <td width="50%" align="center">
      <img src="./docs/images/calculator.png" alt="计算器入口" width="100%"><br>
      <sub><b>计算器入口</b><br>基础计算与多页科学函数</sub>
    </td>
    <td width="50%" align="center">
      <img src="./docs/images/bookshelf.png" alt="书架" width="100%"><br>
      <sub><b>书架</b><br>最近阅读、阅读进度与书籍管理</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="./docs/images/reader.png" alt="阅读界面" width="100%"><br>
      <sub><b>阅读界面</b><br>圆形屏自适应排版与阅读进度</sub>
    </td>
    <td width="50%" align="center">
      <img src="./docs/images/reader-menu.png" alt="阅读菜单" width="100%"><br>
      <sub><b>阅读菜单</b><br>字号、行距、主题、自动翻页与书签</sub>
    </td>
  </tr>
</table>

## 支持设备

`app.json` 当前声明支持以下圆形屏 Amazfit 设备：

| 系列 | 分辨率目标 | 输入方式 |
| --- | ---: | --- |
| Amazfit Balance | 480 × 480 | 表冠 / 触摸 / 方向键（如设备提供） |
| Amazfit T-Rex 3 | 480 × 480 | 触摸 / 方向键（如设备提供） |
| Amazfit Cheetah Pro | 480 × 480 | 表冠 / 触摸 / 方向键（如设备提供） |
| Amazfit GTR 4 | 466 × 466 | 表冠 / 触摸 / 方向键（如设备提供） |
| Amazfit Active 2 | 466 × 466 | 表冠 / 触摸 / 方向键（如设备提供） |

> [!TIP]
> 表冠处理遵循 Zepp OS 的 `KEY_HOME + 非零 degree` 事件规则：仅按旋转方向响应，不累加阈值；表冠按下不会触发阅读导航。

## 使用说明

### 进入书架

1. 打开应用，默认显示计算器。
2. 输入密码 `123456`，按 `=`。
3. 首次进入后可通过书架顶部的“改密”设置 4–8 位数字密码。

### 阅读与设置

1. 在书架点击书籍打开阅读器。
2. 点击底部页码区域打开菜单。
3. 在菜单中调整字号、行距、亮度、主题、自动翻页、滚动阅读和常亮状态。
4. 点击“书签”管理当前位置书签；点击“跳页”可按页码或百分比定位。

### 传书步骤

1. 在 Zepp App 中打开：**我的 → 我的设备 → 本应用 → 应用设置**。
2. 填写书名，粘贴能直接下载的 UTF-8 `.txt` 文件链接。
3. 点击“开始上传到手表”，保持手机端 Zepp App 在前台，并保持手表连接。
4. 在手表输入密码进入书架，等待接收完成后即可打开新书。

> [!WARNING]
> 只支持可直接下载的 UTF-8 TXT 文件。网页预览地址、需要登录的链接、重定向受限链接或非 TXT 编码文件可能无法下载或正常显示。

## 开发与构建

### 前置条件

- Node.js（建议使用当前维护中的 LTS 版本）
- Zepp OS 开发环境
- 可访问的 npm 镜像

### 安装依赖

```bash
npm ci
```

### 构建安装包

```bash
npm run build
```

构建产物会生成在 `dist/` 目录。Windows 下也可直接运行：

```bat
build.cmd
```

### 启动 Zeus 预览

```bash
npm run preview
```

Windows 下也可直接运行：

```bat
preview.cmd
```

## 项目结构

```text
app.js                 # 手表端 TransferFile 接收、队列排空与书籍登记
app-side/index.js      # 手机端 TXT 下载、传输队列与 BLE TransferFile 发送
page/calculator.js     # 计算器默认页、科学函数、历史记录和书架入口
page/bookshelf.js      # 书架、书籍删除、统计、接收状态与设置入口
page/reader.js         # TXT 排版、阅读、书签、进度、菜单与阅读时长
setting/index.js       # Zepp App 应用设置页与传书表单
utils/crown.js         # 表冠与方向键的共享输入纯逻辑
docs/images/           # README 界面截图
```

## 验证

```bash
npm test
npm ci --dry-run
npm run build
```

`npm test` 会执行表冠与方向键纯逻辑回归测试；构建过程会编译全部目标页面和设备资源。

## 开源协议

本项目采用 [MIT License](./LICENSE) 开源。你可以在保留版权与许可声明的前提下使用、修改、分发或商用本项目。
