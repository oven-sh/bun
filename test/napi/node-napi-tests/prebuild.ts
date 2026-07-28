// Build the native addons for a set of node-napi-tests directories once, up
// front, before their do.test.ts files run.
//
// Usage: bun test/napi/node-napi-tests/prebuild.ts <addon-dir>...
//
// A test file's own harness build() finds build/Debug/<target>.node already
// present and does nothing, so nothing recompiles inside the test run.
// Where the harness has its direct-compile fast path (posix), the addons
// build here as one bounded fan of clang invocations — a make -jN, in
// effect. Where it must use node-gyp (Windows), all requested addons are
// merged into ONE binding.gyp so a single gyp + MSBuild run builds every
// target, instead of one multi-second gyp/MSBuild bootstrap per addon; the
// artifacts are then copied back to each addon's build/Debug/.

import { availableParallelism } from "node:os";
import { existsSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { build, buildGypDir, isBuilt, parseBindingGyp } from "./harness";

const dirs = [...new Set(process.argv.slice(2).map(dir => resolve(dir)))];
if (dirs.length === 0) {
  console.error("prebuild: no addon directories given, nothing to do");
  process.exit(0);
}

const started = performance.now();
const pending = (await Promise.all(dirs.map(async dir => ((await isBuilt(dir)) ? null : dir)))).filter(
  (dir): dir is string => dir !== null,
);
console.log(`prebuild: ${pending.length}/${dirs.length} addon(s) to build`);

let built = 0;
const failed: string[] = [];

if (pending.length) {
  if (process.platform !== "win32") {
    // build() takes the direct-compile path here (one clang per addon); run
    // them as a bounded fan.
    const width = Math.max(2, Math.min(8, availableParallelism()));
    let next = 0;
    const worker = async () => {
      for (;;) {
        const dir = pending[next++];
        if (dir === undefined) return;
        try {
          await build(dir);
          built++;
        } catch (error) {
          // The addon's own do.test.ts repeats build() and reports this
          // against the right test file.
          failed.push(dir);
          console.error(`prebuild: ${dir} failed:`, error);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(width, pending.length) }, worker));
  } else {
    // One node-gyp run for all of them: merge every target into a single
    // binding.gyp (names namespaced by their directory so identically-named
    // targets from different suites don't collide), build once, then copy
    // each artifact back under the name its test expects.
    const combinedDir = join(import.meta.dir, ".prebuild");
    await mkdir(combinedDir, { recursive: true });
    const targets: { target_name: string; sources: string[]; defines?: string[] }[] = [];
    const copies: { from: string; to: string }[] = [];
    for (const dir of pending) {
      const parsed = await parseBindingGyp(dir);
      if (parsed === null) {
        failed.push(dir); // not the trivial shape — its do.test.ts builds it alone
        continue;
      }
      const ns = relative(join(import.meta.dir, "test"), dir)
        .replaceAll("/", "_")
        .replaceAll("\\", "_");
      for (const target of parsed) {
        const name = `${ns}__${target.target_name}`;
        targets.push({
          target_name: name,
          sources: target.sources.map(source => relative(combinedDir, join(dir, source)).replaceAll("\\", "/")),
          ...(target.defines ? { defines: target.defines } : {}),
        });
        copies.push({
          from: join(combinedDir, "build", "Debug", `${name}.node`),
          to: join(dir, "build", "Debug", `${target.target_name}.node`),
        });
      }
    }
    if (targets.length) {
      await writeFile(join(combinedDir, "binding.gyp"), JSON.stringify({ targets }, null, 2));
      try {
        await buildGypDir(combinedDir);
        for (const { from, to } of copies) {
          if (!existsSync(from)) throw new Error(`combined build did not produce ${basename(from)}`);
          await mkdir(dirname(to), { recursive: true });
          await copyFile(from, to);
        }
        built += pending.length - failed.length;
      } catch (error) {
        console.error("prebuild: combined node-gyp build failed; tests will build their own:", error);
        failed.push(...pending.filter(dir => !failed.includes(dir)));
      }
    }
  }
}

const seconds = ((performance.now() - started) / 1000).toFixed(1);
console.log(
  `prebuild: ${built} built, ${dirs.length - pending.length} already built, ${failed.length} left to their tests, in ${seconds}s`,
);
