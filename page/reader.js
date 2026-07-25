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
import { back } from '@zos/router'
import { onDigitalCrown, KEY_HOME, KEY_UP, KEY_DOWN, offDigitalCrown, onKey, offKey } from '@zos/interaction'
import { crownDirection, crownDebounceMs, keyDirection } from '../utils/crown'
import { localStorage } from '@zos/storage'
import { setWakeUpRelaunch, setBrightness, getBrightness } from '@zos/display'
import { Time, Battery } from '@zos/sensor'
import { getDeviceInfo } from '@zos/device'
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
var UI_PANEL = 0x181818
var UI_PANEL_SOFT = 0x202020
var UI_ACCENT = 0xD8924B      // 强调（琥珀）
var UI_SUB = 0xA6A6A6          // 次要文本
var UI_DANGER = 0xB05A52
// 菜单配色（琥珀黄 + 石墨，参考 DS 布局但保持项目原色调）
var MENU_PANEL = 0x202020      // 菜单面板背景（石墨）
var MENU_BTN = 0x2A2A2A        // 常规动作按钮（平面石墨）
var MENU_BTN_TOGGLE = 0x34302A // 状态按钮（微暖石墨）
var MENU_BTN_FG = 0xF5F5F5     // 按钮文字（白）
var MENU_ACCENT = 0xD8924B     // 菜单强调色（琥珀）
var MENU_SUB = 0xA6A6A6        // 菜单次要文本
var MENU_MUTED = 0x8A7A5A      // 菜单弱化文本（琥珀灰）
var UI_TEXT = 0xF5F5F5         // 主文本
var UI_MUTED = 0x666666        // 三级弱化文本
var STEP = 3072           // 渲染读取步长（增大以减少 readSync 次数）
var _readBuf = null
var _readBufLen = 0

// --LIBRARY-DATA-- (内置书数据，手动维护；如需批量导入可写脚本替换此段)
var LIBRARY = [
  {
    id: 0,
    title: "测试小说",
    author: "作者A",
    file: "raw/books/Test.txt",
  },
]

var FONT_SIZES = (function () { var a = []; for (var s = 12; s <= 36; s++) a.push(s); return a })()  // 逐号可调
var SPACINGS = [1.0, 1.18, 1.36, 1.58]
var SPACING_LABELS = ['紧', '中', '松', '大']

// 配色主题：bg 背景 / fg 正文 / sub 次要 / bar 进度 / barbg 进度底
var THEMES = [
  { name: '夜', bg: 0x0E0E0E, fg: 0xE8E8E8, sub: UI_SUB, bar: 0xD8924B, barbg: 0x2A2A2A },
  { name: '护眼', bg: 0x12211A, fg: 0xCBE3CE, sub: 0x6E8F76, bar: 0x5AAE78, barbg: 0x24382C },
  { name: '纸', bg: 0xE9E0CB, fg: 0x3A352A, sub: 0x8C8064, bar: 0xB5772E, barbg: 0xCFC3A6 },
  { name: '黑', bg: 0x000000, fg: 0xC6C6C6, sub: 0x707070, bar: 0xC07A33, barbg: 0x1C1C1C },
  { name: '暮', bg: 0x1A1020, fg: 0xD8C8E8, sub: 0x8878A0, bar: 0xA060D0, barbg: 0x2A1838 },
  { name: '雾', bg: 0xF0F0F0, fg: 0x2A2A2A, sub: UI_SUB, bar: 0xD8924B, barbg: 0xD8D8D8 },
  { name: '秋', bg: 0x1C1810, fg: 0xE0D0B0, sub: 0x9A8A6A, bar: 0xD4A040, barbg: 0x2C2418 },
  { name: '冰', bg: 0x0C1420, fg: 0xFFFFFF, sub: 0x9A9A9A, bar: 0xD8924B, barbg: 0x182838 }
]
var AUTO_SECS = [0, 12, 7, 4]            // 自动翻页：关/慢/中/快
var AUTO_LABELS = ['关', '慢', '中', '快']

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
var jump = { active: false, input: '', mode: 'page', widgets: [], _poolBuilt: false }
var _longPressTimer = null  // 已废弃，书签改为菜单按钮
var menu = { active: false, widgets: [], _poolBuilt: false, fontText: null, spacingText: null, brightText: null, themeText: null, autoText: null, scrollText: null, timerText: null, awakeTxt: null }

