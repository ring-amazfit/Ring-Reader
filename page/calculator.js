/**
 * 伪装科学计算器 v2 — 三页（基础 / 函数 / 三角）
 * 表达式求值，真实可用；输入密码(默认123456)按 = 进入隐藏书架。
 * UI 为圆角方钮 + 分类配色，自成一套（非圆形钮风格）。
 */

import { createWidget, widget, align, event, prop, deleteWidget } from '@zos/ui'
import { push } from '@zos/router'
import { onDigitalCrown, KEY_HOME, KEY_UP, KEY_DOWN, offDigitalCrown, onKey, offKey, onGesture, offGesture, GESTURE_LEFT, GESTURE_RIGHT, GESTURE_UP } from '@zos/interaction'
import { localStorage } from '@zos/storage'
import { getDeviceInfo } from '@zos/device'
import { crownDirection, crownDebounceMs, keyDirection } from '../utils/crown'

var W = 480, H = 480

var COL_BG = 0x141414
var COL_NUM = 0x242424
var COL_NUM_T = 0xF5F5F5
var COL_OP = 0x303030
var COL_OP_T = 0xEDEDED
var COL_FN = 0x3A3A3A
var COL_FN_T = 0xE0E0E0
var COL_DEL = 0x4A2C2C
var COL_DEL_T = 0xE7A6A6
var COL_EQ = 0xD8924B
var COL_EQ_T = 0xFFFFFF
var COL_DISP = 0xF5F5F5
var COL_SUB = 0x9A9A9A
var COL_PANEL = 0x181818
var COL_PANEL_SOFT = 0x202020
var COL_ACCENT_SOFT = 0xD8A25A
var COL_BORDER = 0x333333

// 网格：5 列 4 行，居中（computeLayout 按屏幕尺寸缩放）
var COLS = 5
var CELL = 62, GAP = 8, STEP = CELL + GAP
var GRID_X = 69, GRID_Y = 112, DOTS_Y = 392
function computeLayout() {
  var di; try { di = getDeviceInfo() } catch (e) { di = null }
  W = (di && di.width) ? di.width : 480
  H = (di && di.height) ? di.height : 480
  var S = W / 480
  CELL = Math.round(62 * S); GAP = Math.round(8 * S); STEP = CELL + GAP
  GRID_X = Math.round((W - (COLS * CELL + (COLS - 1) * GAP)) / 2)
  GRID_Y = Math.round(112 * S)
  DOTS_Y = H - Math.round(88 * S)
}

// 按钮类别
var NUM = 0, OP = 1, FN = 2, DEL = 3, EQ = 4, CV = 5

// d=显示串 p=求值串 c=类别 (act 特殊：clear/neg/conv；cv=换算函数)
function B(l, d, p, c, act, cv) { return { l: l, d: d, p: p === undefined ? d : p, c: c, act: act, cv: cv } }
function C(l, fn) { return { l: l, c: CV, act: 'conv', cv: fn } }   // 换算钮

