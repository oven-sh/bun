import { test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows } from "harness";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { files, machine, mean, start } from "./brotli-timing";

const installed =
  process.env.BROTLI_TIMING_OTHER ??
  (process.env.PATH ?? process.env.Path ?? "")
    .split(delimiter)
    .map(folder => join(folder, isWindows ? "bun.exe" : "bun"))
    .find(exe => existsSync(exe) && dirname(realpathSync(exe)) !== dirname(realpathSync(bunExe())));

test.skipIf(isASAN || isDebug || !installed)(
  "time of the installed release over time of this build",
  async () => {
    const version = Bun.spawnSync({ cmd: [installed!, "-p", "`${Bun.version_with_sha} ${process.arch}`"], env: bunEnv })
      .stdout.toString()
      .trim();
    using old = start(installed!);
    using now = start(bunExe());
    const columns = [
      ...[0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11].map(quality => ({ quality, decodes: false })),
      ...[1, 5, 11].map(quality => ({ quality, decodes: true })),
    ];
    const exe = readFileSync(bunExe());
    const lines = [
      `TIMING ${machine} against ${version}`,
      `TIMING symbols ${["highway_brotli_short_codes", "highway_brotli_try_matches", "BrotliFindSwitches"].map(name => exe.includes(name))} in ${bunExe()}`,
      "TIMING        " + columns.map(c => ((c.decodes ? "d" : "q") + c.quality).padStart(10)).join(""),
    ];
    const low: string[] = [];
    const deadline = performance.now() + 130_000;
    for (const decodes of [false, true]) {
      for (const proc of [old, now]) {
        await proc.time({
          ...files[0],
          size: 256,
          count: 64,
          quality: 1,
          decodes,
          masks: [null],
          rounds: 1,
          budget: 500,
        });
      }
    }
    for (const [size, count] of [
      [16384, 24],
      [131072, 8],
    ]) {
      let line = "TIMING " + String(size).padEnd(7);
      for (const column of columns) {
        if (performance.now() > deadline) break;
        const ratios: number[] = [];
        for (const file of files) {
          const slow = column.quality >= 10 && !column.decodes;
          const cell = {
            ...file,
            size,
            count: Math.ceil(count / (slow ? 10 : column.quality >= 9 ? 3 : 1)),
            ...column,
            masks: [null],
            rounds: 1,
            budget: 12,
          };
          let [a, b] = [Infinity, Infinity];
          for (let round = 0; round < (slow ? 1 : 3); round++) {
            a = Math.min(a, ...(await old.time(cell)));
            b = Math.min(b, ...(await now.time(cell)));
          }
          ratios.push(a / b);
          if (a / b < 1.03)
            low.push(
              `TIMING low ${size} ${JSON.stringify(column)} ${file.file.slice(-16)} ${a.toFixed(3)} ${b.toFixed(3)}`,
            );
        }
        line += `${mean(ratios).toFixed(2)}/${Math.min(...ratios).toFixed(2)}`.padStart(10);
      }
      lines.push(line);
    }
    console.log([...lines, ...low].join("\n"));
  },
  170_000,
);
