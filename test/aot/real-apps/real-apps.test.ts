import { expect } from "bun:test";
import { bunExe } from "harness";
import { tsc } from "../../cli/check/differential";
import { describe, test } from "../supported";
import { projects, Runner } from "./run";

const work = process.env.AOT_REAL_APPS;
const only = new RegExp(process.env.AOT_REAL_APPS_ONLY ?? ".");

describe.skipIf(!work || process.platform !== "linux")("open-source projects at pinned commits", () => {
  const runner = work ? new Runner(work, bunExe(), tsc, true) : undefined!;
  for (const project of projects.filter(project => only.test(project.name))) {
    test(
      project.name,
      async () => {
        expect(await runner.fetch(project)).toBe(true);
        const types = await runner.compareTypes(project);
        expect({ onlyTsc: types?.onlyTsc ?? [], onlyBunCheck: types?.onlyBunCheck ?? [] }).toEqual({
          onlyTsc: [],
          onlyBunCheck: [],
        });
        const build = await runner.build(project);
        expect(build!.aot.signal).toBeNull();
        if (build!.stock.exitCode === 0 && build!.aot.exitCode !== 0)
          expect(build!.aot.firstErrors.filter(line => !/^error: TS\d+/.test(line))).toEqual([]);
        const tests = await runner.compareTests(project);
        expect(tests.aot.signal).toBeNull();
      },
      60 * 60 * 1000,
    );
  }
});