// 标签用 ASCII 安全字符（手表系统字体可能不含上标/√），同时与参考圆钮风格区分
var PAGES = [
  // 基础
  [
    B('×', '×', '×', OP), B('7', '7'), B('8', '8'), B('9', '9'), B('+', '+', '+', OP),
    B('÷', '÷', '÷', OP), B('4', '4'), B('5', '5'), B('6', '6'), B('-', '-', '-', OP),
    B('±', '-', '-', OP, 'neg'), B('1', '1'), B('2', '2'), B('3', '3'), B('=', '', '', EQ, 'eq'),
    B('C', '', '', DEL, 'clear'), B('0', '0'), B('.', '.'), null, null
  ],
  // 函数
  [
    B('(', '(', '(', FN), B(')', ')', ')', FN), B('π', 'π', 'π', FN), B('e', 'e', 'e', FN), B('|x|', 'abs(', 'abs(', FN),
    B('x^2', '^2', '^2', FN), B('x^y', '^', '^', FN), B('ln', 'ln(', 'ln(', FN), B('log', 'log(', 'log(', FN), B('floor', 'floor(', 'floor(', FN),
    B('x^3', '^3', '^3', FN), B('x!', '!', '!', FN), B('sqrt', 'sqrt(', 'sqrt(', FN), B('cbrt', 'cbrt(', 'cbrt(', FN), B('ceil', 'ceil(', 'ceil(', FN),
    B('ans', 'ans', 'ans', FN), B('exp', 'exp(', 'exp(', FN), B('mod', '%', '%', OP), null, null
  ],
  // 三角
  [
    B('sin', 'sin(', 'sin(', FN), B('sec', 'sec(', 'sec(', FN), B('sinh', 'sinh(', 'sinh(', FN), B('sech', 'sech(', 'sech(', FN), B('asin', 'asin(', 'asin(', FN),
    B('cos', 'cos(', 'cos(', FN), B('csc', 'csc(', 'csc(', FN), B('cosh', 'cosh(', 'cosh(', FN), B('csch', 'csch(', 'csch(', FN), B('acos', 'acos(', 'acos(', FN),
    B('tan', 'tan(', 'tan(', FN), B('cot', 'cot(', 'cot(', FN), B('tanh', 'tanh(', 'tanh(', FN), B('coth', 'coth(', 'coth(', FN), B('atan', 'atan(', 'atan(', FN),
    B('asinh', 'asinh(', 'asinh(', FN), B('acosh', 'acosh(', 'acosh(', FN), B('atanh', 'atanh(', 'atanh(', FN), null, null
  ],
  // 单位换算（取当前数值，点一下即换算）
  [
    C('m>ft', function (v) { return v * 3.28084 }), C('ft>m', function (v) { return v / 3.28084 }), C('cm>in', function (v) { return v / 2.54 }), C('in>cm', function (v) { return v * 2.54 }), C('km>mi', function (v) { return v * 0.621371 }),
    C('mi>km', function (v) { return v / 0.621371 }), C('kg>lb', function (v) { return v * 2.20462 }), C('lb>kg', function (v) { return v / 2.20462 }), C('g>oz', function (v) { return v * 0.035274 }), C('oz>g', function (v) { return v / 0.035274 }),
    C('C>F', function (v) { return v * 9 / 5 + 32 }), C('F>C', function (v) { return (v - 32) * 5 / 9 }), C('L>gal', function (v) { return v * 0.264172 }), C('gal>L', function (v) { return v / 0.264172 }), C('km/h>m/s', function (v) { return v / 3.6 }),
    null, null, null, null, null
  ]
]

var tokens = []          // {d,p}
var cursor = 0           // 光标位置（插入点，0..tokens.length）
var lastAns = 0
var page = 0
var slots = []           // 按钮控件池
var dots = []            // 圆点控件池
var displayWidget = null
var calcBusy = false
var launchRedirected = false
var lastCrownTs = 0
var CROWN_DEBOUNCE = crownDebounceMs()

function getPwd() {
  try { var v = localStorage.getItem('calc_pwd', ''); if (v) return String(v) } catch (e) {}
  return '123456'
}

function dispStr(withCaret) {
  var parts = []
  for (var i = 0; i < tokens.length; i++) {
    if (withCaret && i === cursor) parts.push('|')
    parts.push(tokens[i].d)
  }
  if (withCaret && cursor >= tokens.length) parts.push('|')
  return parts.join('')
}
function parseStr() {
  var parts = []
  for (var i = 0; i < tokens.length; i++) parts.push(tokens[i].p)
  return parts.join('')
}

var _lastDispSize = 0
function updateDisplay(text) {
  var s = text !== undefined ? text : (tokens.length === 0 ? '0' : dispStr(true))
  var size = 38
  if (s.length > 7) size = 30
  if (s.length > 11) size = 22
  if (s.length > 16) size = 17
  if (s.length > 22) { size = 14; s = '…' + s.substring(s.length - 21) }
  if (displayWidget) {
    if (size !== _lastDispSize) {
      var S0 = W / 480
      displayWidget.setProperty(prop.MORE, {
        x: Math.round(92 * S0), y: Math.round(70 * S0), w: Math.round(248 * S0), h: Math.round(46 * S0), text: s, text_size: size, color: COL_DISP,
        align_h: align.RIGHT, align_v: align.CENTER_V
      })
      _lastDispSize = size
    } else {
      displayWidget.setProperty(prop.TEXT, s)
    }
  }
}

function moveCursor(d) {
  var nc = cursor + d
  if (nc < 0) nc = 0
  if (nc > tokens.length) nc = tokens.length
  if (nc === cursor) return
  cursor = nc
  updateDisplay()
}

