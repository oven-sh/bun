import { test } from "bun:test";
import { bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { existsSync, realpathSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { machine, start } from "./brotli-timing";

const installed =
  process.env.BROTLI_TIMING_OTHER ??
  (process.env.PATH ?? process.env.Path ?? "")
    .split(delimiter)
    .map(folder => join(folder, isWindows ? "bun.exe" : "bun"))
    .find(exe => existsSync(exe) && dirname(realpathSync(exe)) !== dirname(realpathSync(bunExe())));

test.skipIf(isASAN || isDebug || !installed)(
  "time of the installed release over time of this build",
  async () => {
    const rows = (row: (i: number) => string) => Array.from({ length: 16000 }, (_, i) => row(i)).join("");
    let state = 1;
    const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) >>> 16;
    using dir = tempDir("brotli-timing", {
      zeros: Buffer.alloc(1 << 20),
      sparse: Buffer.alloc(1 << 20).map(() => (random() % 200 ? 0 : random())),
      line: Buffer.alloc(
        1 << 20,
        Buffer.alloc(100).map(() => 97 + (random() % 20)),
      ),
      table: rows(
        i =>
          `<tr class="row"><td class="id">${i}</td><td class="name">Item name</td><td class="price">19.99</td><td class="status">available</td></tr>\n`,
      ),
      list: rows(i => `<li class="item" data-id="${i}"><a href="/items/${i}">Item ${i}</a></li>\n`),
    });
    using old = start(installed!);
    using now = start(bunExe());
    const qualities = [0, 1, 2, 3, 4, 5, 6, 7, 9];
    const lines = [
      `TIMING ${machine} long`,
      "TIMING" + "".padEnd(21) + qualities.map(q => ("q" + q).padStart(6)).join(""),
    ];
    const deadline = performance.now() + 130_000;
    const common = { skip: 0, masks: [null], rounds: 1 };
    for (const proc of [old, now]) {
      await proc.time({ ...common, file: join(String(dir), "table"), size: 256, count: 64, quality: 1, budget: 500 });
    }
    for (const window of [22, 16]) {
      for (const name of ["zeros", "sparse", "line", "table", "list"]) {
        for (const size of [256, 4096, 16384, 65536, 1 << 19]) {
          let line = `TIMING w${window} ${name.padEnd(7)}${String(size).padEnd(9)}`;
          for (const quality of qualities) {
            if (performance.now() > deadline) break;
            const count = Math.min(200, Math.ceil((1 << 18) / size));
            const cell = { ...common, file: join(String(dir), name), size, count, quality, window, budget: 15 };
            let [a, b] = [Infinity, Infinity];
            for (let round = 0; round < 4; round++) {
              a = Math.min(a, ...(await old.time(cell)));
              b = Math.min(b, ...(await now.time(cell)));
            }
            line += (a / b).toFixed(2).padStart(6);
          }
          lines.push(line);
        }
      }
    }
    console.log(lines.join("\n"));
  },
  170_000,
);
