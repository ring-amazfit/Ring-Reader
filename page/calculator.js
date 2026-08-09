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
import { getText } from '@zos/i18n'
import { crownDirection, crownDebounceMs, keyDirection } from '../utils/crown'
import { C as UI, M, setScale } from '../utils/ui'  // C 与本页换算钮工厂 C() 同名，故取别名
// setScale 在 computeLayout 中调用，保证 466 屏等比缩放

var W = 480, H = 480

// 计算器色阶：与阅读器 / 书架共用 utils/ui.js 令牌，只在按键分级上区分层次。
// 文字一律用白（数字键尤其），只有 = 键用琥珀底 + 深字。
var COL_BG = UI.bg
// 三类键底色统一（用户要求根号等函数键与数字/运算符键风格一致）
var COL_NUM = 0x2A2C33
var COL_NUM_T = 0xFFFFFF
var COL_OP = 0x2A2C33
var COL_OP_T = 0xFFFFFF
var COL_FN = 0x2A2C33
var COL_FN_T = 0xFFFFFF
var COL_DEL = UI.dangerBg
var COL_DEL_T = 0xF0A8A0
var COL_EQ = UI.accent
var COL_EQ_T = 0xFFFFFF          // = 键（橙色）上的文字：纯白
var COL_DISP = 0xFFFFFF           // 显示区：纯白
var COL_SUB = UI.sub
var COL_PANEL = UI.card
var COL_PANEL_SOFT = UI.cardAlt
var COL_ACCENT_SOFT = UI.accentSoft
var COL_BORDER = UI.track

// 网格：5 列 4 行，居中（computeLayout 按屏幕尺寸缩放）
var COLS = 5
var CELL = 62, GAP = 8, STEP = CELL + GAP
var CELL_R = 18            // 按键圆角（squircle：整圆会让 km/h>m/s 这类长标签溢出）
var GRID_X = 69, GRID_Y = 112, DOTS_Y = 392
function computeLayout() {
  var di; try { di = getDeviceInfo() } catch (e) { di = null }
  W = (di && di.width) ? di.width : 480
  H = (di && di.height) ? di.height : 480
  setScale(W)
  var S = W / 480
  CELL = Math.round(62 * S); GAP = Math.round(8 * S); STEP = CELL + GAP; CELL_R = Math.round(18 * S)
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
    B('C', '', '', DEL, 'clear'), B('0', '0'), B('.', '.'), B('√x', '√', 'sqrt(', FN, 'sqrt'), null
  ],
  // 函数
  [
    B('(', '(', '(', FN), B(')', ')', ')', FN), B('π', 'π', 'π', FN), B('e', 'e', 'e', FN), B('|x|', 'abs(', 'abs(', FN),
    B('x^2', '^2', '^2', FN), B('x^y', '^', '^', FN), B('ln', 'ln(', 'ln(', FN), B('log', 'log(', 'log(', FN), B('floor', 'floor(', 'floor(', FN),
    B('x^3', '^3', '^3', FN), B('x!', '!', '!', FN), B('x√y', '√', '√', FN, 'root'), B('cbrt', 'cbrt(', 'cbrt(', FN), B('ceil', 'ceil(', 'ceil(', FN),
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
        x: Math.round(107 * S0), y: Math.round(60 * S0), w: Math.round(220 * S0), h: Math.round(42 * S0), text: s, text_size: size, color: COL_DISP,
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
      else if (cc === 8730) { pos++; v = _pow(P(), 1 / v) }  // √: a√b = b 的 a 次方根
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
    // 支持科学计数法：1.5e-7 / 1e+21 —— 历史记录里指数结果（fmtResult 输出 1.2e+6 之类）
    // 点回输入框后再按 = 必须能重新求值，否则会报“表达式不完整”。
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
      var base = num + frac / fracDiv
      // 指数部分
      if (pos < len && (s[pos] === 'e' || s[pos] === 'E')) {
        var ep = pos + 1, neg = false, expNum = 0, expHas = false
        if (ep < len && (s[ep] === '+' || s[ep] === '-')) { neg = s[ep] === '-'; ep++ }
        while (ep < len && s.charCodeAt(ep) >= 48 && s.charCodeAt(ep) <= 57) { expNum = expNum * 10 + (s.charCodeAt(ep) - 48); expHas = true; ep++ }
        if (expHas) { pos = ep; return base * Math.pow(10, neg ? -expNum : expNum) }
      }
      return base
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
    // 去重：与最后一条完全相同（重复按 = 或点历史后重算）就不再追加
    var last = _histCache[_histCache.length - 1]
    if (last && last.e === expr && last.r === result) return
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
      var v = evaluate(autoCloseParens(ps))
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

// 自动补全未闭合括号：√9 → sqrt(9)，不用手动输入右括号
function autoCloseParens(s) {
  var open = 0
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i)
    if (c === 40) open++          // (
    else if (c === 41) { if (open > 0) open-- }  // )
  }
  while (open-- > 0) s += ')'
  return s
}