// ── 表达式求值（递归下降）──
function fact(n) {
  // 171! 已超出 JavaScript Number；拒绝更大输入，避免手表主线程长时间循环。
  if (n < 0 || Math.floor(n) !== n || n > 170) return NaN
  var r = 1; for (var i = 2; i <= n; i++) r *= i; return r
}
var FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh,
  sec: function (x) { return 1 / Math.cos(x) }, csc: function (x) { return 1 / Math.sin(x) },
  cot: function (x) { return 1 / Math.tan(x) },
  sech: function (x) { return 1 / Math.cosh(x) }, csch: function (x) { return 1 / Math.sinh(x) },
  coth: function (x) { return 1 / Math.tanh(x) },
  ln: Math.log, log: function (x) { return Math.log(x) / Math.LN10 },
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, exp: Math.exp
}

function evaluate(str) {
  var s = str, pos = 0, len = s.length
  // 本地化 Math 引用，减少属性链查找
  var _pow = Math.pow, _PI = Math.PI, _E = Math.E, _LN10 = Math.LN10,
      _sin = Math.sin, _cos = Math.cos, _tan = Math.tan,
      _asin = Math.asin, _acos = Math.acos, _atan = Math.atan,
      _sinh = Math.sinh, _cosh = Math.cosh, _tanh = Math.tanh,
      _log = Math.log, _sqrt = Math.sqrt, _cbrt = Math.cbrt,
      _abs = Math.abs, _floor = Math.floor, _ceil = Math.ceil, _exp = Math.exp
  function skip() { while (pos < len && s[pos] === ' ') pos++ }
  function E() {
    var v = T()
    for (;;) {
      skip(); if (pos >= len) return v
      var cc = s.charCodeAt(pos)
      if (cc === 43) { pos++; v += T() }                      // +
      else if (cc === 45 || cc === 8722) { pos++; v -= T() }  // - or −
      else return v
    }
  }
  function T() {
    var v = P()
    for (;;) {
      skip(); if (pos >= len) return v
      var cc = s.charCodeAt(pos)
      if (cc === 215 || cc === 42) { pos++; v *= P() }       // × or *
      else if (cc === 247 || cc === 47) { pos++; v /= P() }  // ÷ or /
      else if (cc === 37) { pos++; v = v % P() }             // %
      else return v
    }
  }
  function P() {
    var v = U()
    skip()
    if (pos < len && s.charCodeAt(pos) === 94) { pos++; return _pow(v, P()) }
    return v
  }
  function U() {
    skip(); if (pos >= len) throw new Error('缺少操作数')
    var cc = s.charCodeAt(pos)
    if (cc === 45 || cc === 8722) { pos++; return -U() }
    if (cc === 43) { pos++; return U() }
    return Post()
  }
  function Post() {
    var v = Prim()
    for (;;) { skip(); if (pos < len && s.charCodeAt(pos) === 33) { pos++; v = fact(v) } else return v }
  }
  function Prim() {
    skip(); if (pos >= len) throw new Error('缺少操作数')
    var cc = s.charCodeAt(pos)
    if (cc === 40) {
      pos++; var v1 = E(); skip()
      if (pos >= len || s.charCodeAt(pos) !== 41) throw new Error('括号未闭合')
      pos++
      return v1
    }
    if (cc === 960) { pos++; return _PI }
    // 手动数字解析（避免 parseFloat + substring 分配）
    if ((cc >= 48 && cc <= 57) || cc === 46) {
      var num = 0, frac = 0, fracDiv = 1, hasDot = false, hasDigit = false
      while (pos < len) {
        var dc = s.charCodeAt(pos)
        if (dc >= 48 && dc <= 57) {
          if (hasDot) { frac = frac * 10 + (dc - 48); fracDiv *= 10 }
          else { num = num * 10 + (dc - 48) }
          hasDigit = true; pos++
        } else if (dc === 46 && !hasDot) { hasDot = true; pos++ }
        else break
      }
      if (!hasDigit) throw new Error('非法数字')
      return num + frac / fracDiv
    }
    // 函数名 / 常量（使用 FUNCS 表，避免展开大分支拖慢 QuickJS 解释器）
    if (cc >= 97 && cc <= 122) {
      var st2 = pos
      while (pos < len && s.charCodeAt(pos) >= 97 && s.charCodeAt(pos) <= 122) pos++
      var name = s.substring(st2, pos)
      if (name === 'e') {
        skip()
        if (pos < len && s.charCodeAt(pos) === 40) {
          pos++; var ae = E(); skip()
          if (pos >= len || s.charCodeAt(pos) !== 41) throw new Error('括号未闭合')
          pos++
          return _exp(ae)
        }
        return _E
      }
      if (name === 'pi') return _PI
      if (name === 'ans') return lastAns
      var fn = FUNCS[name]
      skip()
      if (!fn) throw new Error('未知函数')
      if (pos >= len || s.charCodeAt(pos) !== 40) throw new Error('函数缺少括号')
      pos++; var a = E(); skip()
      if (pos >= len || s.charCodeAt(pos) !== 41) throw new Error('括号未闭合')
      pos++
      return fn(a)
    }
    throw new Error('非法字符')
  }
  var r = E()
  skip()
  if (pos !== len) throw new Error('表达式不完整')
  return r
}

