/**
 * 书架主界面 — 圆形屏分页书架
 * 每屏只绘制少量卡片，降低控件数量并避免列表溢出。
 */

import { createWidget, widget, align, event, prop, deleteWidget } from '@zos/ui'
import { push } from '@zos/router'
import { localStorage } from '@zos/storage'
import { rmSync } from '@zos/fs'
import { getDeviceInfo } from '@zos/device'

var W = 480
var S = 1
var SAFE = { L: 78, R: 402, T: 65, B: 415 }
var PAGE_SIZE = 4
// 平面石墨层级：不用黑色叠层模拟阴影，减少脏边和重绘。
var COL_BG = 0x101010
var COL_PANEL = 0x181818
var COL_PANEL_SOFT = 0x202020
var COL_ACCENT = 0xD8924B      // 强调（琥珀）
var COL_ACCENT_SOFT = 0xD8A25A
var COL_TEXT = 0xF5F5F5
var COL_SUB = 0x9AA0A6
var COL_MUTED = 0x666666
var COL_DANGER = 0xB05A52
var COL_SUCCESS = 0x4CAF50

function sp(v) { return Math.round(v * S) }

function computeShelfLayout() {
  try { var di = getDeviceInfo(); if (di && di.width) W = di.width } catch (e) {}
  S = W / 480
  SAFE = { L: sp(78), R: sp(402), T: sp(65), B: sp(415) }
}

// --LIBRARY-DATA-- (内置书数据，手动维护；如需批量导入可写脚本替换此段)
var LIBRARY = [
  {
    id: 0,
    title: "测试小说",
    author: "作者A",
    file: "raw/books/Test.txt",
  },
]

var shelfPage = 0
var shelfWidgets = []
var launchWidgets = []
var openingWidgets = []
var confirmWidgets = []
var shelfAlive = true
var opening = false
var openingTimer = null
var toastTimer = null

function trimText(text, max) {
  text = String(text || '')
  return text.length > max ? text.substring(0, max - 1) + '…' : text
}

// ── 动画辅助：控件列表淡入/淡出 ──
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
// 按钮按压反馈
function btnFlash(bgW, origColor) {
  if (!bgW) return
  try { bgW.setProperty(prop.MORE, { color: 0x4A4A4A }) } catch (e) {}
  setTimeout(function () { try { bgW.setProperty(prop.MORE, { color: origColor || 0x2A2A2A }) } catch (e) {} }, 30)
}

// ── localStorage 缓存层：减少反复 JSON.parse ──
var _cache = {}
function cachedJson(key, fallback) {
  if (_cache[key] !== undefined) return _cache[key]
  var value = fallback
  try { value = JSON.parse(localStorage.getItem(key, JSON.stringify(fallback))) } catch (e) {}
  if (Array.isArray(fallback)) value = Array.isArray(value) ? value : fallback
  else if (fallback && typeof fallback === 'object') value = value && typeof value === 'object' && !Array.isArray(value) ? value : fallback
  _cache[key] = value
  return value
}
function writeJson(key, val) {
  _cache[key] = val
  try { localStorage.setItem(key, JSON.stringify(val)) } catch (e) {}
}
function readJson(key, fallback) {
  return cachedJson(key, fallback)
}

function loadDownloadedBooks() {
  return cachedJson('dl_books', [])
}

function loadHidden() {
  return cachedJson('hidden_books', {})
}

function loadDeleted() {
  return cachedJson('deleted_books', {})
}

function progressMap() { return cachedJson('reading_progress', {}) }

function getAllBooks() {
  var all = []
  var hidden = loadHidden()
  var deleted = loadDeleted()
  var dl = loadDownloadedBooks()
  for (var i = 0; i < LIBRARY.length; i++) {
    if (!hidden[String(LIBRARY[i].id)] && !deleted[String(LIBRARY[i].id)]) all.push(LIBRARY[i])
  }
  for (var j = 0; j < dl.length; j++) all.push(dl[j])
  // 最近阅读置顶（按 reading_progress.ts 降序，未读保持原序）
  var prog = progressMap()
  all.sort(function (a, b) {
    var pa = prog[String(a.id)], pb = prog[String(b.id)]
    return ((pb && pb.ts) || 0) - ((pa && pa.ts) || 0)
  })
  return all
}

function addShelfWidget(w) {
  shelfWidgets.push(w)
  return w
}
function createShelfTouch(x, y, w, h) {
  return createWidget(widget.FILL_RECT, { x: x, y: y, w: w, h: h, color: 0x000000, alpha: 0 })
}

// 卡片交互：短按打开；长按(550ms)删除。长按复用“已验证可点”的打开层，
// 作为可靠的删除入口，避免小型角落按钮在部分固件点不到。
function bindCard(w, book) {
  var tid = null, lp = false
  w.addEventListener(event.CLICK_DOWN, (function (b) {
    return function () {
      lp = false
      tid = setTimeout(function () { lp = true; showDeleteConfirm(b) }, 550)
    }
  })(book))
  w.addEventListener(event.CLICK_UP, (function (b) {
    return function () {
      if (tid) { clearTimeout(tid); tid = null }
      if (!lp) openBook(b)
    }
  })(book))
}

function clearShelf() {
  for (var i = 0; i < shelfWidgets.length; i++) {
    try { deleteWidget(shelfWidgets[i]) } catch (e) {}
  }
  shelfWidgets = []
}