// 平方根：在最后一个数字前插入 √（先输数字后点 √，或先点 √ 再输数均可）
function doSqrt() {
  var idx = -1
  for (var i = tokens.length - 1; i >= 0; i--) {
    if (/^[\d.]+$/.test(tokens[i].p)) { idx = i; break }
  }
  var nt = { d: '√', p: 'sqrt(' }
  if (idx >= 0) tokens.splice(idx, 0, nt)
  else tokens.splice(tokens.length, 0, nt)
  cursor = tokens.length
  updateDisplay()
}

// 自定义根号：在最后一个数字后插入 √ 运算符（a√b = b 的 a 次方根）
function doRoot() {
  var idx = -1
  for (var i = tokens.length - 1; i >= 0; i--) {
    if (/^[\d.]+$/.test(tokens[i].p)) { idx = i; break }
  }
  var nt = { d: '√', p: '√' }
  if (idx >= 0) tokens.splice(idx + 1, 0, nt)
  else {
    // 没有先输入根指数：默认按 2 次根（平方根）处理，避免表达式以 √ 开头报错
    tokens.splice(tokens.length, 0, { d: '2', p: '2' }, nt)
  }
  cursor = tokens.length
  updateDisplay()
}

function onButton(b) {
  if (!b || calcBusy) return
  if (b.act === 'eq') doEquals()
  else if (b.act === 'clear') doClear()
  else if (b.act === 'neg') doNeg()
  else if (b.act === 'conv') doConv(b)
  else if (b.act === 'sqrt') doSqrt()
  else if (b.act === 'root') doRoot()
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
  // '√x' 是 2 字符但属于函数键，与 x^2 / x√y 等保持同一字号（16），避免和运算符键（22）混看时大小不一
  if (label === '√x') return 16
  return label.length >= 5 ? 13 : (label.length >= 3 ? 16 : (label === '=' ? 26 : 22))
}

// 控件池：20 个槽位只建一次，切页只 setProperty 改文字/颜色 → 翻页流畅
function buildSlots() {
  for (var i = 0; i < slots.length; i++) { try { deleteWidget(slots[i].bg); deleteWidget(slots[i].txt); deleteWidget(slots[i].touch) } catch (e) {} }
  slots = []
  for (var idx = 0; idx < COLS * 4; idx++) {
    var row = Math.floor(idx / COLS), col = idx % COLS
    var x = GRID_X + col * STEP, y = GRID_Y + row * STEP
    var bg = createWidget(widget.FILL_RECT, { x: x, y: y, w: CELL, h: CELL, radius: CELL_R, color: COL_BG })
    var txt = createWidget(widget.TEXT, { x: x, y: y, w: CELL, h: CELL, text: '', text_size: 20, color: 0xFFFFFF, align_h: align.CENTER_H, align_v: align.CENTER_V })
    var touch = createWidget(widget.FILL_RECT, { x: x, y: y, w: CELL, h: CELL, radius: CELL_R, color: 0x000000, alpha: 0 })
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
        try { s.bg.setProperty(prop.MORE, { x: s.x, y: s.y, w: CELL, h: CELL, radius: CELL_R, color: cc[0] }) } catch (e) {}
        try { s.txt.setProperty(prop.MORE, { x: s.x, y: s.y, w: CELL, h: CELL, text: b.l, text_size: fsOf(b.l), color: cc[1], align_h: align.CENTER_H, align_v: align.CENTER_V }) } catch (e) {}
      }
    } else if (prev) {
      s.base = COL_BG
      try { s.bg.setProperty(prop.MORE, { x: s.x, y: s.y, w: CELL, h: CELL, radius: CELL_R, color: COL_BG }) } catch (e) {}
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
  var r = CELL_R
  bw.setProperty(prop.MORE, { x: gx, y: gy, w: CELL, h: CELL, radius: r, color: lighten(base) })
  setTimeout(function () { try { bw.setProperty(prop.MORE, { x: gx, y: gy, w: CELL, h: CELL, radius: r, color: base }) } catch (e) {} }, 25)
}