function fmtResult(v) {
  if (v === undefined || v === null || (typeof v === 'number' && (isNaN(v) || !isFinite(v)))) return 'Error'
  var n = +v
  if (Math.abs(n) >= 1e12 || (Math.abs(n) < 1e-9 && n !== 0)) return n.toExponential(6)
  var s = (Math.round(n * 1e9) / 1e9).toString()
  if (s.length > 14) s = n.toPrecision(10)
  return s
}

function pushToken(b) { tokens.splice(cursor, 0, { d: b.d, p: b.p }); cursor++; updateDisplay() }
function doClear() { tokens = []; cursor = 0; updateDisplay() }
function doDelete() { if (cursor > 0) { tokens.splice(cursor - 1, 1); cursor-- } updateDisplay() }
function doNeg() { tokens.splice(cursor, 0, { d: '-', p: '-' }); cursor++; updateDisplay() }

var _histCache = null
function saveHistory(expr, result) {
  try {
    if (!_histCache) {
      _histCache = []
      try { _histCache = JSON.parse(localStorage.getItem('calc_history', '[]')) } catch (e) {}
    }
    _histCache.push({ e: expr, r: result })
    if (_histCache.length > 20) _histCache = _histCache.slice(_histCache.length - 20)
    localStorage.setItem('calc_history', JSON.stringify(_histCache))
  } catch (e) {}
}

function doEquals() {
  if (calcBusy) return
  var ps = parseStr()
  if (ps === getPwd()) { tokens = []; cursor = 0; push({ url: 'page/bookshelf' }); return }
  if (tokens.length === 0) return
  calcBusy = true
  setTimeout(function () {
    try {
      var expr = dispStr(false)
      var v = evaluate(ps)
      var out = fmtResult(v)
      if (out === 'Error') { updateDisplay('Error'); tokens = []; cursor = 0; calcBusy = false; return }
      lastAns = +v
      setTimeout(function () { saveHistory(expr, String(out)) }, 0)
      setResultTokens(out)
    } catch (e) { updateDisplay('Error'); tokens = []; cursor = 0 }
    calcBusy = false
  }, 0)
}

function currentValue() {
  if (tokens.length === 0) return lastAns
  try { var v = evaluate(parseStr()); return isFinite(v) ? v : 0 } catch (e) { return 0 }
}
function setResultTokens(out) {
  tokens = []
  var s = String(out)
  for (var i = 0; i < s.length; i++) tokens.push({ d: s.charAt(i), p: s.charAt(i) })
  cursor = tokens.length
  updateDisplay()
}
function doConv(b) {
  var r = b.cv(currentValue())
  var out = fmtResult(r)
  if (out === 'Error') { updateDisplay('Error'); tokens = []; cursor = 0; return }
  lastAns = +r
  setResultTokens(out)
}

function onButton(b) {
  if (!b || calcBusy) return
  if (b.act === 'eq') doEquals()
  else if (b.act === 'clear') doClear()
  else if (b.act === 'neg') doNeg()
  else if (b.act === 'conv') doConv(b)
  else pushToken(b)
}

// ── 绘制 ──
function btnColors(c) {
  if (c === NUM) return [COL_NUM, COL_NUM_T]
  if (c === OP) return [COL_OP, COL_OP_T]
  if (c === FN) return [COL_FN, COL_FN_T]
  if (c === DEL) return [COL_DEL, COL_DEL_T]
  if (c === CV) return [COL_FN, COL_FN_T]   // 换算：与函数键同色系
  return [COL_EQ, COL_EQ_T]
}

function fsOf(label) {
  return label.length >= 5 ? 13 : (label.length >= 3 ? 16 : (label === '=' ? 26 : 22))
}

