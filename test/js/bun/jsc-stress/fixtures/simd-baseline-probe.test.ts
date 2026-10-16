// Temporary measurement for the verify-baseline step: prints how long each
// phase of the three slow simd-baseline tests takes under the emulator, cold
// (round 1) and warm (rounds 2 and 3).

import { expect, test } from "bun:test";
import { promisify } from "node:util";
import { deflate, deflateSync } from "node:zlib";

const deflateAsync = promisify(deflate);

let last = performance.now();
let lastCpu = process.cpuUsage();
function mark(label: string) {
  const now = performance.now();
  const cpu = process.cpuUsage(lastCpu);
  const rss = (process.memoryUsage.rss() / 1048576).toFixed(0);
  console.log(
    `PROBE ${label} ${(now - last).toFixed(1)}ms (user ${(cpu.user / 1000).toFixed(0)}ms sys ${(cpu.system / 1000).toFixed(0)}ms rss ${rss}MB)`,
  );
  lastCpu = process.cpuUsage();
  last = performance.now();
}

const width = 72;
const height = 40;

function crc32(bytes: Uint8Array): number {
  let crc = ~0 >>> 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(Buffer.from(type, "latin1"), 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

function png(tag: string, rgb: (x: number, y: number) => [number, number, number]): Uint8Array {
  const stride = 1 + width * 3;
  const raw = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) raw.set(rgb(x, y), y * stride + 1 + x * 3);
  }
  mark(`${tag} png.pixels`);
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const idat = deflateSync(raw);
  mark(`${tag} png.deflateSync`);
  const out = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
  mark(`${tag} png.crc32+concat`);
  return out;
}

async function pool(tag: string) {
  const small = Buffer.alloc(4096, "a");
  deflateSync(small);
  mark(`${tag} pool.deflateSync(4k)`);
  await deflateAsync(small);
  mark(`${tag} pool.deflateAsync(4k) a`);
  await deflateAsync(small);
  mark(`${tag} pool.deflateAsync(4k) b`);
  await Promise.all(Array.from({ length: 16 }, () => deflateAsync(small)));
  mark(`${tag} pool.deflateAsync(4k) x16 a`);
  await Promise.all(Array.from({ length: 16 }, () => deflateAsync(small)));
  mark(`${tag} pool.deflateAsync(4k) x16 b`);
}

async function grey(tag: string) {
  const source = png(tag, () => [77, 77, 77]);
  const image = new Bun.Image(source);
  mark(`${tag} new Bun.Image`);
  const pending = image.jpeg({ quality: 100 }).bytes();
  mark(`${tag} jpeg().bytes() call`);
  const first = await pending;
  mark(`${tag} await png->jpeg`);
  const second = await new Bun.Image(first).jpeg({ quality: 100 }).bytes();
  mark(`${tag} await jpeg->jpeg`);
  expect(first.subarray(0, 2)).toEqual(new Uint8Array([0xff, 0xd8]));
  expect(second).toEqual(first);
  mark(`${tag} expect`);
}

async function gradient(tag: string) {
  const source = png(tag, (x, y) => [x * 3, y * 6, (x + y) & 0xff]);
  for (const progressive of [false, true]) {
    const p = progressive ? "progressive" : "baseline";
    const jpeg = await new Bun.Image(source).jpeg({ quality: 90, progressive }).bytes();
    mark(`${tag} ${p} await png->jpeg`);
    expect(await new Bun.Image(jpeg).metadata()).toEqual({ width, height, format: "jpeg" });
    mark(`${tag} ${p} await jpeg metadata`);
    const decoded = await new Bun.Image(jpeg).png().bytes();
    mark(`${tag} ${p} await jpeg->png`);
    expect(await new Bun.Image(decoded).metadata()).toEqual({ width, height, format: "png" });
    mark(`${tag} ${p} await png metadata`);
  }
}

async function http(tag: string, host: string) {
  const longHeaderValue = Buffer.alloc(512, "v").toString();
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      return new Response(req.headers.get("X-Test-Header") || "missing");
    },
  });
  mark(`${tag} Bun.serve`);
  const pending = fetch(`http://${host}:${server.port}/` + "path/".repeat(20), {
    headers: {
      "X-Test-Header": longHeaderValue,
      "X-Header-A": Buffer.alloc(64, "a").toString(),
      "X-Header-B": Buffer.alloc(64, "b").toString(),
      "X-Header-C": Buffer.alloc(64, "c").toString(),
      "Accept": "application/json",
      "Accept-Language": "en-US,en;q=0.9,fr;q=0.8,de;q=0.7",
    },
  });
  mark(`${tag} fetch() call`);
  const resp = await pending;
  mark(`${tag} await fetch`);
  expect(await resp.text()).toBe(longHeaderValue);
  mark(`${tag} await text`);
  await server.stop(true);
  mark(`${tag} server.stop`);
}

function steady(tag: string) {
  let sum = 0;
  for (let i = 0; i < 2_000_000; i++) sum = (sum + i * 3) | 0;
  mark(`${tag} steady js loop 2M (${sum})`);
  const hex = Buffer.alloc(4 << 20, 0xab).toString("hex");
  mark(`${tag} steady native hex 4MB (${hex.length})`);
}

test("probe", async () => {
  console.log(`PROBE cpus=${navigator.hardwareConcurrency} revision=${Bun.revision.slice(0, 9)}`);
  mark("start");
  for (const round of [1, 2, 3]) {
    await pool(`r${round} pool:`);
    await http(`r${round} http(localhost):`, "localhost");
    await http(`r${round} http(127.0.0.1):`, "127.0.0.1");
    await grey(`r${round} grey:`);
    await gradient(`r${round} gradient:`);
    steady(`r${round}`);
  }
}, 240_000);
