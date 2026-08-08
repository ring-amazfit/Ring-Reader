import { align, event, prop } from '@zos/ui'

/**
 * 统一 UI 设计令牌 + 自绘控件（滑条 / 关闭钮）+ 公共动画助手
 *
 * 为什么自绘：实机验证 widget.SLIDE_SWITCH 会把 64×40 的 PNG 拉伸进 64×32 的框
 * （旋钮溢出轨道），widget.SLIDER 在该固件上根本不渲染轨道和旋钮（只剩一个灰盒）。
 * 所以滑条一律用 FILL_RECT 自绘，外观可控、任何固件表现一致。
 *
 * 注意：本文件只负责“壳层 UI”（菜单/列表/按钮/弹层），
 * 不参与阅读正文的排版计算（字号 / 行距 / 每行字数由 reader.js 自己算）。
 */

// ── 颜色令牌 ──
export var C = {
  bg: 0x0A0A0B,        // 页面背景
  card: 0x1C1D21,      // 独立行 / 卡片（比背景明显抬起一阶）
  cardAlt: 0x272930,   // 卡内次级块 / 次要按钮
  cardOn: 0x2E2519,    // 开启态行底（暖色，一眼看出哪些功能是开的）
  line: 0x26282C,      // 分隔线
  text: 0xF2F2F4,      // 主文本
  sub: 0x9B9DA3,       // 次要文本
  muted: 0x6A6C72,     // 三级文本
  accent: 0xE09A4E,    // 品牌琥珀（比原色亮一档，深底上更透气）
  accentSoft: 0xF0B46E,
  accentDim: 0x8A6636,  // 琥珀弱化（进度槽 / 描边）
  onAccent: 0x1A1206,  // 琥珀底上的文字
  danger: 0xD4645A,
  dangerBg: 0x3A2320,
  track: 0x3A3B3F,     // 轨道底
  knob: 0xFFFFFF,      // 旋钮
  press: 0x3C3E44      // 按压高亮
}

// ── 尺寸令牌 ──
export var M = {
  rowH: 44,        // 独立胶囊行高
  rowGap: 8,       // 行间距
  cardR: 22,       // 卡片圆角
  rowR: 22,        // 胶囊行圆角（= rowH/2，整行胶囊）
  padX: 20,        // 行内左右内边距
  swW: 46, swH: 26, swKnob: 20,      // 开关
  trackH: 6, sliderKnob: 18,         // 滑条
  stepBtn: 38,     // 圆形步进按钮直径
  btnH: 44,        // 主按钮高
  chipH: 34,       // 顶部 chip 高
  tsTitle: 17, tsRow: 15, tsVal: 14, tsMeta: 11,
  maxW: 352        // 胶囊行宽度上限（全应用统一）
}

// ── 圆屏几何 ──
// 圆屏上下边缘可用宽度骤减：y 越靠两极，能放的行就越窄。
// rowW(y, h) 返回一行在 [y, y+h] 区间内可完整显示的最大居中宽度，
// 让列表自然形成「中间宽、两头窄」的桶形节奏 —— 这是刻意的圆屏语言，不是随机缩放。
export function rowW(y, h, R, pad) {
  R = R || 240
  pad = pad === undefined ? 8 : pad
  var top = Math.abs(y - R), bot = Math.abs(y + h - R)
  var dy = Math.max(top, bot)          // 离圆心最远的那条边决定宽度
  if (dy >= R) return 0
  return Math.floor((Math.sqrt(R * R - dy * dy) - pad) * 2)
}

// 居中矩形左边界
export function cx(w, W) { return Math.round(((W || 480) - w) / 2) }

/**
 * 自绘滑条（轨道 + 琥珀填充 + 白旋钮）
 * 分段点击：把轨道均分为 steps 段，点哪段取哪个值 —— 任何固件都可用。
 * 若事件带坐标则按坐标精确取值。
 * onChange 在值变化时实时回调（更新界面）；onCommit 在松手时回调（落盘/保存）。
 */