// 控件池：20 个槽位只建一次，切页只 setProperty 改文字/颜色 → 翻页流畅
function buildSlots() {
  for (var i = 0; i < slots.length; i++) { try { deleteWidget(slots[i].bg); deleteWidget(slots[i].txt); deleteWidget(slots[i].touch) } catch (e) {} }
  slots = []
  for (var idx = 0; idx < COLS * 4; idx++) {
    var row = Math.floor(idx / COLS), col = idx % COLS
    var x = GRID_X + col * STEP, y = GRID_Y + row * STEP
    var bg = createWidget(widget.FILL_RECT, { x: x, y: y, w: CELL, h: CELL, radius: 16, color: COL_BG })
    var txt = createWidget(widget.TEXT, { x: x, y: y, w: CELL, h: CELL, text: '', text_size: 20, color: 0xFFFFFF, align_h: align.CENTER_H, align_v: align.CENTER_V })
    var touch = createWidget(widget.FILL_RECT, { x: x, y: y, w: CELL, h: CELL, radius: 16, color: 0x000000, alpha: 0 })
    var slot = { bg: bg, txt: txt, touch: touch, x: x, y: y, base: COL_BG }
    touch.addEventListener(event.CLICK_DOWN, (function (s, i) {
      return function () {
        var b = PAGES[page][i]
        if (!b) return
        pressFlash(s.bg, s.base, s.x, s.y)
        onButton(b)
      }
    })(slot, idx))
    slots.push(slot)
  }
}

var _lastPageDefs = null
function applyPage() {
  var defs = PAGES[page]
  for (var idx = 0; idx < slots.length; idx++) {
    var s = slots[idx], b = defs[idx], prev = _lastPageDefs ? _lastPageDefs[idx] : null
    if (b) {
      var cc = btnColors(b.c)
      if (!prev || prev.l !== b.l || prev.c !== b.c) {
        s.base = cc[0]
        try { s.bg.setProperty(prop.MORE, { x: s.x, y: s.y, w: CELL, h: CELL, radius: 16, color: cc[0] }) } catch (e) {}
        try { s.txt.setProperty(prop.MORE, { x: s.x, y: s.y, w: CELL, h: CELL, text: b.l, text_size: fsOf(b.l), color: cc[1], align_h: align.CENTER_H, align_v: align.CENTER_V }) } catch (e) {}
      }
    } else if (prev) {
      s.base = COL_BG
      try { s.bg.setProperty(prop.MORE, { x: s.x, y: s.y, w: CELL, h: CELL, radius: 16, color: COL_BG }) } catch (e) {}
      try { s.txt.setProperty(prop.TEXT, '') } catch (e) {}
    }
  }
  _lastPageDefs = defs
}

function clearGrid() {
  for (var i = 0; i < slots.length; i++) { try { deleteWidget(slots[i].bg); deleteWidget(slots[i].txt); deleteWidget(slots[i].touch) } catch (e) {} }
  slots = []
  for (var j = 0; j < dots.length; j++) { try { deleteWidget(dots[j].d); deleteWidget(dots[j].t) } catch (e) {} }
  dots = []
}

// 按下高亮：瞬时提亮按钮底色，100ms 后还原
function lighten(c) {
  var r = (c >> 16) & 0xFF, g = (c >> 8) & 0xFF, b = c & 0xFF
  return (Math.min(255, r + 40) << 16) | (Math.min(255, g + 40) << 8) | Math.min(255, b + 40)
}
function pressFlash(bw, base, gx, gy) {
  bw.setProperty(prop.MORE, { x: gx, y: gy, w: CELL, h: CELL, radius: 16, color: lighten(base) })
  setTimeout(function () { try { bw.setProperty(prop.MORE, { x: gx, y: gy, w: CELL, h: CELL, radius: 16, color: base }) } catch (e) {} }, 25)
}

// 圆点也用池：只建一次，切页改宽度/颜色
function buildDots() {
  for (var i = 0; i < dots.length; i++) { try { deleteWidget(dots[i].d) } catch (e) {} }
  dots = []
  var n = PAGES.length, dw = 8, dgap = 14, totalW = n * dw + (n - 1) * dgap
  var sx = Math.round((W - totalW) / 2), y = DOTS_Y
  for (var p = 0; p < n; p++) {
    var dx = sx + p * (dw + dgap)
    var d = createWidget(widget.FILL_RECT, { x: dx, y: y, w: dw, h: dw, radius: 4, color: COL_PANEL_SOFT })
    var t = createWidget(widget.FILL_RECT, { x: dx - 8, y: y - 12, w: dw + 16, h: 32, color: 0x000000, alpha: 0 })
    t.addEventListener(event.CLICK_DOWN, (function (pp) { return function () { setPage(pp) } })(p))
    dots.push({ d: d, t: t, x: dx, y: y })
  }
}
function applyDots() {
  for (var p = 0; p < dots.length; p++) {
    var active = p === page
    try { dots[p].d.setProperty(prop.MORE, { x: dots[p].x, y: dots[p].y, w: active ? 18 : 8, h: 8, radius: 4, color: active ? COL_EQ : COL_BORDER }) } catch (e) {}
  }
}

