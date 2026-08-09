// 圆屏几何校验（多机型：480 屏与 466 屏 GTR4/Active2）
// 每个界面的关键矩形按四角到圆心距离检查，466 屏按实际半径 233 校验。
function runGeometry(W0, R0, name) {
  const W = W0, R = R0, LIMIT = R - 2;
  let fail = 0;
  function fits(x, y, w, h, n) {
    let bad = null;
    for (const [px, py] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
      const d = Math.hypot(px - R, py - R);
      if (d > LIMIT) bad = Math.round(d);
    }
    if (bad) { fail++; console.log('  OUT ' + bad + ' | ' + n + ' (' + x + ',' + y + ' ' + w + 'x' + h + ')'); }
  }
  function rowW(y, h, cap, pad) {
    pad = pad === undefined ? 8 : pad;
    const dy = Math.max(Math.abs(y - R), Math.abs(y + h - R));
    return Math.min(cap, Math.floor((Math.sqrt(R * R - dy * dy) - pad) * 2));
  }
  function centered(y, h, cap, name) {
    const w = rowW(y, h, cap);
    fits(Math.round((W - w) / 2), y, w, h, name + ' w=' + w);
  }
  function sp(v) { return Math.round(v * W0 / 480); }
  console.log('=== ' + name + ' (' + W0 + 'px) ===');
  // 阅读器菜单：单屏（chips 102 / 表冠 158 / 两列卡片 226·294 高60 / 关闭 H-54）
  centered(102, 48, 352, '三联chips');
  centered(158, 60, 352, '表冠行');
  [226,294].forEach(function(y){
    const w=Math.min(352, rowW(y,60)); const cw=Math.floor((w-12)/2); const x0=Math.round((W-w)/2);
    fits(x0,y,cw,60,'卡L'+y); fits(x0+cw+12,y,cw,60,'卡R'+y);
  });
  fits(Math.round((W - sp(44)) / 2), W - 54, sp(44), sp(44), '菜单关闭钮');
  // 书签列表：4 行 54 高
  for (let i = 0; i < 4; i++) centered(104 + i * 62, 54, 352, '书签行' + i);
  fits(Math.round((W - sp(44)) / 2), W - 56, sp(44), sp(44), '书签关闭钮');
  // 跳页/密码键盘：76×60
  const kW = sp(76), kH = sp(60), kG = sp(8);
  const gw = 3 * kW + 2 * kG, gx = Math.round((W - gw) / 2);
  fits(gx, 126, gw, 4 * kH + 3 * kG, '跳页键盘');
  fits(gx, 126, gw, 4 * kH + 3 * kG, '密码键盘');
  fits(Math.round((W - sp(44)) / 2), W - 58, sp(44), sp(44), '键盘关闭钮');
  // 样式页
  fits(Math.round((W - sp(280)) / 2), sp(54), sp(280), sp(96), '预览纸张');
  for (let i = 0; i < 4; i++) centered(sp(164) + i * sp(52), sp(44), 352, '调节行' + i);
  fits(Math.round((W - sp(200)) / 2), sp(368), sp(200), sp(48), '完成按钮');
  // 书架
  const cbx = Math.round((W - (3 * sp(94) + 2 * sp(10))) / 2);
  fits(cbx, sp(58), 3 * sp(94) + 2 * sp(10), sp(44), '顶部三 chip');
  for (let i = 0; i < 3; i++) centered(sp(106) + i * sp(78), sp(70), 368, '书脊卡' + i);
  fits(sp(118), sp(336), sp(68), sp(44), '翻页左');
  fits(sp(294), sp(336), sp(68), sp(44), '翻页右');
  fits(Math.round((W - sp(220)) / 2), sp(406), sp(220), sp(40), '启动胶囊');
  // 计算器
  const CELL = Math.round(62 * W0 / 480), GAP = Math.round(8 * W0 / 480);
  const GX = Math.round((W - (5 * CELL + 4 * GAP)) / 2);
  fits(GX, Math.round(112 * W0 / 480), 5 * CELL + 4 * GAP, 4 * CELL + 3 * GAP, '计算器键盘');
  const dd = Math.round(44 * W0 / 480);
  fits(Math.round(329 * W0 / 480), Math.round(59 * W0 / 480), dd, dd, '计算器 DEL');
  fits(Math.round(95 * W0 / 480), Math.round(54 * W0 / 480), Math.round(290 * W0 / 480), Math.round(54 * W0 / 480), '输入框面板');
  // 历史行
  for (let i = 0; i < 5; i++) fits(Math.round(92 * W0 / 480), Math.round(112 * W0 / 480) + i * Math.round(42 * W0 / 480), Math.round(296 * W0 / 480), Math.round(34 * W0 / 480), '历史行' + i);
  fits(Math.round((W - sp(44)) / 2), sp(382), sp(44), sp(44), '密码关闭钮');
  console.log(fail === 0 ? '  OK: all inside' : '  FAIL: ' + fail);
  return fail;
}
let total = 0;
total += runGeometry(480, 240, 'Balance 480');
total += runGeometry(466, 233, 'GTR4/Active2 466');
console.log(total === 0 ? '\nALL RECTS INSIDE CIRCLE (480+466)' : '\n' + total + ' RECT(S) OUT OF BOUNDS');
process.exit(total === 0 ? 0 : 1);
