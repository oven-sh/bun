// The door out of a VM's thread (src/jsc/VmHandle.rs).
//
// A `VirtualMachine` is destroyed only after everything that left its thread
// has come back: work that runs on, or is referenced from, another thread on a
// VM's behalf holds a `bun_jsc::Ticket`, and the VM's teardown waits for every
// ticket. That is only a guarantee if there is no way *around* the door, so
// this lint freezes, for the VM crates (`jsc`, `runtime`, `event_loop`,
// `sql_jsc`, `http_jsc`), the two things that could open one:
//
//   1. `unsafe impl Send` / `unsafe impl Sync`, the `owned_task!` macro
//      (which emits one), and `intrusive_work_task!` / `shared_work_task!`
//      (which are what makes a type schedulable on the pool). `VirtualMachine`,
//      `EventLoop` and `JSGlobalObject` are `!Send + !Sync`, so VM state can
//      only reach another thread inside a type someone declared `Send` by hand.
//      Every such type must either carry a `Ticket` for the VM whose state it
//      holds, or hold no VM/JS state at all.
//   2. Direct calls to the raw thread-crossing primitives — the work pool, the
//      HTTP thread, thread spawning, `uv_queue_work`. VM code reaches these
//      through `bun_jsc::Job` or through a struct that holds a `Ticket` for
//      its in-flight duration; a new direct call site is a new path that has
//      to be shown to do the same.
//
// If this fails because you ADDED one: make the payload carry a `Ticket`
// (taken on the JS thread with `vm.ticket()`, dropped after the completion is
// posted) or show it is VM-free, say so in a `// SAFETY:` comment, then
// regenerate the inventory:
//   bun ./test/internal/source-lints/vm-thread-door.test.ts --update
// If it fails because you REMOVED one: regenerate the same way.

import { file } from "bun";
import { describe, expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

const root = path.resolve(import.meta.dir, "..", "..", "..");
const INVENTORY = import.meta.dir + "/vm-thread-door.inventory.json";

const SCOPED = ["src/jsc/", "src/runtime/", "src/event_loop/", "src/sql_jsc/", "src/http_jsc/"];
// The door itself.
const DOOR = new Set(["src/jsc/VmHandle.rs", "src/jsc/job.rs"]);

const PATTERNS: [name: string, re: RegExp][] = [
  ["unsafe impl Send", /\bunsafe\s+impl(?:\s*<[^>]*>)?\s+Send\s+for\s+([A-Za-z_][\w:<>, ']*)/g],
  ["unsafe impl Sync", /\bunsafe\s+impl(?:\s*<[^>]*>)?\s+Sync\s+for\s+([A-Za-z_][\w:<>, ']*)/g],
  ["owned_task!", /\b(?:bun_threading::)?owned_task!\s*\(\s*([A-Za-z_]\w*)/g],
  ["intrusive_work_task!", /\b(?:bun_threading::)?intrusive_work_task!\s*\(\s*([A-Za-z_]\w*)/g],
  ["shared_work_task!", /\b(?:bun_threading::)?shared_work_task!\s*\(\s*([A-Za-z_]\w*)/g],
  ["WorkPool::schedule*", /\bWorkPool::(?:schedule|schedule_new|schedule_owned|schedule_shared|go)\b/g],
  ["worker_pool.schedule(Batch)", /\)\s*\.schedule\(\s*(?:bun_threading::thread_pool::)?Batch::from/g],
  ["HTTPThread::schedule", /\bHTTPThread::schedule\s*\(/g],
  ["thread spawn", /\bthread::(?:Builder::new\s*\(|spawn\s*\()/g],
  ["uv_queue_work", /(?<!fn\s)\buv_queue_work\s*\(/g],
];

const tracked: Set<string> | null = (() => {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", root, "ls-tree", "-r", "--name-only", "-z", "HEAD"],
    stdout: "pipe",
    stderr: "ignore",
  });
  if (!r.success) return null;
  return new Set(r.stdout.toString().split("\0").filter(Boolean));
})();

type Inventory = Record<string, Record<string, string[] | number>>;
const found: Inventory = {};

for (const abs of globAllSources().rust.filter(p => p.endsWith(".rs"))) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (!SCOPED.some(p => source.startsWith(p)) || DOOR.has(source)) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  const stripped = (await file(abs).text()).replace(/^\s*\/\/.*$/gm, "");
  for (const [name, re] of PATTERNS) {
    const matches = [...stripped.matchAll(re)];
    if (matches.length === 0) continue;
    const entry = (found[source] ??= {});
    if (matches[0].length > 1) {
      entry[name] = matches.map(m => m[1].trim().replace(/\s+/g, " ")).sort();
    } else {
      entry[name] = matches.length;
    }
  }
}

const sortKeys = <T>(o: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
const normalized: Inventory = sortKeys(Object.fromEntries(Object.entries(found).map(([k, v]) => [k, sortKeys(v)])));

if (process.argv.includes("--update")) {
  await Bun.write(INVENTORY, JSON.stringify(normalized, null, 2) + "\n");
  console.log(`Wrote ${Object.keys(normalized).length} files to ${path.basename(INVENTORY)}`);
  process.exit(0);
}

const inventory: Inventory = await Bun.file(INVENTORY).json();

describe("VM thread door", () => {
  const files = [...new Set([...Object.keys(inventory), ...Object.keys(normalized)])].sort();
  test.each(files)("%s", source => {
    const expected = inventory[source] ?? {};
    const actual = normalized[source] ?? {};
    if (!Bun.deepEquals(actual, expected)) {
      throw new Error(
        `${source}: thread-crossing inventory changed.\n` +
          `  expected: ${JSON.stringify(expected)}\n` +
          `  actual:   ${JSON.stringify(actual)}\n` +
          `A new \`unsafe impl Send/Sync\` or a new direct call to a thread-crossing primitive in a VM crate ` +
          `must carry a \`bun_jsc::Ticket\` for the VM whose state it holds (or hold none) — see src/jsc/VmHandle.rs. ` +
          `Then regenerate: bun ./test/internal/source-lints/vm-thread-door.test.ts --update`,
      );
    }
  });

  test("VirtualMachine stays !Send + !Sync", async () => {
    const vm = await file(path.join(root, "src/jsc/VirtualMachine.rs")).text();
    expect(vm).not.toMatch(/unsafe\s+impl\s+(?:Send|Sync)\s+for\s+VirtualMachine\b/);
    expect(vm).toContain("<VirtualMachine as AmbiguousIfImpl<_>>::some_item");
  });
});
