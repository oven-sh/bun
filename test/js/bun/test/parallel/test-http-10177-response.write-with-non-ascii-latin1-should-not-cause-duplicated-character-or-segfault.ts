import { expect } from "bun:test";
import { createServer } from "node:http";
function disableAggressiveGCScope() {
  const gc = Bun.unsafe.gcAggressionLevel(0);
  return {
    [Symbol.dispose]() {
      Bun.unsafe.gcAggressionLevel(gc);
    },
  };
}
// x = ascii
// á = latin1 supplementary character
// 📙 = emoji
// 👍🏽 = its a grapheme of 👍 🟤
// "\u{1F600}" = utf16
const chars = ["x", "á", "📙", "👍🏽", "\u{1F600}"];

// 128 = small than waterMark, 256 = waterMark, 1024 = large than waterMark
// 8Kb = small than cork buffer
// 16Kb = cork buffer
// 32Kb = large than cork buffer
const start_size = 128;
const increment_step = 1024;
const end_size = 32 * 1024;
let expected = "";

const { promise, reject, resolve } = Promise.withResolvers();

async function finish(err) {
  server.closeAllConnections();
  Bun.gc(true);
  if (err) reject(err);
  resolve(err);
}
const server = createServer((_, response) => {
  response.write(expected);
  response.write("");
  response.end();
}).listen(0, "localhost", async (err, hostname, port) => {
  try {
    expect(err).toBeFalsy();
    expect(port).toBeGreaterThan(0);

    for (const char of chars) {
      for (let size = start_size; size <= end_size; size += increment_step) {
        expected = char + Buffer.alloc(size, "-").toString("utf8") + "x";

        try {
          const url = `http://${hostname}:${port}`;
          const count = 20;
          const all = [];
          const batchSize = 20;
          while (all.length < count) {
            const batch = Array.from({ length: batchSize }, () => fetch(url).then(a => a.text()));

            all.push(...(await Promise.all(batch)));
          }

          using _ = disableAggressiveGCScope();
          for (const result of all) {
            expect(result).toBe(expected);
          }
        } catch (err) {
          return finish(err);
        }
      }

      // still always run GC at the end here.
      Bun.gc(true);
    }
    finish();
  } catch (err) {
    finish(err);
  }
});

promise
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
