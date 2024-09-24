import { describe, test, expect } from "bun:test";
import { promisify } from "node:util";
import zlib from "node:zlib";

const input = Buffer.alloc(50000);
for (let i = 0; i < input.length; i++) input[i] = Math.random();

describe("zlib compression does not leak memory", () => {
  for (const compress of ["deflate", "gzip"] as const) {
    test(
      compress,
      async () => {
        for (let index = 0; index < 1_000; index++) {
          await promisify(zlib[compress])(input);
        }
        const baseline = process.memoryUsage.rss();
        console.log(baseline);
        for (let index = 0; index < 1_000; index++) {
          await promisify(zlib[compress])(input);
        }
        Bun.gc(true);
        const after = process.memoryUsage.rss();
        console.log(after);
        expect(after - baseline).toBeLessThan(1024 * 1024 * 20);
      },
      0,
    );
  }

  for (const compress of ["deflateSync", "gzipSync"] as const) {
    test(
      compress,
      async () => {
        for (let index = 0; index < 1_000; index++) {
          zlib[compress](input);
        }
        const baseline = process.memoryUsage.rss();
        console.log(baseline);
        for (let index = 0; index < 1_000; index++) {
          zlib[compress](input);
        }
        Bun.gc(true);
        const after = process.memoryUsage.rss();
        console.log(after);
        expect(after - baseline).toBeLessThan(1024 * 1024 * 20);
      },
      0,
    );
  }
});
