"use client";

// Phone photos are 3–12 MB; shrink before upload (about 1600 px, JPEG) so serverless limits and the
// AI reader's free tier are happy. PDFs and formats the browser can't decode go as they are.
export async function shrink(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  let img: ImageBitmap;
  try {
    img = await createImageBitmap(file);
  } catch {
    return file; // e.g. HEIC on some browsers: send as-is, the server can still read it
  }
  try {
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob((b) => res(b ?? file), "image/jpeg", 0.85));
  } finally {
    img.close();
  }
}
