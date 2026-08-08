// Zepp OS 表冠与方向键的纯逻辑。
// `homeKey` / `upKey` / `downKey` 由页面传入，避免把平台常量耦合到该模块。
//
// 表冠方向仍按“每个有效事件直接判定方向”（KEY_HOME + 非零 degree），
// 但翻页模式可通过 crownStepThreshold 控制“同方向累计 N 个有效事件才执行一次导航”，
// 用于降低表冠灵敏度、防止快速旋转连翻。滚动模式 / 书签面板仍按 1 个事件直接响应。
export function crownDirection(key, degree, homeKey) {
  if (key !== homeKey || typeof degree !== 'number' || degree === 0) return 0
  return degree > 0 ? 1 : -1
}

export function keyDirection(key, upKey, downKey) {
  if (key === upKey) return -1
  if (key === downKey) return 1
  return 0
}

// 事件节流：只限制两次响应之间的最小间隔，避免 replace() 重建整页时连发卡顿。
export function crownDebounceMs() {
  return 120
}

