import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ICON_SIZES,
  decodePng,
  encodeIco,
  resizeArea,
} from '../scripts/generate-app-icon.mjs';

// Squirrel.Windows 的安装进度窗口用 WPF（WIC）解码 setupIcon.ico：
//   Icon = BitmapFrame.Create(new Uri(setupIcon, UriKind.Relative));
// WIC 的 ICO 解码器不支持 PNG 压缩帧，会抛 System.IO.FileFormatException，
// 该异常在线程池线程上无人捕获 -> Update.exe 以 0xE0434352 结束 ->
// Setup.exe 判定安装失败，弹出 "Installation has failed"（安装内容可能已写入，
// 也可能被中途杀死留下半成品）。所以这个 .ico 必须是 BMP(DIB) 帧。
const ico = readFileSync('assets/icons/icon.ico');
const masterPng = readFileSync('assets/icons/icon.png');
const forgeConfig = readFileSync('forge.config.ts', 'utf8');

interface IcoEntry {
  size: number;
  byteLength: number;
  offset: number;
}

function readIconDirectory(buffer: Buffer): IcoEntry[] {
  expect(buffer.readUInt16LE(0)).toBe(0); // reserved
  expect(buffer.readUInt16LE(2)).toBe(1); // 1 = icon
  const count = buffer.readUInt16LE(4);

  return Array.from({ length: count }, (_, index) => {
    const entry = 6 + index * 16;
    // 0 表示 256（ICONDIRENTRY 的宽度/高度字段只有 1 字节）
    const size = buffer.readUInt8(entry) || 256;
    expect(buffer.readUInt8(entry + 1) || 256).toBe(size);
    expect(buffer.readUInt8(entry + 2)).toBe(0); // color count
    expect(buffer.readUInt8(entry + 3)).toBe(0); // reserved
    expect(buffer.readUInt16LE(entry + 4)).toBe(1); // planes
    expect(buffer.readUInt16LE(entry + 6)).toBe(32); // bits per pixel

    return {
      size,
      byteLength: buffer.readUInt32LE(entry + 8),
      offset: buffer.readUInt32LE(entry + 12),
    };
  });
}

describe('应用图标 icon.ico', () => {
  const entries = readIconDirectory(ico);

  it('包含 16/32/48/64/128/256 六个尺寸且升序排列', () => {
    expect(entries.map(entry => entry.size)).toEqual(ICON_SIZES);
  });

  it('每个帧都是 32 位 BMP，没有 PNG 压缩帧', () => {
    for (const entry of entries) {
      const frame = ico.subarray(entry.offset, entry.offset + entry.byteLength);
      // PNG 压缩帧（Windows Vista 起允许）会让 WPF/WIC 解码失败
      expect(frame.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
        false,
      );

      expect(frame.readUInt32LE(0)).toBe(40); // BITMAPINFOHEADER
      expect(frame.readInt32LE(4)).toBe(entry.size); // biWidth
      expect(frame.readInt32LE(8)).toBe(entry.size * 2); // biHeight：XOR 位图 + AND 掩码
      expect(frame.readUInt16LE(12)).toBe(1); // biPlanes
      expect(frame.readUInt16LE(14)).toBe(32); // biBitCount
      expect(frame.readUInt32LE(16)).toBe(0); // BI_RGB

      const maskRowSize = Math.ceil(entry.size / 32) * 4;
      expect(frame.readUInt32LE(20)).toBe(entry.size * entry.size * 4); // biSizeImage
      expect(entry.byteLength).toBe(40 + entry.size * entry.size * 4 + maskRowSize * entry.size);
    }
  });

  it('目录偏移与文件长度自洽', () => {
    let expectedOffset = 6 + entries.length * 16;
    for (const entry of entries) {
      expect(entry.offset).toBe(expectedOffset);
      expectedOffset += entry.byteLength;
    }

    expect(ico.length).toBe(expectedOffset);
  });

  it('与 scripts/generate-app-icon.mjs 从 icon.png 生成的结果完全一致', () => {
    const master = decodePng(masterPng);
    expect(master.width).toBe(1024);
    expect(master.height).toBe(1024);

    const generated = encodeIco(
      ICON_SIZES.map(size => ({ size, rgba: resizeArea(master, size) })),
    );

    expect(generated.equals(ico)).toBe(true);
  });

  it('打包配置把该文件用作 Windows 安装包图标', () => {
    expect(forgeConfig).toContain("icon: './assets/icons/icon'");
    expect(forgeConfig).toContain("setupIcon: './assets/icons/icon.ico'");
  });
});
