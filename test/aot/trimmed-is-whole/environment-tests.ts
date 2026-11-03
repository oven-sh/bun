// A trimmed executable does in every environment what the whole one does: arguments, files beside it, signals, locales, terminals, closed streams, proxies, certificates, variables of Node, Bun and JavaScriptCore.
// A case that names no program is run with the one that tells most about its environment. ./sweep.ts runs every case with every program, every option and every variable.
// The options in BUN_OPTIONS: test/bundler/compile-trim-bun-options.test.ts.
import { afterAll, describe, expect, test } from "bun:test";
import { bunExe, isWindows, tempDir, tls } from "harness";
import { canTrim } from "../../bundler/compile-trim-features";
import { unsupported } from "../harness/compiler";
import { Bench, type Program } from "./environment";
import { cases, knownToDiffer, refused } from "./environment-cases";

/** The runs of these programs. A program is built in one file alone. */
export function testEnvironments(isMine: (program: Program) => boolean) {
  const dir = tempDir("trimmed-is-whole-environment", { "home/keep": "", "tmp/keep": "" });
  const folder = String(dir);
  const bench = new Bench(
    bunExe(),
    folder,
    {
      PATH: "/usr/bin:/bin",
      HOME: folder + "/home",
      TMPDIR: folder + "/tmp",
      BUN_ENABLE_CRASH_REPORTING: "0",
      DO_NOT_TRACK: "1",
      BUN_DEBUG_QUIET_LOGS: "1",
    },
    tls,
  );
  afterAll(() => {
    bench.stop();
    dir[Symbol.dispose]();
  });

  (!canTrim || unsupported || isWindows ? describe.skip : describe.concurrent)(
    "a trimmed executable does in every environment what the whole one does",
    () => {
      for (const it of cases.filter(it => !refused.test(it.name))) {
        const [, why] = knownToDiffer.find(([name]) => name.test(it.name)) ?? [];
        for (const program of (it.programs ?? ([it.signal ? "serve" : "tells"] as Program[])).filter(isMine)) {
          test(`${program}: ${it.name}${why ? ` (differs: ${why})` : ""}`, async () => {
            const { whole, trimmed } = await bench.both(program, it);
            if (why) expect(trimmed).not.toEqual(whole);
            else expect(trimmed).toEqual(whole);
          }, 600_000);
        }
      }
    },
  );
}
