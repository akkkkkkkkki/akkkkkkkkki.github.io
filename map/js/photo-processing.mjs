export async function processPhoto(file) {
  let bitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch { throw new Error("这张照片无法读取，请在相册中转换为 JPEG 后重试"); }
  try {
    const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const photo = await canvasBlob(bitmap, width, height, .84);
    const thumbScale = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
    const thumbnail = await canvasBlob(bitmap, Math.max(1, Math.round(bitmap.width * thumbScale)), Math.max(1, Math.round(bitmap.height * thumbScale)), .75);
    return { photo, thumbnail, width, height };
  } finally { bitmap.close(); }
}

export function photoForm(processed, position) {
  const form = new FormData();
  form.set("photo", processed.photo, "photo.webp");
  form.set("thumbnail", processed.thumbnail, "thumbnail.webp");
  form.set("position", String(position));
  form.set("width", String(processed.width));
  form.set("height", String(processed.height));
  return form;
}

function canvasBlob(bitmap, width, height, quality) {
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  canvas.getContext("2d", { alpha: false }).drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("照片压缩失败")), "image/webp", quality));
}
