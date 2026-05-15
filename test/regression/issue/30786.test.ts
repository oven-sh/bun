// https://github.com/oven-sh/bun/issues/30786

import { Glob } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

const root = join(import.meta.dir, "..", "..", "..");

// Source-level guard (same mechanism as test/internal/ban-words.test.ts):
// a `static` of type `Mutex` must be initialized with the const fn
// `Mutex::new()`, never by zeroing memory — zero-init relies on every
// backend's layout keeping all-zero as the unlocked state.
// `zeroed_unchecked()` stays legitimate for C/FFI out-param structs.
test("no static Mutex is initialized via zeroed_unchecked (use Mutex::new())", async () => {
  const staticMutexDecl = /static\s+(?:mut\s+)?\w+\s*:\s*(?:bun_threading::)?Mutex\s*=/;
  const offenders: string[] = [];

  const files = await Array.fromAsync(new Glob("src/**/*.rs").scan({ cwd: root }));
  await Promise.all(
    files.map(async rel => {
      const raw = await Bun.file(join(root, rel)).text();
      // Cheap pre-filter: only a handful of files use zeroed_unchecked.
      if (!raw.includes("zeroed_unchecked") || !staticMutexDecl.test(raw)) return;

      // Strip `//` line comments so a `;` inside a comment doesn't truncate
      // the initializer window below. Line count is preserved.
      const text = raw
        .split("\n")
        .map(line => {
          const i = line.indexOf("//");
          return i === -1 ? line : line.slice(0, i);
        })
        .join("\n");

      const decl = new RegExp(staticMutexDecl.source, "g");
      let match: RegExpExecArray | null;
      while ((match = decl.exec(text)) !== null) {
        // A static item's initializer expression ends at the next `;`.
        const end = text.indexOf(";", match.index);
        const initializer = text.slice(match.index, end === -1 ? undefined : end);
        if (initializer.includes("zeroed_unchecked")) {
          const line = text.slice(0, match.index).split("\n").length;
          offenders.push(`${rel}:${line}`);
        }
      }
    }),
  );
  offenders.sort();

  expect(offenders).toEqual([]);
});

// BUN_FEATURE_FLAG_FORCE_IO_POOL forces the io_thread_pool path (and its
// static MUTEX) on every platform; a broken static-init would deadlock the
// first `Bun.build()`.
test("Bun.build runs with BUN_FEATURE_FLAG_FORCE_IO_POOL (io_thread_pool static MUTEX init)", async () => {
  using dir = tempDir("bun-build-force-io-pool", {
    "a.js": "import {b} from './b.js'; import {c} from './c.js'; console.log(b + c);",
    "b.js": "export const b = 1;",
    "c.js": "import {d} from './d.js'; export const c = 2 + d;",
    "d.js": "export const d = 3;",
    "run.ts": `
      const dir = process.argv[2];
      for (let i = 0; i < 2; i++) {
        const res = await Bun.build({ entrypoints: [dir + "/a.js"] });
        if (!res.success) throw new AggregateError(res.logs, "build " + i + " failed");
        if (res.outputs.length !== 1) throw new Error("expected 1 output, got " + res.outputs.length);
      }
      console.log("ok");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), join(String(dir), "run.ts"), String(dir)],
    env: { ...bunEnv, BUN_FEATURE_FLAG_FORCE_IO_POOL: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({ stdout: "ok", stderr: "", exitCode: 0 });
});
