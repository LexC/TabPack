import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { validateExtension } from "./validate-extension.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const extensionDir = path.join(repoRoot, "extension");
const distDir = path.join(repoRoot, "dist");
const crcTable = makeCrcTable();

const target = process.argv[2] || "all";
const targets = target === "all" ? ["edge", "chrome"] : [target];
const allowedTargets = new Set(["edge", "chrome"]);

for (const name of targets) {
  if (!allowedTargets.has(name)) {
    console.error(`Unknown build target: ${name}`);
    console.error("Use one of: edge, chrome, all.");
    process.exit(1);
  }
}

validateExtension();
mkdirSync(distDir, { recursive: true });

const manifest = JSON.parse(readFileSync(path.join(extensionDir, "manifest.json"), "utf8"));
const entries = collectFiles(extensionDir);

for (const name of targets) {
  const outputPath = path.join(distDir, `tabpack-${name}-${manifest.version}.zip`);
  rmSync(outputPath, { force: true });
  writeFileSync(outputPath, makeZip(entries));
  console.log(`Wrote ${path.relative(repoRoot, outputPath)}`);
}

function collectFiles(directory, baseDirectory = directory) {
  const entries = [];

  for (const name of readdirSync(directory).sort()) {
    const absolutePath = path.join(directory, name);
    const stats = statSync(absolutePath);

    if (stats.isDirectory()) {
      entries.push(...collectFiles(absolutePath, baseDirectory));
      continue;
    }

    if (!stats.isFile()) {
      continue;
    }

    entries.push({
      absolutePath,
      zipPath: path.relative(baseDirectory, absolutePath).replaceAll(path.sep, "/"),
      data: readFileSync(absolutePath),
      mode: 0o100644,
      mtime: stats.mtime
    });
  }

  return entries;
}

function makeZip(entries) {
  const fileRecords = [];
  const outputParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.zipPath, "utf8");
    const compressed = deflateRawSync(entry.data, { level: 9 });
    const crc = crc32(entry.data);
    const { dosTime, dosDate } = toDosDateTime(entry.mtime);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    outputParts.push(localHeader, nameBuffer, compressed);
    fileRecords.push({ entry, nameBuffer, compressedSize: compressed.length, crc, dosTime, dosDate, offset });
    offset += localHeader.length + nameBuffer.length + compressed.length;
  }

  const centralDirectoryOffset = offset;

  for (const record of fileRecords) {
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(record.dosTime, 12);
    centralHeader.writeUInt16LE(record.dosDate, 14);
    centralHeader.writeUInt32LE(record.crc, 16);
    centralHeader.writeUInt32LE(record.compressedSize, 20);
    centralHeader.writeUInt32LE(record.entry.data.length, 24);
    centralHeader.writeUInt16LE(record.nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(record.entry.mode * 0x10000, 38);
    centralHeader.writeUInt32LE(record.offset, 42);

    outputParts.push(centralHeader, record.nameBuffer);
    offset += centralHeader.length + record.nameBuffer.length;
  }

  const centralDirectorySize = offset - centralDirectoryOffset;
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(fileRecords.length, 8);
  endRecord.writeUInt16LE(fileRecords.length, 10);
  endRecord.writeUInt32LE(centralDirectorySize, 12);
  endRecord.writeUInt32LE(centralDirectoryOffset, 16);
  endRecord.writeUInt16LE(0, 20);
  outputParts.push(endRecord);

  return Buffer.concat(outputParts);
}

function toDosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    dosDate: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function makeCrcTable() {
  return Array.from({ length: 256 }, (_value, index) => {
    let crc = index;

    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }

    return crc >>> 0;
  });
}