// 圆点也用池：只建一次，切页改宽度/颜色
function buildDots() {
  for (var i = 0; i < dots.length; i++) { try { deleteWidget(dots[i].d) } catch (e) {} }
  dots = []
  var n = PAGES.length, dw = 8, dgap = 14, totalW = n * dw + (n - 1) * dgap
  var sx = Math.round((W - totalW) / 2), y = DOTS_Y
  for (var p = 0; p < n; p++) {
    var dx = sx + p * (dw + dgap)
    var d = createWidget(widget.FILL_RECT, { x: dx, y: y, w: dw, h: dw, radius: 4, color: COL_BORDER })
    var t = createWidget(widget.FILL_RECT, { x: dx - 8, y: y - 12, w: dw + 16, h: 32, color: 0x000000, alpha: 0 })
    t.addEventListener(event.CLICK_DOWN, (function (pp) { return function () { setPage(pp) } })(p))
    dots.push({ d: d, t: t, x: dx, y: y })
  }
}
function applyDots() {
  for (var p = 0; p < dots.length; p++) {
    var active = p === page
    try { dots[p].d.setProperty(prop.MORE, { x: dots[p].x, y: dots[p].y, w: active ? 20 : 8, h: 8, radius: 4, color: active ? UI.accent : COL_BORDER }) } catch (e) {}
  }
}

function setPage(p) {
  page = (p + PAGES.length) % PAGES.length
  applyPage()
  applyDots()
}

// ── 历史记录（控件池版：只建一次，开关只改文字/可见性）──
var hist = { active: false }
var MAX_HIST = 5
var startY = 104, rowH = 42

// ── 历史记录（动态创建 / 关闭即销毁）──
// 旧实现是控件池 + alpha 隐藏，有两个硬伤：
//   1) 透明触摸层（行触摸、清空、关闭）alpha 恒为 0 且从不隐藏，关闭历史后仍留在屏幕上
//      拦截点击 —— 表现为关闭历史后键盘那片区域点不动 / 误触发历史项；
//   2) 依赖 alpha 批量隐藏，任何一处漏隐藏都会残留背景。
// 现在统一为“打开即建、关闭即全部 deleteWidget”，与菜单 / 书签一致，状态永远干净。
var histWidgets = []

function hAdd(w) { histWidgets.push(w); return w }

function closeHistory() {
  for (var i = 0; i < histWidgets.length; i++) { try { deleteWidget(histWidgets[i]) } catch (e) {} }
  histWidgets = []
  hist.active = false
}

