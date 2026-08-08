/**
 * 书架主界面 — 圆形屏分页书架
 * 每屏只绘制少量卡片，降低控件数量并避免列表溢出。
 */

import { createWidget, widget, align, event, prop, deleteWidget } from '@zos/ui'
import { push } from '@zos/router'
import { localStorage } from '@zos/storage'
import { rmSync } from '@zos/fs'
import { getDeviceInfo } from '@zos/device'
import { getText } from '@zos/i18n'
import { C, M, rowW, animFadeGroup, btnFlash, makeCloseButton } from '../utils/ui'

var W = 480
var S = 1
var PAGE_SIZE = 3          // 单列书脊卡，每页 3 张
// 平面石墨层级：不用黑色叠层模拟阴影，减少脏边和重绘。
var COL_BG = C.bg                // 页面背景
var COL_PANEL = C.card           // 卡片/面板
var COL_PANEL_SOFT = C.cardAlt   // 内嵌区/次级按钮
var COL_ACCENT = C.accent        // 强调（琥珀）
var COL_ACCENT_SOFT = C.accentSoft
var COL_TEXT = C.text
var COL_SUB = C.sub
var COL_MUTED = C.muted
var COL_DANGER = C.danger
var COL_DANGER_BG = C.dangerBg
var COL_SUCCESS = 0x4CAF50

function sp(v) { return Math.round(v * S) }

function computeShelfLayout() {
  try { var di = getDeviceInfo(); if (di && di.width) W = di.width } catch (e) {}
  S = W / 480
}