function setPage(p) {
  page = (p + PAGES.length) % PAGES.length
  applyPage()
  applyDots()
}

// ── 历史记录（控件池版：只建一次，开关只改文字/可见性）──
var hist = { active: false }
var histBg = null, histTitle = null, histRows = [], histNoText = null
var histClearTxt = null, histCloseTxt = null, MAX_HIST = 5
var startY = 104, rowH = 42

function buildHistPool() {
  var S = W / 480
  histBg = createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: H, color: 0x000000, alpha: 222 })
  histBg.addEventListener(event.CLICK_DOWN, function () {})
  createWidget(widget.FILL_RECT, { x: Math.round(78 * S), y: Math.round(62 * S), w: Math.round(324 * S), h: Math.round(346 * S), radius: Math.round(12 * S), color: COL_PANEL_SOFT })
  histTitle = createWidget(widget.TEXT, { x: Math.round(92 * S), y: Math.round(74 * S), w: Math.round(296 * S), h: 22, text: '历史记录', text_size: 16, color: COL_ACCENT_SOFT, align_h: align.CENTER_H })
  for (var i = 0; i < MAX_HIST; i++) {
    var y = Math.round(startY * S) + i * Math.round(rowH * S)
    var bg = createWidget(widget.FILL_RECT, { x: Math.round(92 * S), y: y, w: Math.round(296 * S), h: Math.round(rowH * S) - 6, radius: 6, color: COL_PANEL })
    var expr = createWidget(widget.TEXT, { x: Math.round(104 * S), y: y + 3, w: Math.round(272 * S), h: 16, text: '', text_size: 12, color: COL_SUB })
    var res = createWidget(widget.TEXT, { x: Math.round(104 * S), y: y + 18, w: Math.round(272 * S), h: 18, text: '', text_size: 15, color: COL_NUM_T })
    var touch = createWidget(widget.FILL_RECT, { x: Math.round(92 * S), y: y, w: Math.round(296 * S), h: Math.round(rowH * S) - 6, radius: 8, color: 0x000000, alpha: 0 })
    histRows.push({ bg: bg, expr: expr, res: res, touch: touch })
  }
  histNoText = createWidget(widget.TEXT, { x: Math.round(92 * S), y: Math.round(200 * S), w: Math.round(296 * S), h: 24, text: '', text_size: 14, color: COL_SUB, align_h: align.CENTER_H })
  createWidget(widget.FILL_RECT, { x: Math.round(96 * S), y: Math.round(344 * S), w: Math.round(128 * S), h: Math.round(38 * S), radius: 9, color: COL_DEL })
  histClearTxt = createWidget(widget.TEXT, { x: Math.round(96 * S), y: Math.round(344 * S), w: Math.round(128 * S), h: Math.round(38 * S), text: '清空', text_size: 14, color: 0xE7A6A6, align_h: align.CENTER_H, align_v: align.CENTER_V })
  var clr = createWidget(widget.FILL_RECT, { x: Math.round(96 * S), y: Math.round(344 * S), w: Math.round(128 * S), h: Math.round(38 * S), radius: 9, color: 0x000000, alpha: 0 })
  clr.addEventListener(event.CLICK_DOWN, function () { _histCache = []; try { localStorage.setItem('calc_history', '[]') } catch (e) {} closeHistory(); openHistory() })
  createWidget(widget.FILL_RECT, { x: Math.round(256 * S), y: Math.round(344 * S), w: Math.round(128 * S), h: Math.round(38 * S), radius: 9, color: COL_BORDER })
  histCloseTxt = createWidget(widget.TEXT, { x: Math.round(256 * S), y: Math.round(344 * S), w: Math.round(128 * S), h: Math.round(38 * S), text: '关闭', text_size: 14, color: COL_FN_T, align_h: align.CENTER_H, align_v: align.CENTER_V })
  var cl = createWidget(widget.FILL_RECT, { x: Math.round(256 * S), y: Math.round(344 * S), w: Math.round(128 * S), h: Math.round(38 * S), radius: 9, color: 0x000000, alpha: 0 })
  cl.addEventListener(event.CLICK_DOWN, function () { closeHistory() })
  setHistVisible(false)
}

