/**
 * 小说阅读器 v6 — 轻量零扫描版
 * 关键：不再扫描全文建索引（手表 CPU 扛不住会卡死）。
 *  - 打开瞬间完成：只渲染当前一页。
 *  - 翻页：顺序读取，用回退栈记录看过的页起点，上一页直接出栈。
 *  - 进度：按字节偏移算百分比（精确、零成本）。
 *  - 页码：用"每页约多少字节"(bpp) 估算，页码是偏移的单调函数，
 *          所以跳页/翻页一致、不再混乱（虽是约数但不跳变）。
 *  - 跳页：按页码 → 目标字节 = (页-1)*bpp，对齐到行首再渲染。
 *
 * 表冠方向约定：
 *   逆时针旋转 → 正 degree → 回退/上一页 (scrollUp / goPrev / bm.page--)
 *   顺时针旋转 → 负 degree → 前进/下一页 (scrollDown / goNext / bm.page++)
 *   书签面板、滚动模式、翻页模式统一使用此约定。
 */

import { createWidget, widget, align, event, prop, deleteWidget } from '@zos/ui'
import { back, push } from '@zos/router'
import { onDigitalCrown, KEY_HOME, KEY_UP, KEY_DOWN, offDigitalCrown, onKey, offKey } from '@zos/interaction'
import { crownDirection, crownDebounceMs, keyDirection } from '../utils/crown'
import { C, M, makeSlider, rowW, makeCloseButton, setScale } from '../utils/ui'
import { localStorage } from '@zos/storage'
import { setWakeUpRelaunch, setBrightness, getBrightness } from '@zos/display'
import { Time, Battery } from '@zos/sensor'
import { getDeviceInfo } from '@zos/device'
import { getText } from '@zos/i18n'
import {
  openAssetsSync, statAssetsSync,
  openSync, statSync,
  O_RDONLY, readSync, closeSync
} from '@zos/fs'

var W = 480, H = 480

// 圆形屏阅读区（尽量大又不裁切，正文用最大内接区域）
var READ_X = 64
var READ_W = 352          // 64 ~ 416
var READ_Y = 56
var READ_BOTTOM = 392
var READ_H = READ_BOTTOM - READ_Y   // 336
var TOP_PCT_Y = 32        // 顶部居中百分比
var META_Y = 396          // 底部居中页码（点开菜单）
var BAR_Y = 418
var BAR_X = 140, BAR_W = 200
// UI 仅使用相邻石墨色阶制造层次，不叠加黑色“假阴影”。
var UI_PANEL_SOFT = C.cardAlt
var UI_ACCENT = C.accent       // 强调（琥珀）
var UI_SUB = C.sub             // 次要文本
var UI_DANGER = C.danger
var UI_TEXT = C.text           // 主文本
var UI_MUTED = C.muted         // 三级弱化文本
var STEP = 3072           // 渲染读取步长（增大以减少 readSync 次数）

// 解码常见 HTML 实体：有些 TXT 书是从网页扒的，正文里带 &#8226;、&amp; 等字面实体。
// 这是书文件的问题（不是渲染 bug），但阅读器兼容解码后两种书都能正常显示。
function decodeEntities(s) {
  if (!s || s.indexOf('&') < 0) return s
  var out = ''
  for (var i = 0; i < s.length; i++) {
    if (s[i] === '&') {
      var m = null
      if (s[i + 1] === '#') {
        var j = i + 2, num = ''
        while (j < s.length && s[j] >= '0' && s[j] <= '9') { num += s[j]; j++ }
        if (num && s[j] === ';') { out += String.fromCharCode(parseInt(num, 10)); i = j; continue }
      } else {
        var names = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', middot: '·' }
        var k = i + 1, nm = ''
        while (k < s.length && s[k] >= 'a' && s[k] <= 'z') { nm += s[k]; k++ }
        if (nm && s[k] === ';' && names[nm] !== undefined) { out += names[nm]; i = k; continue }
      }
    }
    out += s[i]
  }
  return out
}
var _readBuf = null
var _readBufLen = 0

// --LIBRARY-DATA-- (内置书数据，手动维护；如需批量导入可写脚本替换此段)
var LIBRARY = [
  {
    id: 0,
    title: getText('libraryTestTitle'),
    author: getText('libraryTestAuthor'),
    file: "raw/books/Test.txt",
  },
]

var FONT_SIZES = (function () { var a = []; for (var s = 12; s <= 36; s++) a.push(s); return a })()  // 逐号可调
var SPACINGS = [1.0, 1.18, 1.36, 1.58]
var SPACING_LABELS = ['spacingTight', 'spacingNormal', 'spacingLoose', 'spacingLarge']

// 配色主题：bg 背景 / fg 正文 / sub 次要 / bar 进度 / barbg 进度底
var THEMES = [
  { nameKey: 'themeNight', bg: 0x0E0E0E, fg: 0xE8E8E8, sub: UI_SUB, bar: 0xD8924B, barbg: 0x2A2A2A },
  { nameKey: 'themeEye', bg: 0x12211A, fg: 0xCBE3CE, sub: 0x6E8F76, bar: 0x5AAE78, barbg: 0x24382C },
  { nameKey: 'themePaper', bg: 0xE9E0CB, fg: 0x3A352A, sub: 0x8C8064, bar: 0xB5772E, barbg: 0xCFC3A6 },
  { nameKey: 'themeBlack', bg: 0x000000, fg: 0xC6C6C6, sub: 0x707070, bar: 0xC07A33, barbg: 0x1C1C1C },
  { nameKey: 'themeDusk', bg: 0x1A1020, fg: 0xD8C8E8, sub: 0x8878A0, bar: 0xA060D0, barbg: 0x2A1838 },
  { nameKey: 'themeFog', bg: 0xF0F0F0, fg: 0x2A2A2A, sub: UI_SUB, bar: 0xD8924B, barbg: 0xD8D8D8 },
  { nameKey: 'themeAutumn', bg: 0x1C1810, fg: 0xE0D0B0, sub: 0x9A8A6A, bar: 0xD4A040, barbg: 0x2C2418 },
  { nameKey: 'themeIce', bg: 0x0C1420, fg: 0xFFFFFF, sub: 0x9A9A9A, bar: 0xD8924B, barbg: 0x182838 }
]
var AUTO_SECS = [0, 12, 7, 4]            // 自动翻页：关/慢/中/快
var AUTO_LABELS = ['autoOff', 'autoSlow', 'autoNormal', 'autoFast']

var bookId = 0, book = null, isDownloaded = false
var fontIdx = 8
var spacingIdx = 1
var brightVal = 75              // 5% 步进，5~100
var themeIdx = 0
var autoIdx = 0
var scrollMode = false         // 滚动阅读（表冠逐行无缝滚动）
var savedBrightness = -1
var source = null
var curStart = 0, curInfo = null
var backStack = []
var _nextPageCache = null   // 预读缓存：翻下一页时零延迟
var _prevPageCache = null   // 最近上一页缓存：返回时避免再次 readSync
var _preloadTimer = null    // 合并重复的预读任务，避免后台重复解析同一页
var _preloadToken = 0       // 使过期的预读结果失效
var _scrollStack = []       // 滚动模式下行级位置栈：scrollDown 前压入，scrollUp 弹出
var bpp = 600, estTotal = 1

var bgRect = null
var loadingWidgets = []
var lineWidgets = [], tapWidgets = []
var pageNumWidget = null, topPctWidget = null
var fullscreen = false
var readProgressWidget = null
var clockTimer = null, sessionStart = 0, baseReadSec = 0
// 仅用本次会话的有效前进速度估算剩余时间，避免历史挂起时间污染。
var speedBytesPerSec = 0, speedSampleCount = 0, speedLastOffset = 0, speedLastTs = 0
var autoTimer = null
var autoCountdownTimer = null
var autoCountdownWidget = null
var autoCountdownStart = 0
var autoCountdown = 0, autoCountdownTimer = null
var keepAwake = false, keepAwakeTimer = null  // 屏幕常亮
var timeSensor = null, battSensor = null, lastBatt = -1, charging = false
var CROWN_DEBOUNCE = crownDebounceMs(), crownLastTs = 0
// 表冠灵敏度 1~5 级：每翻一页所需的累计旋转角度（°）。
// 级数越大越灵敏：1 级 = 90° 才翻一页，5 级 = 20° 就翻一页。
var CROWN_LEVELS = [90, 80, 60, 40, 20]
var crownAccumDeg = 0, crownAccumDir = 0    // 翻页模式表冠：同方向累计角度
var jump = { active: false, input: '', mode: 'page', widgets: [], _poolBuilt: false, dispText: null, modeText: null }
// 二级菜单返回标记：从主菜单进入书签/跳页/样式时置 true，
// 关闭二级菜单后重新打开主菜单（“所有二级菜单返回都是一级菜单”）。
// 行内“执行类”操作（跳页确认、点书签跳转）会先清除此标记，直接进入阅读。
var _backToMenu = false
var _longPressTimer = null  // 已废弃，书签改为菜单按钮
var menu = { active: false, widgets: [], _poolBuilt: false, page: 0, fontText: null, spacingText: null, brightText: null, themeText: null, autoText: null, autoBtnTxt: null, scrollText: null, timerText: null, awakeTxt: null }

