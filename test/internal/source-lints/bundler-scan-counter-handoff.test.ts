import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// `BundleV2::increment_scan_counter()` counts one unit of work in
// `graph.pending_items`. The unit is paid back when the bundle thread handles
// the result of the task (or the plugin answer) that the caller hands off right
// after the count. `wait_for_parse()` ticks the event loop until the count is
// zero, and the dev server finishes its bundle at zero.
//
// So nothing may leave between the count and the hand-off. A `?` (or a `return`,
// `break` or `continue`) there leaves a unit that no task pays back: the count
// never reaches zero again, and a driver that waits on its error exit
// (`scan_module_graph_from_cli` for `bun test --changed`) never returns. The
// only errors that reach such a `?` are allocation failures, so no test can
// produce one on demand. This lint holds the order instead:
//
//   fallible work (`?`)  ->  increment_scan_counter()  ->  hand-off
//
// as `enqueue_parse_task` and `enqueue_parse_task2` do.

const root = path.resolve(import.meta.dir, "..", "..", "..");

const SCOPE = "src/bundler/";
const rustSources = globAllSources().rust.filter(abs => {
  if (!abs.endsWith(".rs")) return false;
  return path.relative(root, abs).replaceAll(path.sep, "/").startsWith(SCOPE);
});

// Only scan files tracked in HEAD (a `git stash` round-trip can leave stray
// `.rs` files in the working tree; CI runs on a clean checkout).
const tracked: Set<string> | null = (() => {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", root, "ls-tree", "-r", "--name-only", "-z", "HEAD"],
    stdout: "pipe",
    stderr: "ignore",
  });
  if (!r.success) return null;
  return new Set(r.stdout.toString().split("\0").filter(Boolean));
})();

// The call form. The definition (`fn increment_scan_counter(&mut self)`) has no
// leading `.` and does not match.
const COUNT = /\.increment_scan_counter\(\)/g;

