/**
 * 阅读样式调整页（独立页面，从阅读器菜单「样式」进入）
 * 视觉语言与阅读器菜单一致（utils/ui.js）：独立胶囊行 + 圆形步进钮 + 自绘滑条。
 * 预览区不画外框，直接用主题底色铺一块圆角区域 —— 它本身就是「纸张」的样子。
 * 设置写入 reading_progress（与阅读页共用），阅读页 onShow 时重新应用。
 * 阅读正文排版逻辑不在此页，任何调整只影响设置值。
 */
import { createWidget, widget, align, event, prop, deleteWidget } from '@zos/ui'
import { back } from '@zos/router'
import { localStorage } from '@zos/storage'
import { setBrightness } from '@zos/display'
import { getText } from '@zos/i18n'
import { getDeviceInfo } from '@zos/device'
import { C, M, makeSlider, rowW, setScale } from '../utils/ui'

var W = 480
function sp(v) { return Math.round(v * W / 480) }

var FONT_SIZES = (function () { var a = []; for (var s = 12; s <= 36; s++) a.push(s); return a })()
var SPACINGS = [1.0, 1.18, 1.36, 1.58]
var SPACING_LABELS = ['spacingTight', 'spacingNormal', 'spacingLoose', 'spacingLarge']
var THEMES = [
  { nameKey: 'themeNight', bg: 0x0E0E0E, fg: 0xE8E8E8, sub: 0xA6A6A6, bar: 0xD8924B, barbg: 0x2A2A2A },
  { nameKey: 'themeEye', bg: 0x12211A, fg: 0xCBE3CE, sub: 0x6E8F76, bar: 0x5AAE78, barbg: 0x24382C },
  { nameKey: 'themePaper', bg: 0xE9E0CB, fg: 0x3A352A, sub: 0x8C8064, bar: 0xB5772E, barbg: 0xCFC3A6 },
  { nameKey: 'themeBlack', bg: 0x000000, fg: 0xC6C6C6, sub: 0x707070, bar: 0xC07A33, barbg: 0x1C1C1C },
  { nameKey: 'themeDusk', bg: 0x1A1020, fg: 0xD8C8E8, sub: 0x8878A0, bar: 0xA060D0, barbg: 0x2A1838 },
  { nameKey: 'themeFog', bg: 0xF0F0F0, fg: 0x2A2A2A, sub: 0xA6A6A6, bar: 0xD8924B, barbg: 0xD8D8D8 },
  { nameKey: 'themeAutumn', bg: 0x1C1810, fg: 0xE0D0B0, sub: 0x9A8A6A, bar: 0xD4A040, barbg: 0x2C2418 },
  { nameKey: 'themeIce', bg: 0x0C1420, fg: 0xFFFFFF, sub: 0x9A9A9A, bar: 0xD8924B, barbg: 0x182838 }
]

var bookId = '0'
var fontIdx = 8, spacingIdx = 1, brightVal = 75, themeIdx = 0
var widgets = []
var previewBg = null, previewLines = []
var fontVal = null, spacingVal = null, brightValText = null, themeValText = null
var UIDEPS = { createWidget: createWidget, widget: widget, event: event, prop: prop }

function wAdd(w) { widgets.push(w); return w }
function theme() { return THEMES[themeIdx] }

// 行几何：与菜单同一算法（圆屏可用宽自适应，上限 352）
var ROW_H = 44, ROW_PITCH = 52, ROW_CAP = 352
function rowGeo(y, h) {
  var w = Math.min(sp(ROW_CAP), rowW(y, h))
  return { x: Math.round((W - w) / 2), w: w }
}