var loadingPulse = null
function clearLoading() {
  if (loadingPulse) { clearInterval(loadingPulse); loadingPulse = null }
  for (var i = 0; i < loadingWidgets.length; i++) { try { deleteWidget(loadingWidgets[i]) } catch (e) {} }
  loadingWidgets = []
}
function showLoading() {
  clearLoading()
  loadingWidgets.push(createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: H, color: 0x000000, alpha: 220 }))
  loadingWidgets.push(createWidget(widget.FILL_RECT, { x: 90, y: 184, w: W - 180, h: 86, radius: 18, color: UI_PANEL_SOFT }))
  loadingWidgets.push(createWidget(widget.TEXT, { x: 70, y: 214, w: W - 140, h: 32, text: '正在加载…', text_size: 18, color: UI_ACCENT, align_h: align.CENTER_H, align_v: align.CENTER_V }))
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
  if (!source) return { text: '(读取失败)', start: 0, end: 0, eof: true }
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
    return (charging ? '充' : '') + b + '%'
  } catch (e) { return '' }
}
function topText() {
  var s = nowHHMM() + '  ' + percent() + '%  ' + battStr()
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
  if (m < 60) return m + '分'
  return Math.floor(m / 60) + '时' + (m % 60) + '分'
}
function estRemaining() {
  if (!source || source.size <= 0 || !curInfo || curInfo.eof) return ''
  if (speedSampleCount < 2 || speedBytesPerSec <= 0) return ''
  var remainBytes = Math.max(0, source.size - curInfo.end)
  var remain = Math.round(remainBytes / speedBytesPerSec)
  if (remain < 30) return ''
  return '预计还需' + fmtMin(remain)
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
      try { menu.timerText.setProperty(prop.TEXT, '本次 ' + fmtMin(currentReadSec() - baseReadSec) + ' · 累计 ' + fmtMin(currentReadSec()) + (rm ? ' · 剩 ' + rm : '')) } catch (e) {}
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
    var txt = i < lines.length ? (lines[i] || '') : ''
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
    var txt = i < lines.length ? (lines[i] || '') : ''
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

function anyPanel() { return jump.active || menu.active || bm.active }

// ── 动画辅助：对控件列表做淡入/淡出 ──
function animFadeGroup(widgets, fromA, toA, steps, delay, onDone) {
  if (!widgets || widgets.length === 0) { if (onDone) onDone(); return }
  var cur = fromA, total = toA - fromA, step = Math.round(total / steps), n = steps
  function tick() {
    cur += step; n--
    if (n <= 0) cur = toA
    for (var i = 0; i < widgets.length; i++) {
      if (widgets[i]) try { widgets[i].setProperty(prop.MORE, { alpha: cur }) } catch (e) {}
    }
    if (n > 0) setTimeout(tick, delay)
    else if (onDone) setTimeout(onDone, 0)
  }
  tick()
}
// 按钮按压反馈（浅闪）
function btnFlash(bgW, origColor) {
  if (!bgW) return
  try { bgW.setProperty(prop.MORE, { color: 0x4A4A4A }) } catch (e) {}
  setTimeout(function () { try { bgW.setProperty(prop.MORE, { color: origColor || 0x2A2A2A }) } catch (e) {} }, 30)
}

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
  if (menu.scrollText) { try { menu.scrollText.setProperty(prop.TEXT, '滚动 ' + (scrollMode ? '开' : '关')) } catch (e) {} }
  saveProgress()
}
function toggleFullscreen() {
  fullscreen = !fullscreen
  var alpha = fullscreen ? 0 : 255
  try { if (topPctWidget) topPctWidget.setProperty(prop.MORE, { alpha: alpha }) } catch (e) {}
  try { if (pageNumWidget) pageNumWidget.setProperty(prop.MORE, { alpha: alpha }) } catch (e) {}
  try { if (_progBgWidget) _progBgWidget.setProperty(prop.MORE, { alpha: alpha }) } catch (e) {}
  try { if (readProgressWidget) readProgressWidget.setProperty(prop.MORE, { alpha: alpha }) } catch (e) {}
  toast(fullscreen ? '全屏模式' : '退出全屏')
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
  if (menu.brightText) { try { menu.brightText.setProperty(prop.TEXT, brightVal < 0 ? '系统' : brightVal + '%') } catch (e) {} }
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
  toastWidgets.push(createWidget(widget.FILL_RECT, { x: 118, y: 206, w: 244, h: 60, radius: 16, color: UI_PANEL_SOFT, alpha: 0 }))
  toastWidgets.push(createWidget(widget.TEXT, { x: 130, y: 206, w: 220, h: 60, text: text, text_size: 16, color: UI_ACCENT, align_h: align.CENTER_H, align_v: align.CENTER_V, alpha: 0 }))
  animFadeGroup(toastWidgets, 0, 255, 6, 35)
  var shownWidgets = toastWidgets
  toastTimer = setTimeout(function () {
    animFadeGroup(shownWidgets, 255, 0, 6, 35, function () {
      for (var j = 0; j < shownWidgets.length; j++) { try { deleteWidget(shownWidgets[j]) } catch (e) {} }
      if (toastWidgets === shownWidgets) toastWidgets = []
      toastTimer = null
    })
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
  for (var i = 0; i < list.length; i++) if (Math.abs(list[i].offset - curStart) < 4) { toast('本页已有书签'); return }
  list.push({ offset: curStart, page: displayPage(), pct: percent(), ts: Date.now() })
  if (list.length > 50) list.shift()
  saveBookmarks(list)
  toast('已加书签')
}

var bm = { active: false, staticWidgets: [], rowWidgets: [], page: 0 }
var BM_PER_PAGE = 5
function closeBookmarks() {
  for (var i = 0; i < bm.staticWidgets.length; i++) { try { deleteWidget(bm.staticWidgets[i]) } catch (e) {} }
  for (var i = 0; i < bm.rowWidgets.length; i++) { try { deleteWidget(bm.rowWidgets[i]) } catch (e) {} }
  bm.staticWidgets = []; bm.rowWidgets = []; bm.active = false; bm.page = 0; bm._lastRender = 0
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

  var startY = 120, rowH = 42
  var start = bm.page * BM_PER_PAGE
  var end = Math.min(list.length, start + BM_PER_PAGE)
  var n = end - start

  for (var i = 0; i < n; i++) {
    var it = list[list.length - 1 - start - i]
    var y = startY + i * rowH
    bm.rowWidgets.push(createWidget(widget.FILL_RECT, { x: 80, y: y, w: 320, h: rowH - 6, radius: 10, color: UI_PANEL }))
    bm.rowWidgets.push(createWidget(widget.TEXT, { x: 94, y: y, w: 230, h: rowH - 6, text: '第' + it.page + '页 · ' + it.pct + '%', text_size: 14, color: UI_TEXT, align_v: align.CENTER_V }))
    var jt = createWidget(widget.FILL_RECT, { x: 80, y: y, w: 264, h: rowH - 6, radius: 8, color: 0x000000, alpha: 0 })
    jt.addEventListener(event.CLICK_DOWN, (function (off) { return function () { closeBookmarks(); curStart = off; backStack = []; refreshDisplay(); saveProgress() } })(it.offset))
    bm.rowWidgets.push(jt)
    bm.rowWidgets.push(createWidget(widget.TEXT, { x: 350, y: y, w: 44, h: rowH - 6, text: '×', text_size: 20, color: 0xB05A52, align_h: align.CENTER_H, align_v: align.CENTER_V }))
    var dt = createWidget(widget.FILL_RECT, { x: 346, y: y, w: 52, h: rowH - 6, color: 0x000000, alpha: 0 })
    dt.addEventListener(event.CLICK_DOWN, (function (ts) { return function () {
      var l = bookmarksOf(); var nl = []
      for (var k = 0; k < l.length; k++) if (l[k].ts !== ts) nl.push(l[k])
      saveBookmarks(nl); renderBookmarkPage()
    } })(it.ts))
    bm.rowWidgets.push(dt)
  }

  if (list.length === 0) bm.rowWidgets.push(createWidget(widget.TEXT, { x: 90, y: 170, w: 300, h: 24, text: '还没有书签', text_size: 14, color: UI_MUTED, align_h: align.CENTER_H }))

  if (totalPages > 1) {
    bm.rowWidgets.push(createWidget(widget.TEXT, { x: 170, y: 344, w: 140, h: 20, text: (bm.page + 1) + '/' + totalPages + '  表冠翻页', text_size: 11, color: UI_MUTED, align_h: align.CENTER_H }))
  }
}

function openBookmarks() {
  if (bm.active) return
  bm.active = true; bm.staticWidgets = []; bm.rowWidgets = []; bm.page = 0

  // 背景（吸收点击，防止穿透）
  var bg = createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: H, color: 0x000000, alpha: 215 })
  try { bg.setProperty(prop.MORE, { alpha: 0 }) } catch (e) {}
  bg.addEventListener(event.CLICK_DOWN, function () {})
  bm.staticWidgets.push(bg)
  bm.staticWidgets.push(createWidget(widget.FILL_RECT, { x: 72, y: 32, w: 336, h: 376, radius: 20, color: MENU_PANEL }))
  try { bm.staticWidgets[1].setProperty(prop.MORE, { alpha: 0 }) } catch (e) {}
  bm.staticWidgets.push(createWidget(widget.TEXT, { x: 90, y: 44, w: 300, h: 24, text: '书签', text_size: 17, color: UI_ACCENT, align_h: align.CENTER_H }))
  // 加书签按钮
  bm.staticWidgets.push(createWidget(widget.FILL_RECT, { x: 150, y: 72, w: 180, h: 40, radius: 10, color: MENU_BTN_TOGGLE }))
  bm.staticWidgets.push(createWidget(widget.TEXT, { x: 150, y: 70, w: 180, h: 40, text: '＋ 在此页加书签', text_size: 14, color: UI_ACCENT, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  var addT = createWidget(widget.FILL_RECT, { x: 150, y: 70, w: 180, h: 40, radius: 10, color: 0x000000, alpha: 0 })
  addT.addEventListener(event.CLICK_DOWN, function () { addBookmark(); renderBookmarkPage() })
  bm.staticWidgets.push(addT)
  // 关闭按钮
  bm.staticWidgets.push(createWidget(widget.FILL_RECT, { x: 170, y: 364, w: 140, h: 38, radius: 10, color: MENU_BTN }))
  bm.staticWidgets.push(createWidget(widget.TEXT, { x: 170, y: 364, w: 140, h: 38, text: '关闭', text_size: 14, color: UI_SUB, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  var ct = createWidget(widget.FILL_RECT, { x: 170, y: 364, w: 140, h: 38, radius: 10, color: 0x000000, alpha: 0 })
  ct.addEventListener(event.CLICK_DOWN, function () { closeBookmarks() })
  bm.staticWidgets.push(ct)

  renderBookmarkPage()

  // 淡入动画：遮罩先入，面板稍后
  if (bm.staticWidgets.length > 0) {
    setTimeout(function () { if (bm.active) animFadeGroup([bm.staticWidgets[0]], 0, 215, 8, 30) }, 10)
    var panelRef = bm.staticWidgets[1]
    setTimeout(function () { if (bm.active) animFadeGroup([panelRef], 0, 255, 6, 30) }, 60)
  }
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
  menu.fontText = menu.spacingText = menu.brightText = menu.themeText = menu.autoText = menu.scrollText = menu.timerText = menu.remainText = null
  menu.awakeTxt = null
}

function mAdd(w) { menu.widgets.push(w); return w }
var MPX = 72, MPW = 336

// 关键：透明触摸层必须最后创建（盖在文字之上），否则 TEXT 会挡住点击。
function menuBtn(x, y, w, h, label, bg, fg, ts, onClick) {
  mAdd(createWidget(widget.FILL_RECT, { x: x, y: y, w: w, h: h, radius: 10, color: bg }))
  mAdd(createWidget(widget.TEXT, { x: x, y: y, w: w, h: h, text: label, text_size: ts, color: fg, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  var t = mAdd(createWidget(widget.FILL_RECT, { x: x, y: y, w: w, h: h, radius: 10, color: 0x000000, alpha: 0 }))
  t.addEventListener(event.CLICK_DOWN, function () {
    btnFlash(menu.widgets[menu.widgets.length - 3], bg)
    onClick()
  })
  return t
}

function menuStepper(y, label, value, onMinus, onPlus) {
  mAdd(createWidget(widget.FILL_RECT, { x: MPX + 24, y: y, w: 240, h: 40, radius: 12, color: MENU_PANEL }))
  mAdd(createWidget(widget.TEXT, { x: MPX + 36, y: y, w: 56, h: 40, text: label, text_size: 15, color: MENU_SUB, align_v: align.CENTER_V }))
  menuBtn(MPX + 98, y, 50, 40, '−', MENU_BTN, 0xFFFFFF, 22, onMinus)
  var vt = mAdd(createWidget(widget.TEXT, { x: MPX + 150, y: y, w: 56, h: 40, text: value, text_size: 18, color: MENU_ACCENT, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  menuBtn(MPX + 208, y, 50, 40, '＋', MENU_BTN, 0xFFFFFF, 22, onPlus)
  return vt
}

function openMenu() {
  if (menu.active || jump.active || bm.active) return
  menu.active = true

  // 直接弹出（无动画、无池化）：参考 ring-reader-DS 菜单样式（紫调面板）
  menu.widgets = []

  mAdd(createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: H, color: 0x000000, alpha: 210 }))
  var closeBg = mAdd(createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: H, color: 0x000000, alpha: 0 }))
  closeBg.addEventListener(event.CLICK_DOWN, function () { closeMenu() })

  // 面板背景（紫黑）
  var panelBg = mAdd(createWidget(widget.FILL_RECT, { x: MPX, y: 32, w: MPW, h: 384, radius: 18, color: MENU_PANEL }))
  panelBg.addEventListener(event.CLICK_DOWN, function () {})

  mAdd(createWidget(widget.TEXT, {
    x: MPX, y: 40, w: MPW, h: 18,
    text: displayPage() + ' / ~' + estTotal + '  ' + percent() + '%  ' + nowHHMM(),
    text_size: 13, color: 0xCFCFCF, align_h: align.CENTER_H
  }))
  menu.timerText = mAdd(createWidget(widget.TEXT, {
    x: MPX, y: 60, w: MPW, h: 16,
    text: '本次 ' + fmtMin(currentReadSec() - baseReadSec) + ' · 累计 ' + fmtMin(currentReadSec()),
    text_size: 10, color: 0x8A8A8A, align_h: align.CENTER_H
  }))
  menu.remainText = mAdd(createWidget(widget.TEXT, {
    x: MPX, y: 76, w: MPW, h: 12, text: estRemaining() || '',
    text_size: 9, color: MENU_MUTED, align_h: align.CENTER_H
  }))

  // 字号
  mAdd(createWidget(widget.TEXT, { x: MPX + 36, y: 92, w: 56, h: 36, text: '字号', text_size: 14, color: MENU_SUB, align_v: align.CENTER_V }))
  menuBtn(MPX + 98, 92, 48, 36, 'A-', MENU_BTN, 0xFFFFFF, 17, function () { changeFont(-1) })
  menu.fontText = mAdd(createWidget(widget.TEXT, { x: MPX + 148, y: 92, w: 56, h: 36, text: cfgNow().label, text_size: 17, color: MENU_ACCENT, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  menuBtn(MPX + 206, 92, 48, 36, 'A+', MENU_BTN, 0xFFFFFF, 17, function () { changeFont(1) })

  menu.spacingText = menuStepper(134, '行距', SPACING_LABELS[spacingIdx], function () { changeSpacing(-1) }, function () { changeSpacing(1) })
  menu.brightText = menuStepper(176, '亮度', brightVal < 0 ? '系统' : brightVal + '%', function () { changeBright(-1) }, function () { changeBright(1) })
  menu.themeText = menuStepper(218, '主题', theme().name, function () { changeTheme(-1) }, function () { changeTheme(1) })
  menu.autoText = menuStepper(260, '自动', AUTO_LABELS[autoIdx], function () { changeAuto(-1) }, function () { changeAuto(1) })

  // 底部6按钮（2行3列）
  var btnW = 98, btnH = 38, btnGap = 8
  var btnY1 = 306, btnY2 = btnY1 + btnH + btnGap
  var btnX1 = MPX + 12, btnX2 = btnX1 + btnW + btnGap, btnX3 = btnX2 + btnW + btnGap

  // 第一行：书签 / 全屏 / 滚动
  menuBtn(btnX1, btnY1, btnW, btnH, '书签', MENU_BTN_TOGGLE, MENU_BTN_FG, 15, function () { closeMenu(); openBookmarks() })
  menuBtn(btnX2, btnY1, btnW, btnH, '全屏', MENU_BTN_TOGGLE, MENU_BTN_FG, 15, function () { toggleFullscreen() })
  mAdd(createWidget(widget.FILL_RECT, { x: btnX3, y: btnY1, w: btnW, h: btnH, radius: 10, color: MENU_BTN_TOGGLE }))
  menu.scrollText = mAdd(createWidget(widget.TEXT, { x: btnX3, y: btnY1, w: btnW, h: btnH, text: '滚动 ' + (scrollMode ? '开' : '关'), text_size: 14, color: MENU_ACCENT, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  var scT = mAdd(createWidget(widget.FILL_RECT, { x: btnX3, y: btnY1, w: btnW, h: btnH, radius: 10, color: 0x000000, alpha: 0 }))
  scT.addEventListener(event.CLICK_DOWN, function () { toggleScroll() })

  // 第二行：跳页 / 常亮 / 关闭
  menuBtn(btnX1, btnY2, btnW, btnH, '跳页', MENU_BTN, 0xEEEEEE, 15, function () { closeMenu(); openJumpPanel() })
  mAdd(createWidget(widget.FILL_RECT, { x: btnX2, y: btnY2, w: btnW, h: btnH, radius: 10, color: MENU_BTN }))
  menu.awakeTxt = mAdd(createWidget(widget.TEXT, { x: btnX2, y: btnY2, w: btnW, h: btnH, text: keepAwake ? '常亮开' : '常亮关', text_size: 13, color: MENU_ACCENT, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  var awakeTouch = mAdd(createWidget(widget.FILL_RECT, { x: btnX2, y: btnY2, w: btnW, h: btnH, radius: 10, color: 0x000000, alpha: 0 }))
  awakeTouch.addEventListener(event.CLICK_DOWN, function () { toggleKeepAwake(); try { menu.awakeTxt.setProperty(prop.TEXT, keepAwake ? '常亮开' : '常亮关') } catch (e) {} })
  menuBtn(btnX3, btnY2, btnW, btnH, '关闭', 0x2C2C2C, MENU_SUB, 15, function () { closeMenu() })

  menu._poolBuilt = false
}

// ── 跳页数字键盘 ──
function closeJumpPanel() {
  if (!jump.active) return
  jump.active = false
  jump.input = ''
  // 池化：不 deleteWidget，只淡出，下次 openJumpPanel 零延迟复用
  if (jump._poolBuilt && jump.widgets.length > 0) {
    animFadeGroup(jump.widgets, 255, 0, 6, 25, function () {
      for (var i = 0; i < jump.widgets.length; i++) {
        try { jump.widgets[i].setProperty(prop.MORE, { alpha: 0 }) } catch (e) {}
      }
      // 重置显示为占位符
      if (jump.widgets[3]) { try { jump.widgets[3].setProperty(prop.TEXT, '___') } catch (e) {} }
      // 重置模式标题
      if (jump.widgets[5]) { try { jump.widgets[5].setProperty(prop.TEXT, '点击切换：页数 / 百分比') } catch (e) {} }
      jump.mode = 'page'
    })
  } else {
    for (var i = 0; i < jump.widgets.length; i++) { try { deleteWidget(jump.widgets[i]) } catch (e) {} }
    jump.widgets = []
  }
}

// 销毁跳页池（用于 onDestroy 等需要彻底清理的场景）
function destroyJumpPool() {
  for (var i = 0; i < jump.widgets.length; i++) { try { deleteWidget(jump.widgets[i]) } catch (e) {} }
  jump.widgets = []
  jump._poolBuilt = false
}

function updateJumpDisplay() {
  var disp = jump.widgets[3]
  if (disp) { try { disp.setProperty(prop.TEXT, jump.input || '___') } catch (e) {} }
}

function addJumpDigit(d) { if (jump.input.length < 6) { jump.input += d; updateJumpDisplay() } }
function jumpBackspace() { if (jump.input.length > 0) { jump.input = jump.input.slice(0, -1); updateJumpDisplay() } }

function jumpModeLabel() { return jump.mode === 'percent' ? '百分比' : '页数' }
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
  closeJumpPanel()
  if (target > source.size - 1) target = Math.max(0, source.size - 1)
  curStart = snapToLineStart(target)
  backStack = []
  invalidateCache()
  refreshDisplay()
  saveProgress()
}

function openJumpPanel() {
  if (jump.active) return
  jump.active = true
  jump.input = ''
  jump.mode = 'page'

  if (!jump._poolBuilt) {
    // ── 首次：创建所有控件（alpha=0，由动画渐入）──
    jump.widgets = []

    var px = 140, py = 96, pw = 200, ph = 300
    var padX = px + 18, padY0 = py + 96
    var bW = 50, bH = 34, bGap = 6

    jump.widgets.push(createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: H, color: 0x000000, alpha: 0 }))
    jump.widgets.push(createWidget(widget.FILL_RECT, { x: px, y: py, w: pw, h: ph, radius: 16, color: MENU_PANEL, alpha: 0 }))
    jump.widgets.push(createWidget(widget.TEXT, {
      x: px + 8, y: py + 6, w: pw - 40, h: 22, text: '',
      text_size: 13, color: UI_SUB, align_h: align.CENTER_H, alpha: 0
    }))
    jump.widgets.push(createWidget(widget.TEXT, {
      x: px + 16, y: py + 32, w: pw - 32, h: 26, text: '___', text_size: 22, color: 0xFFFFFF,
      align_h: align.CENTER_H, align_v: align.CENTER_V, alpha: 0
    }))
    jump.widgets.push(createWidget(widget.FILL_RECT, { x: px + 16, y: py + 62, w: pw - 32, h: 1, color: 0x333333, alpha: 0 }))

    jump.widgets.push(createWidget(widget.FILL_RECT, { x: px + 18, y: py + 70, w: pw - 36, h: 24, radius: 6, color: MENU_BTN_TOGGLE, alpha: 0 }))
    var modeTitle = createWidget(widget.TEXT, { x: px + 18, y: py + 70, w: pw - 36, h: 24, text: '', text_size: 11, color: UI_ACCENT, align_h: align.CENTER_H, align_v: align.CENTER_V, alpha: 0 })
    jump.widgets.push(modeTitle)
    var modeTouch = createWidget(widget.FILL_RECT, { x: px + 14, y: py + 66, w: pw - 28, h: 32, color: 0x000000, alpha: 0 })
    modeTouch.addEventListener(event.CLICK_DOWN, function () {
      jump.mode = jump.mode === 'page' ? 'percent' : 'page'
      try { jump.widgets[2].setProperty(prop.TEXT, jump.mode === 'percent' ? '跳页：百分比（1~100）' : '跳页：页数（1~' + estTotal + '）') } catch (e) {}
      try { jump.widgets[3].setProperty(prop.TEXT, '___') } catch (e) {}
      try { jump.widgets[5].setProperty(prop.TEXT, jump.mode === 'percent' ? '当前：百分比' : '当前：页数') } catch (e) {}
      jump.input = ''
    })
    jump.widgets.push(modeTouch)

    jump.widgets.push(createWidget(widget.TEXT, {
      x: px + pw - 32, y: py + 4, w: 28, h: 24, text: '×', text_size: 18, color: UI_SUB,
      align_h: align.CENTER_H, align_v: align.CENTER_V, alpha: 0
    }))
    var closeBtn = createWidget(widget.FILL_RECT, { x: px + pw - 42, y: py - 2, w: 48, h: 38, color: 0x000000, alpha: 0 })
    closeBtn.addEventListener(event.CLICK_DOWN, closeJumpPanel)
    jump.widgets.push(closeBtn)

    var btns = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['←', '0', 'OK']]
    for (var row = 0; row < 4; row++) {
      for (var col = 0; col < 3; col++) {
        var label = btns[row][col]
        var bx = padX + col * (bW + bGap)
        var by = padY0 + row * (bH + 4)
        var isOK = label === 'OK', isDel = label === '←'
        jump.widgets.push(createWidget(widget.FILL_RECT, {
          x: bx, y: by, w: bW, h: bH, radius: 8, color: isOK ? 0xD8924B : (isDel ? 0x3A2430 : MENU_BTN), alpha: 0
        }))
        jump.widgets.push(createWidget(widget.TEXT, {
          x: bx, y: by, w: bW, h: bH, text: label, text_size: isOK ? 14 : 18, color: 0xFFFFFF,
          align_h: align.CENTER_H, align_v: align.CENTER_V, alpha: 0
        }))
        var touch = createWidget(widget.FILL_RECT, { x: bx, y: by, w: bW, h: bH, radius: 8, color: 0x000000, alpha: 0 })
        if (isOK) touch.addEventListener(event.CLICK_DOWN, jumpConfirm)
        else if (isDel) touch.addEventListener(event.CLICK_DOWN, function () { jumpBackspace() })
        else touch.addEventListener(event.CLICK_DOWN, (function (d) { return function () { addJumpDigit(d) } })(label))
        jump.widgets.push(touch)
      }
    }

    jump._poolBuilt = true
  }

  // ── 更新动态内容 ──
  try { jump.widgets[2].setProperty(prop.TEXT, '跳页：页数（1~' + estTotal + '）') } catch (e) {}
  try { jump.widgets[3].setProperty(prop.TEXT, '___') } catch (e) {}
  try { jump.widgets[5].setProperty(prop.TEXT, '点击切换：页数 / 百分比') } catch (e) {}

  // ── alpha 动画淡入 ──
  var overlay = jump.widgets[0]
  var panelBg = jump.widgets[1]
  var contentWidgets = []
  for (var i = 2; i < jump.widgets.length; i++) contentWidgets.push(jump.widgets[i])
  animFadeGroup([overlay, panelBg], 0, 255, 4, 20, function () {
    animFadeGroup(contentWidgets, 0, 255, 6, 20)
  })
  // overlay 目标是半透明 190
  setTimeout(function () { try { overlay.setProperty(prop.MORE, { alpha: 190 }) } catch (e) {} }, 100)
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
      createWidget(widget.TEXT, { x: READ_X, y: READ_Y, w: READ_W, h: 60, text: '书籍已删除或尚未接收完成', text_size: 16, color: UI_DANGER, align_h: align.CENTER_H, align_v: align.CENTER_V })
      try { localStorage.removeItem('_reading') } catch (e) {}
      return
    }
    source = openBookSource(book.file)

    // 记录当前在读，配合熄屏重启回到本书
    try { localStorage.setItem('_reading', JSON.stringify({ bookId: bookId, downloaded: isDownloaded })) } catch (e) {}
    try { setWakeUpRelaunch({ relaunch: true }) } catch (e) {}

    var saved = loadProgress(bookId)
    if (saved && saved.fontSize) {
      for (var i = 0; i < FONT_SIZES.length; i++) if (FONT_SIZES[i] === saved.fontSize) fontIdx = i
    }
    if (saved && saved.spacingIdx !== undefined && saved.spacingIdx >= 0 && saved.spacingIdx < SPACINGS.length) spacingIdx = saved.spacingIdx
    if (saved && saved.brightVal !== undefined && (saved.brightVal === -1 || (saved.brightVal >= 5 && saved.brightVal <= 100))) brightVal = saved.brightVal
    if (saved && saved.themeIdx !== undefined && saved.themeIdx >= 0 && saved.themeIdx < THEMES.length) themeIdx = saved.themeIdx
    if (saved && saved.autoIdx !== undefined && saved.autoIdx >= 0 && saved.autoIdx < AUTO_SECS.length) autoIdx = saved.autoIdx
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
        x: READ_X, y: READ_Y, w: READ_W, h: 60, text: '(读取失败: ' + book.file + ')',
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
  onDigitalCrown({
    callback: function (key, degree) {
      var direction = crownDirection(key, degree, KEY_HOME)
      if (!direction) return
      var now = Date.now()
      if (now - crownLastTs < CROWN_DEBOUNCE) return
      crownLastTs = now
      handleNavigation(direction)
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