// The hand-off makes another thread owe the unit back: a task on a pool
// (`schedule`, `schedule_*`) or a plugin dispatch (`dispatch`, `dispatch_*`).
const HAND_OFF = /\.schedule\w*\(|\.dispatch\w*\(/;
// This one hands the task to an `onLoad` plugin only when one matches. When
// none does, the `schedule` call after it is the hand-off, so the scan goes on
// to that call.
const ON_LOAD_CHECK = /\.enqueue_on_load_plugin_if_needed\(/;
// What can leave before the hand-off.
const EXIT = /\?|\b(?:return|break|continue)\b/;

// Same length, same newlines, but no char literals, string literals or
// comments, so that a `?` or a brace in one of them does not count and line
// numbers stay true.
function blank(source: string): string {
  const spaces = (m: string) => m.replace(/[^\n]/g, " ");
  return source
    .replace(/b?'(?:[^'\\\n]|\\.)'/g, spaces)
    .replace(/\br(#*)"[\s\S]*?"\1/g, spaces)
    .replace(/"(?:[^"\\\n]|\\.)*"/g, spaces)
    .replace(/\/\*[\s\S]*?\*\//g, spaces)
    .replace(/\/\/.*$/gm, spaces);
}

// The rest of the block that holds the count: up to the `}` that closes it.
function restOfBlock(text: string): string {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth < 0) return text.slice(0, i);
  }
  return text;
}

function check(source: string, raw: string): { callSites: number; offenders: string[] } {
  const content = blank(raw);
  const lineOf = (index: number) => content.slice(0, index).split("\n").length;
  const offenders: string[] = [];
  let callSites = 0;

  for (const m of content.matchAll(COUNT)) {
    callSites++;
    const at = `${source}:${lineOf(m.index)}`;
    const after = m.index + m[0].length;
    const block = restOfBlock(content.slice(after));

    let handOff = HAND_OFF.exec(block);
    const onLoadCheck = ON_LOAD_CHECK.exec(block);
    if (onLoadCheck !== null && (handOff === null || onLoadCheck.index < handOff.index)) {
      const from = onLoadCheck.index + onLoadCheck[0].length;
      const schedule = HAND_OFF.exec(block.slice(from));
      handOff = schedule === null ? null : Object.assign(schedule, { index: from + schedule.index });
    }
    // A count with no hand-off in its block moves a unit that is already owed
    // (a deferred load that was answered). Nothing may leave that block either.
    const exit = EXIT.exec(block.slice(0, handOff?.index ?? block.length));
    if (exit === null) continue;
    const leaves = `${at}: \`${exit[0]}\` at line ${lineOf(after + exit.index)} can leave after increment_scan_counter()`;
    const why = "a count that no task pays back never lets wait_for_parse() return.";
    offenders.push(
      handOff !== null
        ? `${leaves} and before the hand-off at line ${lineOf(after + handOff.index)}. Move the count below it: ${why}`
        : `${leaves}, and this lint finds no hand-off (\`.schedule*(\`, \`.dispatch*(\`) before it. If a call in between pays the unit back, add it to HAND_OFF in ${path.basename(import.meta.path)}. If not, move the count below the exit: ${why}`,
    );
  }
  return { callSites, offenders };
}

const offenders: string[] = [];
let callSites = 0;
for (const abs of rustSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  const result = check(source, await file(abs).text());
  callSites += result.callSites;
  offenders.push(...result.offenders);
}

test("finds the increment_scan_counter() call sites", () => {
  // Guards against a rename or an over-firing filter that would leave nothing
  // to check and make the rule below pass vacuously.
  expect(callSites).toBeGreaterThan(0);
});

test("no early exit between increment_scan_counter() and the hand-off", () => {
  expect(offenders).toEqual([]);
});

test("the scan recognizes the shapes it claims to", () => {
  const fixture = (body: string) =>
    check("fixture.rs", `fn f(&mut self) -> Result<(), Error> {\n${body}\n}\n`).offenders;

  // The safe order, for each kind of hand-off.
  expect(fixture(`self.append()?;\nself.increment_scan_counter();\nself.graph.pool().schedule(task);\nOk(())`)).toEqual(
    [],
  );
  expect(fixture(`self.increment_scan_counter();\nresolve.dispatch();\nreturn true;`)).toEqual([]);
  expect(fixture(`self.increment_scan_counter();\nself.dispatch_resolve(id);\nreturn true;`)).toEqual([]);
  expect(
    fixture(
      `self.increment_scan_counter();\nif !self.enqueue_on_load_plugin_if_needed(task) {\n    self.graph.pool().schedule(task);\n}\nOk(())`,
    ),
  ).toEqual([]);
  // A unit that is already owed moves back into the count: no hand-off, no exit.
  expect(
    fixture(`if load.deferred {\n    self.graph.deferred_pending -= 1;\n    self.increment_scan_counter();\n}\nOk(())`),
  ).toEqual([]);
  // A `?` in a string, a comment or a char literal is not an exit.
  expect(
    fixture(`self.increment_scan_counter();\nlog("why?"); // why?\nlet q = b'?';\nself.graph.pool().schedule(task);`),
  ).toEqual([]);

  // Each early exit, and an exit between the onLoad check and the schedule call.
  expect(fixture(`self.increment_scan_counter();\nself.append()?;\nself.graph.pool().schedule(task);`)).toEqual([
    expect.stringContaining("fixture.rs:2: `?` at line 3 can leave"),
  ]);
  expect(
    fixture(`self.increment_scan_counter();\nif full { return Ok(()); }\nself.graph.pool().schedule(task);`),
  ).toEqual([expect.stringContaining("fixture.rs:2: `return` at line 3 can leave")]);
  expect(
    fixture(
      `self.increment_scan_counter();\nif !self.enqueue_on_load_plugin_if_needed(task) {\n    files.try_reserve(1)?;\n    self.graph.pool().schedule(task);\n}`,
    ),
  ).toEqual([expect.stringContaining("fixture.rs:2: `?` at line 4 can leave")]);

  // An exit after a call this lint does not know as a hand-off.
  expect(fixture(`self.increment_scan_counter();\nself.post(task);\nreturn true;`)).toEqual([
    expect.stringContaining(
      "fixture.rs:2: `return` at line 4 can leave after increment_scan_counter(), and this lint finds no hand-off",
    ),
  ]);
});
