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
// So nothing may leave between the count and the hand-off, and no path may skip
// the hand-off. A `?` (or a `return`, `break` or `continue`) there, or a
// hand-off in a branch, leaves a unit that no task pays back: the count never
// reaches zero again, and a driver that waits on its error exit
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
const HAND_OFF = /\.schedule\w*\(|\.dispatch\w*\(/g;
// This one hands the task to an `onLoad` plugin only when one matches. When
// none does, the `schedule` call after it is the hand-off, so the scan goes on
// to that call.
const ON_LOAD_CHECK = /\.enqueue_on_load_plugin_if_needed\(/;
// What can leave before the hand-off.
const EXIT = /\?|\b(?:return|break|continue)\b/;

// Same length, same newlines, but no char literals, string literals or
// comments, so that a `?` or a brace in one of them does not count and line
// numbers stay true. One pass: the token that starts first wins, so a `/*` in a
// `//` comment or a `"` in a block comment opens nothing.
const LITERAL_OR_COMMENT = /b?'(?:[^'\\\n]|\\.)'|\br(#*)"[\s\S]*?"\1|"(?:[^"\\\n]|\\.)*"|\/\*[\s\S]*?\*\/|\/\/.*$/gm;
function blank(source: string): string {
  return source.replace(LITERAL_OR_COMMENT, m => m.replace(/[^\n]/g, " "));
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

// The position of the first match at or after `from`, or -1.
function firstIndex(re: RegExp, text: string, from = 0): number {
  const i = text.slice(from).search(re);
  return i === -1 ? -1 : from + i;
}

// How many blocks that open after the count hold `index`. A path that skips
// such a block skips a hand-off inside it. An `unsafe` block always runs, so it
// does not count.
function blocksOpenAt(block: string, index: number): number {
  const open: boolean[] = [];
  for (let i = 0; i < index; i++) {
    if (block[i] === "{") open.push(!/(?:^|\W)unsafe\s*$/.test(block.slice(Math.max(0, i - 16), i)));
    else if (block[i] === "}") open.pop();
  }
  return open.filter(Boolean).length;
}

// The `)` that closes the call whose `(` is the first one at or after `index`.
function closeOfCall(block: string, index: number): number {
  let close = block.indexOf("(", index);
  for (let depth = 0; close < block.length; close++) {
    if (block[close] === "(") depth++;
    else if (block[close] === ")" && --depth === 0) break;
  }
  return close;
}

// The end of the statement that holds the call at `index`: its `;`, or the end
// of the block for a tail expression. A `?` in the call's arguments or on its
// result leaves before the hand-off is done.
function endOfCallStatement(block: string, index: number): number {
  const semicolon = block.indexOf(";", closeOfCall(block, index));
  return semicolon === -1 ? block.length : semicolon;
}

// The body of the block that `if !….enqueue_on_load_plugin_if_needed(…) {` opens,
// as offsets into `block`, when the onLoad check at `index` has that form.
function onLoadCheckBody(block: string, index: number): { start: number; end: number } | null {
  if (!/\bif\s*!\s*[\w.]*$/.test(block.slice(Math.max(0, index - 80), index))) return null;
  const close = closeOfCall(block, index);
  const open = block.slice(close + 1).match(/^\s*\{/);
  if (open === null) return null;
  const start = close + 1 + open[0].length;
  return { start, end: start + restOfBlock(block.slice(start)).length };
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

    const why = "a count that no task pays back never lets wait_for_parse() return.";
    // The hand-off has to run on every path, so it sits at the level of the
    // count. The one block it may sit in is the body of
    // `if !….enqueue_on_load_plugin_if_needed(…) {`, when that check is itself at
    // the level of the count: on the other path the plugin has the task.
    const onLoadCheck = firstIndex(ON_LOAD_CHECK, block);
    const onLoadBody =
      onLoadCheck !== -1 && blocksOpenAt(block, onLoadCheck) === 0 ? onLoadCheckBody(block, onLoadCheck) : null;
    const onEveryPath = (i: number) =>
      blocksOpenAt(block, i) === 0 ||
      (onLoadBody !== null &&
        i >= onLoadBody.start &&
        i < onLoadBody.end &&
        blocksOpenAt(block.slice(onLoadBody.start), i - onLoadBody.start) === 0);

    // A `schedule` or `dispatch` call in some other branch is not the hand-off
    // when one on every path follows it. When every one of them is in a branch,
    // a path can skip the hand-off.
    const calls = [...block.matchAll(HAND_OFF)].map(call => call.index);
    const handOff = calls.find(onEveryPath) ?? -1;
    if (handOff === -1 && calls.length > 0) {
      offenders.push(
        `${at}: the hand-off at line ${lineOf(after + calls[0])} is inside a block that opens after increment_scan_counter(), so a path can skip it. Hand off on every path: at the level of the count, or directly inside \`if !….enqueue_on_load_plugin_if_needed(…) {\`. ${why[0].toUpperCase()}${why.slice(1)}`,
      );
      continue;
    }

    // A count with no hand-off in its block moves a unit that is already owed
    // (a deferred load that was answered). Nothing may leave that block either.
    const exit = block.slice(0, handOff === -1 ? block.length : endOfCallStatement(block, handOff)).match(EXIT);
    if (exit === null) continue;
    const leaves = `${at}: \`${exit[0]}\` at line ${lineOf(after + exit.index!)} can leave after increment_scan_counter()`;
    offenders.push(
      handOff !== -1
        ? `${leaves} and before the hand-off at line ${lineOf(after + handOff)} is done. Move the count below it: ${why}`
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

test("every path from increment_scan_counter() reaches the hand-off", () => {
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
  expect(
    fixture(
      `self.increment_scan_counter();\nif !self.enqueue_on_load_plugin_if_needed(unsafe { &mut *task }) {\n    self.graph.pool().schedule(task);\n}\nOk(())`,
    ),
  ).toEqual([]);
  // A call in a branch is not the hand-off when one on every path follows it.
  expect(
    fixture(
      `self.increment_scan_counter();\nif tracing {\n    self.metrics.dispatch(sample);\n}\nself.graph.pool().schedule(task);`,
    ),
  ).toEqual([]);
  // An `unsafe` block always runs, so a hand-off in it is on every path.
  expect(fixture(`self.increment_scan_counter();\nunsafe { (*pool).schedule(task) };\nOk(())`)).toEqual([]);
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

  // An exit inside the hand-off statement: in the call's arguments, or on its result.
  expect(fixture(`self.increment_scan_counter();\nself.graph.pool().schedule(self.try_make(task)?);`)).toEqual([
    expect.stringContaining("fixture.rs:2: `?` at line 3 can leave"),
  ]);
  expect(fixture(`self.increment_scan_counter();\nself.graph.pool().schedule(task)?;\nOk(())`)).toEqual([
    expect.stringContaining("fixture.rs:2: `?` at line 3 can leave"),
  ]);
  // A `/*` inside a `//` comment opens no block comment, so the count below it is still seen.
  expect(
    fixture(
      `// see linker_context/* for the rest\nself.increment_scan_counter();\nself.append()?;\nself.graph.pool().schedule(task);\n/* done */`,
    ),
  ).toEqual([expect.stringContaining("fixture.rs:3: `?` at line 4 can leave")]);

  // A hand-off that a path can skip: in a branch, in a match arm, or behind an
  // onLoad check that is itself in a branch.
  expect(
    fixture(`self.increment_scan_counter();\nif ready {\n    self.graph.pool().schedule(task);\n}\nOk(())`),
  ).toEqual([expect.stringContaining("fixture.rs:2: the hand-off at line 4 is inside a block")]);
  expect(
    fixture(
      `self.increment_scan_counter();\nmatch kind {\n    Kind::File => self.graph.pool().schedule(task),\n    _ => {}\n}`,
    ),
  ).toEqual([expect.stringContaining("fixture.rs:2: the hand-off at line 4 is inside a block")]);
  expect(
    fixture(
      `self.increment_scan_counter();\nif ready {\n    if !self.enqueue_on_load_plugin_if_needed(task) {\n        self.graph.pool().schedule(task);\n    }\n}`,
    ),
  ).toEqual([expect.stringContaining("fixture.rs:2: the hand-off at line 5 is inside a block")]);

  // Only the block of the onLoad check itself may hold the hand-off.
  expect(
    fixture(
      `self.increment_scan_counter();\nself.enqueue_on_load_plugin_if_needed(task);\nif ready {\n    self.graph.pool().schedule(task);\n}`,
    ),
  ).toEqual([expect.stringContaining("fixture.rs:2: the hand-off at line 5 is inside a block")]);

  // An exit after a call this lint does not know as a hand-off.
  expect(fixture(`self.increment_scan_counter();\nself.post(task);\nreturn true;`)).toEqual([
    expect.stringContaining(
      "fixture.rs:2: `return` at line 4 can leave after increment_scan_counter(), and this lint finds no hand-off",
    ),
  ]);
});