function loadStyle() {
  try {
    var all = JSON.parse(localStorage.getItem('reading_progress', '{}'))
    var s = all[String(bookId)] || null
    if (!s) return
    if (s.fontSize) { for (var i = 0; i < FONT_SIZES.length; i++) if (FONT_SIZES[i] === s.fontSize) fontIdx = i }
    if (s.spacingIdx !== undefined && s.spacingIdx >= 0 && s.spacingIdx < SPACINGS.length) spacingIdx = s.spacingIdx
    if (s.brightVal !== undefined && (s.brightVal === -1 || (s.brightVal >= 5 && s.brightVal <= 100))) brightVal = s.brightVal
    if (s.themeIdx !== undefined && s.themeIdx >= 0 && s.themeIdx < THEMES.length) themeIdx = s.themeIdx
  } catch (e) {}
}

function saveStyle() {
  try {
    var all = {}
    try { all = JSON.parse(localStorage.getItem('reading_progress', '{}')) } catch (e) {}
    var cur = all[String(bookId)] || {}
    cur.fontSize = FONT_SIZES[fontIdx]
    cur.spacingIdx = spacingIdx
    cur.brightVal = brightVal
    cur.themeIdx = themeIdx
    cur.ts = Date.now()
    all[String(bookId)] = cur
    localStorage.setItem('reading_progress', JSON.stringify(all))
  } catch (e) {}
}

// 按当前字号估算每行可容纳字符数，把示例文字切行（与阅读页同口径）
function splitSample(text, maxChars) {
  var lines = [], cur = ''
  for (var i = 0; i < text.length; i++) {
    if (text[i] === '\n') { lines.push(cur); cur = ''; continue }
    cur += text[i]
    if (cur.length >= maxChars) { lines.push(cur); cur = '' }
  }
  if (cur) lines.push(cur)
  return lines
}

// 预览区：y=54 处圆屏可用宽只有 ~287，取 280 保证四角不出圆
var PV_Y = 54, PV_H = 96, PV_W = 280

function updatePreview() {
  var th = theme()
  var size = FONT_SIZES[fontIdx]
  var ts = sp(size)                        // 缩放后的字号
  var lh = Math.round(ts * SPACINGS[spacingIdx])   // 行高随字号缩放
  var pvW = sp(PV_W), pvX = Math.round((W - pvW) / 2)
  var innerH = sp(PV_H) - sp(16)
  var maxChars = Math.max(4, Math.floor((pvW - sp(28)) / (ts * 1.02)))
  var sample = splitSample(getText('readerStyleSample'), maxChars)
  var n = Math.max(1, Math.min(sample.length, Math.floor(innerH / lh)))
  // 背景同样全量更新：只传 color 在部分固件上不重绘/丢几何，主题切换后底色不变
  try { previewBg.setProperty(prop.MORE, { x: pvX, y: sp(PV_Y), w: pvW, h: sp(PV_H), radius: sp(M.cardR), color: th.bg }) } catch (e) {}
  for (var i = 0; i < previewLines.length; i++) {
    // 全量属性更新：部分固件 setProperty(prop.MORE) 是替换语义，
    // 漏传 x/w/align 会把控件重置到 (0,0) 宽度 0 —— 预览文字就会挤在左上角/不可见。
    if (i < n && sample[i]) {
      try { previewLines[i].setProperty(prop.MORE, {
        x: pvX + sp(14), y: sp(PV_Y) + sp(8) + i * lh, w: pvW - sp(28), h: lh,
        text: sample[i], text_size: ts, color: th.fg,
        align_h: align.CENTER_H, align_v: align.CENTER_V, alpha: 255
      }) } catch (e) {}
    } else {
      try { previewLines[i].setProperty(prop.MORE, {
        x: pvX + sp(14), y: sp(PV_Y) + sp(8) + i * lh, w: pvW - sp(28), h: lh,
        text: '', text_size: ts, color: th.fg,
        align_h: align.CENTER_H, align_v: align.CENTER_V, alpha: 0
      }) } catch (e) {}
    }
  }
}

