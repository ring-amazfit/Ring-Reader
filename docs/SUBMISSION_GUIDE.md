# 送审说明：应用审核流程指引

**应用**：环间阅读器（Ring Reader）
**AppID**：1121557
**版本**：3.0.1
**提交日期**：2026-07-31

## 一、应用定位说明

环间阅读器是一款**伪装成科学计算器的本地 TXT 阅读器**。应用打开后默认显示计算器界面，输入密码后才能进入书架。这是产品设计特性，不是缺陷：应用面向需要隐私保护的阅读场景，用户可以在公共场合以计算器的外观使用阅读功能。

因此，审核时**在计算器界面看不到任何书籍内容属于正常现象**，请按以下流程完成功能验证。

## 二、审核验证流程

### 第一步：进入书架并验证阅读（无需网络）

1. 安装并打开应用，默认显示深色计算器界面
2. 在计算器中依次输入密码 `123456`
3. 按 `=` 键
4. 进入书架页面，可见内置测试书籍「测试文本」（Test.txt）
5. 点击该书打开阅读器
6. 可验证：正文排版铺满圆屏、点击左右区域翻页、点击页码区域打开菜单（字号 / 行距 / 主题 / 亮度 / 自动翻页 / 书签 / 跳页）、表冠滚动或翻页

### 第二步：手机传书验证（可选，需网络与直链）

1. 手机打开 Zepp App → 我的 → 我的设备 → 本应用 → 应用设置
2. 填写书名，粘贴**可直接下载的 UTF-8 .txt 文件直链**
3. 点击「开始上传到手表」
4. 保持 Zepp App 在前台，保持手表与手机蓝牙连接
5. 手表端：计算器输入 `123456` 按 `=` 进入书架，停留在书架页面等待接收
6. 传输完成（进度 100%）后，书架出现新书，点击即可阅读

## 三、关于「APP端上传之后，设备无法获取小说」的说明

经排查，该现象由以下操作原因导致，均不是应用缺陷：

| 现象 | 原因 | 正确操作 |
| --- | --- | --- |
| 计算器界面看不到书 | 未进入书架。书架是隐藏入口，需输入密码 | 计算器输入 123456 按 = |
| 传书后书架没有新书 | TXT 链接不是直链（网页 / 需登录 / 重定向受限） | 使用可直接下载的 .txt 链接 |
| 传输卡住或失败 | 手机 App 退到后台，或手表断开连接 | 保持 Zepp App 前台 + 手表连接 |
| 文件无法显示 | 非 UTF-8 编码 | 使用 UTF-8 编码 TXT |

## 四、补充说明

- 入口密码仅用于应用内页面跳转，不提供加密、隐私保护或访问控制（详见隐私声明）
- 应用不含第三方 SDK、广告或追踪服务
- 权限仅三项：本地存储、网络（仅访问用户填写的直链）、设备信息（屏幕尺寸适配）
- 下载或传输失败会自动释放当前任务并继续后续队列，不会卡死

## 五、联系方式

GitHub：<https://github.com/ring-amazfit/Ring-Reader>
可通过仓库 issue 联系我们。

---

## Submission Guide: App Review Process

**App**: Ring Reader (环间阅读器)
**App ID**: 1121557
**Version**: 3.0.1
**Submitted**: 2026-07-31

### 1. About the App

Ring Reader is a **local TXT reader disguised as a scientific calculator**. The app opens on a calculator screen and requires a password to reach the bookshelf. This is an intentional design for privacy: users can read books in public without drawing attention.

As a result, **seeing no books on the calculator screen is expected**. Please follow the steps below to verify the app.

### 2. Review Steps

#### Step 1: Open the bookshelf and verify reading (no network required)

1. Install and open the app. It shows a dark calculator screen.
2. Enter the password `123456` on the calculator.
3. Press `=`.
4. The bookshelf opens with a built-in test book "Test" (Test.txt).
5. Tap the book to open the reader.
6. You can verify: full-screen round display layout, tap left/right to turn pages, tap the page-number area to open the menu (font size / line spacing / theme / brightness / auto-turn / bookmarks / jump), and Digital Crown scrolling or paging.

#### Step 2: Transfer a book from the phone (optional, needs network and a direct link)

1. In the Zepp app, open Profile > My Device > This App > App Settings.
2. Enter a title and paste a **directly downloadable UTF-8 .txt URL**.
3. Tap "Start Upload to Watch".
4. Keep the Zepp app in the foreground and keep the watch connected.
5. On the watch, enter `123456` and press `=` to open the bookshelf. Stay on the bookshelf and wait.
6. When the transfer reaches 100%, the new book appears on the bookshelf. Tap it to read.

### 3. About "The watch cannot get the book after uploading from the app"

This is caused by operational reasons below, not an app defect:

| Symptom | Cause | Correct action |
| --- | --- | --- |
| No book on calculator screen | The bookshelf is a hidden entry; you must enter the password | Enter 123456 and press = |
| No new book after upload | The URL is not a direct .txt link (webpage / login required / restricted redirect) | Use a directly downloadable .txt URL |
| Transfer stuck or failed | The phone app went to background, or the watch disconnected | Keep the Zepp app in the foreground and the watch connected |
| File does not display | Not UTF-8 encoded | Use UTF-8 TXT files |

### 4. Notes

- The password only switches pages inside the app. It is not encryption, privacy protection, or access control (see the privacy policy).
- The app has no third-party SDKs, ads, or tracking services.
- Permissions: local storage, network (only to the URL the user enters), and device info (screen size for layout).
- Failed downloads or transfers release the current job and continue the queue. The app never hangs.

### 5. Contact

GitHub: <https://github.com/ring-amazfit/Ring-Reader>
You can reach us through the repository issue tracker.