var loadingPulse = null
function clearLoading() {
  if (loadingPulse) { clearInterval(loadingPulse); loadingPulse = null }
  for (var i = 0; i < loadingWidgets.length; i++) { try { deleteWidget(loadingWidgets[i]) } catch (e) {} }
  loadingWidgets = []
}
function showLoading() {
  clearLoading()
  loadingWidgets.push(createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: H, color: C.bg, alpha: 255 }))
  loadingWidgets.push(createWidget(widget.FILL_RECT, { x: 90, y: 184, w: W - 180, h: 86, radius: M.cardR, color: C.cardAlt }))
  loadingWidgets.push(createWidget(widget.TEXT, { x: 70, y: 214, w: W - 140, h: 32, text: getText('readerLoading'), text_size: 18, color: C.accent, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  // 琥珀脉冲：加载文字呼吸效果
  var pulseUp = true, pulseAlpha = 180
  var pulseTarget = loadingWidgets[loadingWidgets.length - 1]
  loadingPulse = setInterval(function () {
    pulseAlpha += pulseUp ? 25 : -25
    if (pulseAlpha >= 255) { pulseAlpha = 255; pulseUp = false }
    if (pulseAlpha <= 120) { pulseAlpha = 120; pulseUp = true }
    try { pulseTarget.setProperty(prop.MORE, { alpha: pulseAlpha }) } catch (e) {}
  }, 200)
}
function theme() { return THEMES[themeIdx] }

function cfgNow() {
  var size = FONT_SIZES[fontIdx]
  return { size: size, lh: Math.round(size * SPACINGS[spacingIdx]), label: String(size) }
}

// 按真实屏幕尺寸等比缩放布局（适配 466/480 等圆屏），基准为 480 设计
// 正文宽度取圆内最小弦宽，并保留字体边缘安全余量，避免首尾字符越出屏幕。
function computeLayout() {
  var di; try { di = getDeviceInfo() } catch (e) { di = null }
  W = (di && di.width) ? di.width : 480
  H = (di && di.height) ? di.height : 480
  setScale(W)
  var S = W / 480
  READ_Y = Math.round(58 * S); READ_BOTTOM = H - Math.round(72 * S); READ_H = READ_BOTTOM - READ_Y
  var radius = W / 2, center = H / 2
  var topDist = Math.abs(center - READ_Y), bottomDist = Math.abs(READ_BOTTOM - center)
  var topHalf = topDist < radius ? Math.sqrt(radius * radius - topDist * topDist) : radius
  var bottomHalf = bottomDist < radius ? Math.sqrt(radius * radius - bottomDist * bottomDist) : radius
  var chord = Math.round(2 * Math.min(topHalf, bottomHalf))
  var edgeSafe = Math.round(8 * S)
  READ_W = Math.max(120, chord - edgeSafe * 2)
  READ_X = Math.round((W - READ_W) / 2)
  TOP_PCT_Y = Math.round(32 * S)
  META_Y = H - Math.round(84 * S)
  BAR_W = Math.round(200 * S); BAR_X = Math.round((W - BAR_W) / 2); BAR_Y = H - Math.round(62 * S)
}

function normalizeDataPath(path) {
  if (!path) return ''
  if (path.indexOf('/data/') === 0) return path.substring(6)
  if (path.indexOf('data://') === 0) return path.substring(7)
  return path
}

function openBookSource(filePath) {
  try {
    var fd, st, path = filePath || ''
    if (path.indexOf('raw/') === 0) {
      st = statAssetsSync({ path: path })
      if (!st || !st.size) return null   // 文件不存在或空：返回 null，让 drawPage 走"读取失败"提示，而非静默空白
      fd = openAssetsSync({ path: path, flag: O_RDONLY })
      return { fd: fd, size: st.size, asset: true, path: path }
    }
    path = normalizeDataPath(path)
    st = statSync({ path: path })
    if (!st || !st.size) return null
    fd = openSync({ path: path, flag: O_RDONLY })
    return { fd: fd, size: st.size, asset: false, path: path }
  } catch (e) { return null }
}

function closeBookSource() {
  if (source && source.fd !== undefined && source.fd !== null) {
    try { closeSync({ fd: source.fd }) } catch (e) {}
  }
  source = null
}

function readBytesAt(offset, length) {
  if (!source || offset >= source.size) return { bytes: null, len: 0 }
  if (offset + length > source.size) length = source.size - offset
  if (length <= 0) return { bytes: null, len: 0 }
  if (!_readBuf || _readBufLen < length) {
    _readBufLen = Math.max(length, 4096)
    _readBuf = new ArrayBuffer(_readBufLen)
  }
  try {
    var n = readSync({ fd: source.fd, buffer: _readBuf, options: { offset: 0, length: length, position: offset } })
    if (!n || n <= 0) return { bytes: null, len: 0 }
    return { bytes: new Uint8Array(_readBuf, 0, n), len: n }
  } catch (e) { return { bytes: null, len: 0 } }
}

function cpByteLen(b) {
  return b < 0x80 ? 1 : ((b & 0xE0) === 0xC0 ? 2 : ((b & 0xF0) === 0xE0 ? 3 : ((b & 0xF8) === 0xF0 ? 4 : 1)))
}

function decodeUtf8CodePoint(bytes, i, blen) {
  var b = bytes[i]
  if (blen === 1) return b
  if (blen === 2) return ((b & 0x1F) << 6) | (bytes[i + 1] & 0x3F)
  if (blen === 3) return ((b & 0x0F) << 12) | ((bytes[i + 1] & 0x3F) << 6) | (bytes[i + 2] & 0x3F)
  if (blen === 4) return 0x10000 + (((b & 0x07) << 18) | ((bytes[i + 1] & 0x3F) << 12) | ((bytes[i + 2] & 0x3F) << 6) | (bytes[i + 3] & 0x3F))
  return 0x3F
}

function stringFromCodePoint(cp) {
  if (cp <= 0xFFFF) return String.fromCharCode(cp)
  cp -= 0x10000
  return String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF))
}

function lineVisibleWidth(lineIdx, cfg) {
  var y = READ_Y + lineIdx * cfg.lh + Math.floor(cfg.lh / 2)
  var radius = W / 2, center = H / 2
  var dist = Math.abs(center - y)
  var half = dist < radius ? Math.sqrt(radius * radius - dist * dist) : radius
  var safe = Math.max(4, Math.round(cfg.size * 0.32))
  var width = Math.round(2 * half) - safe * 2
  if (width < 80) width = 80
  return width
}
function pageLimits(cfg) {
  var maxLines = Math.floor(READ_H / cfg.lh)
  if (maxLines < 1) maxLines = 1
  var cpls = [], xs = [], ws = []
  for (var i = 0; i < maxLines; i++) {
    var w = lineVisibleWidth(i, cfg)
    var cpl = Math.floor(w / (cfg.size * 1.02))
    if (cpl < 4) cpl = 4
    cpls.push(cpl)
    ws.push(w)
    xs.push(Math.round((W - w) / 2))
  }
  return { maxLines: maxLines, cpls: cpls, xs: xs, ws: ws }
}

// 渲染从 startOffset 开始的一页，返回 {lines,end,eof,layout}。按每行动态宽度排版，尽量铺满圆屏。
function renderPage(startOffset, cfg) {
  if (!source) return { text: getText('readerReadFailed'), start: 0, end: 0, eof: true }
  var lim = pageLimits(cfg)
  var lines = [], parts = [], lineLen = 0
  var pos = startOffset
  var lineIdx = 0, lineCap = lim.cpls[0]

  while (lineIdx < lim.maxLines && pos < source.size) {
    var got = readBytesAt(pos, STEP)
    if (got.len <= 0) break
    var bytes = got.bytes, len = got.len
    var atEOF = (pos + len >= source.size)
    var i = 0, full = false
    while (i < len) {
      var b = bytes[i]
      var blen = cpByteLen(b)
      if (i + blen > len) { if (atEOF) { i = len } ; break }
      var cp = decodeUtf8CodePoint(bytes, i, blen)
      i += blen
      if (cp === 0x0D) continue
      if (cp === 0x0A) {
        lines.push(parts.join('')); parts = []; lineLen = 0; lineIdx++
        if (lineIdx >= lim.maxLines) { full = true; break }
        lineCap = lim.cpls[lineIdx]
      } else {
        parts.push(stringFromCodePoint(cp)); lineLen++
        if (lineLen >= lineCap) {
          lines.push(parts.join('')); parts = []; lineLen = 0; lineIdx++
          if (lineIdx >= lim.maxLines) { full = true; break }
          lineCap = lim.cpls[lineIdx]
        }
      }
    }
    pos += i
    if (full) break
  }
  if (lineIdx < lim.maxLines && parts.length > 0) lines.push(parts.join(''))
  return { lines: lines, start: startOffset, end: pos, eof: pos >= source.size, layout: lim }
}

// 估算每页字节数 + 约总页数（仅一次 4KB 采样，零卡顿）
function estimateLayout(cfg) {
  var lim = pageLimits(cfg)
  var avgCpl = 0
  for (var li = 0; li < lim.cpls.length; li++) avgCpl += lim.cpls[li]
  avgCpl = Math.round(avgCpl / lim.cpls.length)
  var ratio = 2.6
  if (source && source.size > 0) {
    var at = source.size > 8192 ? Math.floor(source.size / 3) : 0
    var got = readBytesAt(at, Math.min(4096, source.size))
    if (got.len > 0) {
      var chars = 0, i = 0
      while (i < got.len) {
        var bl = cpByteLen(got.bytes[i])
        if (i + bl > got.len) break
        chars++; i += bl
      }
      if (chars > 0) ratio = i / chars
    }
  }
  bpp = Math.max(64, Math.round(lim.maxLines * avgCpl * ratio * 0.9))
  estTotal = source ? Math.max(1, Math.ceil(source.size / bpp)) : 1
}

function snapToLineStart(approx) {
  if (approx <= 0) return 0
  var winStart = Math.max(0, approx - 512)
  var got = readBytesAt(winStart, approx - winStart)
  if (got.len <= 0) return approx
  for (var i = got.len - 1; i >= 0; i--) {
    if (got.bytes[i] === 0x0A) return winStart + i + 1
  }
  return winStart
}

function displayPage() {
  if (curInfo && curInfo.eof) return estTotal
  var p = Math.floor(curStart / bpp) + 1
  if (p < 1) p = 1
  if (p > estTotal) p = estTotal
  return p
}

function percent() {
  if (!source || source.size <= 0) return 0
  var end = curInfo ? curInfo.end : curStart
  var pct = Math.floor(end * 100 / source.size)
  if (pct < 0) pct = 0
  if (pct > 100) pct = 100
  return pct
}

