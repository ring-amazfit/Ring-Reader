/**
 * 环形阅读 - Side Service
 * 设置页触发后，手机下载 TXT 到 data://download，再用 TransferFile 发给手表。
 */

var downloadBusy = false

function getStorage() {
  try {
    if (settings && settings.settingsStorage) return settings.settingsStorage
  } catch (e) {}
  return null
}

function setStatus(text) {
  var ss = getStorage()
  if (ss) ss.setItem('_bk_status', text)
}

function getQueue() {
  try {
    var ss = getStorage()
    var queue = ss ? JSON.parse(ss.getItem('_dl_queue') || '[]') : []
    return Array.isArray(queue) ? queue : []
  } catch (e) { return [] }
}
function saveQueue(queue) {
  try { var ss = getStorage(); if (ss) ss.setItem('_dl_queue', JSON.stringify(queue)) } catch (e) {}
}
function updateQueueStatus() {
  var queue = getQueue()
  var status = queue.length === 0 ? '空' : queue.length + '本排队中'
  try { var ss = getStorage(); if (ss) ss.setItem('_queue_status', status) } catch (e) {}
}

function setProgress(phase, progress, text) {
  var ss = getStorage()
  if (!ss) return
  ss.setItem('_bk_phase', phase || 'idle')
  ss.setItem('_bk_progress', String(progress || 0))
  ss.setItem('_bk_status', text || '')
}

function continueQueue() {
  downloadBusy = false
  updateQueueStatus()
  processNextInQueue()
}

function processNextInQueue() {
  if (downloadBusy) return
  var queue = getQueue()
  if (queue.length === 0) {
    updateQueueStatus()
    return
  }
  var task = queue.shift()
  saveQueue(queue)
  downloadBusy = true
  updateQueueStatus()
  setStatus('开始下载: ' + cleanTitle(task.title))
  startDownload(task)
}

function normalizeDataPath(path) {
  if (!path) return ''
  if (path.indexOf('/data/') === 0) return path.substring(6)
  if (path.indexOf('data://') === 0) return path.substring(7)
  return path
}
function cleanTitle(title) {
  return String(title || '未命名小说').replace(/[\\/:*?"<>|]/g, '_').substring(0, 48)
}

function getOutbox() {
  // 参考 Falcon：实测可用的是 transferFile.outbox 属性；兼容方法式写法。
  if (typeof transferFile === 'undefined' || !transferFile) return null
  if (transferFile.outbox) return transferFile.outbox
  if (transferFile.getOutBox) return transferFile.getOutBox()
  if (transferFile.getOutbox) return transferFile.getOutbox()
  return null
}

function transferToWatch(filePath, task) {
  var settled = false
  function finish(phase, progress, text) {
    if (settled) return
    settled = true
    setProgress(phase, progress, text)
    continueQueue()
  }

  try {
    var outbox = getOutbox()
    if (!outbox) {
      finish('error', 0, '传输不可用：固件不支持 TransferFile')
      return
    }
    var fileObject = outbox.enqueueFile(filePath, {
      type: 'book',
      title: task.title,
      author: '线上导入',
      ts: Date.now()
    })

    fileObject.on('progress', function (event) {
      if (settled) return
      var data = event && event.data ? event.data : {}
      if (data.fileSize) {
        var percent = Math.floor(data.loadedSize * 100 / data.fileSize)
        setProgress('transfer', percent, '传输到手表 ' + percent + '%')
      }
    })

    fileObject.on('change', function (event) {
      var state = event && event.data ? event.data.readyState : ''
      if (state === 'transferred') finish('done', 100, '已传到手表，请打开隐藏书架')
      else if (state === 'error') finish('error', 0, '传输失败，请保持手表连接后重试')
      else if (state === 'canceled') finish('error', 0, '传输已取消')
    })
  } catch (e) {
    finish('error', 0, '传输启动失败: ' + (e.message || 'TransferFile不可用'))
  }
}

function startDownload(task) {
  if (!task || !task.url) {
    setProgress('error', 0, '下载任务无效')
    continueQueue()
    return
  }

  task.title = cleanTitle(task.title)
  var filePath = 'data://download/' + task.title + '_' + Date.now() + '.txt'
  var settled = false
  function finish(phase, progress, text) {
    if (settled) return
    settled = true
    setProgress(phase, progress, text)
    continueQueue()
  }

  setProgress('download', 2, '下载中...')
  try {
    if (typeof network === 'undefined' || !network || !network.downloader) {
      finish('error', 0, '网络模块不可用')
      return
    }
    var dl = network.downloader.downloadFile({
      url: task.url,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*' },
      timeout: 180000,
      filePath: filePath
    })

    dl.onProgress = function (event) {
      if (settled) return
      if (event && event.total) {
        var percent = Math.floor(event.loaded * 100 / event.total)
        if (percent > 95) percent = 95
        if (percent < 2) percent = 2
        setProgress('download', percent, '下载中 ' + percent + '%')
      } else {
        setProgress('download', 5, '下载中...')
      }
    }
    dl.onSuccess = function (event) {
      if (settled) return
      settled = true // 下载阶段完成，传输阶段继续持有 downloadBusy。
      var path = (event && (event.filePath || event.tempFilePath)) || filePath
      setProgress('transfer', 96, '下载完成，开始传输到手表')
      transferToWatch(path, task)
    }
    dl.onFail = function (event) {
      var message = (event && (event.message || event.code)) || '网络错误'
      finish('error', 0, '下载失败: ' + message)
    }
    dl.onComplete = function () {}
  } catch (e) {
    finish('error', 0, '下载启动失败: ' + (e.message || '网络不可用'))
  }
}

// 按 ts 去重，避免重复处理；同时兼容“服务在写入之后才启动”的竞态。
function processTrigger(raw) {
  if (!raw) return
  var task
  try { task = JSON.parse(raw) } catch (e) { setProgress('error', 0, '任务解析失败'); return }
  if (!task || !task.url) return

  var ss = getStorage()
  var seen = ss ? (ss.getItem('_dl_seen') || '') : ''
  if (String(task.ts) && String(task.ts) === seen) return
  if (ss) ss.setItem('_dl_seen', String(task.ts || ''))

  var queue = getQueue()
  queue.push({ title: task.title || '未命名', url: task.url, author: task.author || '' })
  saveQueue(queue)
  updateQueueStatus()
  if (downloadBusy) setProgress('queued', 1, '已加入队列，前面还有 ' + queue.length + ' 本')
  else processNextInQueue()
}

function checkExistingTrigger() {
  var ss = getStorage()
  if (!ss) return
  try { processTrigger(ss.getItem('_dl_trigger')) } catch (e) {}
}

AppSideService({
  onInit() {
    var ss = getStorage()
    if (!ss) return
    ss.addListener('change', function (event) {
      if (!event || event.key !== '_dl_trigger' || !event.newValue) return
      processTrigger(event.newValue)
    })
    checkExistingTrigger()
  },
  onRun() {
    checkExistingTrigger()
    processNextInQueue()
  },
  onDestroy() {}
})
