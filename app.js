/**
 * Calc-Reader Device App 入口
 * 在 App 级别常驻接收 TransferFile：只要手表 app 处于打开状态（任意页面），
 * 都能收到手机传来的书；并在每次启动时排空系统队列（处理"传输时 app 没开"的情况）。
 * 收到的书写入 localStorage dl_books，书架读取显示。
 */
import { localStorage } from '@zos/storage'
import TransferFile from '@zos/ble/TransferFile'
import { rmSync } from '@zos/fs'

var _tf = null
var _inbox = null
var _bookSeq = 0

function readBooks() {
  try {
    var books = JSON.parse(localStorage.getItem('dl_books', '[]'))
    return Array.isArray(books) ? books : []
  } catch (e) { return [] }
}
function writeBooks(books) {
  try { localStorage.setItem('dl_books', JSON.stringify(books)) } catch (e) {}
}

function registerBook(fileObject) {
  try {
    var params = fileObject.params || {}
    if (params.type && params.type !== 'book') return
    var title = params.title || fileObject.fileName || '线上导入'
    var filePath = fileObject.filePath || fileObject.fileName
    if (!filePath) return

    var books = readBooks()
    for (var i = 0; i < books.length; i++) {
      if (books[i].file === filePath) return false   // 已登记
    }
    books.push({
      id: 'dl_' + Date.now() + '_' + (++_bookSeq),
      title: title,
      author: params.author || '线上导入',
      file: filePath,
      downloaded: true
    })
    writeBooks(books)
    try { localStorage.setItem('_new_book', '1') } catch (e) {}
    try { localStorage.setItem('_last_received', JSON.stringify({ title: title, ts: Date.now() })) } catch (e) {}
    console.log('[RingReader] book registered:', title, filePath)
    return true
  } catch (e) {
    console.log('[RingReader] register error:', e.message)
    return false
  }
}

var _lastRecvTs = 0

// ── 手表端取消接收 ──
// 书架接收浮层的“取消”按钮写入 _cancel_recv 标记（60 秒窗口）。
// 收到标记后：不再更新接收进度、不登记书籍，并尝试删除已收到的临时文件。
var CANCEL_WINDOW = 60000
function isCancelPending() {
  try {
    if (localStorage.getItem('_cancel_recv') !== '1') return false
    var ts = parseInt(localStorage.getItem('_cancel_recv_ts') || '0') || 0
    return (Date.now() - ts) < CANCEL_WINDOW
  } catch (e) { return false }
}
function clearCancelPending() {
  try {
    localStorage.removeItem('_cancel_recv')
    localStorage.removeItem('_cancel_recv_ts')
  } catch (e) {}
}
function tryDeleteIncoming(fileObject) {
  var path = (fileObject && (fileObject.filePath || fileObject.fileName)) || ''
  if (!path) return
  var candidates = [path]
  try {
    if (path.indexOf('data://') === 0) candidates.push(path.substring(7))
    else if (path.indexOf('/data/') === 0) candidates.push(path.substring(6))
    else candidates.push('/data/' + path)
  } catch (e) {}
  for (var i = 0; i < candidates.length; i++) {
    try { rmSync({ path: candidates[i] }); break } catch (e) {}
  }
}

function setRecv(state, pct, name) {
  var now = Date.now()
  // recv 进度节流到 ~200ms 一次；done/error 立即写
  if (state === 'recv' && now - _lastRecvTs < 200) return
  _lastRecvTs = now
  try { localStorage.setItem('_recv', JSON.stringify({ s: state, p: pct, n: name || '', t: now })) } catch (e) {}
}

function handleIncoming(fileObject) {
  if (!fileObject) return
  var nm = (fileObject.params && fileObject.params.title) || fileObject.fileName || '在线书'

  // 接收进度（百分比 + 供书架画进度条）
  try {
    fileObject.on('progress', function (event) {
      if (isCancelPending()) return   // 已取消：停止更新进度浮层
      var d = event && event.data ? event.data : {}
      if (d.fileSize) {
        var pct = Math.floor((d.loadedSize || 0) * 100 / d.fileSize)
        if (pct < 0) pct = 0; if (pct > 100) pct = 100
        setRecv('recv', pct, nm)
      } else {
        setRecv('recv', 0, nm)
      }
    })
  } catch (e) {}

  try {
    fileObject.on('change', function (event) {
      var st = event && event.data ? event.data.readyState : ''
      if (st === 'transferred') {
        if (isCancelPending()) { clearCancelPending(); tryDeleteIncoming(fileObject); return }  // 已取消：不登记、删临时文件
        if (registerBook(fileObject)) setRecv('done', 100, nm)
      }
      else if (st === 'error') { setRecv('error', 0, nm) }
    })
  } catch (e) {}

  // 队列里已传完的文件：仅新书才提示完成（避免重开 app 旧文件重放误弹）
  if (fileObject.filePath) {
    if (isCancelPending()) { clearCancelPending(); tryDeleteIncoming(fileObject); return }
    if (registerBook(fileObject)) setRecv('done', 100, nm)
  }
}

function getInbox(tf) {
  // 兼容不同固件：属性 inbox / 方法 getInbox() / getInBox()
  if (tf.inbox) return tf.inbox
  if (tf.getInbox) return tf.getInbox()
  if (tf.getInBox) return tf.getInBox()
  return null
}

function drainQueue() {
  if (!_inbox) return
  var guard = 50
  while (guard-- > 0) {
    var f = _inbox.getNextFile()
    if (!f) break
    handleIncoming(f)
  }
}

function setupReceiver() {
  try {
    // 优先用全局 transferFile（部分固件设备端也提供），否则 new TransferFile()
    _tf = (typeof transferFile !== 'undefined' && transferFile) ? transferFile : new TransferFile()
    _inbox = getInbox(_tf)
    if (!_inbox) { console.log('[RingReader] inbox unavailable'); return }

    // 关键：实测可用的写法是小写 newfile / file 事件（参考 Falcon），
    // 同时兼容官方文档的大写 NEWFILE，全挂上。
    var onNew = function () { handleIncoming(_inbox.getNextFile()) }
    try { _inbox.on('newfile', onNew) } catch (e) {}
    try { _inbox.on('file', onNew) } catch (e) {}
    try { _inbox.on('NEWFILE', onNew) } catch (e) {}
    try { _inbox.on('FILE', onNew) } catch (e) {}

    drainQueue()   // 排空系统队列（传输时 app 没开，重开后补收）
  } catch (e) {
    console.log('[RingReader] receiver init failed:', e.message)
  }
}

App({
  onCreate() {
    setupReceiver()
  },
  onDestroy() {
    _inbox = null
    _tf = null
  }
})
