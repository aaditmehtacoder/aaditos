/**
 * Generates the PWA icon set.
 *
 * The mark is drawn from a pixel grid rather than a font so the build has no
 * rasterizer dependency and the output is byte-identical on every machine.
 * Run with `bun run icons` after changing the palette or the glyph.
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../public/icons");

// Indigo accent from the design system, converted from oklch(0.53 0.208 275).
const BRAND = [79, 70, 229];
const INK = [255, 255, 255];

/**
 * The mark, rasterized from the same outline as `src/components/os/logo.tsx`
 * so the PWA icon and the in-app SVG can never drift apart.
 *
 * A four-point sparkle: an astroid-like curve, x = r·cos³ᐟ²·⁴ t, traced in 48
 * steps on the SVG's own 24-unit grid, centred on (12, 12). The exponent below
 * 3 fattens the arms so it still reads at 16px.
 */
const MARK_POINTS = Array.from({ length: 48 }, (_, i) => {
  const t = (i / 48) * Math.PI * 2;
  const shape = (v) => Math.sign(v) * Math.abs(v) ** 2.4;
  return [
    Math.round((12 + 7 * shape(Math.cos(t))) * 100) / 100,
    Math.round((12 + 7 * shape(Math.sin(t))) * 100) / 100,
  ];
});

/** Even-odd point-in-polygon. The renderer supersamples this per pixel. */
function inside(px, py, points) {
  let hit = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    crc32.table = table;
  }
  let crc = -1;
  for (const byte of buf) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([length, typeBuf, data, crcBuf]);
}

function png(width, height, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // no filter
    for (let x = 0; x < width; x += 1) {
      const src = (y * width + x) * 4;
      const dst = y * (width * 4 + 1) + 1 + x * 4;
      raw[dst] = pixels[src];
      raw[dst + 1] = pixels[src + 1];
      raw[dst + 2] = pixels[src + 2];
      raw[dst + 3] = pixels[src + 3];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function draw(size, { maskable }) {
  const pixels = Buffer.alloc(size * size * 4);
  // Maskable icons must survive a circular crop, so the glyph is drawn smaller
  // and the background covers the full square.
  const radius = maskable ? 0 : Math.round(size * 0.22);
  const glyphScale = maskable ? 0.42 : 0.54;

  // Fit the mark's bounding box into a centred square of `size * glyphScale`,
  // preserving aspect. Everything below samples the polygon directly, so edges
  // are antialiased instead of snapped to a coarse cell grid.
  const xs = MARK_POINTS.map((pt) => pt[0]);
  const ys = MARK_POINTS.map((pt) => pt[1]);
  const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
  const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
  const markW = maxX - minX;
  const markH = maxY - minY;
  const box = size * glyphScale;
  const scale = Math.min(box / markW, box / markH);
  const drawW = markW * scale;
  const drawH = markH * scale;
  const offsetX = (size - drawW) / 2;
  const offsetY = (size - drawH) / 2;

  /** 4x4 supersample: fraction of this pixel covered by the mark. */
  const coverageAt = (x, y) => {
    let hits = 0;
    for (let sy = 0; sy < 4; sy += 1) {
      for (let sx = 0; sx < 4; sx += 1) {
        const px = minX + (x + (sx + 0.5) / 4 - offsetX) / scale;
        const py = minY + (y + (sy + 0.5) / 4 - offsetY) / scale;
        if (inside(px, py, MARK_POINTS)) hits += 1;
      }
    }
    return hits / 16;
  };

  /** Same supersample for the rounded corner, so the silhouette is smooth. */
  const cornerAlphaAt = (x, y) => {
    if (radius <= 0) return 1;
    let hits = 0;
    for (let sy = 0; sy < 4; sy += 1) {
      for (let sx = 0; sx < 4; sx += 1) {
        const px = x + (sx + 0.5) / 4;
        const py = y + (sy + 0.5) / 4;
        const cx = px < radius ? radius : px > size - radius ? size - radius : px;
        const cy = py < radius ? radius : py > size - radius ? size - radius : py;
        const dx = px - cx;
        const dy = py - cy;
        if (dx * dx + dy * dy <= radius * radius) hits += 1;
      }
    }
    return hits / 16;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const alpha = cornerAlphaAt(x, y);
      if (alpha <= 0) {
        pixels[i + 3] = 0;
        continue;
      }
      const cover = coverageAt(x, y);
      for (let c = 0; c < 3; c += 1) {
        pixels[i + c] = Math.round(BRAND[c] + (INK[c] - BRAND[c]) * cover);
      }
      pixels[i + 3] = Math.round(alpha * 255);
    }
  }
  return png(size, size, pixels);
}

mkdirSync(OUT_DIR, { recursive: true });
const targets = [
  { name: "icon-192.png", size: 192, maskable: false },
  { name: "icon-512.png", size: 512, maskable: false },
  { name: "icon-maskable-512.png", size: 512, maskable: true },
  { name: "apple-touch-icon.png", size: 180, maskable: true },
];

for (const target of targets) {
  writeFileSync(resolve(OUT_DIR, target.name), draw(target.size, { maskable: target.maskable }));
  console.log(`wrote public/icons/${target.name} (${target.size}x${target.size})`);
}

/**
 * favicon.ico holding PNG frames, which every current browser reads. 32 for
 * the tab, 16 for old toolbars, 256 for anything that wants it large.
 */
function ico(sizes) {
  const frames = sizes.map((size) => ({ size, data: draw(size, { maskable: false }) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = 6 + 16 * frames.length;
  const entries = frames.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...frames.map((f) => f.data)]);
}

writeFileSync(resolve(OUT_DIR, "../favicon.ico"), ico([16, 32, 256]));
console.log("wrote public/favicon.ico (16, 32, 256)");
