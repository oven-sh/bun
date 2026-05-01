import { expect, test } from "bun:test";
import * as zlib from "zlib";

const expectStr = "abcdefghijklmnopqrstuvwxyz".repeat(2);
const expectBuf = Buffer.from(expectStr);

function createWriter(target: zlib.Zlib, buffer: Buffer): Promise<void> {
  return new Promise(resolve => {
    let size = 0;
    const write = () => {
      if (size < buffer.length) {
        target.write(Buffer.from([buffer[size++]]), () => {
          target.flush(() => write());
        });
      } else {
        target.end(() => resolve());
      }
    };
    write();
  });
}

const methods = [
  ["createGzip", "createGunzip", false],
  ["createGzip", "createUnzip", false],
  ["createDeflate", "createInflate", true],
  ["createDeflateRaw", "createInflateRaw", true],
  ["createBrotliCompress", "createBrotliDecompress", true],
] as const;
type C = (typeof methods)[number][0];
type D = (typeof methods)[number][1];

for (const [compressMethod, decompressMethod, allowExtra] of methods) {
  test(`Test ${compressMethod} and ${decompressMethod}`, async () => {
    let compData = Buffer.alloc(0);
    const comp = zlib[compressMethod]();

    comp.on("data", (d: Buffer) => {
      compData = Buffer.concat([compData, d]);
    });

    const compPromise = new Promise<void>(resolve => {
      comp.on("end", () => {
        expect(comp.bytesWritten).toBe(expectStr.length);
        resolve();
      });
    });

    await createWriter(comp, expectBuf);
    await compPromise;

    // Decompression test
    await testDecompression(decompressMethod, compData);

    // Test with extra data if allowed
    if (allowExtra) {
      await testDecompressionWithExtra(decompressMethod, compData);
    }
  });
}

async function testDecompression(decompressMethod: D, compData: Buffer) {
  let decompData = Buffer.alloc(0);
  const decomp = zlib[decompressMethod]();

  decomp.on("data", (d: Buffer) => {
    decompData = Buffer.concat([decompData, d]);
  });

  const decompPromise = new Promise<void>(resolve => {
    decomp.on("end", () => {
      expect(decomp.bytesWritten).toBe(compData.length);
      expect(decompData.toString()).toBe(expectStr);
      resolve();
    });
  });

  await createWriter(decomp, compData);
  await decompPromise;
}

async function testDecompressionWithExtra(decompressMethod: D, compData: Buffer) {
  const compDataExtra = Buffer.concat([compData, Buffer.from("extra")]);
  let decompData = Buffer.alloc(0);
  const decomp = zlib[decompressMethod]();

  decomp.on("data", (d: Buffer) => {
    decompData = Buffer.concat([decompData, d]);
  });

  const decompPromise = new Promise<void>(resolve => {
    decomp.on("end", () => {
      expect(decomp.bytesWritten).toBe(compData.length);
      // Checking legacy name.
      expect(decomp.bytesWritten).toBe((decomp as any).bytesWritten);
      expect(decompData.toString()).toBe(expectStr);
      resolve();
    });
  });

  await createWriter(decomp, compDataExtra);
  await decompPromise;
}