// 进度条控件池：只建一次，翻页只改宽度（消除每页 deleteWidget+createWidget 开销）
var _progBgWidget = null
function buildProgressBar() {
  // 背景条（始终全宽）— 4px 圆角轨道
  _progBgWidget = createWidget(widget.FILL_RECT, { x: BAR_X, y: BAR_Y, w: BAR_W, h: 4, radius: 2, color: theme().barbg })
  // 前景填充条 — 只更新宽度
  readProgressWidget = createWidget(widget.FILL_RECT, { x: BAR_X, y: BAR_Y, w: 4, h: 4, radius: 2, color: theme().bar })
}
function refreshProgressBar() {
  var pct = percent()
  var w = Math.floor(BAR_W * pct / 100)
  if (pct > 0 && w < 4) w = 4
  if (w > BAR_W) w = BAR_W
  if (readProgressWidget) {
    readProgressWidget.setProperty(prop.MORE, { x: BAR_X, y: BAR_Y, w: w, h: 4, radius: 2, color: theme().bar })
  }
}

function battStr() {
  try {
    if (!battSensor) battSensor = new Battery()
    var b = battSensor.getCurrent()
    if (typeof b !== 'number') return ''
    if (lastBatt >= 0 && b > lastBatt) charging = true
    else if (lastBatt >= 0 && b < lastBatt) charging = false
    lastBatt = b
    return (charging ? getText('readerBatteryCharging') : '') + b + '%'
  } catch (e) { return '' }
}
function topText() {
  var s = nowHHMM() + ' · ' + percent() + '% · ' + battStr()
  return s
}

function two(n) { return n < 10 ? '0' + n : '' + n }
function nowHHMM() {
  try {
    if (!timeSensor) timeSensor = new Time()
    return two(timeSensor.getHours()) + ':' + two(timeSensor.getMinutes())
  } catch (e) { return '' }
}

function updateMeta() {
  if (pageNumWidget) pageNumWidget.setProperty(prop.TEXT, displayPage() + ' / ~' + estTotal)
  if (topPctWidget) topPctWidget.setProperty(prop.TEXT, topText())
}

// 主题换肤：背景/正文/页码/进度条配色
function applyChromeColors() {
  var th = theme()
  try { if (bgRect) bgRect.setProperty(prop.MORE, { x: 0, y: 0, w: W, h: H, color: th.bg }) } catch (e) {}
  try { if (pageNumWidget) pageNumWidget.setProperty(prop.MORE, { x: Math.round((W - 200) / 2), y: META_Y, w: 200, h: 22, text: displayPage() + ' / ~' + estTotal, text_size: 15, color: th.sub, align_h: align.CENTER_H }) } catch (e) {}
  try { if (topPctWidget) topPctWidget.setProperty(prop.MORE, { x: Math.round((W - 180) / 2), y: TOP_PCT_Y, w: 180, h: 20, text: topText(), text_size: 13, color: th.sub, align_h: align.CENTER_H }) } catch (e) {}
  try { if (_progBgWidget) _progBgWidget.setProperty(prop.MORE, { x: BAR_X, y: BAR_Y, w: BAR_W, h: 4, radius: 2, color: th.barbg }) } catch (e) {}
}

// ── 亮度（系统会在亮屏时重置，故定时/翻页时反复重申）──
function applyBrightness() {
  if (brightVal < 0) return
  try { setBrightness({ brightness: brightVal }) } catch (e) {}
}

// ── 阅读计时 ──
function currentReadSec() {
  var s = baseReadSec
  if (sessionStart) s += Math.floor((Date.now() - sessionStart) / 1000)
  return s
}
function fmtMin(sec) {
  var m = Math.floor(sec / 60)
  if (m < 60) return m + getText('readerMinuteSuffix')
  return Math.floor(m / 60) + getText('readerHourSuffix') + (m % 60) + getText('readerMinuteSuffix')
}
function estRemaining() {
  if (!source || source.size <= 0 || !curInfo || curInfo.eof) return ''
  if (speedSampleCount < 2 || speedBytesPerSec <= 0) return ''
  var remainBytes = Math.max(0, source.size - curInfo.end)
  var remain = Math.round(remainBytes / speedBytesPerSec)
  if (remain < 30) return ''
  return getText('readerEstimateRemain') + fmtMin(remain)
}
function resetSpeedTracking() {
  speedBytesPerSec = 0
  speedSampleCount = 0
  speedLastOffset = curInfo ? curInfo.end : curStart
  speedLastTs = Date.now()
}
function noteForwardProgress(fromOffset) {
  if (!curInfo || curInfo.end <= fromOffset) return
  var now = Date.now()
  var elapsed = (now - speedLastTs) / 1000
  var bytes = curInfo.end - fromOffset
  // 熄屏/停留过久后不把整段挂起时间算进速度。
  if (elapsed >= 2 && elapsed <= 300 && bytes > 0) {
    var instant = bytes / elapsed
    speedBytesPerSec = speedSampleCount === 0 ? instant : speedBytesPerSec * 0.65 + instant * 0.35
    speedSampleCount++
  }
  speedLastOffset = curInfo.end
  speedLastTs = now
}
var _lastFlushTs = 0
function todayKey() {
  var d = new Date()
  return d.getFullYear() + '-' + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1) + '-' + (d.getDate() < 10 ? '0' : '') + d.getDate()
}
function flushReadTime() {
  try {
    var all = {}
    try { all = JSON.parse(localStorage.getItem('read_time', '{}')) } catch (e) {}
    all[String(bookId)] = currentReadSec()
    localStorage.setItem('read_time', JSON.stringify(all))
  } catch (e) {}
  try {
    var now = Date.now()
    if (_lastFlushTs > 0) {
      var elapsed = Math.floor((now - _lastFlushTs) / 1000)
      if (elapsed > 0 && elapsed < 300) {
        var daily = {}
        try { daily = JSON.parse(localStorage.getItem('read_daily', '{}')) } catch (e) {}
        var key = todayKey()
        daily[key] = (daily[key] || 0) + elapsed
        localStorage.setItem('read_daily', JSON.stringify(daily))
      }
    }
    _lastFlushTs = now
  } catch (e) {}
}
function loadReadTime(bid) {
  try {
    var all = JSON.parse(localStorage.getItem('read_time', '{}'))
    return all[String(bid)] || 0
  } catch (e) { return 0 }
}
function startClock() {
  stopClock()
  function tick() {
    if (topPctWidget) topPctWidget.setProperty(prop.TEXT, topText())
    if (menu.active && menu.timerText) {
      var rm = estRemaining()
      try { menu.timerText.setProperty(prop.TEXT, getText('readerSessionTime') + fmtMin(currentReadSec() - baseReadSec) + ' · ' + getText('readerTotalTime') + fmtMin(currentReadSec()) + (rm ? getText('readerRemain') + rm : '')) } catch (e) {}
    }
    applyBrightness()
    flushReadTime()
    clockTimer = setTimeout(tick, 30000)
  }
  clockTimer = setTimeout(tick, 30000)
}
function stopClock() {
  if (clockTimer) { clearTimeout(clockTimer); clockTimer = null }
}

// ── 逐行渲染 + 控件池：每行一个固定 TEXT，y 按 lh 精确定位（行距可调、
//    最后一行不被裁）。控件池只在字号/行距变化时重建，翻页只 setProperty
//    刷新文字 → 大幅减少弱 CPU 的控件创建/销毁开销。──
var poolLh = 0, poolSize = 0

function clearLines() {
  for (var i = 0; i < lineWidgets.length; i++) { try { deleteWidget(lineWidgets[i]) } catch (e) {} }
  lineWidgets = []
  poolLh = 0; poolSize = 0
}
function clearTaps() {
  for (var i = 0; i < tapWidgets.length; i++) { try { deleteWidget(tapWidgets[i]) } catch (e) {} }
  tapWidgets = []
}
function buildPageWidgets(cfg) {
  clearLines(); clearTaps()
  var lim = pageLimits(cfg)
  var n = lim.maxLines
  for (var i = 0; i < n; i++) {
    lineWidgets.push(createWidget(widget.TEXT, {
      x: lim.xs[i], y: READ_Y + i * cfg.lh, w: lim.ws[i], h: cfg.lh,
      text: '', text_size: cfg.size, color: theme().fg,
      align_h: align.CENTER_H, align_v: align.CENTER_V
    }))
  }
  // 触摸层使用整块大区域，保证翻页操作不受每行宽度变化影响。
  var half = Math.floor(W / 2)
  var L = createWidget(widget.FILL_RECT, { x: 0, y: READ_Y, w: half, h: READ_H, color: 0x000000, alpha: 0 })
  L.addEventListener(event.CLICK_DOWN, function () { goPrev() })
  tapWidgets.push(L)
  var R = createWidget(widget.FILL_RECT, { x: half, y: READ_Y, w: W - half, h: READ_H, color: 0x000000, alpha: 0 })
  R.addEventListener(event.CLICK_DOWN, function () { goNext() })
  tapWidgets.push(R)
  poolLh = cfg.lh; poolSize = cfg.size
}
function drawPage() {
  if (!source) return
  var cfg = cfgNow()
  if (lineWidgets.length === 0 || poolLh !== cfg.lh || poolSize !== cfg.size) buildPageWidgets(cfg)
  curInfo = renderPage(curStart, cfg)
  var lines = curInfo.lines, n = lineWidgets.length
  for (var i = 0; i < n; i++) {
    var txt = i < lines.length ? decodeEntities(lines[i] || '') : ''
    try { lineWidgets[i].setProperty(prop.TEXT, txt) } catch (e) {}
  }
  updateMeta()
  refreshProgressBar()
  schedulePreload(350)
}
function refreshDisplay() { drawPage() }

// 预读只保留一个待执行任务，翻页/改设置时先取消旧任务。
function schedulePreload(delay) {
  if (_preloadTimer) { clearTimeout(_preloadTimer); _preloadTimer = null }
  var token = ++_preloadToken
  var expectedStart = curStart
  var expectedEnd = curInfo ? curInfo.end : -1
  var expectedSize = FONT_SIZES[fontIdx]
  var expectedSpacing = spacingIdx
  _preloadTimer = setTimeout(function () {
    _preloadTimer = null
    if (token !== _preloadToken || curStart !== expectedStart || !curInfo || curInfo.end !== expectedEnd || FONT_SIZES[fontIdx] !== expectedSize || spacingIdx !== expectedSpacing) return
    preloadNext()
  }, delay || 350)
}

