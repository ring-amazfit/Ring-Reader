/**
 * URL 输入页 — T9 风格，适配圆形屏
 * 用于输入 OPENLIST 直链
 * 点击 OK 后写入 settingsStorage，触发 Side Service 下载
 */

import { createWidget, widget, align, event, prop } from '@zos/ui'
import { push, pop } from '@zos/router'

var W = 480, H = 480
var SAFE = { L: 78, R: 402, T: 65, B: 415 }
var BG = 0x111111
var PANEL = 0x1E1E1E
var PANEL_SOFT = 0x262626
var ACCENT = 0xD8A25A
var TEXT = 0xF5F5F5
var SUB = 0x9AA0A6
var MUTED = 0x666666

// @zos/settings — 用于写入 settingsStorage 触发下载
var _settings = null
try {
  _settings = require('@zos/settings')
} catch (e) {
  console.log('[URLInput] require settings failed:', e.message)
}

// T9 键盘映射
var T9_MAP = {
  1: '1',
  2: 'abc2',
  3: 'def3',
  4: 'ghi4',
  5: 'jkl5',
  6: 'mno6',
  7: 'pqrs7',
  8: 'tuv8',
  9: 'wxyz9',
  0: '0.:/-_~% ',
}

var state = {
  url: '',
  t9Key: -1,
  t9Idx: 0,
  t9Timer: null,
}

var widgets = []
var _urlAnimWidgets = []  // 用于淡入的控件索引

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
function btnFlash(bgW, origColor) {
  if (!bgW) return
  try { bgW.setProperty(prop.MORE, { color: 0x4A4A4A }) } catch (e) {}
  setTimeout(function () { try { bgW.setProperty(prop.MORE, { color: origColor || 0x2A2A2A }) } catch (e) {} }, 30)
}

