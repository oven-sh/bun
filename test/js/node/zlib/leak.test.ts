import { describe, test, expect } from "bun:test";
import { promisify } from "node:util";
import zlib from "node:zlib";

describe("zlib compression does not leak memory", () => {
  const inputString =
    "ΩΩLorem ipsum dolor sit amet, consectetur adipiscing eli" +
    "t. Morbi faucibus, purus at gravida dictum, libero arcu " +
    "convallis lacus, in commodo libero metus eu nisi. Nullam" +
    " commodo, neque nec porta placerat, nisi est fermentum a" +
    "ugue, vitae gravida tellus sapien sit amet tellus. Aenea" +
    "n non diam orci. Proin quis elit turpis. Suspendisse non" +
    " diam ipsum. Suspendisse nec ullamcorper odio. Vestibulu" +
    "m arcu mi, sodales non suscipit id, ultrices ut massa. S" +
    "ed ac sem sit amet arcu malesuada fermentum. Nunc sed. ".repeat(50);

  for (const compress of ["deflate", "gzip"] as const) {
    test(
      compress,
      async () => {
        for (let index = 0; index < 1_000; index++) {
          await promisify(zlib[compress])(inputString);
        }
        const baseline = process.memoryUsage.rss();
        console.log(baseline);
        for (let index = 0; index < 1_000; index++) {
          await promisify(zlib[compress])(inputString);
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
          zlib[compress](inputString);
        }
        const baseline = process.memoryUsage.rss();
        console.log(baseline);
        for (let index = 0; index < 1_000; index++) {
          zlib[compress](inputString);
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