function openHistory() {
  if (hist.active) return
  hist.active = true
  histWidgets = []

  var S = W / 480
  var h = _histCache || []
  if (!_histCache) { try { h = _histCache = JSON.parse(localStorage.getItem('calc_history', '[]')) } catch (e) { h = [] } }
  var n = Math.min(h.length, MAX_HIST)

  // 整屏铺底（不透明，直接显示，无淡入动画）
  var bg = hAdd(createWidget(widget.FILL_RECT, { x: 0, y: 0, w: W, h: H, color: COL_BG }))
  bg.addEventListener(event.CLICK_DOWN, function () {})

  hAdd(createWidget(widget.TEXT, { x: Math.round(92 * S), y: Math.round(74 * S), w: Math.round(296 * S), h: 22, text: getText('calcHistory'), text_size: M.tsTitle, color: UI.text, align_h: align.CENTER_H }))
  hAdd(createWidget(widget.FILL_RECT, { x: Math.round(224 * S), y: Math.round(102 * S), w: Math.round(32 * S), h: Math.round(3 * S), radius: Math.round(2 * S), color: UI.accent }))

  // 历史行：最新的在最上面
  for (var i = 0; i < n; i++) {
    var it = h[h.length - 1 - i]
    var y = Math.round(112 * S) + i * Math.round(rowH * S)
    var rh = Math.round(rowH * S) - 8
    hAdd(createWidget(widget.FILL_RECT, { x: Math.round(92 * S), y: y, w: Math.round(296 * S), h: rh, radius: M.rowR, color: COL_PANEL_SOFT }))
    hAdd(createWidget(widget.TEXT, { x: Math.round(106 * S), y: y + 3, w: Math.round(268 * S), h: 16, text: trim(it.e, 26), text_size: M.tsMeta, color: COL_SUB }))
    hAdd(createWidget(widget.TEXT, { x: Math.round(106 * S), y: y + 18, w: Math.round(268 * S), h: 18, text: '= ' + trim(it.r, 22), text_size: M.tsRow, color: COL_NUM_T }))
    // 触摸层最后建（盖在文字之上），点一条 = 把结果整体替换进输入区
    var rowTouch = createWidget(widget.FILL_RECT, { x: Math.round(92 * S), y: y, w: Math.round(296 * S), h: rh, radius: M.rowR, color: 0x000000, alpha: 0 })
    rowTouch.addEventListener(event.CLICK_DOWN, (function (res) { return function () { closeHistory(); setResultTokens(res) } })(it.r))
    hAdd(rowTouch)
  }

  if (n === 0) {
    hAdd(createWidget(widget.TEXT, { x: Math.round(92 * S), y: Math.round(210 * S), w: Math.round(296 * S), h: 24, text: getText('calcNoHistory'), text_size: M.tsVal, color: COL_SUB, align_h: align.CENTER_H }))
  }

  // 底部两钮：清空 / 关闭
  var hbY = Math.round(342 * S), hbW = Math.round(132 * S), hbH = Math.round(40 * S), hbR = Math.round(hbH / 2)
  hAdd(createWidget(widget.FILL_RECT, { x: Math.round(94 * S), y: hbY, w: hbW, h: hbH, radius: hbR, color: COL_DEL }))
  hAdd(createWidget(widget.TEXT, { x: Math.round(94 * S), y: hbY, w: hbW, h: hbH, text: getText('calcClear'), text_size: M.tsVal, color: COL_DEL_T, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  var clr = createWidget(widget.FILL_RECT, { x: Math.round(94 * S), y: hbY, w: hbW, h: hbH, radius: hbR, color: 0x000000, alpha: 0 })
  clr.addEventListener(event.CLICK_DOWN, function () {
    _histCache = []
    try { localStorage.setItem('calc_history', '[]') } catch (e) {}
    closeHistory()
    openHistory()
  })
  hAdd(clr)

  hAdd(createWidget(widget.FILL_RECT, { x: Math.round(254 * S), y: hbY, w: hbW, h: hbH, radius: hbR, color: UI.accent }))
  hAdd(createWidget(widget.TEXT, { x: Math.round(254 * S), y: hbY, w: hbW, h: hbH, text: getText('calcClose'), text_size: M.tsVal, color: UI.onAccent, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  var cl = createWidget(widget.FILL_RECT, { x: Math.round(254 * S), y: hbY, w: hbW, h: hbH, radius: hbR, color: 0x000000, alpha: 0 })
  cl.addEventListener(event.CLICK_DOWN, function () { closeHistory() })
  hAdd(cl)
}

function trim(s, m) { s = String(s); return s.length > m ? s.substring(0, m - 1) + '…' : s }

// animFadeGroup 已统一到 utils/ui.js

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
    // 表达式输入框：圆角底板。面板 y=54 底边 108，与键盘第一行（y=112）不重叠。
    // 四角 (95,54) 实测 235.9 < 238，完整落在圆屏内。
    createWidget(widget.FILL_RECT, { x: Math.round(95 * S), y: Math.round(54 * S), w: Math.round(290 * S), h: Math.round(54 * S), radius: Math.round(18 * S), color: COL_PANEL_SOFT })
    // 顶部显示（带光标，右对齐；右侧留给 DEL 键）
    displayWidget = createWidget(widget.TEXT, {
      x: Math.round(107 * S), y: Math.round(60 * S), w: Math.round(220 * S), h: Math.round(42 * S), text: '0', text_size: 38, color: COL_DISP,
      align_h: align.RIGHT, align_v: align.CENTER_V
    })
    // 删除键：面板右上角，暗红圆角块 + DEL 文字，44×44 大点击区
    var dd = Math.round(44 * S)
    createWidget(widget.FILL_RECT, { x: Math.round(329 * S), y: Math.round(59 * S), w: dd, h: dd, radius: Math.round(13 * S), color: COL_DEL })
    createWidget(widget.TEXT, { x: Math.round(329 * S), y: Math.round(59 * S), w: dd, h: dd, text: 'DEL', text_size: Math.round(14 * S), color: COL_DEL_T, align_h: align.CENTER_H, align_v: align.CENTER_V })
    var delTouch = createWidget(widget.FILL_RECT, { x: Math.round(324 * S), y: Math.round(54 * S), w: Math.round(54 * S), h: Math.round(54 * S), radius: Math.round(15 * S), color: 0x000000, alpha: 0 })
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
