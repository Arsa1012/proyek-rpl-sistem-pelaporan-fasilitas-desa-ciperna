/**
 * Membuat src/app/favicon.ico tanpa dependensi tambahan.
 * Ikon mengikuti lambang sementara di src/components/landing/Logo.tsx.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const SIZE = 32;

function insideRoundedRect(x, y, left, top, right, bottom, r) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = Math.min(Math.max(x, left + r), right - r);
  const cy = Math.min(Math.max(y, top + r), bottom - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r ** 2;
}

function insideTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

const pixels = new Uint8ClampedArray(SIZE * SIZE * 4);

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    // Latar transparan.
    pixels[i] = 0;
    pixels[i + 1] = 0;
    pixels[i + 2] = 0;
    pixels[i + 3] = 0;

    // Kotak membulat hijau dengan gradien diagonal.
    if (insideRoundedRect(x + 0.5, y + 0.5, 1, 1, 31, 31, 8)) {
      const t = (x + y) / (2 * (SIZE - 1));
      pixels[i] = Math.round(15 + (22 - 15) * t);
      pixels[i + 1] = Math.round(118 + (163 - 118) * t);
      pixels[i + 2] = Math.round(110 + (74 - 110) * t);
      pixels[i + 3] = 255;
    }

    // Atap putih.
    if (insideTriangle(x + 0.5, y + 0.5, 16, 5, 5, 13, 27, 13)) {
      pixels[i] = 255;
      pixels[i + 1] = 255;
      pixels[i + 2] = 255;
      pixels[i + 3] = 255;
    }

    // Badan bangunan putih.
    if (x >= 9 && x <= 22 && y >= 13 && y <= 27) {
      pixels[i] = 255;
      pixels[i + 1] = 255;
      pixels[i + 2] = 255;
      pixels[i + 3] = 255;
    }

    // Jendela hijau.
    const isWindow =
      ((x >= 12 && x <= 15) || (x >= 18 && x <= 21)) &&
      ((y >= 16 && y <= 19) || (y >= 21 && y <= 24));
    if (isWindow) {
      pixels[i] = 15;
      pixels[i + 1] = 118;
      pixels[i + 2] = 110;
      pixels[i + 3] = 255;
    }

    // Pintu hijau.
    if (x >= 14 && x <= 17 && y >= 24 && y <= 27) {
      pixels[i] = 15;
      pixels[i + 1] = 118;
      pixels[i + 2] = 110;
      pixels[i + 3] = 255;
    }

    // Garis dasar putih.
    if (x >= 4 && x <= 27 && y >= 28 && y <= 29) {
      pixels[i] = 255;
      pixels[i + 1] = 255;
      pixels[i + 2] = 255;
      pixels[i + 3] = 235;
    }
  }
}

// ICO: header + satuan BMP 32-bit (BGRA, bottom-up) + AND mask.
const xorSize = SIZE * SIZE * 4;
const andRowSize = Math.ceil(SIZE / 32) * 4;
const andSize = andRowSize * SIZE;
const bmpSize = 40 + xorSize + andSize;
const dib = Buffer.alloc(40);
dib.writeUInt32LE(40, 0);
dib.writeInt32LE(SIZE, 4);
dib.writeInt32LE(SIZE * 2, 8);
dib.writeUInt16LE(1, 12);
dib.writeUInt16LE(32, 14);
dib.writeUInt32LE(0, 16);
dib.writeUInt32LE(xorSize + andSize, 20);

const xor = Buffer.alloc(xorSize);
for (let y = 0; y < SIZE; y++) {
  const srcRow = SIZE - 1 - y;
  for (let x = 0; x < SIZE; x++) {
    const src = (srcRow * SIZE + x) * 4;
    const dst = (y * SIZE + x) * 4;
    xor[dst] = pixels[src + 2]; // B
    xor[dst + 1] = pixels[src + 1]; // G
    xor[dst + 2] = pixels[src]; // R
    xor[dst + 3] = pixels[src + 3]; // A
  }
}

const andMask = Buffer.alloc(andSize, 0);
const iconDir = Buffer.alloc(6);
iconDir.writeUInt16LE(0, 0);
iconDir.writeUInt16LE(1, 2);
iconDir.writeUInt16LE(1, 4);

const entry = Buffer.alloc(16);
entry[0] = SIZE;
entry[1] = SIZE;
entry[2] = 0;
entry[3] = 0;
entry.writeUInt16LE(1, 4);
entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(bmpSize, 8);
entry.writeUInt32LE(22, 12);

const ico = Buffer.concat([iconDir, entry, dib, xor, andMask]);
const out = path.join(process.cwd(), 'src', 'app', 'favicon.ico');
await fs.writeFile(out, ico);
console.log(`Wrote ${out} (${ico.length} bytes)`);
