/**
 * A test leaf DRAWN by this page (no photo, so no licence to check): a green leaf with a midrib, veins and a few
 * brown, yellow-edged spots. It is not a real leaf and the model may well call it unknown; the tool says so.
 * Deterministic: the same picture every time.
 */
export function drawTestLeaf(size = 512): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const g = cv.getContext('2d')!;
  const s = size / 512;
  // soil-and-straw background, softly lit
  const bg = g.createRadialGradient(256 * s, 220 * s, 40 * s, 256 * s, 256 * s, 380 * s);
  bg.addColorStop(0, '#c9b98f');
  bg.addColorStop(1, '#7a6a48');
  g.fillStyle = bg;
  g.fillRect(0, 0, size, size);

  g.save();
  g.translate(256 * s, 262 * s);
  g.rotate(-0.62);
  const leaf = new Path2D();
  leaf.moveTo(-220 * s, 0);
  leaf.bezierCurveTo(-120 * s, -120 * s, 120 * s, -118 * s, 226 * s, -6 * s);
  leaf.bezierCurveTo(120 * s, 112 * s, -120 * s, 116 * s, -220 * s, 0);
  const fill = g.createLinearGradient(0, -110 * s, 0, 110 * s);
  fill.addColorStop(0, '#5d9a3c');
  fill.addColorStop(0.5, '#4b8a31');
  fill.addColorStop(1, '#3a6f26');
  g.fillStyle = fill;
  g.fill(leaf);
  g.clip(leaf);
  // veins
  g.strokeStyle = 'rgba(222, 240, 190, 0.55)';
  g.lineWidth = 4 * s;
  g.beginPath();
  g.moveTo(-220 * s, 0);
  g.quadraticCurveTo(0, -8 * s, 226 * s, -6 * s);
  g.stroke();
  g.lineWidth = 2 * s;
  for (let i = -5; i <= 5; i++) {
    if (!i) continue;
    const x = i * 36 * s;
    for (const side of [-1, 1]) {
      g.beginPath();
      g.moveTo(x, -4 * s);
      g.quadraticCurveTo(x + 30 * s, side * 40 * s, x + 64 * s, side * 96 * s);
      g.stroke();
    }
  }
  // lesions: brown centres with a pale tan halo (no yellow anywhere: owner, 20 Nov)
  const spots: [number, number, number][] = [
    [-90, -30, 18],
    [-40, 34, 13],
    [30, -46, 16],
    [86, 20, 21],
    [140, -22, 11],
    [-150, 18, 10],
  ];
  for (const [x, y, r] of spots) {
    const halo = g.createRadialGradient(x * s, y * s, r * 0.4 * s, x * s, y * s, r * 1.9 * s);
    halo.addColorStop(0, 'rgba(176, 140, 96, 0.95)');
    halo.addColorStop(1, 'rgba(176, 140, 96, 0)');
    g.fillStyle = halo;
    g.beginPath();
    g.ellipse(x * s, y * s, r * 2.2 * s, r * 1.5 * s, 0.3, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#6b4224';
    g.beginPath();
    g.ellipse(x * s, y * s, r * s, r * 0.7 * s, 0.3, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(40, 24, 12, 0.6)';
    g.beginPath();
    g.ellipse(x * s, y * s, r * 0.45 * s, r * 0.3 * s, 0.3, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  return cv;
}