function setHistVisible(v) {
  var a = v ? 255 : 0
  try { histBg.setProperty(prop.MORE, { alpha: v ? 222 : 0 }) } catch (e) {}
  try { histTitle.setProperty(prop.MORE, { alpha: a }) } catch (e) {}
  try { histNoText.setProperty(prop.MORE, { alpha: a }) } catch (e) {}
  try { histClearTxt.setProperty(prop.MORE, { alpha: a }) } catch (e) {}
  try { histCloseTxt.setProperty(prop.MORE, { alpha: a }) } catch (e) {}
  for (var i = 0; i < histRows.length; i++) {
    try { histRows[i].bg.setProperty(prop.MORE, { alpha: a }) } catch (e) {}
    try { histRows[i].expr.setProperty(prop.MORE, { alpha: a }) } catch (e) {}
    try { histRows[i].res.setProperty(prop.MORE, { alpha: a }) } catch (e) {}
    try { histRows[i].touch.setProperty(prop.MORE, { alpha: 0 }) } catch (e) {}
  }
}

function closeHistory() {
  // 淡出动画后关闭
  var fadeWidgets = []
  if (histBg) fadeWidgets.push(histBg)
  if (histTitle) fadeWidgets.push(histTitle)
  if (histNoText) fadeWidgets.push(histNoText)
  if (histClearTxt) fadeWidgets.push(histClearTxt)
  if (histCloseTxt) fadeWidgets.push(histCloseTxt)
  if (fadeWidgets.length > 0) {
    var _tw = fadeWidgets
    animFadeGroup(_tw, 255, 0, 6, 30, function () {
      setHistVisible(false)
      hist.active = false
    })
  } else {
    setHistVisible(false)
    hist.active = false
  }
}

function openHistory() {
  if (hist.active) return
  if (!histBg) buildHistPool()
  hist.active = true
  var h = _histCache || []
  if (!_histCache) { try { h = _histCache = JSON.parse(localStorage.getItem('calc_history', '[]')) } catch (e) { h = [] } }
  var n = Math.min(h.length, MAX_HIST)
  var S = W / 480
  for (var i = 0; i < MAX_HIST; i++) {
    if (i < n) {
      var it = h[h.length - 1 - i]
      var y = Math.round(startY * S) + i * Math.round(rowH * S)
      try { histRows[i].bg.setProperty(prop.MORE, { x: Math.round(92 * S), y: y, w: Math.round(296 * S), h: Math.round(rowH * S) - 6, radius: 8, color: COL_PANEL, alpha: 255 }) } catch (e) {}
      try { histRows[i].expr.setProperty(prop.TEXT, trim(it.e, 26)) } catch (e) {}
      try { histRows[i].res.setProperty(prop.TEXT, '= ' + trim(it.r, 22)) } catch (e) {}
      try { histRows[i].touch.setProperty(prop.MORE, { alpha: 0 }) } catch (e) {}
      histRows[i].touch.removeAllListeners && histRows[i].touch.removeAllListeners()
      histRows[i].touch.addEventListener(event.CLICK_DOWN, (function (res) { return function () { closeHistory(); insertText(res) } })(it.r))
    } else {
      try { histRows[i].bg.setProperty(prop.MORE, { alpha: 0 }) } catch (e) {}
      try { histRows[i].expr.setProperty(prop.TEXT, '') } catch (e) {}
      try { histRows[i].res.setProperty(prop.TEXT, '') } catch (e) {}
    }
  }
  try { histNoText.setProperty(prop.TEXT, n === 0 ? '暂无历史' : '') } catch (e) {}
  // 先设置可见，然后将关键控件 alpha 置 0 再淡入
  setHistVisible(true)
  var fadeInWidgets = []
  if (histBg) { try { histBg.setProperty(prop.MORE, { alpha: 0 }) } catch (e) {} fadeInWidgets.push(histBg) }
  if (histTitle) { try { histTitle.setProperty(prop.MORE, { alpha: 0 }) } catch (e) {} fadeInWidgets.push(histTitle) }
  if (histNoText) { try { histNoText.setProperty(prop.MORE, { alpha: 0 }) } catch (e) {} fadeInWidgets.push(histNoText) }
  if (histClearTxt) { try { histClearTxt.setProperty(prop.MORE, { alpha: 0 }) } catch (e) {} fadeInWidgets.push(histClearTxt) }
  if (histCloseTxt) { try { histCloseTxt.setProperty(prop.MORE, { alpha: 0 }) } catch (e) {} fadeInWidgets.push(histCloseTxt) }
  animFadeGroup(fadeInWidgets, 0, 255, 8, 30)
}
function trim(s, m) { s = String(s); return s.length > m ? s.substring(0, m - 1) + '…' : s }
function insertText(s) {
  for (var i = 0; i < s.length; i++) { tokens.splice(cursor, 0, { d: s.charAt(i), p: s.charAt(i) }); cursor++ }
  updateDisplay()
}

