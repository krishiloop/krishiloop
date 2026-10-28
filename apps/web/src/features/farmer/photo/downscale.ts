/**
 * Get a farmer's photo ready for the server: at most 1024 px on the long side, as a JPEG, and as base64 (no `data:` prefix),
 * which is what POST /api/demo/{sid}/photo takes. Done in the browser so a 12-megapixel phone photo never goes over a weak
 * network at full size, and so the picture the farmer sees in the preview is exactly the picture that is sent.
 */

/** The longest side the server needs: its model reads a 224 px crop, and the officer needs to see the leaf, not every pore. */
export const MAX_EDGE = 1024;
/** The server accepts 4,000,000 base64 characters; stay clear of the edge. */
export const B64_LIMIT = 3_900_000;
const QUALITIES = [0.85, 0.72, 0.6, 0.48];

/** Fit a photo inside a square of `max` px without ever scaling it up (rounded, at least 1 px). */
export function fitWithin(width: number, height: number, max = MAX_EDGE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(1, width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export interface PreparedPhoto {
  blob: Blob;
  /** the JPEG as base64, without the "data:image/jpeg;base64," prefix */
  b64: string;
  width: number;
  height: number;
  bytes: number;
}

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error ?? new Error('could not read the photo'));
    r.onload = () => {
      const s = String(r.result);
      resolve(s.slice(s.indexOf(',') + 1));
    };
    r.readAsDataURL(blob);
  });

const toJpeg = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not encode the photo'))), 'image/jpeg', quality));

/** Decode with the camera's rotation applied (phones store portrait photos sideways plus an EXIF flag). */
async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; done: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bmp, width: bmp.width, height: bmp.height, done: () => bmp.close() };
    } catch {
      /* an older browser or a format it cannot bitmap: fall back to an <img> */
    }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
}

/** Downscale to at most `maxEdge` px and encode as a JPEG small enough for the server. Throws when the file is not an image. */
export async function prepareJpeg(file: Blob, maxEdge = MAX_EDGE): Promise<PreparedPhoto> {
  const src = await decode(file);
  try {
    if (!src.width || !src.height) throw new Error('the photo has no pixels');
    let edge = maxEdge;
    for (let attempt = 0; attempt < 3; attempt++, edge = Math.round(edge * 0.8)) {
      const { width, height } = fitWithin(src.width, src.height, edge);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      ctx.fillStyle = '#fff'; // a PNG with transparency would turn black as a JPEG
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(src.source, 0, 0, width, height);
      for (const q of QUALITIES) {
        const blob = await toJpeg(canvas, q);
        const b64 = await toBase64(blob);
        if (b64.length <= B64_LIMIT) return { blob, b64, width, height, bytes: blob.size };
      }
    }
    throw new Error('the photo is too large to send');
  } finally {
    src.done();
  }
}
