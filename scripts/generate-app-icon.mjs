/**
 * Regenerate `assets/icons/icon.ico` from the master `assets/icons/icon.png`.
 *
 * The .ico MUST be built from BMP (DIB) frames, never from PNG-compressed frames:
 * WIC/WPF cannot decode PNG-in-ICO, and Squirrel.Windows' installer shows its
 * progress window with `BitmapFrame.Create(setupIcon.ico)`. When that decode
 * throws, Update.exe dies with an unhandled exception and Setup.exe reports
 * "Installation has failed" even though the app was installed.
 *
 * Usage: node scripts/generate-app-icon.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export const ICON_SIZES = [16, 32, 48, 64, 128, 256];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Channels per pixel for each PNG color type. */
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * Minimal, non-interlaced PNG decoder (8/16 bit, all color types) returning RGBA.
 */
export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('not a PNG file');
  }

  let offset = 8;
  let header;
  let palette = null;
  let transparency = null;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'tRNS') {
      transparency = data;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }

    offset += 12 + length;
  }

  if (!header) throw new Error('PNG without IHDR');
  if (header.interlace !== 0) throw new Error('interlaced PNG is not supported');
  if (header.bitDepth !== 8 && header.bitDepth !== 16) {
    throw new Error(`unsupported PNG bit depth ${header.bitDepth}`);
  }

  const channels = CHANNELS[header.colorType];
  if (!channels) throw new Error(`unsupported PNG color type ${header.colorType}`);
  if (header.colorType === 3 && !palette) throw new Error('palette PNG without PLTE');

  const { width, height, bitDepth, colorType } = header;
  const bytesPerPixel = Math.ceil((channels * bitDepth) / 8);
  const bytesPerRow = Math.ceil((width * channels * bitDepth) / 8);
  const raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(bytesPerRow);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (bytesPerRow + 1)];
    const row = Buffer.from(raw.subarray(y * (bytesPerRow + 1) + 1, (y + 1) * (bytesPerRow + 1)));

    for (let x = 0; x < bytesPerRow; x++) {
      const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
      const up = previous[x];
      const upLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;

      switch (filter) {
        case 0:
          break;
        case 1:
          row[x] = (row[x] + left) & 0xff;
          break;
        case 2:
          row[x] = (row[x] + up) & 0xff;
          break;
        case 3:
          row[x] = (row[x] + ((left + up) >> 1)) & 0xff;
          break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          row[x] = (row[x] + predictor) & 0xff;
          break;
        }
        default:
          throw new Error(`unsupported PNG filter type ${filter}`);
      }
    }

    const sample = (index) => {
      if (bitDepth === 8) return row[index];
      return row[index * 2]; // 16 bit: keep the high byte
    };

    for (let x = 0; x < width; x++) {
      const target = (y * width + x) * 4;

      if (colorType === 3) {
        const entry = sample(x);
        out[target] = palette[entry * 3];
        out[target + 1] = palette[entry * 3 + 1];
        out[target + 2] = palette[entry * 3 + 2];
        out[target + 3] = transparency && entry < transparency.length ? transparency[entry] : 255;
        continue;
      }

      const base = x * channels;
      if (colorType === 0 || colorType === 4) {
        const gray = sample(base);
        out[target] = gray;
        out[target + 1] = gray;
        out[target + 2] = gray;
        out[target + 3] = colorType === 4 ? sample(base + 1) : 255;
      } else {
        out[target] = sample(base);
        out[target + 1] = sample(base + 1);
        out[target + 2] = sample(base + 2);
        out[target + 3] = colorType === 6 ? sample(base + 3) : 255;
      }
    }

    previous = row;
  }

  return { width, height, data: out };
}

/**
 * Downscale with an area (box) average, which is exact for integer ratios.
 */