// ── 动画辅助 ──
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

function moveByInput(direction) {
  if (!direction || hist.active) return
  moveCursor(direction)
}

Page({
  onInit() {
    tokens = []; cursor = 0; page = 0; lastAns = 0; lastCrownTs = 0
  },
  onDestroy() {
    closeHistory()
    clearGrid()
    try { offDigitalCrown() } catch (e) {}
    try { offKey() } catch (e) {}
    try { offGesture() } catch (e) {}
  },
  build() {
    computeLayout()
    var S = W / 480
    var launchCalc = true
    try { launchCalc = localStorage.getItem('launch_calc', '1') !== '0' } catch (e) {}
    if (!launchCalc) {
      if (!launchRedirected) {
        launchRedirected = true
        setTimeout(function () { push({ url: 'page/bookshelf' }) }, 0)
      }
      return
    }
    createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: H, color: COL_BG })
    // 表达式显示面板（约束在圆内安全区，避免被圆边裁切）
    createWidget(widget.FILL_RECT, { x: Math.round(78 * S), y: Math.round(62 * S), w: Math.round(324 * S), h: Math.round(58 * S), radius: Math.round(16 * S), color: COL_PANEL_SOFT })
    // 顶部显示（带光标，右对齐）
    displayWidget = createWidget(widget.TEXT, {
      x: Math.round(92 * S), y: Math.round(70 * S), w: Math.round(248 * S), h: Math.round(46 * S), text: '0', text_size: 38, color: COL_DISP,
      align_h: align.RIGHT, align_v: align.CENTER_V
    })
    // 删除键（面板右上，暗红）
    createWidget(widget.FILL_RECT, { x: Math.round(350 * S), y: Math.round(70 * S), w: Math.round(44 * S), h: Math.round(40 * S), radius: Math.round(10 * S), color: COL_DEL })
    createWidget(widget.TEXT, { x: Math.round(350 * S), y: Math.round(70 * S), w: Math.round(44 * S), h: Math.round(40 * S), text: 'DEL', text_size: 13, color: COL_DEL_T, align_h: align.CENTER_H, align_v: align.CENTER_V })
    var delTouch = createWidget(widget.FILL_RECT, { x: Math.round(346 * S), y: Math.round(66 * S), w: Math.round(52 * S), h: Math.round(48 * S), radius: Math.round(10 * S), color: 0x000000, alpha: 0 })
    delTouch.addEventListener(event.CLICK_DOWN, function () { doDelete() })

    buildSlots()
    buildDots()
    applyPage()
    applyDots()

    // 左右滑动切页
    try {
      offGesture()
      onGesture({
        callback: function (e) {
          if (hist.active) { if (e === GESTURE_LEFT || e === GESTURE_RIGHT) { closeHistory(); return true } return false }
          if (e === GESTURE_UP) { openHistory(); return true }      // 上滑看历史
          if (e === GESTURE_LEFT) { setPage(page + 1); return true }
          if (e === GESTURE_RIGHT) { setPage(page - 1); return true }
          return false
        }
      })
    } catch (err) {}

    // 表冠：KEY_HOME + 非零 number 过滤，按方向逐事件响应；不累计 degree。
    onDigitalCrown({
      callback: function (key, degree) {
        var direction = crownDirection(key, degree, KEY_HOME)
        if (!direction || hist.active) return
        var now = Date.now()
        if (now - lastCrownTs < CROWN_DEBOUNCE) return
        lastCrownTs = now
        moveByInput(direction)
      }
    })
    // T-Rex 等有方向实体键的设备也可移动光标；其他按键不拦截。
    onKey({
      callback: function (key) {
        var direction = keyDirection(key, KEY_UP, KEY_DOWN)
        if (!direction || hist.active) return false
        moveByInput(direction)
        return true
      }
    })
  }
})
