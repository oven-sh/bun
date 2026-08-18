
import { availableParallelism } from "node:os";
import { existsSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { build, buildWithNodeGyp, isBuilt, parseBindingGyp, warmNodeGyp } from "./harness";

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
    await warmNodeGyp();
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
          failed.push(dir);
          console.error(`prebuild: ${dir} failed:`, error);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(width, pending.length) }, worker));
  } else {
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
        await buildWithNodeGyp(combinedDir);
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
