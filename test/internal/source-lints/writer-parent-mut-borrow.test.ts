import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// The PipeWriter parent vtables (`impl_streaming_writer_parent!` /
// `impl_buffered_writer_parent!` in src/io/PipeWriter.rs) must not dispatch a
// callback through `&mut Parent`: `borrow = mut` is banned at every invocation,
// and the macros must not grow a dispatch arm for it again.
//
// A parent's callbacks run underneath the writer that reports to it, and the
// writer is a field of the parent. Forming `&mut *this` over the parent at the
// vtable therefore
//
//   - asserts unique access to the writer's own bytes while the writer may
//     still be borrowed further up the stack (the Windows write-complete
//     callbacks and the synchronous `write()` paths report from `&mut self`),
//     and
//   - leaves a protected reference to the parent live for the whole callback,
//     and a callback is exactly where a parent releases refs: when the release
//     is the last one, the allocation the protected reference points into is
//     freed underneath it, which both aliasing models reject (Tree Borrows,
//     the model `bun run rust:miri` uses: "deallocation through <tag> ... is
//     forbidden"; Stacked Borrows: "would remove [Unique for <tag>] which is
//     strongly protected"; both point at the reference argument).
//     `StaticPipeWriter::on_write` was the instance: on POSIX its trailing
//     release of the `start()` ref is normally the writer's last one.
//
// `borrow = shared` is sound only for parents that keep the writer in a
// `JsCell`/`UnsafeCell` (shell `IOWriter`, `WindowsNamedPipe`); `borrow = ptr`
// hands the callback the raw backref, so it can do its `&mut` work through
// call-scoped reborrows and release through the pointer (`FileSink`,
// `StaticPipeWriter`). The module comment above the macros has the details.
//
// Hand-written `*WriterParent` impls are outside this lint; they have the same
// obligations. Siblings: self-receiver-reclaim.test.ts (freeing the receiver's
// own allocation), fn-long-mut-reborrow.test.ts.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const rustSources = globAllSources().rust.filter(p => p.endsWith(".rs"));

// Only scan files tracked in HEAD (a `git stash` round-trip can leave stray
// `.rs` files in the working tree; CI runs on a clean checkout). Same guard as
// dead-code-escapes.test.ts.
const tracked: Set<string> | null = (() => {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", root, "ls-tree", "-r", "--name-only", "-z", "HEAD"],
    stdout: "pipe",
    stderr: "ignore",
  });
  if (!r.success) return null;
  return new Set(r.stdout.toString().split("\0").filter(Boolean));
})();

// Start of a brace-delimited invocation of either macro. The macros' internal
// helper arms are invoked with parentheses (`!(@call ..)`), so they never
// match; their brace-delimited `@emit` recursion does, and is skipped below
// because it carries no `borrow =` setting.
const INVOCATION = /\bimpl_(?:streaming|buffered)_writer_parent!\s*\{/g;
const BORROW_SETTING = /\bborrow\s*=\s*(\w+)\s*,/;
const KNOWN_MODES = new Set(["shared", "ptr"]);

// A dispatch arm in either macro's definition for a `mut` mode
// (`(@call mut $p:expr; ..)`, or the older `(@borrow mut $p:expr)` spelling).
const MUT_DISPATCH_ARM = /@(?:call|borrow)\s+mut\b/g;

interface Invocation {
  /** Offset of the `borrow =` setting (of the opening brace when there is none). */
  offset: number;
  /** The `borrow =` mode, or `null` for a body without one (`@emit` recursion). */
  mode: string | null;
}

/** Every brace-delimited invocation in `text`, with its `borrow =` mode. */
function invocations(text: string): Invocation[] {
  const out: Invocation[] = [];
  for (const m of text.matchAll(INVOCATION)) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let close = open;
    for (; close < text.length; close++) {
      const c = text[close];
      if (c === "{") depth++;
      else if (c === "}" && --depth === 0) break;
    }
    const setting = BORROW_SETTING.exec(text.slice(open + 1, close));
    out.push(setting === null ? { offset: open, mode: null } : { offset: open + 1 + setting.index, mode: setting[1] });
  }
  return out;
}

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

/** `file:line: <reason>` for every violation in one (comment-stripped) file. */
function violations(source: string, stripped: string): string[] {
  const out: string[] = [];
  for (const { offset, mode } of invocations(stripped)) {
    if (mode === null || KNOWN_MODES.has(mode)) continue;
    const reason =
      mode === "mut"
        ? "borrow = mut dispatches through &mut Parent"
        : `unknown borrow mode \`${mode}\`; document its aliasing story here first`;
    out.push(`${source}:${lineOf(stripped, offset)}: ${reason}`);
  }
  for (const m of stripped.matchAll(MUT_DISPATCH_ARM)) {
    out.push(`${source}:${lineOf(stripped, m.index)}: macro offers a \`mut\` dispatch mode`);
  }
  return out;
}