function openBook(book) {
  if (opening || !shelfAlive) return
  opening = true
  openingWidgets = []
  // 遮罩直接显示，避免一次性打开提示被隐藏。
  openingWidgets.push(createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: 480, color: 0x000000, alpha: 225 }))
  // 直接显示一次性打开提示，不创建持续脉冲定时器。
  openingWidgets.push(createWidget(widget.FILL_RECT, { x: sp(90), y: sp(184), w: sp(300), h: sp(86), radius: sp(14), color: COL_PANEL_SOFT }))
  openingWidgets.push(createWidget(widget.TEXT, { x: 80, y: 214, w: 320, h: 32, text: '正在打开…', text_size: 18, color: COL_ACCENT_SOFT, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  setTimeout(function () {
    if (!shelfAlive) return
    push({ url: 'page/reader', params: { bookId: String(book.id), downloaded: book.downloaded ? '1' : '0' } })
  }, 180)
  // 路由 API 没有失败回调；若未跳转，主动撤销遮罩，避免书架永久无法操作。
  openingTimer = setTimeout(function () {
    if (!shelfAlive || !opening) return
    opening = false
    for (var i = 0; i < openingWidgets.length; i++) { try { deleteWidget(openingWidgets[i]) } catch (e) {} }
    openingWidgets = []
    toast('打开失败，请重试')
  }, 1500)
}

function clearLaunch() {
  for (var i = 0; i < launchWidgets.length; i++) { try { deleteWidget(launchWidgets[i]) } catch (e) {} }
  launchWidgets = []
}
function launchCalcEnabled() {
  try { return localStorage.getItem('launch_calc', '1') !== '0' } catch (e) { return true }
}
function toggleLaunchCalc() {
  var enabled = !launchCalcEnabled()
  try { localStorage.setItem('launch_calc', enabled ? '1' : '0') } catch (e) {}
  renderLaunchButton()
  toast(enabled ? '启动计算器：开' : '启动计算器：关')
}
function renderLaunchButton() {
  clearLaunch()
  var enabled = launchCalcEnabled()
  var x = sp(148), y = sp(430), w = sp(184), h = sp(26)
  launchWidgets.push(createWidget(widget.FILL_RECT, { x: x, y: y, w: w, h: h, radius: sp(14), color: enabled ? COL_PANEL_SOFT : COL_PANEL }))
  launchWidgets.push(createWidget(widget.TEXT, { x: x, y: y, w: w, h: h, text: '启动计算器：' + (enabled ? '开' : '关'), text_size: sp(12), color: enabled ? COL_ACCENT_SOFT : COL_SUB, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  var t = createWidget(widget.FILL_RECT, { x: x - sp(4), y: y - sp(4), w: w + sp(8), h: h + sp(8), radius: sp(16), color: 0x000000, alpha: 0 })
  t.addEventListener(event.CLICK_DOWN, toggleLaunchCalc)
  launchWidgets.push(t)
}

function clearConfirm() {
  for (var i = 0; i < confirmWidgets.length; i++) {
    try { deleteWidget(confirmWidgets[i]) } catch (e) {}
  }
  confirmWidgets = []
}

function normalizeDataPath(path) {
  if (!path) return ''
  if (path.indexOf('/data/') === 0) return path.substring(6)
  if (path.indexOf('data://') === 0) return path.substring(7)
  return path
}

function isManagedDownloadPath(path) {
  var clean = normalizeDataPath(String(path || ''))
  while (clean.indexOf('/') === 0) clean = clean.substring(1)
  return clean.indexOf('download/') === 0 && clean.indexOf('..') === -1
}

function removeFile(path) {
  if (!isManagedDownloadPath(path)) return false
  var raw = String(path)
  var clean = normalizeDataPath(raw)
  if (clean.indexOf('/') === 0) clean = clean.substring(1)
  var candidates = [raw, clean]
  if (clean.indexOf('download/') === 0) {
    candidates.push('/data/' + clean)
    candidates.push('data://' + clean)
  }
  var seen = {}
  for (var i = 0; i < candidates.length; i++) {
    var p = candidates[i]
    if (!p || seen[p]) continue
    seen[p] = 1
    try { rmSync({ path: p }); return true } catch (e) {}
  }
  return false
}

function removeKey(key) {
  try {
    if (localStorage.removeItem) localStorage.removeItem(key)
    else localStorage.setItem(key, '')
  } catch (e) {}
}

function doDelete(book) {
  var isBuiltin = book.file && book.file.indexOf('raw/') === 0

  if (isBuiltin) {
    // 安装包内资源不能由手表运行时物理删除；用永久删除名单使其不再回到书架。
    var deleted = loadDeleted()
    deleted[String(book.id)] = 1
    writeJson('deleted_books', deleted)
    var hidden = loadHidden()
    if (hidden[String(book.id)]) { delete hidden[String(book.id)]; writeJson('hidden_books', hidden) }
  } else {
    if (!removeFile(book.file)) {
      clearConfirm()
      toast('删除文件失败，请重试')
      return
    }
    var dl = loadDownloadedBooks()
    var next = []
    for (var i = 0; i < dl.length; i++) {
      if (String(dl[i].file) !== String(book.file)) next.push(dl[i])
    }
    writeJson('dl_books', next)
  }

  var prog = progressMap()
  if (prog[String(book.id)]) { delete prog[String(book.id)]; writeJson('reading_progress', prog) }
  removeKey('idx_' + book.id)
  var times = cachedJson('read_time', {})
  if (times[String(book.id)] !== undefined) { delete times[String(book.id)]; writeJson('read_time', times) }
  var marks = cachedJson('bookmarks', {})
  if (marks[String(book.id)] !== undefined) { delete marks[String(book.id)]; writeJson('bookmarks', marks) }

  clearConfirm()
  shelfPage = 0
  renderShelf()
}

// 透明触摸层最后建（盖文字之上），保证点得到
function cBtn(x, y, w, h, label, bg, fg, ts, onClick) {
  var bgIdx = confirmWidgets.length
  confirmWidgets.push(createWidget(widget.FILL_RECT, { x: x, y: y, w: w, h: h, radius: 10, color: bg }))
  confirmWidgets.push(createWidget(widget.TEXT, { x: x, y: y, w: w, h: h, text: label, text_size: ts, color: fg, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  var t = createWidget(widget.FILL_RECT, { x: x, y: y, w: w, h: h, radius: 10, color: 0x000000, alpha: 0 })
  t.addEventListener(event.CLICK_DOWN, function () { btnFlash(confirmWidgets[bgIdx], bg); onClick() })
  confirmWidgets.push(t)
}

function showDeleteConfirm(book) {
  clearConfirm()
  var isBuiltin = book.file && book.file.indexOf('raw/') === 0
  var verb = '删除'

  // 背景吸收点击，避免误触下层书卡
  var bg = createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: 480, color: 0x000000, alpha: 205 })
  try { bg.setProperty(prop.MORE, { alpha: 0 }) } catch (e) {}
  bg.addEventListener(event.CLICK_DOWN, function () { clearConfirm() })
  confirmWidgets.push(bg)

  confirmWidgets.push(createWidget(widget.FILL_RECT, { x: 92, y: 146, w: 296, h: 192, radius: 20, color: COL_PANEL_SOFT }))
  try { confirmWidgets[1].setProperty(prop.MORE, { alpha: 0 }) } catch (e) {}
  confirmWidgets.push(createWidget(widget.TEXT, {
    x: 112, y: 168, w: 256, h: 24, text: verb + '这本书？',
    text_size: 17, color: COL_TEXT, align_h: align.CENTER_H
  }))
  confirmWidgets.push(createWidget(widget.TEXT, {
    x: 112, y: 198, w: 256, h: 36, text: trimText(book.title, 22),
    text_size: 13, color: COL_SUB, align_h: align.CENTER_H
  }))

  cBtn(116, 278, 110, 46, '取消', COL_PANEL_SOFT, 0xEEEEEE, 16, function () { clearConfirm() })
  cBtn(254, 278, 110, 46, verb, COL_DANGER, 0xFFFFFF, 16, (function (b) { return function () { doDelete(b) } })(book))
  // 淡入动画
  if (confirmWidgets.length > 1) {
    setTimeout(function () { animFadeGroup([confirmWidgets[0]], 0, 205, 8, 30) }, 10)
    setTimeout(function () { if (confirmWidgets.length > 1) animFadeGroup([confirmWidgets[1]], 0, 255, 6, 30) }, 50)
  }
}

var COVER_PAL = [0x3A4A6B, 0x5A3E5E, 0x3E5E4A, 0x6B4A3A, 0x44476B, 0x5E5A3E, 0x3E5A5E, 0x5E3E4A]
function coverColor(book) {
  var s = String(book.title || ''), h = 0
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0x7fffffff
  return COVER_PAL[h % COVER_PAL.length]
}

// 封面网格瓦片（按屏幕缩放）
var TILE_W = 148, TILE_H = 140, COVER_H = 92
function updateTileSizes() {
  TILE_W = sp(148); TILE_H = sp(140); COVER_H = sp(92)
}
function drawTile(book, x, y) {
  var prog = progressMap()[String(book.id)]
  addShelfWidget(createWidget(widget.FILL_RECT, { x: x, y: y, w: TILE_W, h: COVER_H, radius: sp(14), color: coverColor(book) }))
  // 不再叠加整卡黑色阴影；只保留一条窄信息带，避免卡片发脏。
  addShelfWidget(createWidget(widget.FILL_RECT, { x: x, y: y + COVER_H - sp(22), w: TILE_W, h: sp(22), radius: sp(8), color: 0x151515, alpha: 220 }))
  addShelfWidget(createWidget(widget.TEXT, {
    x: x + sp(8), y: y + sp(8), w: TILE_W - sp(16), h: COVER_H - sp(20), text: trimText(book.title, 22),
    text_size: sp(15), color: COL_TEXT, align_h: align.CENTER_H, align_v: align.CENTER_V
  }))
  if (prog && prog.percent) {
    addShelfWidget(createWidget(widget.FILL_RECT, { x: x, y: y + COVER_H - sp(4), w: Math.floor(TILE_W * prog.percent / 100), h: sp(4), color: 0xD8924B }))
  }
  var sub = prog && prog.percent ? ('已读 ' + prog.percent + '%') : trimText(book.author || (book.downloaded ? '线上' : '内置'), 12)
  addShelfWidget(createWidget(widget.TEXT, {
    x: x + sp(8), y: y + COVER_H + sp(4), w: TILE_W - sp(34), h: sp(20), text: sub, text_size: sp(11),
    color: prog && prog.percent ? 0xD8924B : COL_SUB, align_h: align.LEFT, align_v: align.CENTER_V
  }))
  // 打开层：整卡去掉右上角删除区，避免两块可点区域重叠。
  // 打开层同时支持“长按删除”（复用已验证可点的打开层，作为可靠删除入口）。
  var DEL = sp(34)
  var delX = x + TILE_W - DEL
  var open = addShelfWidget(createWidget(widget.FILL_RECT, { x: x, y: y, w: TILE_W - DEL, h: TILE_H, radius: sp(10), color: 0x000000, alpha: 0 }))
  bindCard(open, book)
  var open2 = addShelfWidget(createWidget(widget.FILL_RECT, { x: delX, y: y + DEL, w: DEL, h: TILE_H - DEL, radius: sp(10), color: 0x000000, alpha: 0 }))
  bindCard(open2, book)
  // 删除按钮：圆点承载点击；× 文字画在“圆点下层”透过半透明圆点显示，
  // 这样顶层只有圆点(可点)，不会被文字层挡住点击。点不到×时长按书卡同样可删除。
  // 圆点视觉缩小（28→20），热区 DEL 保持 34 不变，确保易点中又不突兀。
  var onDel = (function (b) { return function () { showDeleteConfirm(b) } })(book)
  var dot = sp(20), dotOff = Math.round((DEL - dot) / 2)
  addShelfWidget(createWidget(widget.TEXT, { x: delX + dotOff, y: y + dotOff, w: dot, h: dot, text: '×', text_size: sp(13), color: 0xEEEEEE, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  var del = addShelfWidget(createWidget(widget.FILL_RECT, { x: delX + dotOff, y: y + dotOff, w: dot, h: dot, radius: sp(10), color: 0x3A2222, alpha: 180 }))
  del.addEventListener(event.CLICK_DOWN, onDel)
}

function drawNav(totalPages) {
  var y = sp(388)
  addShelfWidget(createWidget(widget.TEXT, {
    x: sp(200), y: y + sp(6), w: sp(80), h: sp(18), text: (shelfPage + 1) + '/' + totalPages,
    text_size: sp(11), color: COL_MUTED, align_h: align.CENTER_H
  }))
  if (shelfPage > 0) {
    var prev = addShelfWidget(createWidget(widget.FILL_RECT, { x: sp(126), y: y - sp(2), w: sp(62), h: sp(34), radius: sp(10), color: COL_PANEL }))
    addShelfWidget(createWidget(widget.TEXT, { x: sp(126), y: y + sp(4), w: sp(62), h: sp(18), text: '<', text_size: sp(16), color: COL_ACCENT_SOFT, align_h: align.CENTER_H }))
    var prevTouch = addShelfWidget(createShelfTouch(sp(124), y - sp(4), sp(66), sp(38)))
    prevTouch.addEventListener(event.CLICK_DOWN, function () { if (!shelfAlive) return; btnFlash(prev, COL_PANEL); if (shelfPage > 0) { shelfPage--; renderShelf() } })
  }
  if (shelfPage < totalPages - 1) {
    var next = addShelfWidget(createWidget(widget.FILL_RECT, { x: sp(292), y: y - sp(2), w: sp(62), h: sp(34), radius: sp(10), color: COL_PANEL }))
    addShelfWidget(createWidget(widget.TEXT, { x: sp(292), y: y + sp(4), w: sp(62), h: sp(18), text: '>', text_size: sp(16), color: COL_ACCENT_SOFT, align_h: align.CENTER_H }))
    var nextTouch = addShelfWidget(createShelfTouch(sp(290), y - sp(4), sp(66), sp(38)))
    nextTouch.addEventListener(event.CLICK_DOWN, function () { if (!shelfAlive) return; btnFlash(next, COL_PANEL); if (shelfPage < totalPages - 1) { shelfPage++; renderShelf() } })
  }
}

function renderShelf() {
  _cache = {}
  clearShelf()
  var allBooks = getAllBooks()

  if (allBooks.length === 0) {
    addShelfWidget(createWidget(widget.TEXT, {
      x: sp(80), y: sp(210), w: sp(320), h: sp(24), text: '暂无书籍', text_size: sp(14), color: COL_MUTED, align_h: align.CENTER_H
    }))
    return
  }

  var totalPages = Math.ceil(allBooks.length / PAGE_SIZE)
  if (shelfPage >= totalPages) shelfPage = totalPages - 1
  if (shelfPage < 0) shelfPage = 0

  // 2 列网格（按屏宽居中）
  var gapX = sp(16), gapY = sp(12)
  var gx = Math.round((W - (2 * TILE_W + gapX)) / 2), gy = sp(100)
  var start = shelfPage * PAGE_SIZE
  var end = Math.min(allBooks.length, start + PAGE_SIZE)
  for (var i = start; i < end; i++) {
    var k = i - start
    var col = k % 2, row = Math.floor(k / 2)
    drawTile(allBooks[i], gx + col * (TILE_W + gapX), gy + row * (TILE_H + gapY))
  }

  drawNav(totalPages)
}

// ── 接收进度浮层（百分比 + 进度条），数据来自 app.js 写入的 _recv ──
var recvWidgets = []
var recvBarFill = null, recvPctText = null, recvTitleText = null, recvShown = false
var RB_X = 100, RB_W = 280

function clearRecv() {
  for (var i = 0; i < recvWidgets.length; i++) { try { deleteWidget(recvWidgets[i]) } catch (e) {} }
  recvWidgets = []
  recvBarFill = recvPctText = recvTitleText = null
  recvShown = false
}
function showRecv(name, pct, label, color) {
  if (!recvShown) {
    clearRecv()
    recvWidgets.push(createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: 480, color: 0x000000, alpha: 225 }))
    recvWidgets.push(createWidget(widget.TEXT, { x: 80, y: 150, w: 320, h: 24, text: '正在接收', text_size: 16, color: 0xFFD29A, align_h: align.CENTER_H }))
    recvTitleText = createWidget(widget.TEXT, { x: 80, y: 180, w: 320, h: 22, text: '', text_size: 13, color: COL_SUB, align_h: align.CENTER_H })
    recvWidgets.push(recvTitleText)
    recvWidgets.push(createWidget(widget.FILL_RECT, { x: RB_X, y: 224, w: RB_W, h: 10, radius: 5, color: COL_PANEL_SOFT }))
    recvBarFill = createWidget(widget.FILL_RECT, { x: RB_X, y: 224, w: 2, h: 10, radius: 5, color: 0xD8924B })
    recvWidgets.push(recvBarFill)
    recvPctText = createWidget(widget.TEXT, { x: 80, y: 244, w: 320, h: 26, text: '', text_size: 18, color: 0xFFFFFF, align_h: align.CENTER_H })
    recvWidgets.push(recvPctText)
    recvShown = true
  }
  var w = Math.floor(RB_W * pct / 100); if (w < 2) w = 2; if (w > RB_W) w = RB_W
  try { recvBarFill.setProperty(prop.MORE, { x: RB_X, y: 224, w: w, h: 10, radius: 5, color: color || 0xD8924B }) } catch (e) {}
  try { recvTitleText.setProperty(prop.TEXT, trimText(name, 18)) } catch (e) {}
  try { recvPctText.setProperty(prop.TEXT, label || (pct + '%')) } catch (e) {}
}

// 返回 true 表示当前有接收活动（用于自适应轮询提速）
function checkRecv() {
  var r = null
  try { r = JSON.parse(localStorage.getItem('_recv', 'null')) } catch (e) {}
  if (!r || (Date.now() - (r.t || 0)) > 60000) { if (recvShown) clearRecv(); return false }
  if (r.s === 'recv') { showRecv(r.n, r.p || 0); return true }
  if (r.s === 'done') {
    showRecv(r.n, 100, '完成 ✓', COL_SUCCESS)
    try { localStorage.removeItem('_recv') } catch (e) {}
    setTimeout(function () { if (!shelfAlive) return; clearRecv(); shelfPage = 0; renderShelf() }, 1200)
    return true
  }
  if (r.s === 'error') {
    showRecv(r.n, 0, '接收失败', COL_DANGER)
    try { localStorage.removeItem('_recv') } catch (e) {}
    setTimeout(function () { if (shelfAlive) clearRecv() }, 1500)
    return true
  }
  return false
}

// ── 自动刷新：app.js 收书写 _new_book 标记，书架只检查标记 ──
var pollTimer = null

function pollNewBooks() {
  var active = checkRecv()
  var hasNew = false
  try { hasNew = localStorage.getItem('_new_book') === '1' } catch (e) {}
  if (hasNew && !recvShown) {
    try { localStorage.removeItem('_new_book') } catch (e) {}
    shelfPage = 0
    renderShelf()
  }
  pollTimer = setTimeout(pollNewBooks, (active || recvShown) ? 800 : 2500)
}

function startPoll() {
  stopPoll()
  pollTimer = setTimeout(pollNewBooks, 1000)
}
function stopPoll() {
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null }
}

// ── 在线上传说明（手表端发现入口）──
var helpWidgets = []
function clearHelp() {
  for (var i = 0; i < helpWidgets.length; i++) { try { deleteWidget(helpWidgets[i]) } catch (e) {} }
  helpWidgets = []
}
function showUploadHelp() {
  clearHelp()
  var bg = createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: 480, color: 0x000000, alpha: 220 })
  try { bg.setProperty(prop.MORE, { alpha: 0 }) } catch (e) {}
  bg.addEventListener(event.CLICK_DOWN, function () {})  // 吸收背景点击
  helpWidgets.push(bg)
  helpWidgets.push(createWidget(widget.TEXT, {
    x: 84, y: 60, w: 312, h: 28, text: '在线上传小说', text_size: 18, color: 0xFFD29A, align_h: align.CENTER_H
  }))
  helpWidgets.push(createWidget(widget.TEXT, {
    x: 78, y: 100, w: 324, h: 240,
    text: '需在手机操作（手表无法打字）：\n\n1. 打开 Zepp App\n2. 我的 → 我的设备 → 你的手表\n3. 找到本应用 → 应用设置\n4. 填书名 + 粘贴下载直链\n5. 点「开始上传到手表」\n6. 保持 App 前台，回到此书架等待接收',
    text_size: 14, color: COL_TEXT, align_h: align.LEFT, align_v: align.TOP
  }))
  // 知道了按钮（透明触摸层最后建）
  helpWidgets.push(createWidget(widget.FILL_RECT, { x: 150, y: 356, w: 180, h: 48, radius: 12, color: COL_PANEL_SOFT }))
  helpWidgets.push(createWidget(widget.TEXT, { x: 150, y: 356, w: 180, h: 48, text: '知道了', text_size: 17, color: COL_ACCENT_SOFT, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  var okT = createWidget(widget.FILL_RECT, { x: 150, y: 356, w: 180, h: 48, radius: 12, color: 0x000000, alpha: 0 })
  okT.addEventListener(event.CLICK_DOWN, function () {
    var helpBgIdx = 1  // panel bg is at index 1
    if (helpWidgets.length > helpBgIdx) btnFlash(helpWidgets[helpBgIdx], COL_PANEL_SOFT)
    clearHelp()
  })
  helpWidgets.push(okT)
  // 淡入动画
  if (helpWidgets.length > 1) {
    setTimeout(function () { animFadeGroup([helpWidgets[0]], 0, 220, 8, 30) }, 10)
    setTimeout(function () { animFadeGroup([helpWidgets[1]], 0, 255, 6, 30) }, 50)
  }
}

// ── 改密码（表上设置，无需旧密码）──
var pwdWidgets = []
var pwdInput = ''
var pwdDisplayWidget = null
function clearPwd() {
  for (var i = 0; i < pwdWidgets.length; i++) { try { deleteWidget(pwdWidgets[i]) } catch (e) {} }
  pwdWidgets = []
  pwdInput = ''
  pwdDisplayWidget = null
}
function pwdAdd(w) { pwdWidgets.push(w); return w }
function updatePwdDisp() {
  if (pwdDisplayWidget) { try { pwdDisplayWidget.setProperty(prop.TEXT, pwdInput || '____') } catch (e) {} }
}
function pwdKey(x, y, w, h, label, bg, fg, onClick) {
  var bgIdx = pwdWidgets.length
  pwdAdd(createWidget(widget.FILL_RECT, { x: x, y: y, w: w, h: h, radius: 10, color: bg }))
  pwdAdd(createWidget(widget.TEXT, { x: x, y: y, w: w, h: h, text: label, text_size: 20, color: fg, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  var t = pwdAdd(createWidget(widget.FILL_RECT, { x: x, y: y, w: w, h: h, radius: 10, color: 0x000000, alpha: 0 }))
  t.addEventListener(event.CLICK_DOWN, function () {
    btnFlash(pwdWidgets[bgIdx], bg)
    onClick()
  })
}
function showPwdPanel() {
  clearPwd()
  var bg = createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: 480, color: 0x000000, alpha: 225 })
  try { bg.setProperty(prop.MORE, { alpha: 0 }) } catch (e) {}
  bg.addEventListener(event.CLICK_DOWN, function () {})
  pwdWidgets.push(bg)
  pwdWidgets.push(createWidget(widget.TEXT, { x: 84, y: 58, w: 312, h: 24, text: '设置新密码（4-8位数字）', text_size: 15, color: 0xFFD29A, align_h: align.CENTER_H }))
  pwdDisplayWidget = createWidget(widget.TEXT, { x: 84, y: 88, w: 312, h: 34, text: '____', text_size: 26, color: 0xFFFFFF, align_h: align.CENTER_H, align_v: align.CENTER_V })
  pwdWidgets.push(pwdDisplayWidget)
  pwdWidgets.push(createWidget(widget.TEXT, { x: 366, y: 50, w: 26, h: 28, text: '×', text_size: 22, color: COL_SUB, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  var closeT = createWidget(widget.FILL_RECT, { x: 360, y: 46, w: 44, h: 38, color: 0x000000, alpha: 0 })
  closeT.addEventListener(event.CLICK_DOWN, function () { clearPwd() })
  pwdWidgets.push(closeT)

  var gx = 138, gy = 134, bw = 60, bh = 50, gp = 8
  var keys = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['←', '0', 'OK']]
  for (var r = 0; r < 4; r++) {
    for (var c = 0; c < 3; c++) {
      var lb = keys[r][c]
      var x = gx + c * (bw + gp), y = gy + r * (bh + gp)
      var isOK = lb === 'OK', isDel = lb === '←'
      var col = isOK ? COL_SUCCESS : (isDel ? 0x3A2430 : COL_PANEL_SOFT)
      var fcol = isOK ? 0xFFFFFF : 0xEEEEEE
      ;(function (label, ok, del) {
        pwdKey(x, y, bw, bh, label, col, fcol, function () {
          if (ok) {
            if (pwdInput.length >= 4) {
              try { localStorage.setItem('calc_pwd', pwdInput) } catch (e) {}
              clearPwd()
              toast('密码已更新')
            }
          } else if (del) {
            pwdInput = pwdInput.slice(0, -1); updatePwdDisp()
          } else {
            if (pwdInput.length < 8) { pwdInput += label; updatePwdDisp() }
          }
        })
      })(lb, isOK, isDel)
    }
  }
  // 淡入动画
  if (pwdWidgets.length > 1) {
    setTimeout(function () { animFadeGroup([pwdWidgets[0]], 0, 225, 8, 30) }, 10)
    setTimeout(function () {
      var pwdPanel = pwdWidgets[1]
      animFadeGroup([pwdPanel], 0, 255, 6, 30)
    }, 50)
  }
}

// 轻量提示
var toastWidgets = []
function toast(text) {
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null }
  for (var i = 0; i < toastWidgets.length; i++) { try { deleteWidget(toastWidgets[i]) } catch (e) {} }
  toastWidgets = []
  toastWidgets.push(createWidget(widget.FILL_RECT, { x: 120, y: 210, w: 240, h: 56, radius: 14, color: COL_PANEL_SOFT, alpha: 0 }))
  toastWidgets.push(createWidget(widget.TEXT, { x: 120, y: 210, w: 240, h: 56, text: text, text_size: 16, color: COL_ACCENT, align_h: align.CENTER_H, align_v: align.CENTER_V, alpha: 0 }))
  animFadeGroup(toastWidgets, 0, 255, 6, 35)
  var shownWidgets = toastWidgets
  toastTimer = setTimeout(function () {
    animFadeGroup(shownWidgets, 255, 0, 6, 35, function () {
      for (var j = 0; j < shownWidgets.length; j++) { try { deleteWidget(shownWidgets[j]) } catch (e) {} }
      if (toastWidgets === shownWidgets) toastWidgets = []
      toastTimer = null
    })
  }, 1100)
}

// ── 阅读统计 ──
var statsWidgets = []
function clearStats() {
  for (var i = 0; i < statsWidgets.length; i++) { try { deleteWidget(statsWidgets[i]) } catch (e) {} }
  statsWidgets = []
}
function sAdd(w) { statsWidgets.push(w); return w }
function fmtSec(sec) {
  if (sec < 60) return sec + '秒'
  var m = Math.floor(sec / 60)
  if (m < 60) return m + '分'
  var h = Math.floor(m / 60)
  if (h < 24) return h + '时' + (m % 60) + '分'
  return Math.floor(h / 24) + '天' + (h % 24) + '时'
}
function showStats() {
  clearStats()
  var ACCENT = COL_ACCENT
  var bg = sAdd(createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: 480, color: 0x000000, alpha: 232 }))
  try { bg.setProperty(prop.MORE, { alpha: 0 }) } catch (e) {}
  bg.addEventListener(event.CLICK_DOWN, function () {})
  sAdd(createWidget(widget.TEXT, { x: sp(90), y: sp(50), w: sp(300), h: sp(28), text: '阅读统计', text_size: sp(22), color: ACCENT, align_h: align.CENTER_H }))

  var allTime = {}; try { allTime = JSON.parse(localStorage.getItem('read_time', '{}')) } catch (e) {}
  var allProg = {}; try { allProg = JSON.parse(localStorage.getItem('reading_progress', '{}')) } catch (e) {}
  var dlBooks = []; try { dlBooks = JSON.parse(localStorage.getItem('dl_books', '[]')) } catch (e) {}

  var totalSec = 0, bookCount = 0, doneCount = 0
  for (var k in allTime) { if (allTime.hasOwnProperty(k)) totalSec += allTime[k] || 0 }
  for (var p in allProg) {
    if (allProg.hasOwnProperty(p)) {
      bookCount++
      if (allProg[p] && allProg[p].percent >= 100) doneCount++
    }
  }
  var totalBooks = LIBRARY.length + dlBooks.length

  // 统计摘要（2行2列）
  var items = [
    ['累计', fmtSec(totalSec)],
    ['在读', bookCount + '/' + totalBooks + '本'],
    ['读完', doneCount + '本'],
    ['今日', '']
  ]
  var daily = {}; try { daily = JSON.parse(localStorage.getItem('read_daily', '{}')) } catch (e) {}
  var todayK = (function () {
    var d = new Date()
    return d.getFullYear() + '-' + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1) + '-' + (d.getDate() < 10 ? '0' : '') + d.getDate()
  })()
  items[3][1] = fmtSec(daily[todayK] || 0)

  // 阅读速度估算（字/分钟）
  var totalChars = 0
  for (var pi in allProg) {
    if (allProg.hasOwnProperty(pi) && allProg[pi] && allProg[pi].percent > 0) {
      var bId = pi
      var bTime = allTime[bId] || 0
      if (bTime > 60 && allProg[pi].total > 0) {
        totalChars += Math.round(allProg[pi].total * allProg[pi].percent / 100 / 2.6)
      }
    }
  }
  var speed = totalSec > 60 ? Math.round(totalChars / (totalSec / 60)) : 0

  for (var ri = 0; ri < 4; ri++) {
    var col = ri % 2, row = Math.floor(ri / 2)
    var bx = sp(76) + col * sp(168), by = sp(82) + row * sp(42)
    sAdd(createWidget(widget.FILL_RECT, { x: bx, y: by, w: sp(160), h: sp(36), radius: sp(8), color: COL_PANEL_SOFT }))
    sAdd(createWidget(widget.TEXT, { x: bx + sp(8), y: by, w: sp(58), h: sp(36), text: items[ri][0], text_size: sp(13), color: COL_MUTED, align_v: align.CENTER_V }))
    sAdd(createWidget(widget.TEXT, { x: bx + sp(64), y: by, w: sp(88), h: sp(36), text: items[ri][1], text_size: sp(14), color: COL_TEXT, align_h: align.RIGHT, align_v: align.CENTER_V }))
  }

  // 阅读速度（横通栏，位于摘要下方独立行，避免与图表重叠）
  if (speed > 0) {
    var spdY = sp(174)
    sAdd(createWidget(widget.FILL_RECT, { x: sp(76), y: spdY, w: sp(328), h: sp(30), radius: sp(8), color: COL_PANEL_SOFT }))
    sAdd(createWidget(widget.TEXT, { x: sp(78), y: spdY, w: sp(140), h: sp(30), text: '阅读速度', text_size: sp(13), color: COL_MUTED, align_v: align.CENTER_V }))
    sAdd(createWidget(widget.TEXT, { x: sp(210), y: spdY, w: sp(200), h: sp(30), text: speed + ' 字/分钟', text_size: sp(14), color: COL_ACCENT, align_h: align.RIGHT, align_v: align.CENTER_V }))
  }

  // ── 每周阅读趋势图 ──
  sAdd(createWidget(widget.TEXT, { x: sp(76), y: sp(208), w: sp(328), h: sp(20), text: '近7天阅读（分钟）', text_size: sp(13), color: COL_MUTED, align_h: align.CENTER_H }))

  var weekDays = ['日', '一', '二', '三', '四', '五', '六']
  var chartX = sp(76), chartW = sp(328), chartY = sp(234), chartH = sp(88)
  var barW = sp(30), barGap = sp(14)
  var chartData = [], maxVal = 0

  for (var di = 6; di >= 0; di--) {
    var dt = new Date()
    dt.setDate(dt.getDate() - di)
    var dk = dt.getFullYear() + '-' + (dt.getMonth() + 1 < 10 ? '0' : '') + (dt.getMonth() + 1) + '-' + (dt.getDate() < 10 ? '0' : '') + dt.getDate()
    var mins = Math.round((daily[dk] || 0) / 60)
    chartData.push({ label: weekDays[dt.getDay()], mins: mins, isToday: di === 0 })
    if (mins > maxVal) maxVal = mins
  }
  if (maxVal < 1) maxVal = 1

  // 图表背景
  sAdd(createWidget(widget.FILL_RECT, { x: chartX, y: chartY, w: chartW, h: chartH, radius: sp(8), color: COL_PANEL }))

  // 网格线
  for (var gi = 0; gi < 3; gi++) {
    var gy = chartY + chartH - sp(10) - Math.round((chartH - sp(20)) * gi / 2)
    sAdd(createWidget(widget.FILL_RECT, { x: chartX + sp(8), y: gy, w: chartW - sp(16), h: 1, color: COL_PANEL_SOFT }))
  }

  // 柱状图
  var startX = chartX + Math.round((chartW - 7 * barW - 6 * barGap) / 2)
  for (var bi = 0; bi < 7; bi++) {
    var bx = startX + bi * (barW + barGap)
    var barH = Math.round((chartH - sp(24)) * chartData[bi].mins / maxVal)
    if (chartData[bi].mins > 0 && barH < sp(4)) barH = sp(4)
    var by = chartY + chartH - sp(18) - barH
    var barColor = chartData[bi].isToday ? ACCENT : 0x2A2A2A
    sAdd(createWidget(widget.FILL_RECT, { x: bx, y: by, w: barW, h: barH, radius: sp(4), color: barColor }))
    // 数值：柱够高放柱内顶部（白字），否则放柱顶外（灰字），避免高柱数值上溢撞标题
    if (chartData[bi].mins > 0) {
      if (barH >= sp(20)) {
        sAdd(createWidget(widget.TEXT, { x: bx, y: by + sp(2), w: barW, h: sp(14), text: String(chartData[bi].mins), text_size: sp(10), color: 0xFFFFFF, align_h: align.CENTER_H, align_v: align.CENTER_V }))
      } else {
        sAdd(createWidget(widget.TEXT, { x: bx, y: by - sp(14), w: barW, h: sp(14), text: String(chartData[bi].mins), text_size: sp(10), color: COL_SUB, align_h: align.CENTER_H }))
      }
    }
    // 星期标签
    sAdd(createWidget(widget.TEXT, { x: bx, y: chartY + chartH - sp(16), w: barW, h: sp(14), text: chartData[bi].label, text_size: sp(11), color: chartData[bi].isToday ? ACCENT : COL_MUTED, align_h: align.CENTER_H }))
  }

  // 关闭按钮（y=363 + h=42 = 405，安全区 415 内）
  var statsCloseBg = sAdd(createWidget(widget.FILL_RECT, { x: sp(170), y: sp(363), w: sp(140), h: sp(42), radius: sp(10), color: COL_PANEL_SOFT }))
  sAdd(createWidget(widget.TEXT, { x: sp(170), y: sp(363), w: sp(140), h: sp(42), text: '返回', text_size: sp(16), color: 0xFFFFFF, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  var cl = sAdd(createWidget(widget.FILL_RECT, { x: sp(170), y: sp(363), w: sp(140), h: sp(42), radius: sp(10), color: 0x000000, alpha: 0 }))
  cl.addEventListener(event.CLICK_DOWN, function () { btnFlash(statsCloseBg, COL_PANEL_SOFT); clearStats() })
  // 淡入动画
  var statsOverlay = statsWidgets.length > 0 ? statsWidgets[0] : null
  setTimeout(function () { if (statsOverlay) animFadeGroup([statsOverlay], 0, 232, 8, 35) }, 10)
}

// ── 关于（环间系列风格：深色背景 + 绿色主题）──
var aboutWidgets = []
function clearAbout() {
  for (var i = 0; i < aboutWidgets.length; i++) { try { deleteWidget(aboutWidgets[i]) } catch (e) {} }
  aboutWidgets = []
}
function aAdd(w) { aboutWidgets.push(w); return w }
function showAbout() {
  clearAbout()
  var ACCENT = COL_ACCENT
  var bg = aAdd(createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: 480, color: 0x000000, alpha: 232 }))
  try { bg.setProperty(prop.MORE, { alpha: 0 }) } catch (e) {}
  bg.addEventListener(event.CLICK_DOWN, function () { clearAbout() }) // 点空白处关闭

  // 中央底板卡片
  var cardX = sp(60), cardY = sp(32), cardW = sp(360), cardH = sp(380)
  aAdd(createWidget(widget.FILL_RECT, { x: cardX, y: cardY, w: cardW, h: cardH, radius: sp(20), color: COL_PANEL }))
  // 卡片顶部琥珀细条（签名元素，与书架标题下划线呼应）
  aAdd(createWidget(widget.FILL_RECT, { x: cardX + sp(140), y: cardY + sp(8), w: sp(80), h: sp(3), radius: sp(2), color: COL_ACCENT }))

  // 图标已删除（用户反馈显示异常）。关于页改为纯文字版式，更干净。

  // 标题 + 版本（紧凑分组）
  aAdd(createWidget(widget.TEXT, { x: cardX, y: sp(100), w: cardW, h: sp(26), text: '环间阅读器', text_size: sp(21), color: 0xFFFFFF, align_h: align.CENTER_H }))
  aAdd(createWidget(widget.TEXT, { x: cardX, y: sp(126), w: cardW, h: sp(18), text: 'v3.0.1  ·  伪装计算器', text_size: sp(13), color: ACCENT, align_h: align.CENTER_H }))

  // 分隔线
  aAdd(createWidget(widget.FILL_RECT, { x: cardX + sp(40), y: sp(152), w: cardW - sp(80), h: 1, color: 0x333333 }))

  // 特性列表：单列正文式，每行前缀琥珀圆点，更干净有层次
  var features = ['伪装计算器界面', '在线传书 · BLE 接收', '8 款阅读主题 · 书签跳页', '表冠翻页 · 滚动模式']
  var listY = sp(160), lineH = sp(18)
  for (var fi = 0; fi < features.length; fi++) {
    var fy = listY + fi * lineH
    aAdd(createWidget(widget.FILL_RECT, { x: cardX + sp(40), y: fy + sp(7), w: sp(6), h: sp(6), radius: sp(3), color: COL_ACCENT }))
    aAdd(createWidget(widget.TEXT, { x: cardX + sp(56), y: fy, w: cardW - sp(96), h: lineH, text: features[fi], text_size: sp(13), color: COL_TEXT, align_v: align.CENTER_V }))
  }

  // 开源仓库二维码：扫码打开 https://github.com/ring-amazfit/Ring-Reader
  var QR = sp(140), qx = (W - QR) / 2, qy = sp(240)
  try {
    aAdd(createWidget(widget.IMG, { x: qx, y: qy, w: QR, h: QR, src: 'qr_github.png' }))
  } catch (e) {
    // 资源缺失时的占位回退
    aAdd(createWidget(widget.FILL_RECT, { x: qx, y: qy, w: QR, h: QR, radius: sp(8), color: 0x222222 }))
  }
  aAdd(createWidget(widget.TEXT, { x: cardX, y: sp(384), w: cardW, h: sp(12), text: '扫码访问开源仓库', text_size: sp(11), color: COL_MUTED, align_h: align.CENTER_H }))

  // 淡入动画（仅遮罩淡入，底板及内容直接显示）
  var aboutOverlay = aboutWidgets.length > 0 ? aboutWidgets[0] : null
  setTimeout(function () { if (aboutOverlay) animFadeGroup([aboutOverlay], 0, 232, 8, 35) }, 10)
}

Page({
  build() {
    shelfAlive = true
    computeShelfLayout()
    updateTileSizes()
    createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: W, color: 0x111111 })
    createWidget(widget.TEXT, {
      x: sp(140), y: sp(22), w: sp(200), h: sp(28),
      text: '书架', text_size: sp(19), color: 0xF5F5F5,
      align_h: align.CENTER_H
    })
    // 标题下方强调下划线（签名元素，统一圆形屏视觉语言）
    createWidget(widget.FILL_RECT, { x: sp(220), y: sp(54), w: sp(40), h: sp(3), radius: sp(2), color: COL_ACCENT })
    // 顶部三按钮（向内收紧适配圆形屏安全区）
    var _bw = sp(48), _bh = sp(30), _by = SAFE.T   // 按钮下移到圆形屏可见区
    var _bgap = Math.round((W - 3 * _bw) / 4)
    var _labels = [
      { t: '改密', f: function () { showPwdPanel() } },
      { t: '统计', f: function () { showStats() } },
      { t: '关于', f: function () { showAbout() } }
    ]
    for (var _bi = 0; _bi < 3; _bi++) {
      var _bx = _bgap + _bi * (_bw + _bgap)
      var _bg2 = createWidget(widget.FILL_RECT, { x: _bx, y: _by, w: _bw, h: _bh, radius: sp(9), color: COL_PANEL })
      createWidget(widget.TEXT, { x: _bx, y: _by, w: _bw, h: _bh, text: _labels[_bi].t, text_size: sp(13), color: COL_ACCENT_SOFT, align_h: align.CENTER_H, align_v: align.CENTER_V })
      var _touch = createWidget(widget.FILL_RECT, { x: _bx - sp(2), y: _by - sp(2), w: _bw + sp(4), h: _bh + sp(4), radius: sp(9), color: 0x000000, alpha: 0 })
      _touch.addEventListener(event.CLICK_DOWN, (function (btnBg, fn) {
        return function () { btnFlash(btnBg, COL_PANEL); fn() }
      })(_bg2, _labels[_bi].f))
    }

    renderShelf()
    renderLaunchButton()
    startPoll()
  },

  onDestroy() {
    shelfAlive = false
    stopPoll()
    // 仅清理可能处于打开状态的模态面板；书架网格由系统自动回收
    if (recvShown) clearRecv()
    if (helpWidgets.length) clearHelp()
    if (confirmWidgets.length) clearConfirm()
    if (pwdWidgets.length) clearPwd()
    if (aboutWidgets.length) clearAbout()
    if (statsWidgets.length) clearStats()
    opening = false
    if (openingTimer) { clearTimeout(openingTimer); openingTimer = null }
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null }
    clearLaunch()
    for (var oi = 0; oi < openingWidgets.length; oi++) { try { deleteWidget(openingWidgets[oi]) } catch (e) {} }
    openingWidgets = []
    // shelfWidgets 由 build() 创建，系统自动回收
  }
})
