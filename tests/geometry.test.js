// 圆屏几何校验：把每个界面的关键矩形按四角到圆心距离检查一遍
const R = 240, LIMIT = 238;
let fail = 0;
function fits(x, y, w, h, name) {
  let bad = null;
  for (const [px, py] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
    const d = Math.hypot(px - R, py - R);
    if (d > LIMIT) bad = Math.round(d);
  }
  if (bad) { fail++; console.log('  OUT ' + bad + ' | ' + name + ' (' + x + ',' + y + ' ' + w + 'x' + h + ')'); }
  else console.log('  ok   | ' + name);
}
function rowW(y, h, cap, pad = 8) {
  const dy = Math.max(Math.abs(y - R), Math.abs(y + h - R));
  return Math.min(cap, Math.floor((Math.sqrt(R * R - dy * dy) - pad) * 2));
}
function centered(y, h, cap, name) {
  const w = rowW(y, h, cap);
  fits(Math.round((480 - w) / 2), y, w, h, name + ' w=' + w);
}

console.log('=== 阅读器菜单 ===');
centered(92, 40, 352, '开关三联 chip');
centered(138, 44, 352, '表冠滑条行');
centered(190, 40, 352, '自动');
centered(236, 40, 352, '书签');
centered(282, 40, 352, '跳页');
centered(328, 40, 352, '样式');
fits(223, 434, 34, 34, '底部关闭钮');

console.log('=== 书签列表 ===');
for (let i = 0; i < 5; i++) centered(108 + i * 52, 44, 352, '书签行' + i);
fits(140, 52, 200, 44, '添加书签胶囊');
fits(223, 434, 34, 34, '底部关闭钮');

console.log('=== 跳页键盘 ===');
const kW = 68, kH = 52, kG = 10, gw = 3 * kW + 2 * kG, gx = Math.round((480 - gw) / 2);
fits(gx, 132, gw, 4 * kH + 3 * kG, '键盘网格');
fits(223, 382, 34, 34, '关闭钮');

console.log('=== 样式页 ===');
fits(100, 54, 280, 96, '预览纸张');
for (let i = 0; i < 4; i++) centered(164 + i * 52, 44, 352, '调节行' + i);
fits(150, 374, 180, 40, '完成胶囊');

console.log('=== 书架 ===');
const cbx = Math.round((480 - (3 * 84 + 2 * 12)) / 2);
fits(cbx, 60, 3 * 84 + 2 * 12, 32, '顶部三 chip');
for (let i = 0; i < 3; i++) centered(100 + i * 78, 70, 368, '书脊卡' + i);
fits(132, 336, 58, 34, '翻页左');
fits(290, 336, 58, 34, '翻页右');
fits(148, 412, 184, 30, '启动开关');

console.log('=== 计算器 ===');
fits(95, 54, 290, 54, '输入框面板');
fits(333, 61, 44, 40, 'DEL 键');
const CELL = 62, GAP = 8, GX = Math.round((480 - (5 * CELL + 4 * GAP)) / 2);
fits(GX, 112, 5 * CELL + 4 * GAP, 4 * CELL + 3 * GAP, '键盘网格');
// 历史面板已改为整屏铺底，改为校验行卡片
[0,1,2,3,4].forEach(i => fits(92, 112 + i * 42, 296, 34, '历史行' + i));
fits(94, 342, 132, 40, '历史清空');
fits(254, 342, 132, 40, '历史关闭');

console.log('=== 密码键盘 ===');
fits(gx, 132, gw, 4 * kH + 3 * kG, '键盘网格');
fits(223, 382, 34, 34, '关闭钮');

console.log('=== 书架弹层 ===');
fits(84, 148, 312, 188, '删除确认卡');
fits(104, 268, 126, 44, '取消');
fits(250, 268, 126, 44, '删除');
fits(66, 138, 348, 208, '接收卡');
// 关于卡已移除（改整屏铺底）
fits(100, 376, 280, 48, 'toast');


console.log(fail === 0 ? '\nALL RECTS INSIDE CIRCLE' : '\n' + fail + ' RECT(S) OUT OF BOUNDS');
process.exit(fail === 0 ? 0 : 1);