function changeFont(d) {
  var ni = fontIdx + d
  if (ni < 0) ni = 0
  if (ni > FONT_SIZES.length - 1) ni = FONT_SIZES.length - 1
  if (ni === fontIdx) return
  fontIdx = ni
  updatePreview()
  try { fontVal.setProperty(prop.TEXT, String(FONT_SIZES[fontIdx])) } catch (e) {}
  saveStyle()
}
function changeSpacing(d) {
  var ni = spacingIdx + d
  if (ni < 0) ni = 0
  if (ni > SPACINGS.length - 1) ni = SPACINGS.length - 1
  if (ni === spacingIdx) return
  spacingIdx = ni
  updatePreview()
  try { spacingVal.setProperty(prop.TEXT, getText(SPACING_LABELS[spacingIdx])) } catch (e) {}
  saveStyle()
}
// 亮度滑条：1~20 档（每档 5%），最左一档表示跟随系统
function applyBrightStep(step) {
  brightVal = step <= 1 ? -1 : step * 5
  if (brightVal >= 5) { try { setBrightness({ brightness: brightVal }) } catch (e) {} }
  try { brightValText.setProperty(prop.TEXT, brightVal < 0 ? getText('readerBrightnessSystem') : brightVal + '%') } catch (e) {}
  saveStyle()
}
function changeTheme(d) {
  themeIdx = (themeIdx + d + THEMES.length) % THEMES.length
  updatePreview()
  try { themeValText.setProperty(prop.TEXT, getText(theme().nameKey)) } catch (e) {}
  saveStyle()
}