export function resizeArea(image, size) {
  const { width: sourceWidth, height: sourceHeight, data } = image;
  const out = Buffer.alloc(size * size * 4);

  for (let targetY = 0; targetY < size; targetY++) {
    const y0 = (targetY * sourceHeight) / size;
    const y1 = ((targetY + 1) * sourceHeight) / size;

    for (let targetX = 0; targetX < size; targetX++) {
      const x0 = (targetX * sourceWidth) / size;
      const x1 = ((targetX + 1) * sourceWidth) / size;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let weightSum = 0;

      for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
        const weightY = Math.min(y1, y + 1) - Math.max(y0, y);
        if (weightY <= 0) continue;

        for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
          const weightX = Math.min(x1, x + 1) - Math.max(x0, x);
          if (weightX <= 0) continue;

          const weight = weightX * weightY;
          const source = (y * sourceWidth + x) * 4;
          r += data[source] * weight;
          g += data[source + 1] * weight;
          b += data[source + 2] * weight;
          a += data[source + 3] * weight;
          weightSum += weight;
        }
      }

      const target = (targetY * size + targetX) * 4;
      out[target] = Math.round(r / weightSum);
      out[target + 1] = Math.round(g / weightSum);
      out[target + 2] = Math.round(b / weightSum);
      out[target + 3] = Math.round(a / weightSum);
    }
  }

  return out;
}

/**
 * Encode a single icon image as a 32bpp BI_RGB DIB (as stored inside an .ico).
 */
export function encodeBmpFrame(size, rgba) {
  const rowSize = size * 4;
  const maskRowSize = Math.ceil(size / 32) * 4;
  const pixelsSize = rowSize * size;
  const maskSize = maskRowSize * size;
  const frame = Buffer.alloc(40 + pixelsSize + maskSize);

  frame.writeUInt32LE(40, 0); // biSize
  frame.writeInt32LE(size, 4); // biWidth
  frame.writeInt32LE(size * 2, 8); // biHeight (XOR bitmap + AND mask)
  frame.writeUInt16LE(1, 12); // biPlanes
  frame.writeUInt16LE(32, 14); // biBitCount
  frame.writeUInt32LE(0, 16); // biCompression = BI_RGB
  frame.writeUInt32LE(pixelsSize, 20); // biSizeImage

  for (let y = 0; y < size; y++) {
    const source = (size - 1 - y) * rowSize; // DIB rows are bottom-up
    for (let x = 0; x < size; x++) {
      const from = source + x * 4;
      const to = 40 + y * rowSize + x * 4;
      frame[to] = rgba[from + 2]; // B
      frame[to + 1] = rgba[from + 1]; // G
      frame[to + 2] = rgba[from]; // R
      frame[to + 3] = rgba[from + 3]; // A
    }
  }

  // The AND mask stays all-zero: every pixel is described by the alpha channel.
  return frame;
}

/** Assemble an .ico from `{ size, rgba }` frames (expected in ascending size order). */
export function encodeIco(frames) {
  const headerSize = 6 + frames.length * 16;
  const payloads = frames.map((frame) => encodeBmpFrame(frame.size, frame.rgba));
  const total = payloads.reduce((sum, payload) => sum + payload.length, headerSize);
  const ico = Buffer.alloc(total);

  ico.writeUInt16LE(0, 0); // reserved
  ico.writeUInt16LE(1, 2); // type: icon
  ico.writeUInt16LE(frames.length, 4); // image count

  let offset = headerSize;
  frames.forEach((frame, index) => {
    const entry = 6 + index * 16;
    ico.writeUInt8(frame.size >= 256 ? 0 : frame.size, entry);
    ico.writeUInt8(frame.size >= 256 ? 0 : frame.size, entry + 1);
    ico.writeUInt8(0, entry + 2); // color count
    ico.writeUInt8(0, entry + 3); // reserved
    ico.writeUInt16LE(1, entry + 4); // planes
    ico.writeUInt16LE(32, entry + 6); // bits per pixel
    ico.writeUInt32LE(payloads[index].length, entry + 8);
    ico.writeUInt32LE(offset, entry + 12);
    payloads[index].copy(ico, offset);
    offset += payloads[index].length;
  });

  return ico;
}

/**
 * Entry point kept side-effect free so tests can import the helpers above.
 */
export function main() {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const source = path.join(root, 'assets', 'icons', 'icon.png');
  const target = path.join(root, 'assets', 'icons', 'icon.ico');
  const master = decodePng(readFileSync(source));
  const ico = encodeIco(
    ICON_SIZES.map((size) => ({ size, rgba: resizeArea(master, size) })),
  );

  writeFileSync(target, ico);
  return `${target}: ${ICON_SIZES.join(', ')} BMP frames, ${ico.length} bytes`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(main());
}