// 预读下一页：当前页渲染完成后异步缓存下一页数据，下次翻页即时显示
function preloadNext() {
  if (!source || !curInfo || curInfo.eof) { _nextPageCache = null; return }
  try { _nextPageCache = renderPage(curInfo.end, cfgNow()) } catch (e) { _nextPageCache = null }
}
// 用缓存渲染（跳过 readSync，直接填充 text）
function drawPageFromCache(cache) {
  if (!cache) return
  var cfg = cfgNow()
  if (lineWidgets.length === 0 || poolLh !== cfg.lh || poolSize !== cfg.size) buildPageWidgets(cfg)
  curInfo = cache
  curStart = cache.start
  var lines = cache.lines, n = lineWidgets.length
  for (var i = 0; i < n; i++) {
    var txt = i < lines.length ? decodeEntities(lines[i] || '') : ''
    try { lineWidgets[i].setProperty(prop.TEXT, txt) } catch (e) {}
  }
  updateMeta()
  refreshProgressBar()
}
// 使预读缓存失效（字号/行距/跳页变化时调用）
function invalidateCache() {
  _preloadToken++
  if (_preloadTimer) { clearTimeout(_preloadTimer); _preloadTimer = null }
  _nextPageCache = null
  _prevPageCache = null
}

function saveProgress() {
  try {
    var all = {}
    try { all = JSON.parse(localStorage.getItem('reading_progress', '{}')) } catch (e) {}
    all[String(bookId)] = {
      offset: curStart,
      page: displayPage(),
      total: estTotal,
      percent: percent(),
      fontSize: FONT_SIZES[fontIdx],
      spacingIdx: spacingIdx,
      brightVal: brightVal,
      themeIdx: themeIdx,
      autoIdx: autoIdx,
      scrollMode: scrollMode,
      ts: Date.now()
    }
    localStorage.setItem('reading_progress', JSON.stringify(all))
  } catch (e) {}
}

function loadProgress(bid) {
  try {
    var all = JSON.parse(localStorage.getItem('reading_progress', '{}'))
    return all[String(bid)] || null
  } catch (e) { return null }
}

// 从 reading_progress 恢复阅读设置：build() 首载与 onShow() 从样式页返回共用，
// 避免两份重复的“逐项赋值 + 变更检测”。返回 true 表示有设置发生实质变化。
function applySavedConfig(saved) {
  var changed = false
  if (!saved) return changed
  if (saved.fontSize) {
    for (var i = 0; i < FONT_SIZES.length; i++) {
      if (FONT_SIZES[i] === saved.fontSize && fontIdx !== i) { fontIdx = i; changed = true }
    }
  }
  if (saved.spacingIdx !== undefined && saved.spacingIdx >= 0 && saved.spacingIdx < SPACINGS.length && spacingIdx !== saved.spacingIdx) { spacingIdx = saved.spacingIdx; changed = true }
  if (saved.brightVal !== undefined && (saved.brightVal === -1 || (saved.brightVal >= 5 && saved.brightVal <= 100)) && brightVal !== saved.brightVal) { brightVal = saved.brightVal; changed = true }
  if (saved.themeIdx !== undefined && saved.themeIdx >= 0 && saved.themeIdx < THEMES.length && themeIdx !== saved.themeIdx) { themeIdx = saved.themeIdx; changed = true }
  if (saved.autoIdx !== undefined && saved.autoIdx >= 0 && saved.autoIdx < AUTO_SECS.length && autoIdx !== saved.autoIdx) { autoIdx = saved.autoIdx; changed = true }
  return changed
}

function anyPanel() { return jump.active || menu.active || bm.active }
// animFadeGroup 已统一到 utils/ui.js
// 翻页频繁，进度写入做防抖（1s 合并一次），省电；离开/熄屏前会即时落盘
var saveTimer = null
function saveProgressSoon() {
  if (saveTimer) return
  saveTimer = setTimeout(function () { saveTimer = null; saveProgress() }, 1000)
}

function goNext() {
  if (anyPanel()) return
  if (curInfo && curInfo.eof) return
  if (_preloadTimer) { clearTimeout(_preloadTimer); _preloadTimer = null }
  var fromOffset = curStart
  _scrollStack = []            // 翻页/触摸导航时清空滚动栈
  backStack.push(curStart)
  if (backStack.length > 5000) backStack.shift()
  // 使用预读缓存：如果缓存命中，跳过 readSync，零延迟翻页
  if (_nextPageCache && curInfo && _nextPageCache.start === curInfo.end) {
    _prevPageCache = curInfo
    drawPageFromCache(_nextPageCache)
    schedulePreload(350)
  } else {
    curStart = curInfo ? curInfo.end : curStart
    _prevPageCache = curInfo
    refreshDisplay()
  }
  noteForwardProgress(fromOffset)
  saveProgressSoon()
}

function goPrev() {
  _scrollStack = []            // 翻页/触摸导航时清空滚动栈
  var target = backStack.length > 0 ? backStack.pop() : null
  if (target === null) {
    if (curStart <= 0) return
    target = snapToLineStart(curStart - bpp)
  }
  curStart = target
  // 上一页通常就是刚刚离开的页面，直接使用缓存，避免同步读取。
  if (_prevPageCache && _prevPageCache.start === target) {
    drawPageFromCache(_prevPageCache)
    _prevPageCache = null
    schedulePreload(350)
  } else {
    refreshDisplay()
  }
  saveProgressSoon()
}

// ── 逐行无缝滚动 ──
// 返回 start 后第一行结束（下一行起点）的精确字节偏移
function lineEndOffset(start, cfg) {
  var lim = pageLimits(cfg)
  var pos = start, lineLen = 0
  while (pos < source.size) {
    var got = readBytesAt(pos, STEP)
    if (got.len <= 0) break
    var bytes = got.bytes, len = got.len
    var atEOF = (pos + len >= source.size)
    var i = 0, done = false
    while (i < len) {
      var b = bytes[i]
      var blen = cpByteLen(b)
      if (i + blen > len) { if (atEOF) { i = len } ; break }
      var cp = decodeUtf8CodePoint(bytes, i, blen)
      i += blen
      if (cp === 0x0D) continue
      if (cp === 0x0A) { done = true; break }
      lineLen++
      if (lineLen >= lim.cpl) { done = true; break }
    }
    pos += i
    if (done) break
  }
  return pos
}
function scrollDown() {
  if (anyPanel()) return
  if (curInfo && curInfo.eof) return
  var pos = curStart
  var ne = lineEndOffset(pos, cfgNow())
  if (ne > pos && ne < source.size) pos = ne
  if (pos <= curStart) return
  _scrollStack.push(curStart)   // 记录当前位置，scrollUp 时精确回退
  curStart = pos
  refreshDisplay()
  saveProgressSoon()
}
function scrollUp() {
  if (anyPanel()) return
  if (curStart <= 0) return
  if (_scrollStack.length > 0) {
    // 精确回退：从位置栈取出之前记录的行起始位置
    curStart = _scrollStack.pop()
    refreshDisplay()
    saveProgressSoon()
    return
  }
  // 栈空时（未向下滚动就直接向上滚）用估算回退
  var lim = pageLimits(cfgNow())
  var oneLine = Math.max(2, Math.round(bpp / lim.maxLines))
  curStart = snapToLineStart(Math.max(0, curStart - oneLine))
  refreshDisplay()
  saveProgressSoon()
}
function toggleScroll() {
  scrollMode = !scrollMode
  _scrollStack = []           // 切回翻页模式后滚动栈失效
  if (menu.scrollText) { try { menu.scrollText.setProperty(prop.TEXT, getText('readerScrollMode') + (scrollMode ? getText('readerScrollOn') : getText('readerScrollOff'))) } catch (e) {} }
  saveProgress()
}
function toggleFullscreen() {
  fullscreen = !fullscreen
  var alpha = fullscreen ? 0 : 255
  try { if (topPctWidget) topPctWidget.setProperty(prop.MORE, { alpha: alpha }) } catch (e) {}
  try { if (pageNumWidget) pageNumWidget.setProperty(prop.MORE, { alpha: alpha }) } catch (e) {}
  try { if (_progBgWidget) _progBgWidget.setProperty(prop.MORE, { alpha: alpha }) } catch (e) {}
  try { if (readProgressWidget) readProgressWidget.setProperty(prop.MORE, { alpha: alpha }) } catch (e) {}
  toast(fullscreen ? getText('readerFullscreenOn') : getText('readerFullscreenOff'))
}

function relayout() {
  curStart = snapToLineStart(curStart)   // 仍是行首
  backStack = []
  _scrollStack = []                      // 字号/行距变化，滚动栈失效
  invalidateCache()                      // 字号/行距变化，旧缓存失效
  estimateLayout(cfgNow())
  drawPage()                              // 逐行重绘（会重建正文+触摸层）
  saveProgress()
  if (menu.active) { menu.active = false; destroyMenuPool(); openMenu() }   // 正文重建后重升菜单到最上层
}

function changeFont(delta) {
  var ni = fontIdx + delta
  if (ni < 0) ni = 0
  if (ni > FONT_SIZES.length - 1) ni = FONT_SIZES.length - 1   // 到顶/到底不循环
  if (ni === fontIdx) return
  fontIdx = ni
  relayout()
}

function changeSpacing(delta) {
  var ni = spacingIdx + delta
  if (ni < 0) ni = 0
  if (ni > SPACINGS.length - 1) ni = SPACINGS.length - 1
  if (ni === spacingIdx) return
  spacingIdx = ni
  relayout()
}

function changeBright(delta) {
  if (brightVal < 0) {
    brightVal = delta > 0 ? 5 : 100
  } else {
    brightVal += delta * 5
    if (brightVal > 100) brightVal = -1
    if (brightVal < 0) brightVal = -1
  }
  applyBrightness()
  if (menu.brightText) { try { menu.brightText.setProperty(prop.TEXT, brightVal < 0 ? getText('readerBrightnessSystem') : brightVal + '%') } catch (e) {} }
  saveProgress()
}

function changeTheme(delta) {
  themeIdx = (themeIdx + delta + THEMES.length) % THEMES.length
  applyChromeColors()
  poolLh = 0          // 强制重建行控件池以换正文色
  drawPage()
  saveProgress()
  if (menu.active) { menu.active = false; destroyMenuPool(); openMenu() }   // 正文重建后重升菜单到最上层
}