function build() {
  // 正确销毁：调用 widget 对象的 deleteWidget() 方法
  for (var i = 0; i < widgets.length; i++) {
    try { widgets[i].deleteWidget() } catch (e) {}
  }
  widgets = []

  // ── 标题（初始 alpha 0，由淡入动画渐显）──
  widgets.push(createWidget(widget.FILL_RECT, {
    x: SAFE.L - 8, y: SAFE.T - 10,
    w: SAFE.R - SAFE.L + 16, h: 78,
    radius: 16, color: PANEL_SOFT, alpha: 0,
  }))
  widgets.push(createWidget(widget.TEXT, {
    x: SAFE.L, y: SAFE.T,
    w: SAFE.R - SAFE.L, h: 28,
    text: '输入下载链接',
    text_size: 16, color: TEXT, alpha: 0,
    align_h: align.CENTER_H,
  }))

  // ── URL 显示区 ──
  var urlView = state.url
  if (urlView.length > 44) urlView = '...' + urlView.substring(urlView.length - 41)
  widgets.push(createWidget(widget.TEXT, {
    x: SAFE.L + 4, y: SAFE.T + 34,
    w: SAFE.R - SAFE.L - 8, h: 26,
    text: urlView || '(空)',
    text_size: 13, color: urlView ? ACCENT : MUTED, alpha: 0,
    align_h: align.LEFT,
  }))

  // ── 光标指示 ──
  widgets.push(createWidget(widget.FILL_RECT, {
    x: SAFE.L, y: SAFE.T + 62,
    w: SAFE.R - SAFE.L, h: 1,
    color: ACCENT,
  }))

  // ── T9 键盘 ──
  var keys = [1, 2, 3, 4, 5, 6, 7, 8, 9, -1, 0, -2]
  var keyW = 88, keyH = 52, gapX = 6, gapY = 5
  var startX = SAFE.L + 4, startY = SAFE.T + 75

  for (var r = 0; r < 4; r++) {
    for (var c = 0; c < 3; c++) {
      var idx = r * 3 + c
      var key = keys[idx]
      var kx = startX + c * (keyW + gapX)
      var ky = startY + r * (keyH + gapY)

      if (key === -1) {
        // 删除键
        var delBg = createWidget(widget.FILL_RECT, {
          x: kx, y: ky, w: keyW, h: keyH,
          radius: 10, color: 0x3A2430,
        })
        widgets.push(delBg)
        widgets.push(createWidget(widget.TEXT, {
          x: kx, y: ky, w: keyW, h: keyH,
          text: 'DEL', text_size: 15, color: 0xE7A6A6,
          align_h: align.CENTER_H, align_v: align.CENTER_V,
        }))
        // 触摸层（最后创建 = 最上层）
        var delTouch = createWidget(widget.FILL_RECT, {
          x: kx, y: ky, w: keyW, h: keyH,
          radius: 10, color: 0x000000, alpha: 0,
        })
        delTouch.addEventListener(event.CLICK_DOWN, function () {
          btnFlash(delBg, 0x3A2430)
          state.url = state.url.substring(0, state.url.length - 1)
          clearTimer()
          build()
        })
        widgets.push(delTouch)

      } else if (key === -2) {
        // 确认键
        var okBg = createWidget(widget.FILL_RECT, {
          x: kx, y: ky, w: keyW, h: keyH,
          radius: 10, color: 0x1E3A28,
        })
        widgets.push(okBg)
        widgets.push(createWidget(widget.TEXT, {
          x: kx, y: ky, w: keyW, h: keyH,
          text: 'OK', text_size: 15, color: 0x8FE0A0,
          align_h: align.CENTER_H, align_v: align.CENTER_V,
        }))
        var okTouch = createWidget(widget.FILL_RECT, {
          x: kx, y: ky, w: keyW, h: keyH,
          radius: 10, color: 0x000000, alpha: 0,
        })
        okTouch.addEventListener(event.CLICK_DOWN, function () {
          if (state.url.length < 5) return
          btnFlash(okBg, 0x1E3A28)
          if (_settings && _settings.settingsStorage) {
            _settings.settingsStorage.setItem('_dl_title', extractTitle(state.url))
            _settings.settingsStorage.setItem('_dl_author', '')
            _settings.settingsStorage.setItem('_dl_url', state.url)
          }
          pop()
        })
        widgets.push(okTouch)

      } else {
        // 数字/字母键 — 用局部变量捕获 key 值
        var label = String(key)
        var sub = T9_MAP[key]
        var numBg = createWidget(widget.FILL_RECT, {
          x: kx, y: ky, w: keyW, h: keyH,
          radius: 10, color: PANEL,
        })
        widgets.push(numBg)
        widgets.push(createWidget(widget.TEXT, {
          x: kx, y: ky + 2, w: keyW, h: 20,
          text: label,
          text_size: 16, color: 0xFFFFFF,
          align_h: align.CENTER_H,
        }))
        widgets.push(createWidget(widget.TEXT, {
          x: kx, y: ky + 22, w: keyW, h: 16,
          text: sub,
          text_size: 9, color: SUB,
          align_h: align.CENTER_H,
        }))
        // 触摸层（最后创建 = 最上层）
        var keyTouch = createWidget(widget.FILL_RECT, {
          x: kx, y: ky, w: keyW, h: keyH,
          radius: 10, color: 0x000000, alpha: 0,
        })
        // 用闭包捕获当前 key 值
        ;(function (k, bgW) {
          keyTouch.addEventListener(event.CLICK_DOWN, function () { btnFlash(bgW, PANEL); onT9Key(k) })
        })(key, numBg)
        widgets.push(keyTouch)
      }
    }
  }

  // ── 提示文字 ──
  widgets.push(createWidget(widget.TEXT, {
    x: SAFE.L, y: SAFE.B - 18,
    w: SAFE.R - SAFE.L, h: 16,
    text: '短按切换字符 · 输入5位以上后点OK',
    text_size: 9, color: MUTED,
    align_h: align.CENTER_H,
  }))

  // 主面板淡入：标题区 + URL 显示 + 提示
  var titleWidgets = [widgets[0], widgets[1], widgets[2]]
  var hintWidget = widgets[widgets.length - 1]
  setTimeout(function () { animFadeGroup(titleWidgets, 0, 255, 6, 35) }, 20)
  setTimeout(function () { if (hintWidget) animFadeGroup([hintWidget], 0, 255, 4, 40) }, 100)
}

function onT9Key(key) {
  clearTimer()

  if (state.t9Key === key) {
    state.t9Idx = (state.t9Idx + 1) % T9_MAP[key].length
  } else {
    if (state.t9Key >= 0) {
      var prevMap = T9_MAP[state.t9Key]
      state.url += prevMap[state.t9Idx]
    }
    state.t9Key = key
    state.t9Idx = 0
  }

  var map = T9_MAP[key]
  var ch = map[state.t9Idx]
  if (state.t9Key === key && state.t9Idx > 0) {
    state.url = state.url.substring(0, state.url.length - 1) + ch
  } else if (state.t9Idx === 0) {
    state.url += ch
  }

  state.t9Timer = setTimeout(function () {
    state.t9Key = -1
    state.t9Idx = 0
    state.t9Timer = null
  }, 800)

  build()
}

function clearTimer() {
  if (state.t9Timer) {
    clearTimeout(state.t9Timer)
    state.t9Timer = null
  }
}

function extractTitle(url) {
  try {
    var parts = url.split('/')
    var file = parts[parts.length - 1] || '未知书籍'
    file = file.split('?')[0]
    file = file.split('#')[0]
    if (file.endsWith('.txt')) file = file.substring(0, file.length - 4)
    try { return decodeURIComponent(file) } catch (e) { return file }
  } catch (e) {
    return '未知书籍'
  }
}

Page({
  onInit() {
    state.url = ''
    state.t9Key = -1
    state.t9Idx = 0
  },
  build() {
    build()
  },
  onDestroy() {
    clearTimer()
    for (var i = 0; i < widgets.length; i++) {
      try { widgets[i].deleteWidget() } catch (e) {}
    }
    widgets = []
  },
})
