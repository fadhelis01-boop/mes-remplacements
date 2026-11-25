// Génère les icônes PNG sans dépendance : node tools/make-icons.mjs
// Dessin : un calendrier blanc avec une coche, sur fond bleu.
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";

const BG = [0x1f, 0x5f, 0x9e], FG = [255, 255, 255], ACC = [0x1e, 0x7d, 0x4f];
const inRR = (x, y, rx, ry, w, h, r) => {
  if (x < rx || y < ry || x > rx + w || y > ry + h) return false;
  const cx = Math.min(Math.max(x, rx + r), rx + w - r), cy = Math.min(Math.max(y, ry + r), ry + h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const near = (x, y, x1, y1, x2, y2, w) => {
  const dx = x2 - x1, dy = y2 - y1, t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  return (x - x1 - t * dx) ** 2 + (y - y1 - t * dy) ** 2 <= w * w;
};
// coordonnées sur une grille de 512
function couleur(x, y) {
  const page = inRR(x, y, 116, 132, 280, 264, 34);
  const tete = inRR(x, y, 116, 132, 280, 70, 34) || (x >= 116 && x <= 396 && y >= 170 && y <= 202);
  const anneau = near(x, y, 190, 104, 190, 150, 16) || near(x, y, 322, 104, 322, 150, 16);
  const coche = near(x, y, 186, 296, 236, 344, 20) || near(x, y, 236, 344, 330, 244, 20);
  if (anneau) return FG;
  if (coche && page && !tete) return ACC;
  if (tete) return [0xd9, 0xe8, 0xf6];
  if (page) return FG;
  return null;
}
function render(size, { rounded, scale = 1 }) {
  const px = Buffer.alloc(size * size * 4), ss = 4;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const X = ((i + (sx + 0.5) / ss) / size) * 512, Y = ((j + (sy + 0.5) / ss) / size) * 512;
      if (rounded && !inRR(X, Y, 0, 0, 512, 512, 112)) continue;
      const cX = 256 + (X - 256) / scale, cY = 256 + (Y - 256) / scale;
      const c = couleur(cX, cY) || BG;
      r += c[0]; g += c[1]; b += c[2]; a += 255;
    }
    const n = ss * ss, o = (j * size + i) * 4;
    px[o] = a ? Math.round(r / (a / 255)) : 0; px[o + 1] = a ? Math.round(g / (a / 255)) : 0; px[o + 2] = a ? Math.round(b / (a / 255)) : 0; px[o + 3] = Math.round(a / n);
  }
  return png(size, px);
}
function png(size, px) {
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
mkdirSync("icons", { recursive: true });
writeFileSync("icons/icon-192.png", render(192, { rounded: true }));
writeFileSync("icons/icon-512.png", render(512, { rounded: true }));
writeFileSync("icons/icon-maskable-512.png", render(512, { rounded: false, scale: 0.8 }));
writeFileSync("icons/apple-touch-icon.png", render(180, { rounded: false }));
writeFileSync("icons/icon.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#1f5f9e"/><rect x="116" y="132" width="280" height="264" rx="34" fill="#fff"/><path d="M150 132h212a34 34 0 0 1 34 34v36H116v-36a34 34 0 0 1 34-34z" fill="#d9e8f6"/><path d="M190 104v46M322 104v46" stroke="#fff" stroke-width="32" stroke-linecap="round"/><path d="M186 296l50 48 94-100" fill="none" stroke="#1e7d4f" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
console.log("icônes générées");