// ── 自动翻页 ──
function updateAutoCountdown() {
  if (autoIdx <= 0 || !autoCountdownWidget) return
  var elapsed = Math.floor((Date.now() - autoCountdownStart) / 1000)
  var total = AUTO_SECS[autoIdx]
  var remain = Math.max(0, total - (elapsed % total))
  try { autoCountdownWidget.setProperty(prop.TEXT, remain + 's') } catch (e) {}
}
function showAutoCountdown() {
  if (autoCountdownWidget) return
  autoCountdownWidget = createWidget(widget.TEXT, {
    x: Math.round((W + BAR_W) / 2) + 8, y: BAR_Y - 8, w: 40, h: 16,
    text: '', text_size: 11, color: theme().sub, align_h: align.LEFT
  })
}
function hideAutoCountdown() {
  if (autoCountdownWidget) { try { deleteWidget(autoCountdownWidget) } catch (e) {} autoCountdownWidget = null }
  if (autoCountdownTimer) { clearInterval(autoCountdownTimer); autoCountdownTimer = null }
}
function stopAuto() {
  if (autoTimer) { clearTimeout(autoTimer); autoTimer = null }
  hideAutoCountdown()
}
function startAuto() {
  stopAuto()
  var secs = AUTO_SECS[autoIdx]
  if (secs <= 0) return
  showAutoCountdown()
  autoCountdownStart = Date.now()
  updateAutoCountdown()
  autoCountdownTimer = setInterval(updateAutoCountdown, 1000)
  autoTimer = setTimeout(function loop() {
    if (anyPanel()) { autoTimer = setTimeout(loop, 1500); return }
    if (curInfo && curInfo.eof) { autoIdx = 0; stopAuto(); return }
    goNext()
    autoCountdownStart = Date.now()
    autoTimer = setTimeout(loop, AUTO_SECS[autoIdx] * 1000)
  }, secs * 1000)
}
function changeAuto(delta) {
  autoIdx = (autoIdx + delta + AUTO_SECS.length) % AUTO_SECS.length
  startAuto()
  if (menu.autoText) { try { menu.autoText.setProperty(prop.TEXT, AUTO_LABELS[autoIdx]) } catch (e) {} }
  if (menu.autoBtnTxt) { try { menu.autoBtnTxt.set(getText(AUTO_LABELS[autoIdx])) } catch (e) {} }
  saveProgress()
}

// 屏幕常亮：定时重置熄屏计时器
function startKeepAwake() {
  stopKeepAwake()
  if (!keepAwake) return
  keepAwakeTimer = setInterval(function () {
    try { setWakeUpRelaunch({ relaunch: true }) } catch (e) {}
  }, 10000)
}
function stopKeepAwake() {
  if (keepAwakeTimer) { clearInterval(keepAwakeTimer); keepAwakeTimer = null }
}
function toggleKeepAwake() {
  keepAwake = !keepAwake
  if (keepAwake) startKeepAwake()
  else stopKeepAwake()
  saveProgress()
}