// --LIBRARY-DATA-- (内置书数据，手动维护；如需批量导入可写脚本替换此段)
var LIBRARY = [
  {
    id: 0,
    title: getText('libraryTestTitle'),
    author: getText('libraryTestAuthor'),
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

// animFadeGroup / btnFlash 已统一到 utils/ui.js

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
  openingWidgets.push(createWidget(widget.FILL_RECT, { x: sp(96), y: sp(188), w: sp(288), h: sp(80), radius: sp(M.cardR), color: COL_PANEL }))
  openingWidgets.push(createWidget(widget.TEXT, { x: 80, y: 214, w: 320, h: 32, text: getText('shelfOpening'), text_size: M.tsTitle, color: COL_ACCENT_SOFT, align_h: align.CENTER_H, align_v: align.CENTER_V }))
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
    toast(getText('shelfOpenFailed'))
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
  toast(getText('shelfLaunchCalc') + '：' + (enabled ? getText('shelfOn') : getText('shelfOff')))
}
function renderLaunchButton() {
  clearLaunch()
  var enabled = launchCalcEnabled()
  var w = sp(184), h = sp(30), x = Math.round((W - w) / 2), y = sp(412)
  launchWidgets.push(createWidget(widget.FILL_RECT, { x: x, y: y, w: w, h: h, radius: Math.round(h / 2), color: enabled ? COL_PANEL_SOFT : COL_PANEL }))
  launchWidgets.push(createWidget(widget.TEXT, { x: x, y: y, w: w, h: h, text: getText('shelfLaunchCalc') + '：' + (enabled ? getText('shelfOn') : getText('shelfOff')), text_size: sp(M.tsMeta), color: enabled ? COL_ACCENT_SOFT : COL_SUB, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  var t = createWidget(widget.FILL_RECT, { x: x - sp(6), y: y - sp(5), w: w + sp(12), h: h + sp(10), radius: Math.round(h / 2) + sp(4), color: 0x000000, alpha: 0 })
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
      toast(getText('shelfDeleteFailed'))
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
  confirmWidgets.push(createWidget(widget.FILL_RECT, { x: x, y: y, w: w, h: h, radius: Math.round(h / 2), color: bg }))
  confirmWidgets.push(createWidget(widget.TEXT, { x: x, y: y, w: w, h: h, text: label, text_size: ts, color: fg, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  var t = createWidget(widget.FILL_RECT, { x: x, y: y, w: w, h: h, radius: Math.round(h / 2), color: 0x000000, alpha: 0 })
  t.addEventListener(event.CLICK_DOWN, function () { btnFlash(confirmWidgets[bgIdx], bg); onClick() })
  confirmWidgets.push(t)
}

function showDeleteConfirm(book) {
  clearConfirm()
  var isBuiltin = book.file && book.file.indexOf('raw/') === 0
  var verb = getText('shelfDelete')

  // 背景吸收点击，避免误触下层书卡
  var bg = createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: 480, color: 0x000000, alpha: 205 })
  try { bg.setProperty(prop.MORE, { alpha: 0 }) } catch (e) {}
  bg.addEventListener(event.CLICK_DOWN, function () { clearConfirm() })
  confirmWidgets.push(bg)

  confirmWidgets.push(createWidget(widget.FILL_RECT, { x: 84, y: 148, w: 312, h: 188, radius: M.cardR, color: COL_PANEL }))
  try { confirmWidgets[1].setProperty(prop.MORE, { alpha: 0 }) } catch (e) {}
  confirmWidgets.push(createWidget(widget.TEXT, {
    x: 104, y: 170, w: 272, h: 24, text: getText('shelfDeleteBook'),
    text_size: M.tsTitle, color: COL_TEXT, align_h: align.CENTER_H
  }))
  // 签名细线（琥珀）
  confirmWidgets.push(createWidget(widget.FILL_RECT, { x: 208, y: 198, w: 64, h: 3, radius: 2, color: COL_ACCENT }))
  confirmWidgets.push(createWidget(widget.TEXT, {
    x: 104, y: 208, w: 272, h: 36, text: trimText(book.title, 22),
    text_size: M.tsVal, color: COL_SUB, align_h: align.CENTER_H
  }))

  cBtn(104, 268, 126, M.btnH, getText('shelfCancel'), COL_PANEL_SOFT, COL_TEXT, M.tsRow, function () { clearConfirm() })
  cBtn(250, 268, 126, M.btnH, verb, COL_DANGER, 0xFFFFFF, M.tsRow, (function (b) { return function () { doDelete(b) } })(book))
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

// ── 单列「书脊卡」──
// 2 列小方块在 480 圆屏上只能给每本书 148px，标题基本读不全，且底部一行必然撞圆边。
// 改成单列横向卡片：左侧一条彩色书脊（取书名哈希色）+ 书名 + 作者/进度 + 底部进度条。
// 卡片宽度按所在 y 的圆屏可用宽自适应，与阅读器菜单同一套胶囊语言。
var CARD_H = 70, CARD_PITCH = 78, CARD_CAP = M.maxW   // 与菜单行同上限，统一视觉宽度
function updateTileSizes() {
  CARD_H = sp(70); CARD_PITCH = sp(78); CARD_CAP = sp(M.maxW)
}

function drawTile(book, y) {
  var prog = progressMap()[String(book.id)]
  var pct = (prog && prog.percent) ? prog.percent : 0
  var w = Math.min(CARD_CAP, rowW(y, CARD_H))
  var x = Math.round((W - w) / 2)
  var r = sp(18)

  // 卡片底
  addShelfWidget(createWidget(widget.FILL_RECT, { x: x, y: y, w: w, h: CARD_H, radius: r, color: COL_PANEL }))
  // 左侧书脊：彩色竖条（书的身份色）
  var spineW = sp(8)
  addShelfWidget(createWidget(widget.FILL_RECT, { x: x + sp(10), y: y + sp(12), w: spineW, h: CARD_H - sp(24), radius: sp(4), color: coverColor(book) }))

  var tx = x + sp(28)
  var delW = sp(40)
  var textW = w - sp(28) - delW - sp(8)

  // 书名（主）
  addShelfWidget(createWidget(widget.TEXT, {
    x: tx, y: y + sp(12), w: textW, h: sp(22), text: trimText(book.title, 16),
    text_size: sp(16), color: COL_TEXT, align_h: align.LEFT, align_v: align.CENTER_V
  }))
  // 副行：作者 / 来源 + 进度百分比
  var src = trimText(book.author || (book.downloaded ? getText('shelfOnline') : getText('shelfBuiltin')), 12)
  addShelfWidget(createWidget(widget.TEXT, {
    x: tx, y: y + sp(34), w: textW - sp(46), h: sp(16), text: src,
    text_size: sp(M.tsMeta), color: COL_MUTED, align_h: align.LEFT, align_v: align.CENTER_V
  }))
  if (pct) {
    addShelfWidget(createWidget(widget.TEXT, {
      x: tx + textW - sp(46), y: y + sp(34), w: sp(46), h: sp(16), text: pct + '%',
      text_size: sp(M.tsMeta), color: COL_ACCENT, align_h: align.RIGHT, align_v: align.CENTER_V
    }))
  }
  // 进度条：底槽 + 琥珀填充（未读也有槽，卡片节奏一致）
  var barX = tx, barW = textW, barY = y + CARD_H - sp(16)
  addShelfWidget(createWidget(widget.FILL_RECT, { x: barX, y: barY, w: barW, h: sp(4), radius: sp(2), color: C.track }))
  if (pct) {
    addShelfWidget(createWidget(widget.FILL_RECT, { x: barX, y: barY, w: Math.max(sp(4), Math.floor(barW * pct / 100)), h: sp(4), radius: sp(2), color: COL_ACCENT }))
  }

  // 打开层：卡片左侧主体（避开右侧删除 chip）
  var open = addShelfWidget(createWidget(widget.FILL_RECT, { x: x, y: y, w: w - delW, h: CARD_H, radius: r, color: 0x000000, alpha: 0 }))
  bindCard(open, book)
  // 删除 chip：右侧居中圆钮，视觉 28 / 热区 40×CARD_H
  var chip = sp(28), chipX = x + w - sp(14) - chip, chipY = y + Math.round((CARD_H - chip) / 2)
  addShelfWidget(createWidget(widget.FILL_RECT, { x: chipX, y: chipY, w: chip, h: chip, radius: Math.round(chip / 2), color: COL_DANGER_BG }))
  addShelfWidget(createWidget(widget.TEXT, { x: chipX, y: chipY, w: chip, h: chip, text: '×', text_size: sp(15), color: COL_DANGER, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  var del = addShelfWidget(createWidget(widget.FILL_RECT, { x: x + w - delW, y: y, w: delW, h: CARD_H, radius: r, color: 0x000000, alpha: 0 }))
  del.addEventListener(event.CLICK_DOWN, (function (b) { return function () { showDeleteConfirm(b) } })(book))
}

// 翻页控件：左右胶囊 + 中间页码，位于书卡下方 y=340（不与卡片重叠）
function drawNav(totalPages) {
  var y = sp(336), bh = sp(34), bw = sp(58)
  addShelfWidget(createWidget(widget.TEXT, {
    x: sp(200), y: y, w: sp(80), h: bh, text: (shelfPage + 1) + '/' + totalPages,
    text_size: sp(M.tsMeta), color: COL_MUTED, align_h: align.CENTER_H, align_v: align.CENTER_V
  }))
  if (shelfPage > 0) {
    var px = sp(132)
    var prev = addShelfWidget(createWidget(widget.FILL_RECT, { x: px, y: y, w: bw, h: bh, radius: Math.round(bh / 2), color: COL_PANEL }))
    addShelfWidget(createWidget(widget.TEXT, { x: px, y: y, w: bw, h: bh, text: '<', text_size: sp(18), color: COL_ACCENT_SOFT, align_h: align.CENTER_H, align_v: align.CENTER_V }))
    var prevTouch = addShelfWidget(createShelfTouch(px - sp(4), y - sp(4), bw + sp(8), bh + sp(8)))
    prevTouch.addEventListener(event.CLICK_DOWN, function () { if (!shelfAlive) return; btnFlash(prev, COL_PANEL); if (shelfPage > 0) { shelfPage--; renderShelf() } })
  }
  if (shelfPage < totalPages - 1) {
    var nx = sp(290)
    var next = addShelfWidget(createWidget(widget.FILL_RECT, { x: nx, y: y, w: bw, h: bh, radius: Math.round(bh / 2), color: COL_PANEL }))
    addShelfWidget(createWidget(widget.TEXT, { x: nx, y: y, w: bw, h: bh, text: '>', text_size: sp(18), color: COL_ACCENT_SOFT, align_h: align.CENTER_H, align_v: align.CENTER_V }))
    var nextTouch = addShelfWidget(createShelfTouch(nx - sp(4), y - sp(4), bw + sp(8), bh + sp(8)))
    nextTouch.addEventListener(event.CLICK_DOWN, function () { if (!shelfAlive) return; btnFlash(next, COL_PANEL); if (shelfPage < totalPages - 1) { shelfPage++; renderShelf() } })
  }
}

function renderShelf() {
  _cache = {}
  clearShelf()
  var allBooks = getAllBooks()

  if (allBooks.length === 0) {
    addShelfWidget(createWidget(widget.TEXT, {
      x: sp(80), y: sp(200), w: sp(320), h: sp(24), text: getText('shelfNoBooks'), text_size: sp(M.tsRow), color: COL_TEXT, align_h: align.CENTER_H
    }))
    addShelfWidget(createWidget(widget.TEXT, {
      x: sp(80), y: sp(226), w: sp(320), h: sp(18), text: getText('shelfNoBooksHint'), text_size: sp(M.tsMeta), color: COL_MUTED, align_h: align.CENTER_H
    }))
    return
  }

  var totalPages = Math.ceil(allBooks.length / PAGE_SIZE)
  if (shelfPage >= totalPages) shelfPage = totalPages - 1
  if (shelfPage < 0) shelfPage = 0

  // 单列，每页 3 张：100 / 178 / 256（卡底 326），翻页控件 336
  var gy = sp(100)
  var start = shelfPage * PAGE_SIZE
  var end = Math.min(allBooks.length, start + PAGE_SIZE)
  for (var i = start; i < end; i++) {
    drawTile(allBooks[i], gy + (i - start) * CARD_PITCH)
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
    // 系统风格：近黑背景 + 中央卡片 + 进度条 + 取消按钮
    recvWidgets.push(createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: 480, color: C.bg, alpha: 228 }))
    recvWidgets.push(createWidget(widget.FILL_RECT, { x: sp(66), y: sp(138), w: sp(348), h: sp(208), radius: sp(M.cardR), color: COL_PANEL }))
    recvWidgets.push(createWidget(widget.FILL_RECT, { x: sp(224), y: sp(150), w: sp(32), h: sp(3), radius: sp(2), color: COL_ACCENT }))
    recvWidgets.push(createWidget(widget.TEXT, { x: sp(80), y: sp(164), w: sp(320), h: sp(24), text: getText('shelfReceiving'), text_size: sp(M.tsTitle), color: COL_TEXT, align_h: align.CENTER_H }))
    recvTitleText = createWidget(widget.TEXT, { x: sp(80), y: sp(192), w: sp(320), h: sp(22), text: '', text_size: sp(M.tsVal), color: COL_SUB, align_h: align.CENTER_H })
    recvWidgets.push(recvTitleText)
    recvWidgets.push(createWidget(widget.FILL_RECT, { x: sp(100), y: sp(224), w: sp(280), h: sp(6), radius: sp(3), color: C.track }))
    recvBarFill = createWidget(widget.FILL_RECT, { x: sp(100), y: sp(224), w: sp(2), h: sp(6), radius: sp(3), color: COL_ACCENT })
    recvWidgets.push(recvBarFill)
    recvPctText = createWidget(widget.TEXT, { x: sp(80), y: sp(238), w: sp(320), h: sp(26), text: '', text_size: sp(18), color: COL_TEXT, align_h: align.CENTER_H })
    recvWidgets.push(recvPctText)
    // 取消接收按钮（红色胶囊，touch 层最后创建确保可点）
    recvWidgets.push(createWidget(widget.FILL_RECT, { x: sp(160), y: sp(278), w: sp(160), h: sp(M.btnH), radius: sp(22), color: COL_DANGER }))
    recvWidgets.push(createWidget(widget.TEXT, { x: sp(160), y: sp(278), w: sp(160), h: sp(M.btnH), text: getText('shelfRecvCancel'), text_size: sp(M.tsRow), color: 0xFFFFFF, align_h: align.CENTER_H, align_v: align.CENTER_V }))
    var cancelT = createWidget(widget.FILL_RECT, { x: sp(154), y: sp(274), w: sp(172), h: sp(M.btnH + 8), radius: sp(22), color: 0x000000, alpha: 0 })
    cancelT.addEventListener(event.CLICK_DOWN, function () { cancelRecvNow() })
    recvWidgets.push(cancelT)
    recvShown = true
  }
  var w = Math.floor(RB_W * pct / 100); if (w < 2) w = 2; if (w > RB_W) w = RB_W
  try { recvBarFill.setProperty(prop.MORE, { x: sp(100), y: sp(224), w: Math.max(sp(6), Math.floor(sp(280) * pct / 100)), h: sp(6), radius: sp(3), color: color || COL_ACCENT }) } catch (e) {}
  try { recvTitleText.setProperty(prop.TEXT, trimText(name, 18)) } catch (e) {}
  try { recvPctText.setProperty(prop.TEXT, label || (pct + '%')) } catch (e) {}
}

// 手表端取消接收：写入一次性取消标记（60 秒窗口），并清除接收浮层。
// app.js 在进度更新与登记书籍前检查该标记：取消后不再更新进度、不登记书籍并删除临时文件。
function cancelRecvNow() {
  try { localStorage.setItem('_cancel_recv', '1') } catch (e) {}
  try { localStorage.setItem('_cancel_recv_ts', String(Date.now())) } catch (e) {}
  clearRecv()
  toast(getText('shelfRecvCanceled'))
}

// 返回 true 表示当前有接收活动（用于自适应轮询提速）
function checkRecv() {
  var r = null
  try { r = JSON.parse(localStorage.getItem('_recv', 'null')) } catch (e) {}
  if (!r || (Date.now() - (r.t || 0)) > 60000) { if (recvShown) clearRecv(); return false }
  if (r.s === 'recv') { showRecv(r.n, r.p || 0); return true }
  if (r.s === 'done') {
    showRecv(r.n, 100, getText('shelfDone'), COL_SUCCESS)
    try { localStorage.removeItem('_recv') } catch (e) {}
    setTimeout(function () { if (!shelfAlive) return; clearRecv(); shelfPage = 0; renderShelf() }, 1200)
    return true
  }
  if (r.s === 'error') {
    showRecv(r.n, 0, getText('shelfRecvFailed'), COL_DANGER)
    try { localStorage.removeItem('_recv') } catch (e) {}
    setTimeout(function () { if (shelfAlive) clearRecv() }, 1500)
    return true
  }
  return false
}

// ── 自动刷新：app.js 收书写 _new_book 标记，书架只检查标记 ──
var pollTimer = null

function pollNewBooks() {
  // 清理过期的取消标记（60 秒窗口，避免影响下一次正常传书）
  try {
    if (localStorage.getItem('_cancel_recv') === '1') {
      var cts = parseInt(localStorage.getItem('_cancel_recv_ts') || '0') || 0
      if (Date.now() - cts > 60000) {
        localStorage.removeItem('_cancel_recv')
        localStorage.removeItem('_cancel_recv_ts')
      }
    }
  } catch (e) {}
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
    x: 84, y: 56, w: 312, h: 28, text: getText('shelfOnlineUpload'), text_size: M.tsTitle, color: COL_TEXT, align_h: align.CENTER_H
  }))
  // 签名细线
  helpWidgets.push(createWidget(widget.FILL_RECT, { x: 200, y: 90, w: 80, h: 3, radius: 2, color: COL_ACCENT }))
  helpWidgets.push(createWidget(widget.TEXT, {
    x: 78, y: 102, w: 324, h: 240,
    text: getText('shelfUploadGuide'),
    text_size: 14, color: COL_TEXT, align_h: align.LEFT, align_v: align.TOP
  }))
  // 知道了按钮（透明触摸层最后建）
  helpWidgets.push(createWidget(widget.FILL_RECT, { x: 150, y: 356, w: 180, h: M.btnH, radius: 22, color: COL_PANEL_SOFT }))
  helpWidgets.push(createWidget(widget.TEXT, { x: 150, y: 356, w: 180, h: M.btnH, text: getText('shelfGotIt'), text_size: M.tsRow, color: COL_ACCENT_SOFT, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  var okT = createWidget(widget.FILL_RECT, { x: 146, y: 352, w: 188, h: M.btnH + 8, radius: 22, color: 0x000000, alpha: 0 })
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
  pwdAdd(createWidget(widget.FILL_RECT, { x: x, y: y, w: w, h: h, radius: 18, color: bg }))
  pwdAdd(createWidget(widget.TEXT, { x: x, y: y, w: w, h: h, text: label, text_size: 21, color: fg, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  var t = pwdAdd(createWidget(widget.FILL_RECT, { x: x, y: y, w: w, h: h, radius: 18, color: 0x000000, alpha: 0 }))
  t.addEventListener(event.CLICK_DOWN, function () {
    btnFlash(pwdWidgets[bgIdx], bg)
    onClick()
  })
}
function showPwdPanel() {
  clearPwd()
  var bg = createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: 480, color: C.bg, alpha: 232 })
  try { bg.setProperty(prop.MORE, { alpha: 0 }) } catch (e) {}
  bg.addEventListener(event.CLICK_DOWN, function () {})
  pwdWidgets.push(bg)
  pwdWidgets.push(createWidget(widget.TEXT, { x: 84, y: 52, w: 312, h: 22, text: getText('shelfSetPwd'), text_size: M.tsMeta, color: COL_SUB, align_h: align.CENTER_H }))
  pwdDisplayWidget = createWidget(widget.TEXT, { x: 84, y: 74, w: 312, h: 40, text: '____', text_size: 32, color: COL_ACCENT, align_h: align.CENTER_H, align_v: align.CENTER_V })
  pwdWidgets.push(pwdDisplayWidget)
  // 关闭：键盘下方居中圆钮（共用组件）
  var BDEPS = { createWidget: createWidget, widget: widget, event: event }
  makeCloseButton(BDEPS, function (w) { pwdWidgets.push(w) }, 382, function () { clearPwd() }, W)

  // 与跳页键盘同一规格：键 68×52 / gap 10，全部落在圆屏安全区内
  var bw = 68, bh = 52, gp = 10
  var gx = Math.round((W - (3 * bw + 2 * gp)) / 2), gy = 132
  var keys = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['DEL', '0', 'OK']]
  for (var r = 0; r < 4; r++) {
    for (var c = 0; c < 3; c++) {
      var lb = keys[r][c]
      var x = gx + c * (bw + gp), y = gy + r * (bh + gp)
      var isOK = lb === 'OK', isDel = lb === 'DEL'
      var col = isOK ? COL_ACCENT : (isDel ? COL_DANGER_BG : COL_PANEL_SOFT)
      var fcol = isOK ? C.onAccent : (isDel ? COL_DANGER : COL_TEXT)
      ;(function (label, ok, del) {
        pwdKey(x, y, bw, bh, label, col, fcol, function () {
          if (ok) {
            if (pwdInput.length >= 4) {
              try { localStorage.setItem('calc_pwd', pwdInput) } catch (e) {}
              clearPwd()
              toast(getText('shelfPwdUpdated'))
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
  if (pwdWidgets.length > 0) {
    setTimeout(function () { animFadeGroup([pwdWidgets[0]], 0, 232, 8, 30) }, 10)
  }
}

// 轻量提示
var toastWidgets = []
function toast(text) {
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null }
  for (var i = 0; i < toastWidgets.length; i++) { try { deleteWidget(toastWidgets[i]) } catch (e) {} }
  toastWidgets = []
  // 系统风格底部胶囊提示
  toastWidgets.push(createWidget(widget.FILL_RECT, { x: sp(100), y: sp(376), w: sp(280), h: sp(48), radius: sp(24), color: COL_PANEL_SOFT, alpha: 0 }))
  toastWidgets.push(createWidget(widget.TEXT, { x: sp(112), y: sp(376), w: sp(256), h: sp(48), text: text, text_size: sp(M.tsVal), color: COL_TEXT, align_h: align.CENTER_H, align_v: align.CENTER_V, alpha: 0 }))
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
  if (sec < 60) return sec + getText('shelfSec')
  var m = Math.floor(sec / 60)
  if (m < 60) return m + getText('shelfMin')
  var h = Math.floor(m / 60)
  if (h < 24) return h + getText('shelfHour') + (m % 60) + getText('shelfMin')
  return Math.floor(h / 24) + getText('shelfDay') + (h % 24) + getText('shelfHour')
}
function showStats() {
  clearStats()
  var ACCENT = COL_ACCENT
  var bg = sAdd(createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: 480, color: C.bg, alpha: 255 }))
  try { bg.setProperty(prop.MORE, { alpha: 0 }) } catch (e) {}
  bg.addEventListener(event.CLICK_DOWN, function () {})
  sAdd(createWidget(widget.TEXT, { x: sp(90), y: sp(46), w: sp(300), h: sp(28), text: getText('shelfStats'), text_size: sp(20), color: COL_TEXT, align_h: align.CENTER_H }))
  // 签名细线
  sAdd(createWidget(widget.FILL_RECT, { x: sp(200), y: sp(80), w: sp(80), h: sp(3), radius: sp(2), color: ACCENT }))

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
    [getText('shelfTotal'), fmtSec(totalSec)],
    [getText('shelfReading'), bookCount + '/' + totalBooks + getText('shelfBookUnit')],
    [getText('shelfDone2'), doneCount + getText('shelfBookUnit')],
    [getText('shelfToday'), '']
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
    var bx = sp(76) + col * sp(168), by = sp(94) + row * sp(42)
    sAdd(createWidget(widget.FILL_RECT, { x: bx, y: by, w: sp(160), h: sp(36), radius: sp(M.rowR), color: COL_PANEL }))
    sAdd(createWidget(widget.TEXT, { x: bx + sp(12), y: by, w: sp(58), h: sp(36), text: items[ri][0], text_size: sp(M.tsMeta), color: COL_SUB, align_v: align.CENTER_V }))
    sAdd(createWidget(widget.TEXT, { x: bx + sp(64), y: by, w: sp(84), h: sp(36), text: items[ri][1], text_size: sp(M.tsVal), color: COL_TEXT, align_h: align.RIGHT, align_v: align.CENTER_V }))
  }

  // 阅读速度（横通栏，位于摘要下方独立行，避免与图表重叠）
  if (speed > 0) {
    var spdY = sp(174)
    sAdd(createWidget(widget.FILL_RECT, { x: sp(76), y: spdY, w: sp(328), h: sp(32), radius: sp(M.rowR), color: COL_PANEL }))
    sAdd(createWidget(widget.TEXT, { x: sp(94), y: spdY, w: sp(140), h: sp(32), text: getText('shelfReadSpeed'), text_size: sp(M.tsMeta), color: COL_SUB, align_v: align.CENTER_V }))
    sAdd(createWidget(widget.TEXT, { x: sp(200), y: spdY, w: sp(186), h: sp(32), text: speed + getText('shelfSpeedUnit'), text_size: sp(M.tsVal), color: COL_ACCENT, align_h: align.RIGHT, align_v: align.CENTER_V }))
  }

  // ── 每周阅读趋势图 ──
  sAdd(createWidget(widget.TEXT, { x: sp(76), y: sp(208), w: sp(328), h: sp(20), text: getText('shelfRecent7d'), text_size: sp(M.tsMeta), color: COL_SUB, align_h: align.CENTER_H }))

  var weekDays = [getText('weekSun'), getText('weekMon'), getText('weekTue'), getText('weekWed'), getText('weekThu'), getText('weekFri'), getText('weekSat')]
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
  sAdd(createWidget(widget.FILL_RECT, { x: chartX, y: chartY, w: chartW, h: chartH, radius: sp(M.rowR), color: COL_PANEL }))

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
    var barColor = chartData[bi].isToday ? ACCENT : C.cardAlt
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
  var statsCloseBg = sAdd(createWidget(widget.FILL_RECT, { x: sp(164), y: sp(366), w: sp(152), h: sp(M.btnH), radius: sp(22), color: COL_PANEL_SOFT }))
  sAdd(createWidget(widget.TEXT, { x: sp(164), y: sp(366), w: sp(152), h: sp(M.btnH), text: getText('shelfBack'), text_size: sp(M.tsRow), color: COL_TEXT, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  var cl = sAdd(createWidget(widget.FILL_RECT, { x: sp(158), y: sp(362), w: sp(164), h: sp(M.btnH + 8), radius: sp(22), color: 0x000000, alpha: 0 }))
  cl.addEventListener(event.CLICK_DOWN, function () { btnFlash(statsCloseBg, COL_PANEL_SOFT); clearStats() })
  // 淡入动画
  var statsOverlay = statsWidgets.length > 0 ? statsWidgets[0] : null
  setTimeout(function () { if (statsOverlay) animFadeGroup([statsOverlay], 0, 255, 8, 35) }, 10)
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
  var bg = aAdd(createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: 480, color: C.bg, alpha: 255 }))
  try { bg.setProperty(prop.MORE, { alpha: 0 }) } catch (e) {}
  bg.addEventListener(event.CLICK_DOWN, function () { clearAbout() }) // 点空白处关闭

  // 不画底板卡片：348 宽 × 378 高的方卡在圆屏上四角必然出界（实测顶到 245 > 238）。
  // 关于页内容本身就铺满整屏，直接用不透明背景承载，只保留顶部琥珀签名条。
  var cardX = sp(66), cardW = sp(348)
  aAdd(createWidget(widget.FILL_RECT, { x: Math.round((W - sp(32)) / 2), y: sp(52), w: sp(32), h: sp(3), radius: sp(2), color: COL_ACCENT }))

  // 标题 + 版本（紧凑分组）
  aAdd(createWidget(widget.TEXT, { x: cardX, y: sp(78), w: cardW, h: sp(26), text: getText('shelfAboutTitle'), text_size: sp(19), color: COL_TEXT, align_h: align.CENTER_H }))
  aAdd(createWidget(widget.TEXT, { x: cardX, y: sp(104), w: cardW, h: sp(18), text: getText('shelfAboutSub'), text_size: sp(M.tsVal), color: ACCENT, align_h: align.CENTER_H }))

  // 分隔线
  aAdd(createWidget(widget.FILL_RECT, { x: cardX + sp(40), y: sp(128), w: cardW - sp(80), h: 1, color: C.line }))

  // 特性列表：单列正文式，每行前缀琥珀圆点，更干净有层次
  var features = [getText('shelfFeatDisguise'), getText('shelfFeatBle'), getText('shelfFeatTheme'), getText('shelfFeatCrown')]
  var listY = sp(136), lineH = sp(17)
  for (var fi = 0; fi < features.length; fi++) {
    var fy = listY + fi * lineH
    aAdd(createWidget(widget.FILL_RECT, { x: cardX + sp(40), y: fy + sp(7), w: sp(5), h: sp(5), radius: sp(3), color: COL_ACCENT }))
    aAdd(createWidget(widget.TEXT, { x: cardX + sp(54), y: fy, w: cardW - sp(94), h: lineH, text: features[fi], text_size: sp(M.tsVal), color: COL_TEXT, align_v: align.CENTER_V }))
  }

  // 支持开发者：爱发电赞赏码（新增）
  aAdd(createWidget(widget.TEXT, { x: cardX, y: sp(214), w: cardW, h: sp(18), text: getText('shelfAboutSupport'), text_size: sp(M.tsMeta), color: COL_SUB, align_h: align.CENTER_H }))

  // 双二维码并排：左爱发电赞赏 / 右开源仓库
  var QR = sp(140), qgap = sp(16)
  var qx0 = (W - (QR * 2 + qgap)) / 2
  var qy = sp(232)
  try {
    aAdd(createWidget(widget.IMG, { x: qx0, y: qy, w: QR, h: QR, src: 'qr_ifdian.png' }))
  } catch (e) {
    // 资源缺失时的占位回退
    aAdd(createWidget(widget.FILL_RECT, { x: qx0, y: qy, w: QR, h: QR, radius: sp(8), color: 0x222222 }))
  }
  try {
    aAdd(createWidget(widget.IMG, { x: qx0 + QR + qgap, y: qy, w: QR, h: QR, src: 'qr_github.png' }))
  } catch (e) {
    aAdd(createWidget(widget.FILL_RECT, { x: qx0 + QR + qgap, y: qy, w: QR, h: QR, radius: sp(8), color: 0x222222 }))
  }
  // 二维码下标签
  aAdd(createWidget(widget.TEXT, { x: qx0, y: qy + QR + sp(4), w: QR, h: sp(14), text: getText('shelfAboutDonate'), text_size: sp(M.tsMeta), color: COL_MUTED, align_h: align.CENTER_H }))
  aAdd(createWidget(widget.TEXT, { x: qx0 + QR + qgap, y: qy + QR + sp(4), w: QR, h: sp(14), text: getText('shelfAboutQr'), text_size: sp(M.tsMeta), color: COL_MUTED, align_h: align.CENTER_H }))

  // 底部版本行
  aAdd(createWidget(widget.FILL_RECT, { x: cardX + sp(40), y: sp(394), w: cardW - sp(80), h: 1, color: C.line }))
  aAdd(createWidget(widget.TEXT, { x: cardX, y: sp(398), w: cardW, h: sp(14), text: getText('shelfAboutFooter'), text_size: sp(M.tsMeta), color: COL_MUTED, align_h: align.CENTER_H }))

  // 淡入动画（仅遮罩淡入，底板及内容直接显示）
  var aboutOverlay = aboutWidgets.length > 0 ? aboutWidgets[0] : null
  setTimeout(function () { if (aboutOverlay) animFadeGroup([aboutOverlay], 0, 255, 8, 35) }, 10)
}

Page({
  build() {
    shelfAlive = true
    computeShelfLayout()
    updateTileSizes()
    createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: W, color: COL_BG })
    createWidget(widget.TEXT, {
      x: sp(140), y: sp(16), w: sp(200), h: sp(26),
      text: getText('shelfTitle'), text_size: sp(M.tsTitle), color: COL_TEXT,
      align_h: align.CENTER_H
    })
    // 标题下方强调下划线（签名元素，统一圆形屏视觉语言）
    createWidget(widget.FILL_RECT, { x: sp(224), y: sp(42), w: sp(32), h: sp(3), radius: sp(2), color: COL_ACCENT })
    // 顶部三个功能钮：改密 / 统计 / 关于
    var _bw = sp(84), _bh = sp(32), _by = sp(60)
    var _bgap = sp(12)
    var _bx0 = Math.round((W - (3 * _bw + 2 * _bgap)) / 2)
    var _labels = [
      { t: getText('shelfBtnPwd'), f: function () { showPwdPanel() } },
      { t: getText('shelfBtnStats'), f: function () { showStats() } },
      { t: getText('shelfBtnAbout'), f: function () { showAbout() } }
    ]
    for (var _bi = 0; _bi < 3; _bi++) {
      var _bx = _bx0 + _bi * (_bw + _bgap)
      var _bg2 = createWidget(widget.FILL_RECT, { x: _bx, y: _by, w: _bw, h: _bh, radius: Math.round(_bh / 2), color: COL_PANEL })
      createWidget(widget.TEXT, { x: _bx, y: _by, w: _bw, h: _bh, text: _labels[_bi].t, text_size: sp(M.tsMeta), color: COL_ACCENT_SOFT, align_h: align.CENTER_H, align_v: align.CENTER_V })
      var _touch = createWidget(widget.FILL_RECT, { x: _bx - sp(3), y: _by - sp(4), w: _bw + sp(6), h: _bh + sp(8), radius: Math.round(_bh / 2), color: 0x000000, alpha: 0 })
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