const modesSeen: string[] = [];
const offenders: string[] = [];
let scanned = 0;
for (const abs of rustSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  // `src/cli` is a symlink into `src/runtime/cli`; count each file once under
  // its canonical path.
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  const content = await file(abs).text();
  // Strip full-line comments so prose (including the macros' own module
  // comment) does not count. `[ \t]*`, not `\s*`, so blank lines survive and
  // reported line numbers stay right.
  const stripped = content.replace(/^[ \t]*\/\/.*$/gm, "");
  for (const { mode } of invocations(stripped)) {
    if (mode !== null) modesSeen.push(`${source}: ${mode}`);
  }
  offenders.push(...violations(source, stripped));
}

test("scans a non-empty set of tracked Rust sources, including vtable invocations", () => {
  // Guards against the filters above over-firing, or the macros being renamed
  // out from under `INVOCATION`, which would make the ban pass vacuously.
  expect(scanned).toBeGreaterThan(0);
  expect(modesSeen.length).toBeGreaterThan(0);
});

test("the scanner reads invocations and definitions the way it claims to", () => {
  const staticPipeWriterBefore = [
    "bun_io::impl_buffered_writer_parent! {",
    "    for<P: StaticPipeWriterProcess> StaticPipeWriter<P>;",
    "    poll_tag   = P::POLL_OWNER_TAG,",
    "    borrow     = mut,",
    "    on_write   = on_write,",
    "    get_buffer = |this| &*(*this).buffer.as_ptr(),",
    "    deref      = |this| RefCount::<Self>::deref(this),",
    "}",
  ].join("\n");
  const fileSink = [
    "bun_io::impl_streaming_writer_parent! {",
    "    FileSink;",
    "    poll_tag   = bun_io::posix_event_loop::poll_tag::FILE_SINK,",
    "    borrow     = ptr,",
    "    uws_loop   = |this| (*this).event_loop_handle.r#loop(),",
    "}",
  ].join("\n");
  // An accessor expression containing braces must not end the body early.
  const bracesInAccessor = [
    "bun_io::impl_buffered_writer_parent! {",
    "    IOWriter;",
    "    event_loop = |this| { let s = &*this; s.io_evtloop() },",
    "    borrow     = shared,",
    "}",
  ].join("\n");
  const emitRecursion = ["$crate::impl_streaming_writer_parent! {", "    @emit [] $Ty; $($rest)*", "}"].join("\n");

  expect(invocations(staticPipeWriterBefore).map(i => i.mode)).toEqual(["mut"]);
  expect(invocations(fileSink).map(i => i.mode)).toEqual(["ptr"]);
  expect(invocations(bracesInAccessor).map(i => i.mode)).toEqual(["shared"]);
  expect(invocations(emitRecursion).map(i => i.mode)).toEqual([null]);

  expect(violations("a.rs", staticPipeWriterBefore)).toEqual(["a.rs:4: borrow = mut dispatches through &mut Parent"]);
  expect(violations("a.rs", fileSink + "\n" + bracesInAccessor + "\n" + emitRecursion)).toEqual([]);
  expect(violations("a.rs", fileSink.replace("ptr", "owned"))).toEqual([
    "a.rs:4: unknown borrow mode `owned`; document its aliasing story here first",
  ]);

  const definitionBefore = [
    "    (@call mut    $p:expr; $m:ident($($a:tt)*)) => { (&mut *$p).$m($($a)*) };",
    "    (@call shared $p:expr; $m:ident($($a:tt)*)) => { (&*$p).$m($($a)*) };",
    "    (@borrow mut    $p:expr) => { &mut *$p };",
  ].join("\n");
  expect(violations("m.rs", definitionBefore)).toEqual([
    "m.rs:1: macro offers a `mut` dispatch mode",
    "m.rs:3: macro offers a `mut` dispatch mode",
  ]);
  const definitionAfter = [
    "    (@call shared $p:expr; $m:ident($($a:tt)*)) => { (&*$p).$m($($a)*) };",
    "    (@call ptr    $p:expr; $m:ident($($a:tt)*)) => { <Self>::$m($p, $($a)*) };",
    "    borrow     = $borrow:tt,",
  ].join("\n");
  expect(violations("m.rs", definitionAfter)).toEqual([]);
});

test("no writer-parent vtable dispatches through &mut Parent", () => {
  expect(offenders).toEqual([]);
});
