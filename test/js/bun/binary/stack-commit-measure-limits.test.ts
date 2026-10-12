// TEMPORARY: see stack-commit-measure.ts.
import { expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  foldedRegExpScript,
  headerPair,
  jobLimitScript,
  json,
  recursionScript,
  round,
  runCaptured,
  serveScript,
  step,
} from "./stack-commit-measure.ts";

test.skipIf(!isWindows)(
  "MEASURE Windows stack commit: idle server, commit limit, unprobed frames",
  async () => {
    using dir = tempDir("stack-commit-measure", {
      "serve.js": serveScript,
      "joblimit.js": jobLimitScript,
      "recursion.js": recursionScript,
    });
    const cwd = String(dir);
    const { both } = headerPair(cwd);
    const exitOf = (exitCode: number | null) => `exit 0x${((exitCode ?? -1) >>> 0).toString(16)}`;

    // Started now, awaited at the end: they idle for 35 and 25 seconds.
    const server = both(async exe => json(await runCaptured(exe, ["serve.js"], cwd))).catch(e => ({
      error: String(e).slice(0, 300),
    }));
    const headroomsKB = [256, 1024, 2048, 4096, 8192, 16384, 32768];
    const jobLimit = (mode: string) =>
      Promise.all(
        headroomsKB.map(async kb => {
          const r = await both(async exe => {
            const { stdout, exitCode } = await runCaptured(exe, ["joblimit.js", String(kb), mode], cwd);
            return `${exitCode === 0 ? "" : exitOf(exitCode) + " "}${stdout.replaceAll("\n", " ")}`;
          });
          return [kb, r["2m"], r["4k"]];
        }),
      ).catch(e => ({ error: String(e).slice(0, 300) }));
    const jobLimitGc = jobLimit("gc");

    await step("jobLimitThreads[headroomKB,2m,4k]", () => jobLimit("threads"));
    await step("rangeErrorDepth", () =>
      both(async exe => {
        const depths: string[] = [];
        for (let i = 0; i < 3; i++) depths.push((await runCaptured(exe, ["recursion.js"], cwd)).stdout);
        return depths;
      }),
    );
    await step("foldedRegExp[frameKB,2m,4k]", async () => {
      const rows: unknown[] = [];
      for (const [terms, fold] of [
        [375, true],
        [640, true],
        [1000, true],
        [2000, true],
        [3000, true],
        [8000, true],
        [8000, false],
      ] as const) {
        const file = `regexp-${terms}-${fold ? "folded" : "unfolded"}.js`;
        writeFileSync(join(cwd, file), foldedRegExpScript(terms, fold));
        const r = await both(async exe => {
          const { stdout, exitCode } = await runCaptured(exe, [file], cwd);
          return exitCode === 0 && stdout.startsWith("done") ? "ok" : exitOf(exitCode);
        });
        rows.push([`${round((terms * 16) / 1024, 1)}${fold ? "" : " unfolded"}`, r["2m"], r["4k"]]);
      }
      return rows;
    });
    await step("jobLimitGc[headroomKB,2m,4k]", () => jobLimitGc);
    await step("idleServerKB", () => server);
    expect("done").toBe("measurements only: see the MEASURE lines");
  },
  170 * 1000,
);