export function makeSlider(deps, add, x, y, w, min, max, value, onChange, onCommit) {
  var createWidget = deps.createWidget, widget = deps.widget, event = deps.event, prop = deps.prop
  var th = M.trackH, k = M.sliderKnob
  var ty = y + Math.round((k - th) / 2)
  var val = value
  var span = max - min
  add(createWidget(widget.FILL_RECT, { x: x, y: ty, w: w, h: th, radius: Math.round(th / 2), color: C.track }))
  var fill = add(createWidget(widget.FILL_RECT, {
    x: x, y: ty, w: Math.max(th, Math.round(w * (val - min) / span)), h: th, radius: Math.round(th / 2), color: C.accent
  }))
  var knob = add(createWidget(widget.FILL_RECT, {
    x: x + Math.round((w - k) * (val - min) / span), y: y, w: k, h: k, radius: Math.round(k / 2), color: C.knob
  }))
  function paint() {
    try { fill.setProperty(prop.MORE, { x: x, y: ty, w: Math.max(th, Math.round(w * (val - min) / span)), h: th, radius: Math.round(th / 2), color: C.accent }) } catch (e) {}
    try { knob.setProperty(prop.MORE, { x: x + Math.round((w - k) * (val - min) / span), y: y, w: k, h: k, radius: Math.round(k / 2), color: C.knob }) } catch (e) {}
  }
  function apply(v) {
    if (v < min) v = min
    if (v > max) v = max
    if (v === val) return
    val = v
    paint()
    if (onChange) onChange(val)
  }
  var touch = add(createWidget(widget.FILL_RECT, { x: x - 8, y: y - 10, w: w + 16, h: k + 20, color: 0x000000, alpha: 0 }))
  function fromEvent(e) {
    var px = null
    if (e && typeof e === 'object') {
      if (typeof e.x === 'number') px = e.x
      else if (e.detail && typeof e.detail.x === 'number') px = e.detail.x
    }
    if (px === null) return null
    var r = (px - x) / w
    if (r < 0) r = 0
    if (r > 1) r = 1
    return min + Math.round(r * span)
  }
  touch.addEventListener(event.CLICK_DOWN, function (e) {
    var v = fromEvent(e)
    // 无坐标信息时降级为“循环递增”，仍然可用
    apply(v === null ? (val >= max ? min : val + 1) : v)
  })
  try {
    touch.addEventListener(event.MOVE, function (e) {
      var v = fromEvent(e)
      if (v !== null) apply(v)
    })
  } catch (e) {}
  try {
    touch.addEventListener(event.CLICK_UP, function () {
      if (onCommit) onCommit(val)
    })
  } catch (e) {}
  return { set: function (v) { val = v; paint() } }
}

/**
 * 按钮按压反馈（浅闪后还原）。origColor 缺省用卡片色。
 */
export function btnFlash(bgW, origColor) {
  if (!bgW) return
  try { bgW.setProperty(prop.MORE, { color: C.press }) } catch (e) {}
  setTimeout(function () { try { bgW.setProperty(prop.MORE, { color: origColor || C.card }) } catch (e) {} }, 30)
}

/**
 * 底部居中关闭圆钮（菜单 / 书签 / 跳页 / 密码四处共用）。
 * y 为圆钮顶边；W 为屏幕宽，用于居中。
 */
export function makeCloseButton(deps, add, y, onClick, W) {
  var createWidget = deps.createWidget, widget = deps.widget, event = deps.event
  var d = 34, x = Math.round(((W || 480) - d) / 2)
  add(createWidget(widget.FILL_RECT, { x: x, y: y, w: d, h: d, radius: 17, color: C.cardAlt }))
  add(createWidget(widget.TEXT, { x: x, y: y, w: d, h: d, text: '×', text_size: 20, color: C.sub, align_h: align.CENTER_H, align_v: align.CENTER_V }))
  var t = add(createWidget(widget.FILL_RECT, { x: x - 16, y: y - 8, w: d + 32, h: d + 16, radius: 25, color: 0x000000, alpha: 0 }))
  t.addEventListener(event.CLICK_DOWN, onClick)
}