// 圆形步进钮（38 直径）：圆屏上圆钮比方块协调，热区再外扩 6px
function stepBtn(cx, cy, label, onClick) {
  var d = sp(M.stepBtn), x = cx - Math.round(d / 2), y = cy - Math.round(d / 2)
  wAdd(createWidget(widget.FILL_RECT, { x: x, y: y, w: d, h: d, radius: Math.round(d / 2), color: C.cardAlt }))
  wAdd(createWidget(widget.TEXT, { x: x, y: y, w: d, h: d, text: label, text_size: sp(20), color: C.text, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  var t = wAdd(createWidget(widget.FILL_RECT, { x: x - sp(6), y: y - sp(6), w: d + sp(12), h: d + sp(12), radius: Math.round(d / 2) + sp(6), color: 0x000000, alpha: 0 }))
  t.addEventListener(event.CLICK_DOWN, onClick)
}

// 步进行：独立胶囊 + label 左 + [−] 值 [+] 右
function stepRow(y, label, valueText, onMinus, onPlus) {
  var h = sp(ROW_H)
  var g = rowGeo(y, h)
  var cy = y + Math.round(h / 2)
  wAdd(createWidget(widget.FILL_RECT, { x: g.x, y: y, w: g.w, h: h, radius: Math.round(h / 2), color: C.card }))
  wAdd(createWidget(widget.TEXT, { x: g.x + sp(M.padX), y: y, w: sp(70), h: h, text: label, text_size: sp(M.tsRow), color: C.text, align_v: align.CENTER_V }))
  stepBtn(g.x + g.w - sp(M.padX) - sp(19), cy, '+', onPlus)
  var vt = wAdd(createWidget(widget.TEXT, { x: g.x + g.w - sp(M.padX) - sp(38) - sp(76), y: y, w: sp(76), h: h, text: valueText, text_size: sp(M.tsVal), color: C.accent, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  stepBtn(g.x + g.w - sp(M.padX) - sp(38) - sp(76) - sp(19), cy, '-', onMinus)
  return vt
}

function buildUI() {
  createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: W, color: C.bg })

  // 预览区：直接用主题底色铺一块圆角「纸张」，不套外框
  var pvW = sp(PV_W), pvX = Math.round((W - pvW) / 2)
  previewBg = wAdd(createWidget(widget.FILL_RECT, { x: pvX, y: sp(PV_Y), w: pvW, h: sp(PV_H), radius: sp(M.cardR), color: theme().bg }))
  // 三行示例文字：创建时按默认行高（24）分行排布，避免全部叠在 y=PV_Y+8
  for (var i = 0; i < 3; i++) {
    previewLines.push(wAdd(createWidget(widget.TEXT, {
      x: pvX + sp(14), y: sp(PV_Y) + sp(8) + i * sp(24), w: pvW - sp(28), h: sp(24), text: '', text_size: 12,
      color: theme().fg, align_h: align.CENTER_H, align_v: align.CENTER_V
    })))
  }

  // 四行独立胶囊：字号 / 行距 / 主题 / 亮度
  var y0 = sp(164), pitch = sp(ROW_PITCH), h = sp(ROW_H)
  fontVal = stepRow(y0, getText('readerFont'), String(FONT_SIZES[fontIdx]), function () { changeFont(-1) }, function () { changeFont(1) })
  spacingVal = stepRow(y0 + pitch, getText('readerSpacing'), getText(SPACING_LABELS[spacingIdx]), function () { changeSpacing(-1) }, function () { changeSpacing(1) })
  themeValText = stepRow(y0 + pitch * 2, getText('readerTheme'), getText(theme().nameKey), function () { changeTheme(-1) }, function () { changeTheme(1) })

  // 亮度行：label + 自绘滑条 + 值
  var bY = y0 + pitch * 3
  var gb = rowGeo(bY, h)
  wAdd(createWidget(widget.FILL_RECT, { x: gb.x, y: bY, w: gb.w, h: h, radius: Math.round(h / 2), color: C.card }))
  wAdd(createWidget(widget.TEXT, { x: gb.x + sp(M.padX), y: bY, w: sp(56), h: h, text: getText('readerBrightness'), text_size: sp(M.tsRow), color: C.text, align_v: align.CENTER_V }))
  brightValText = wAdd(createWidget(widget.TEXT, { x: gb.x + gb.w - sp(M.padX) - sp(50), y: bY, w: sp(50), h: h, text: brightVal < 0 ? getText('readerBrightnessSystem') : brightVal + '%', text_size: sp(M.tsMeta), color: C.accent, align_h: align.RIGHT, align_v: align.CENTER_V }))
  var slX = gb.x + sp(M.padX) + sp(62)
  var slW = (gb.x + gb.w - sp(M.padX) - sp(56)) - slX
  makeSlider(UIDEPS, wAdd, slX, bY + Math.round((h - sp(M.sliderKnob)) / 2), slW, 1, 20, brightVal < 0 ? 1 : Math.max(1, Math.round(brightVal / 5)), applyBrightStep)

  // 完成：底部琥珀胶囊（保存并返回）
  var doneW = sp(200), doneX = Math.round((W - doneW) / 2), doneY = sp(368), doneH = sp(M.btnH)
  wAdd(createWidget(widget.FILL_RECT, { x: doneX, y: doneY, w: doneW, h: doneH, radius: Math.round(doneH / 2), color: C.accent }))
  wAdd(createWidget(widget.TEXT, { x: doneX, y: doneY, w: doneW, h: doneH, text: getText('readerStyleBack'), text_size: sp(M.tsRow), color: C.onAccent, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  var doneTouch = wAdd(createWidget(widget.FILL_RECT, { x: doneX - sp(8), y: doneY - sp(6), w: doneW + sp(16), h: doneH + sp(12), radius: Math.round(doneH / 2) + sp(6), color: 0x000000, alpha: 0 }))
  doneTouch.addEventListener(event.CLICK_DOWN, function () { saveStyle(); back() })

  updatePreview()
}

Page({
  onInit(params) {
    try {
      var p = JSON.parse(params || '{}')
      if (p.bookId !== undefined && p.bookId !== null) bookId = String(p.bookId)
    } catch (e) {}
    try { var di = getDeviceInfo(); if (di && di.width) W = di.width } catch (e) {}
    setScale(W)
    loadStyle()
    buildUI()
  },
  onDestroy() {
    for (var i = 0; i < widgets.length; i++) { try { deleteWidget(widgets[i]) } catch (e) {} }
    widgets = []
    previewBg = null
    previewLines = []
  }
})