// ── 轻量提示 ──
var toastWidgets = [], toastTimer = null
function toast(text) {
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null }
  for (var i = 0; i < toastWidgets.length; i++) { try { deleteWidget(toastWidgets[i]) } catch (e) {} }
  toastWidgets = []
  // 直接显示，不做淡入淡出动画（本设备定时器回调不可靠，动画会卡在中间态）
  toastWidgets.push(createWidget(widget.FILL_RECT, { x: 110, y: 204, w: 260, h: 62, radius: 20, color: C.cardAlt }))
  toastWidgets.push(createWidget(widget.TEXT, { x: 124, y: 204, w: 232, h: 62, text: text, text_size: M.tsRow, color: C.text, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  var shownWidgets = toastWidgets
  toastTimer = setTimeout(function () {
    for (var j = 0; j < shownWidgets.length; j++) { try { deleteWidget(shownWidgets[j]) } catch (e) {} }
    if (toastWidgets === shownWidgets) toastWidgets = []
    toastTimer = null
  }, 900)
}

// ── 书签 ──
function loadBookmarks() {
  try {
    var all = JSON.parse(localStorage.getItem('bookmarks', '{}'))
    return all && typeof all === 'object' && !Array.isArray(all) ? all : {}
  } catch (e) { return {} }
}
function bookmarksOf() {
  var all = loadBookmarks()
  var list = all[String(bookId)]
  return Array.isArray(list) ? list : []
}
function saveBookmarks(list) { var all = loadBookmarks(); all[String(bookId)] = list; try { localStorage.setItem('bookmarks', JSON.stringify(all)) } catch (e) {} }
function addBookmark() {
  var list = bookmarksOf()
  for (var i = 0; i < list.length; i++) if (Math.abs(list[i].offset - curStart) < 4) { toast(getText('readerBookmarkExists')); return }
  list.push({ offset: curStart, page: displayPage(), pct: percent(), ts: Date.now() })
  if (list.length > 50) list.shift()
  saveBookmarks(list)
  toast(getText('readerBookmarkAdded'))
}

var bm = { active: false, staticWidgets: [], rowWidgets: [], page: 0 }
var BM_PER_PAGE = 4          // 行高加大后每页 4 行（表冠可翻页）
function closeBookmarks() {
  for (var i = 0; i < bm.staticWidgets.length; i++) { try { deleteWidget(bm.staticWidgets[i]) } catch (e) {} }
  for (var i = 0; i < bm.rowWidgets.length; i++) { try { deleteWidget(bm.rowWidgets[i]) } catch (e) {} }
  bm.staticWidgets = []; bm.rowWidgets = []; bm.active = false; bm.page = 0; bm._lastRender = 0
  // 二级菜单返回一级菜单
  if (_backToMenu) { _backToMenu = false; openMenu() }
}
function renderBookmarkPage() {
  // 节流：避免表冠快速旋转时频繁重建控件
  var now = Date.now()
  if (bm._lastRender && now - bm._lastRender < 200) return
  bm._lastRender = now

  for (var i = 0; i < bm.rowWidgets.length; i++) { try { deleteWidget(bm.rowWidgets[i]) } catch (e) {} }
  bm.rowWidgets = []

  var list = bookmarksOf()
  var totalPages = Math.max(1, Math.ceil(list.length / BM_PER_PAGE))
  if (bm.page >= totalPages) bm.page = totalPages - 1
  if (bm.page < 0) bm.page = 0

  // 独立胶囊行，行高 54（大点击区），每页 4 行；宽度按圆屏可用宽自适应
  var startY = 104, rowH = 54, rowGap = 8
  var start = bm.page * BM_PER_PAGE
  var end = Math.min(list.length, start + BM_PER_PAGE)
  var n = end - start

  for (var i = 0; i < n; i++) {
    var it = list[list.length - 1 - start - i]
    var y = startY + i * (rowH + rowGap)
    var bw = Math.min(352, rowW(y, rowH))
    var bx = Math.round((W - bw) / 2)
    var lx = bx + M.padX, rx = bx + bw - M.padX
    bm.rowWidgets.push(createWidget(widget.FILL_RECT, { x: bx, y: y, w: bw, h: rowH, radius: Math.round(rowH / 2), color: C.card }))
    bm.rowWidgets.push(createWidget(widget.TEXT, { x: lx, y: y, w: 150, h: rowH, text: getText('readerPage') + it.page, text_size: M.tsRow, color: C.text, align_v: align.CENTER_V }))
    bm.rowWidgets.push(createWidget(widget.TEXT, { x: rx - 84, y: y, w: 48, h: rowH, text: it.pct + '%', text_size: M.tsVal, color: C.accent, align_h: align.RIGHT, align_v: align.CENTER_V }))
    var jt = createWidget(widget.FILL_RECT, { x: bx, y: y, w: bw - 64, h: rowH, radius: Math.round(rowH / 2), color: 0x000000, alpha: 0 })
    // 点书签行 = 执行跳转，直接进入阅读（不再回菜单）
    jt.addEventListener(event.CLICK_DOWN, (function (off) { return function () { _backToMenu = false; closeBookmarks(); curStart = off; backStack = []; refreshDisplay(); saveProgress() } })(it.offset))
    bm.rowWidgets.push(jt)
    // 删除：暗红圆形 chip（直径 36，热区 54 全行）
    var chipD = 36, chipX = rx - chipD, chipY = y + Math.round((rowH - chipD) / 2)
    bm.rowWidgets.push(createWidget(widget.FILL_RECT, { x: chipX, y: chipY, w: chipD, h: chipD, radius: Math.round(chipD / 2), color: C.dangerBg }))
    bm.rowWidgets.push(createWidget(widget.TEXT, { x: chipX, y: chipY, w: chipD, h: chipD, text: '×', text_size: 20, color: C.danger, align_h: align.CENTER_H, align_v: align.CENTER_V }))
    var dt = createWidget(widget.FILL_RECT, { x: rx - 62, y: y, w: 62, h: rowH, radius: 27, color: 0x000000, alpha: 0 })
    dt.addEventListener(event.CLICK_DOWN, (function (ts) { return function () {
      var l = bookmarksOf(); var nl = []
      for (var k = 0; k < l.length; k++) if (l[k].ts !== ts) nl.push(l[k])
      saveBookmarks(nl); renderBookmarkPage()
    } })(it.ts))
    bm.rowWidgets.push(dt)
  }

  if (list.length === 0) bm.rowWidgets.push(createWidget(widget.TEXT, { x: 90, y: 210, w: 300, h: 24, text: getText('readerNoBookmarks'), text_size: M.tsVal, color: C.muted, align_h: align.CENTER_H }))

  if (totalPages > 1) {
    bm.rowWidgets.push(createWidget(widget.TEXT, { x: 150, y: 366, w: 180, h: 18, text: (bm.page + 1) + '/' + totalPages + '  ' + getText('readerCrownPaging'), text_size: M.tsMeta, color: C.muted, align_h: align.CENTER_H }))
  }
}

function openBookmarks() {
  if (bm.active) return
  bm.active = true; bm.staticWidgets = []; bm.rowWidgets = []; bm.page = 0

  // 整屏：背景 + 标题 + 琥珀胶囊添加按钮 + 卡片列表
  // 背景直接不透明显示：这台设备上“先置透明 + setTimeout 淡入”会卡在透明状态（打开不显示），
  // 所有面板一律同步显示，不做依赖定时器的淡入动画。
  var bg = createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: H, color: C.bg })
  bg.addEventListener(event.CLICK_DOWN, function () {})
  bm.staticWidgets.push(bg)
  bm.staticWidgets.push(createWidget(widget.TEXT, { x: 0, y: 22, w: W, h: 26, text: getText('readerBookmarks'), text_size: M.tsTitle, color: C.text, align_h: align.CENTER_H }))
  // 关闭：底部居中大圆钮（共用组件，直径 44）
  makeCloseButton(UIDEPS, function (w) { bm.staticWidgets.push(w) }, H - 56, function () { closeBookmarks() }, W)
  // 添加书签（琥珀胶囊）
  bm.staticWidgets.push(createWidget(widget.FILL_RECT, { x: 140, y: 52, w: 200, h: M.btnH, radius: Math.round(M.btnH / 2), color: C.accent }))
  bm.staticWidgets.push(createWidget(widget.TEXT, { x: 140, y: 52, w: 200, h: M.btnH, text: getText('readerAddBookmark'), text_size: M.tsRow, color: C.onAccent, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  var addT = createWidget(widget.FILL_RECT, { x: 136, y: 48, w: 208, h: M.btnH + 8, radius: Math.round(M.btnH / 2), color: 0x000000, alpha: 0 })
  addT.addEventListener(event.CLICK_DOWN, function () { addBookmark(); renderBookmarkPage() })
  bm.staticWidgets.push(addT)

  renderBookmarkPage()
}

// ── 菜单（底部页码点出）──
function closeMenu() {
  if (!menu.active) return
  menu.active = false
  if (_longPressTimer) { clearTimeout(_longPressTimer); _longPressTimer = null }  // 关闭菜单同时取消书签计时
  // 直接销毁（无池化、无动画）：每次 openMenu 重建，状态干净
  for (var i = 0; i < menu.widgets.length; i++) { try { deleteWidget(menu.widgets[i]) } catch (e) {} }
  menu.widgets = []
  menu._poolBuilt = false
}

// 销毁菜单池（用于 relayout/changeTheme 等需要重建正文控件的场景）
function destroyMenuPool() {
  for (var i = 0; i < menu.widgets.length; i++) { try { deleteWidget(menu.widgets[i]) } catch (e) {} }
  menu.widgets = []
  menu._poolBuilt = false
  menu.fontText = menu.spacingText = menu.brightText = menu.themeText = menu.autoText = menu.autoBtnTxt = menu.scrollText = menu.timerText = menu.remainText = null
  menu.awakeTxt = null
}

function mAdd(w) { menu.widgets.push(w); return w }

// ── 菜单几何：独立胶囊行（大按钮，支持分页）──
// 每行是一颗独立的圆角胶囊，宽度按所在 y 的圆屏可用宽度自适应（上限 352），
// 形成「中间宽、底部收窄」的桶形轮廓。行高 48 加大点击区；
// 内容分 2 页：页1 功能（三联开关/表冠/自动），页2 导航（书签/跳页/样式），表冠翻页。
var MROW = 48                       // 常规行高（加大点击区）
var MPITCH = 56                     // 行间距（行高 + 8）
var CROWN_H = 52                    // 表冠滑条行高（滑条更高更好拖）
var MCAP = M.maxW                   // 行宽上限（统一令牌）
var UIDEPS = { createWidget: createWidget, widget: widget, event: event, prop: prop }
var CONTENT_Y = 104                 // 内容区起始 y（头部下方）

function menuRowGeo(y, h) {
  var w = Math.min(MCAP, rowW(y, h))
  return { x: Math.round((W - w) / 2), w: w }
}

/**
 * 独立胶囊行：整行一颗胶囊，左标签 + 右控件。
 * type:
 *   'nav'   右侧 ›，整行可点
 *   'value' 右侧琥珀值文本，整行可点（循环切换）
 * 返回 value 行的 { set(text) } 控制器。
 */
function menuRow(y, label, type, opt) {
  var g = menuRowGeo(y, MROW)
  var lx = g.x + M.padX, rx = g.x + g.w - M.padX
  mAdd(createWidget(widget.FILL_RECT, { x: g.x, y: y, w: g.w, h: MROW, radius: Math.round(MROW / 2), color: C.card }))
  mAdd(createWidget(widget.TEXT, { x: lx, y: y, w: 160, h: MROW, text: label, text_size: M.tsRow, color: C.text, align_v: align.CENTER_V }))
  var ctrl = null
  if (type === 'nav') {
    mAdd(createWidget(widget.TEXT, { x: rx - 22, y: y, w: 22, h: MROW, text: '>', text_size: 22, color: C.muted, align_h: align.RIGHT, align_v: align.CENTER_V }))
  } else {
    var vt = mAdd(createWidget(widget.TEXT, { x: rx - 170, y: y, w: 170, h: MROW, text: opt.text(), text_size: M.tsVal, color: C.accent, align_h: align.RIGHT, align_v: align.CENTER_V }))
    ctrl = { set: function (t) { try { vt.setProperty(prop.TEXT, t) } catch (e) {} } }
  }
  var t = mAdd(createWidget(widget.FILL_RECT, { x: g.x, y: y, w: g.w, h: MROW, radius: Math.round(MROW / 2), color: 0x000000, alpha: 0 }))
  t.addEventListener(event.CLICK_DOWN, function () { opt.onClick() })
  return ctrl
}

/**
 * 三联开关 chip（全屏 / 滚动 / 常亮），48 高，点击区大。
 * 开启态 = 暖色底 + 琥珀图标文字，关闭态 = 深底 + 灰字。
 */
function menuToggleChips(y) {
  var g = menuRowGeo(y, MROW)
  var n = 3, gap = 8
  var cw = Math.floor((g.w - gap * (n - 1)) / n)
  var defs = [
    { label: getText('readerFullscreen'), get: function () { return fullscreen }, act: function () { return toggleFullscreen() } },
    { label: getText('readerScrollMode').trim(), get: function () { return scrollMode }, act: function () { return toggleScroll() } },
    { label: getText('readerKeepAwake'), get: function () { return keepAwake }, act: function () { return toggleKeepAwake() } }
  ]
  for (var i = 0; i < n; i++) {
    var x = g.x + i * (cw + gap)
    var on = defs[i].get()
    var bg = mAdd(createWidget(widget.FILL_RECT, { x: x, y: y, w: cw, h: MROW, radius: 16, color: on ? C.cardOn : C.card }))
    var tx = mAdd(createWidget(widget.TEXT, { x: x, y: y, w: cw, h: MROW, text: defs[i].label, text_size: M.tsRow, color: on ? C.accentSoft : C.sub, align_h: align.CENTER_H, align_v: align.CENTER_V }))
    var touch = mAdd(createWidget(widget.FILL_RECT, { x: x, y: y, w: cw, h: MROW, radius: 16, color: 0x000000, alpha: 0 }))
    touch.addEventListener(event.CLICK_DOWN, (function (d, bgW, txW) {
      return function () {
        d.act()
        var nowOn = d.get()
        try { bgW.setProperty(prop.MORE, { color: nowOn ? C.cardOn : C.card }) } catch (e) {}
        try { txW.setProperty(prop.MORE, { color: nowOn ? C.accentSoft : C.sub }) } catch (e) {}
      }
    })(defs[i], bg, tx))
  }
}

// 进度环：沿屏幕边缘画一圈 ARC。固件不支持 ARC 时降级为顶部细横条。
function menuProgressRing() {
  var pct = percent()
  if (widget.ARC !== undefined) {
    var ok = false
    try {
      mAdd(createWidget(widget.ARC, {
        x: 5, y: 5, w: W - 10, h: H - 10,
        start_angle: 0, end_angle: 360, line_width: 5, color: C.cardAlt
      }))
      var deg = Math.round(360 * pct / 100)
      if (deg < 4) deg = 4
      mAdd(createWidget(widget.ARC, {
        x: 5, y: 5, w: W - 10, h: H - 10,
        start_angle: 0, end_angle: deg, line_width: 5, color: C.accent
      }))
      ok = true
    } catch (e) {}
    if (ok) return
  }
  var bw = 200, bx = Math.round((W - bw) / 2), by = 22
  mAdd(createWidget(widget.FILL_RECT, { x: bx, y: by, w: bw, h: 4, radius: 2, color: C.cardAlt }))
  mAdd(createWidget(widget.FILL_RECT, { x: bx, y: by, w: Math.max(4, Math.round(bw * pct / 100)), h: 4, radius: 2, color: C.accent }))
}

// 页指示点：两个圆点，当前页琥珀。点击可直接跳页（热区 44×44）。
function menuPageDots() {
  var n = 2, d = 10, gap = 26
  var total = n * d + (n - 1) * gap
  var sx = Math.round((W - total) / 2), y = 288
  for (var p = 0; p < n; p++) {
    var dx = sx + p * (d + gap)
    var active = p === menu.page
    var dot = mAdd(createWidget(widget.FILL_RECT, { x: dx, y: y, w: active ? 16 : d, h: d, radius: 5, color: active ? C.accent : C.track }))
    mAdd(dot)
    var t = mAdd(createWidget(widget.FILL_RECT, { x: dx - 14, y: y - 14, w: d + 28, h: d + 28, radius: 21, color: 0x000000, alpha: 0 }))
    t.addEventListener(event.CLICK_DOWN, (function (pp) { return function () { menuSetPage(pp) } })(p))
  }
}

// 翻页：删除内容区控件（CONTENT_Y 之后创建的），按页重建。
var menuContentStart = 0
function menuBuildContent() {
  while (menu.widgets.length > menuContentStart) {
    var wd = menu.widgets.pop()
    try { deleteWidget(wd) } catch (e) {}
  }
  var y = CONTENT_Y
  if (menu.page === 0) {
    // 页1：三联开关 + 表冠灵敏度 + 自动翻页
    menuToggleChips(y)
    // 表冠行
    var g = menuRowGeo(y + MPITCH, CROWN_H)
    mAdd(createWidget(widget.FILL_RECT, { x: g.x, y: y + MPITCH, w: g.w, h: CROWN_H, radius: Math.round(CROWN_H / 2), color: C.card }))
    mAdd(createWidget(widget.TEXT, { x: g.x + M.padX, y: y + MPITCH, w: 80, h: CROWN_H, text: getText('readerCrown'), text_size: M.tsRow, color: C.text, align_v: align.CENTER_V }))
    var crownStepVal = 3
    try {
      var cv = parseInt(localStorage.getItem('crown_level') || '', 10)
      if (cv >= 1 && cv <= 5) crownStepVal = cv
      else {
        var co = parseInt(localStorage.getItem('crown_step') || '', 10)
        if (co >= 1 && co <= 3) crownStepVal = co
      }
    } catch (e) {}
    var crownValText = mAdd(createWidget(widget.TEXT, { x: g.x + g.w - M.padX - 28, y: y + MPITCH, w: 28, h: CROWN_H, text: String(crownStepVal), text_size: M.tsVal, color: C.accent, align_h: align.RIGHT, align_v: align.CENTER_V }))
    var slX = g.x + M.padX + 88
    var slW = (g.x + g.w - M.padX - 38) - slX
    makeSlider(UIDEPS, mAdd, slX, y + MPITCH + Math.round((CROWN_H - M.sliderKnob) / 2), slW, 1, 5, crownStepVal,
      function (v) { try { crownValText.setProperty(prop.TEXT, String(v)) } catch (e) {} },
      function (v) { try { localStorage.setItem('crown_level', String(v)) } catch (e) {} }
    )
    menu.autoBtnTxt = menuRow(y + MPITCH * 2, getText('readerAuto'), 'value', { text: function () { return getText(AUTO_LABELS[autoIdx]) }, onClick: function () { changeAuto(1) } })
  } else {
    // 页2：导航（书签 / 跳页 / 样式）
    menuRow(y, getText('readerBookmarks'), 'nav', { onClick: function () { _backToMenu = true; closeMenu(); openBookmarks() } })
    menuRow(y + MPITCH, getText('readerJump'), 'nav', { onClick: function () { _backToMenu = true; closeMenu(); openJumpPanel() } })
    menuRow(y + MPITCH * 2, getText('readerStyle'), 'nav', { onClick: function () { _backToMenu = true; closeMenu(); openStylePage() } })
  }
}

function menuSetPage(p) {
  if (p < 0 || p > 1 || p === menu.page) return
  menu.page = p
  // 删除旧内容与旧页点（menuContentStart 之后全部），再重建新页内容 + 页点
  while (menu.widgets.length > menuContentStart) {
    var wd = menu.widgets.pop()
    try { deleteWidget(wd) } catch (e) {}
  }
  menuBuildContent()
  menuPageDots()
}

function openMenu() {
  if (menu.active || jump.active || bm.active) return
  menu.active = true

  menu.widgets = []
  menu.page = 0

  mAdd(createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: H, color: C.bg }))
  var closeBg = mAdd(createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: H, color: 0x000000, alpha: 0 }))
  closeBg.addEventListener(event.CLICK_DOWN, function () { closeMenu() })

  // 边缘进度环（替代原来那条挤在文字里的百分比）
  menuProgressRing()

  // 头部：大号百分比作为视觉锚点，页码/时间做次要行
  mAdd(createWidget(widget.TEXT, { x: 90, y: 26, w: W - 180, h: 36, text: percent() + '%', text_size: 32, color: C.accent, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  mAdd(createWidget(widget.TEXT, { x: 60, y: 62, w: W - 120, h: 18, text: displayPage() + ' / ~' + estTotal + '   ' + nowHHMM(), text_size: M.tsMeta, color: C.sub, align_h: align.CENTER_H }))
  menu.timerText = mAdd(createWidget(widget.TEXT, { x: 60, y: 80, w: W - 120, h: 16, text: getText('readerSessionTime') + fmtMin(currentReadSec() - baseReadSec) + ' · ' + getText('readerTotalTime') + fmtMin(currentReadSec()), text_size: M.tsMeta, color: C.muted, align_h: align.CENTER_H }))

  menuContentStart = menu.widgets.length
  menuBuildContent()

  // 页指示点（在内容区与关闭钮之间）
  menuPageDots()

  // 关闭按钮：底部居中大圆钮（共用组件，直径 44）
  makeCloseButton(UIDEPS, mAdd, H - 52, function () { closeMenu() }, W)

  menu._poolBuilt = false
}
// 表冠灵敏度：菜单滑动条写入 crown_level（1~5 级），返回每页累计角度阈值。
// 兼容旧版 crown_step（1~3）直接映射为 1~3 级。默认 3 级 = 60°。
function effectiveCrownStep() {
  try {
    var v = parseInt(localStorage.getItem('crown_level') || '', 10)
    if (v >= 1 && v <= 5) return CROWN_LEVELS[v - 1]
    var old = parseInt(localStorage.getItem('crown_step') || '', 10)
    if (old >= 1 && old <= 3) return CROWN_LEVELS[old - 1]
  } catch (e) {}
  return CROWN_LEVELS[2]
}

// 打开阅读样式页（独立页面，非弹窗）。样式页返回（onShow）后重新打开主菜单。
function openStylePage() {
  try { push({ url: 'page/style', params: JSON.stringify({ bookId: String(bookId) }) }) } catch (e) {}
}

// ── 跳页数字键盘 ──
function closeJumpPanel() {
  if (!jump.active) return
  jump.active = false
  jump.input = ''
  // 直接销毁（无池化、无动画）：每次 openJumpPanel 重建，状态干净。
  // 池化淡出后透明 touch 层仍留在屏幕上拦截点击，
  // 会导致跳完页后“卡住”（点击无响应）或误触发跳页（点到隐藏数字键）。
  destroyJumpPool()
}

// 销毁跳页池（用于 onDestroy 等需要彻底清理的场景）
function destroyJumpPool() {
  for (var i = 0; i < jump.widgets.length; i++) { try { deleteWidget(jump.widgets[i]) } catch (e) {} }
  jump.widgets = []
  jump._poolBuilt = false
  jump.dispText = null
  jump.modeText = null
}

function updateJumpDisplay() {
  if (jump.dispText) { try { jump.dispText.setProperty(prop.TEXT, jump.input || '—') } catch (e) {} }
}

function addJumpDigit(d) { if (jump.input.length < 6) { jump.input += d; updateJumpDisplay() } }
function jumpBackspace() { if (jump.input.length > 0) { jump.input = jump.input.slice(0, -1); updateJumpDisplay() } }

function jumpModeLabel() { return jump.mode === 'percent' ? getText('readerJumpModePercent') : getText('readerJumpModePage') }
function jumpConfirm() {
  var val = parseInt(jump.input) || 1
  var target
  if (jump.mode === 'percent') {
    if (val < 1) val = 1
    if (val > 100) val = 100
    target = Math.floor(source.size * val / 100)
  } else {
    if (val < 1) val = 1
    if (val > estTotal) val = estTotal
    target = (val - 1) * bpp
  }
  _backToMenu = false   // 跳页确认 = 执行动作，直接进入阅读
  closeJumpPanel()
  if (target > source.size - 1) target = Math.max(0, source.size - 1)
  curStart = snapToLineStart(target)
  backStack = []
  invalidateCache()
  refreshDisplay()
  saveProgress()
}

function jAdd(w) { jump.widgets.push(w); return w }

function openJumpPanel() {
  if (jump.active) return
  // 防御：清理任何残留控件（正常关闭会销毁，但保险起见）
  if (jump.widgets.length > 0) destroyJumpPool()
  jump.active = true
  jump.input = ''
  jump.mode = 'page'
  jump.widgets = []

  // 整屏键盘：3 列 × 4 行、键 76×60（M.keyW/keyH，大点击区），全部落在圆屏安全区内。
  jAdd(createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: H, color: C.bg }))

  // 顶部：模式标签（可点切换）+ 大号输入值 + 右上关闭
  var modeTitle = jAdd(createWidget(widget.TEXT, {
    x: 120, y: 34, w: 240, h: 20, text: '', text_size: M.tsMeta, color: C.sub, align_h: align.CENTER_H, align_v: align.CENTER_V
  }))
  jump.modeText = modeTitle
  jump.dispText = jAdd(createWidget(widget.TEXT, {
    x: 120, y: 54, w: 240, h: 36, text: '—', text_size: 30, color: C.accent,
    align_h: align.CENTER_H, align_v: align.CENTER_V
  }))
  // 模式切换 chip
  var chipW = 132, chipX = Math.round((W - chipW) / 2), chipY = 94
  jAdd(createWidget(widget.FILL_RECT, { x: chipX, y: chipY, w: chipW, h: M.chipH, radius: Math.round(M.chipH / 2), color: C.cardAlt }))
  var chipTxt = jAdd(createWidget(widget.TEXT, { x: chipX, y: chipY, w: chipW, h: M.chipH, text: '', text_size: M.tsVal, color: C.accentSoft, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  var modeTouch = jAdd(createWidget(widget.FILL_RECT, { x: chipX - 8, y: chipY - 6, w: chipW + 16, h: M.chipH + 12, radius: Math.round(M.chipH / 2), color: 0x000000, alpha: 0 }))
  function paintMode() {
    var isPct = jump.mode === 'percent'
    try { modeTitle.setProperty(prop.TEXT, isPct ? getText('readerJumpPercentRange') : getText('readerJumpPageRangePrefix') + estTotal + getText('readerJumpPageRangeSuffix')) } catch (e) {}
    try { chipTxt.setProperty(prop.TEXT, jumpModeLabel()) } catch (e) {}
  }
  modeTouch.addEventListener(event.CLICK_DOWN, function () {
    jump.mode = jump.mode === 'page' ? 'percent' : 'page'
    jump.input = ''
    updateJumpDisplay()
    paintMode()
  })

  // 关闭：键盘下方居中大圆钮（共用组件，直径 44）
  makeCloseButton(UIDEPS, jAdd, H - 58, closeJumpPanel, W)

  // 键盘：3×4，键 76×60，gap 8；整体居中（126 → 384，全在圆屏内）
  var kW = M.keyW, kH = M.keyH, kGap = M.keyGap
  var gridW = 3 * kW + 2 * kGap
  var gx = Math.round((W - gridW) / 2), gy = 126
  // ⌫ 字形在手表字体里是方框，退格键用 DEL 文本
  var btns = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['DEL', '0', 'OK']]
  for (var row = 0; row < 4; row++) {
    for (var col = 0; col < 3; col++) {
      var label = btns[row][col]
      var bx = gx + col * (kW + kGap)
      var by = gy + row * (kH + kGap)
      var isOK = label === 'OK', isDel = label === 'DEL'
      var bgCol = isOK ? C.accent : (isDel ? C.dangerBg : C.cardAlt)
      var fgCol = isOK ? C.onAccent : (isDel ? C.danger : C.text)
      jAdd(createWidget(widget.FILL_RECT, { x: bx, y: by, w: kW, h: kH, radius: 20, color: bgCol }))
      jAdd(createWidget(widget.TEXT, {
        x: bx, y: by, w: kW, h: kH, text: label, text_size: isOK ? 19 : (isDel ? 17 : 24), color: fgCol,
        align_h: align.CENTER_H, align_v: align.CENTER_V
      }))
      var touch = jAdd(createWidget(widget.FILL_RECT, { x: bx, y: by, w: kW, h: kH, radius: 20, color: 0x000000, alpha: 0 }))
      if (isOK) touch.addEventListener(event.CLICK_DOWN, jumpConfirm)
      else if (isDel) touch.addEventListener(event.CLICK_DOWN, function () { jumpBackspace() })
      else touch.addEventListener(event.CLICK_DOWN, (function (d) { return function () { addJumpDigit(d) } })(label))
    }
  }

  paintMode()
  updateJumpDisplay()
}

function parseParams(params) {
  if (!params) return {}
  try { return JSON.parse(params) } catch (e) { return {} }
}

function findBook() {
  if (isDownloaded) {
    var dlBooks = []
    try { dlBooks = JSON.parse(localStorage.getItem('dl_books', '[]')) } catch (e) {}
    if (!Array.isArray(dlBooks)) dlBooks = []
    for (var i = 0; i < dlBooks.length; i++) {
      if (String(dlBooks[i].id) === String(bookId)) return dlBooks[i]
    }
    return null
  }
  var idx = parseInt(bookId) || 0
  if (idx < 0 || idx >= LIBRARY.length) idx = 0
  return LIBRARY[idx]
}

function defaultFontIdx() {
  for (var i = 0; i < FONT_SIZES.length; i++) if (FONT_SIZES[i] === 21) return i
  return Math.floor(FONT_SIZES.length / 2)
}

Page({
  onInit(params) {
    var p = parseParams(params)
    if (p.bookId !== undefined && p.bookId !== null && p.bookId !== '') {
      bookId = p.bookId
      isDownloaded = (p.downloaded === '1')
    } else {
      // 熄屏重启回到本页时 params 可能丢失，用持久化兜底
      try {
        var r = JSON.parse(localStorage.getItem('_reading', 'null'))
        if (r) { bookId = r.bookId; isDownloaded = !!r.downloaded }
      } catch (e) {}
    }
    fontIdx = defaultFontIdx()
  },

  onShow() {
    // 从阅读样式页返回：重新应用字号/行距/亮度/主题设置
    var changed = applySavedConfig(loadProgress(bookId))
    if (changed) {
      try { setBrightness({ brightness: brightVal < 0 ? savedBrightness : brightVal }) } catch (e) {}
      applyChromeColors()
      relayout()
      startAuto()
    }
    // 从样式页返回：重新打开主菜单（二级菜单返回一级菜单）
    if (_backToMenu) {
      _backToMenu = false
      openMenu()
    }
  },

  onDestroy() {
    stopClock()
    stopAuto()
    stopKeepAwake()
    if (_preloadTimer) { clearTimeout(_preloadTimer); _preloadTimer = null }
    _preloadToken++
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
    // 异步落盘，避免阻塞页面切换动画
    setTimeout(function () {
      saveProgress()
      flushReadTime()
      try { if (savedBrightness >= 0) setBrightness({ brightness: savedBrightness }) } catch (e) {}
    }, 0)
    try { setWakeUpRelaunch({ relaunch: false }) } catch (e) {}  // 离开阅读页恢复正常熄屏行为
    // 只清理可能处于打开状态的模态面板；正文行控件由系统自动回收
    if (jump.active) { jump.active = false; destroyJumpPool() }
    if (menu.active) { menu.active = false; destroyMenuPool() }
    _backToMenu = false
    if (bm.active) {
      for (var bi = 0; bi < bm.staticWidgets.length; bi++) { try { deleteWidget(bm.staticWidgets[bi]) } catch (e) {} }
      for (var br = 0; br < bm.rowWidgets.length; br++) { try { deleteWidget(bm.rowWidgets[br]) } catch (e) {} }
      bm.active = false; bm.staticWidgets = []; bm.rowWidgets = []
    }
    clearLoading()
    closeBookSource()
    try { offDigitalCrown() } catch (e) {}
    try { offKey() } catch (e) {}
  },

  build() {
    computeLayout()   // 适配屏幕尺寸
    showLoading()
    book = findBook()
    if (!book) {
      clearLoading()
      createWidget(widget.TEXT, { x: READ_X, y: READ_Y, w: READ_W, h: 60, text: getText('readerBookDeleted'), text_size: 16, color: UI_DANGER, align_h: align.CENTER_H, align_v: align.CENTER_V })
      try { localStorage.removeItem('_reading') } catch (e) {}
      return
    }
    source = openBookSource(book.file)

    // 记录当前在读，配合熄屏重启回到本书
    try { localStorage.setItem('_reading', JSON.stringify({ bookId: bookId, downloaded: isDownloaded })) } catch (e) {}
    try { setWakeUpRelaunch({ relaunch: true }) } catch (e) {}

    var saved = loadProgress(bookId)
    applySavedConfig(saved)
    scrollMode = !!(saved && saved.scrollMode)
    curStart = saved && saved.offset ? saved.offset : 0
    backStack = []
    lastBatt = -1; charging = false

    // 亮度：记住原值，离开时恢复
    try { var gb = getBrightness(); savedBrightness = (gb && gb.brightness !== undefined) ? gb.brightness : gb } catch (e) {}
    applyBrightness()

    if (source && curStart >= source.size) curStart = 0
    baseReadSec = loadReadTime(bookId)
    sessionStart = Date.now()
    _lastFlushTs = sessionStart
    resetSpeedTracking()
    var cfg = cfgNow()
    var th = theme()
    bgRect = createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: H, color: th.bg })

    topPctWidget = createWidget(widget.TEXT, {
      x: Math.round((W - 180) / 2), y: TOP_PCT_Y, w: 180, h: 20, text: '', text_size: 13, color: th.sub, align_h: align.CENTER_H
    })

    pageNumWidget = createWidget(widget.TEXT, {
      x: Math.round((W - 200) / 2), y: META_Y, w: 200, h: 22, text: '...', text_size: 15, color: th.sub, align_h: align.CENTER_H
    })
    buildProgressBar()

    // 底部页码点出菜单（建在正文之前；翻页时正文/触摸层会重建在其上方，
    // 但 metaTap 主体在正文区下方，互不影响）
    var metaTap = createWidget(widget.FILL_RECT, { x: Math.round((W - 260) / 2), y: META_Y - 4, w: 260, h: 36, color: 0x000000, alpha: 0 })
    metaTap.addEventListener(event.CLICK_DOWN, function () {
      openMenu()
    })

    if (source) {
      estimateLayout(cfg)
      drawPage()             // 逐行渲染正文 + 翻页触摸层
      clearLoading()
      saveProgress()
    } else {
      clearLoading()
      createWidget(widget.TEXT, {
        x: READ_X, y: READ_Y, w: READ_W, h: 60, text: getText('readerReadFailedFile') + book.file + ')',
        text_size: 16, color: UI_DANGER, align_h: align.LEFT, align_v: align.TOP
      })
      return
    }
    startClock()
    startAuto()
    if (keepAwake) startKeepAwake()

    registerMainCrown()
  }
})

