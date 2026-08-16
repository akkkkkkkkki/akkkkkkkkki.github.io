export function drawQr(canvas, text, { size = 180, color = "#365c50", background = "#fffaf1" } = {}) {
  const qrcode = globalThis.qrcode;
  if (!qrcode) throw new Error("二维码组件没有加载，请刷新后重试");
  const qr = qrcode(0, "M"); qr.addData(text); qr.make();
  const count = qr.getModuleCount(), margin = 3, total = count + margin * 2;
  const ratio = Math.max(1, globalThis.devicePixelRatio || 1);
  canvas.width = size * ratio; canvas.height = size * ratio; canvas.style.width = `${size}px`; canvas.style.height = `${size}px`;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("浏览器无法绘制二维码，请使用 Open 链接");
  context.scale(ratio, ratio); context.fillStyle = background; context.fillRect(0, 0, size, size); context.fillStyle = color;
  for (let row = 0; row < count; row += 1) for (let col = 0; col < count; col += 1) if (qr.isDark(row, col)) {
    const x0 = Math.round((col + margin) * size / total), x1 = Math.round((col + margin + 1) * size / total);
    const y0 = Math.round((row + margin) * size / total), y1 = Math.round((row + margin + 1) * size / total);
    context.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
}
