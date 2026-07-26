# Ring Reader 隐私声明 / Privacy Policy

> 用于 Zepp 应用市场提交。提交时把对应语言版本填入 Console 的「隐私声明」字段。

## 中文版

### 环间阅读器（Ring Reader）隐私声明

更新日期：2026-07-26

本应用（AppID: 1121557）是一款伪装成计算器的本地 TXT 阅读器。我们高度重视您的隐私，现就数据收集与使用情况说明如下：

#### 1. 我们收集哪些数据

| 数据类型 | 用途 | 是否上传服务器 |
|---|---|---|
| 本地存储数据（书籍文件、阅读进度、书签、密码、阅读统计、主题设置） | 保存在手表本地，用于阅读功能 | 否，仅存于手表本地存储 |
| 网络访问 | 仅用于从用户填写的下载直链获取 TXT 书籍文件 | 仅访问用户指定的 URL，不访问任何分析/追踪服务 |
| 设备信息（屏幕尺寸、设备型号） | 用于 UI 布局适配圆形屏幕，确保界面在不同设备上正确显示 | 否，仅在本应用运行时使用 |

#### 2. 数据如何被使用

- **本地存储**：所有书籍内容、阅读进度、书签、密码、设置均存储在手表本地（`localStorage`），不会上传到任何服务器，也不会与第三方共享
- **网络**：仅当用户主动在手机端设置页填写下载直链并点击「开始上传到手表」时，应用会从该 URL 下载 TXT 文件并通过蓝牙推送到手表。应用不收集、不分析、不上传任何用户行为数据
- **设备信息**：仅用于计算屏幕布局（如控件尺寸、安全区），不包含设备唯一标识符，不用于追踪

#### 3. 数据共享与披露

本应用**不会**将任何用户数据共享给第三方，包括但不限于：
- 不与广告商共享
- 不与数据分析服务商共享
- 不与任何其他应用共享

#### 4. 数据安全

- 阅读器入口密码存储在手表本地（默认 123456，用户可在手表上修改），不进行任何加密传输
- 网络下载仅使用标准 HTTPS/HTTP 协议，安全性取决于用户填写的直链本身

#### 5. 用户权利

- 您可以随时通过手表端「长按书卡 → 删除」删除任意书籍及其阅读数据
- 您可以通过卸载应用清除所有本地数据

#### 6. 联系方式

如对本隐私声明有疑问，请在 GitHub 仓库提交 issue：<https://github.com/ring-amazfit/Ring-Reader>

#### 7. 权限清单

- `device:os.local_storage`：存储书籍、进度、书签、设置
- `device:os.network`：从用户填写的直链下载书籍
- `data:os.device.info`：读取屏幕尺寸用于布局适配

---

## English Version

### Ring Reader Privacy Policy

Last updated: 2026-07-26

This app (AppID: 1121557) is a local TXT reader disguised as a calculator. We take your privacy seriously. This policy explains what data we collect and how it is used.

#### 1. Data We Collect

| Data Type | Purpose | Uploaded to Server |
|---|---|---|
| Local storage data (book files, reading progress, bookmarks, password, reading stats, theme settings) | Stored on watch locally for reading features | No, only on watch local storage |
| Network access | Only used to fetch TXT book files from user-entered download URLs | Only accesses user-specified URLs, no analytics/tracking services |
| Device info (screen size, device model) | Used for UI layout adaptation to round screens, ensuring correct display across devices | No, only used at runtime |

#### 2. How Data Is Used

- **Local Storage**: All book content, reading progress, bookmarks, passwords, and settings are stored locally on the watch (`localStorage`). Nothing is uploaded to any server or shared with third parties
- **Network**: Only when a user actively enters a download URL in the phone-side settings page and taps "Start Upload to Watch" does the app download the TXT file from that URL and push it to the watch via Bluetooth. The app does not collect, analyze, or upload any user behavior data
- **Device Info**: Only used to compute screen layout (widget sizes, safe area). Does not include device unique identifiers, not used for tracking

#### 3. Data Sharing and Disclosure

This app does **not** share any user data with third parties, including but not limited to:
- No sharing with advertisers
- No sharing with analytics providers
- No sharing with any other apps

#### 4. Data Security

- The reader entry password is stored locally on the watch (default 123456, user can change it on the watch). No encrypted transmission occurs
- Network downloads use standard HTTPS/HTTP protocols; security depends on the user-entered URL itself

#### 5. User Rights

- You can delete any book and its reading data at any time via "Long-press book card → Delete" on the watch
- You can clear all local data by uninstalling the app

#### 6. Contact

For questions about this privacy policy, please file an issue at the GitHub repo: <https://github.com/ring-amazfit/Ring-Reader>

#### 7. Permissions List

- `device:os.local_storage`: store books, progress, bookmarks, settings
- `device:os.network`: download books from user-entered URLs
- `data:os.device.info`: read screen size for layout adaptation