// 阅读页只注册一次表冠与方向键监听：书签面板通过状态分发，不重复注册回调。
function handleNavigation(direction) {
  if (!direction) return
  if (bm.active) {
    if (direction > 0) bm.page--; else bm.page++
    renderBookmarkPage()
    return
  }
  if (anyPanel()) return
  if (scrollMode) { if (direction > 0) scrollUp(); else scrollDown() }
  else { if (direction > 0) goPrev(); else goNext() }
}

function registerMainCrown() {
  crownLastTs = 0
  crownAccumDeg = 0
  crownAccumDir = 0
  onDigitalCrown({
    callback: function (key, degree) {
      var direction = crownDirection(key, degree, KEY_HOME)
      if (!direction) return
      var now = Date.now()
      if (now - crownLastTs < CROWN_DEBOUNCE) return
      crownLastTs = now
      // 滚动模式 / 书签面板：1 个有效事件直接响应（保持原有手感）
      if (scrollMode || bm.active) { handleNavigation(direction); return }
      // 翻页模式：同方向累计旋转角度，达到当前灵敏度阈值（90/80/60/40/20°）才翻一页。
      // 方向切换立即重置 —— 防止快速旋转连翻；度数来自表冠事件回调。
      if (crownAccumDir !== direction) { crownAccumDir = direction; crownAccumDeg = 0 }
      crownAccumDeg += Math.abs(degree) || 0
      if (crownAccumDeg >= effectiveCrownStep()) {
        crownAccumDeg = 0
        handleNavigation(direction)
      }
    }
  })
  // T-Rex 等没有旋钮的机型可以通过方向实体键使用同一导航语义。
  onKey({
    callback: function (key) {
      var direction = keyDirection(key, KEY_UP, KEY_DOWN)
      if (!direction) return false
      handleNavigation(direction)
      return true
    }
  })
}
