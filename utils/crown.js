// Zepp OS 表冠与方向键的纯逻辑：所有设备统一按一次有效输入直接响应。
// `homeKey` / `upKey` / `downKey` 由页面传入，避免把平台常量耦合到该模块。
export function crownDirection(key, degree, homeKey) {
  if (key !== homeKey || typeof degree !== 'number' || degree === 0) return 0
  return degree > 0 ? 1 : -1
}

export function keyDirection(key, upKey, downKey) {
  if (key === upKey) return -1
  if (key === downKey) return 1
  return 0
}

// 只做事件节流，绝不根据 degree 累加或设置触发阈值。
export function crownDebounceMs() {
  return 120
}
