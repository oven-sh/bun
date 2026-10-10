import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// Every frame between the event loop reporting a ready `FilePoll` and the
// poll's owner running must hold the poll as `*mut FilePoll`, never as a
// reference:
//
//   Bun__internal_dispatch_ready_poll            (src/io/posix_event_loop.rs)
//     -> FilePoll::on_kqueue_event / on_epoll_event -> FilePoll::on_update
//       -> __bun_run_file_poll                   (src/runtime/dispatch.rs)
//         -> Resolver::on_dns_poll               (src/runtime/dns_jsc/dns.rs)
//
// The owner that runs at the bottom of that stack reaches the same slot through
// the pointer it keeps itself (`FilePollRef`, `PollerPosix::Fd`, the resolver's
// poll map, and for the DNS frame c-ares' socket-state callback from inside
// `Channel::process`): a one-shot re-arm reads and clears the `NeedsRearm` that
// `on_update` just set, and a reader at EOF / an exited process / a closed
// c-ares socket deinits the slot. Those are accesses through a pointer foreign
// to any `&mut self` / `&mut FilePoll` argument still live up the stack, and a
// reference argument is protected for the whole call under both aliasing models
// (the same protector rule self-receiver-reclaim.test.ts describes for frees;
// rustc also emits `noalias` for such arguments). The chain therefore carries
// the raw pointer all the way down, reads the slot only through
// statement-scoped `(*p).field` accesses, and never touches it after the owner
// returns. `FilePollRef::inner` and `PollerPosix::fd_poll_mut` document their
// `&mut FilePoll` as the only live reference to the slot; that is only true
// while this holds.
//
// For each frame in CHAIN (located by name, wherever it lives) this pins:
//   - signature: the poll arrives as `*mut FilePoll` (a `self` receiver on the
//     FilePoll methods counts as taking it by reference unless spelled
//     `self: *mut Self`), and no parameter takes it as `&FilePoll` / `&mut
//     FilePoll`;
//   - hand-off: the frame itself calls the next frame(s) of the chain
//     (`handsTo`), with its pointer as the first argument. This is what keeps
//     the chain closed: a helper interposed between two frames, whether it
//     takes `&mut FilePoll` or is a `&mut self` method called as
//     `(*this).helper()`, means the frame no longer calls the next one
//     directly and is reported; so is a `&mut *this` argument, which would
//     coerce to `*mut` and compile. The entry point decodes the tagged pointer
//     it gets from uSockets, so its pointer is the body's
//     `let <name>: *mut FilePoll = ..` binding;
//   - body: no `let` binding is a `&[mut] FilePoll`, or has a `&mut *..` /
//     `unsafe { ...as_mut()... }` reborrow as its whole initializer, i.e. no
//     frame holds a reference into the slot beyond a single statement.
//     Statement-scoped accesses (`(*p).flags`, `(*p).update_flags(..)`) are
//     the intended shape and are not matched.
//
// A new frame on the chain goes into CHAIN (and into the `handsTo` of the frame
// above it); a new `__bun_run_file_poll` arm that passes the poll to a handler
// goes into its `handsTo`. `FilePoll::deinit*` themselves (the owner's side of
// the same contract) are converted in #37803. Siblings:
// self-receiver-reclaim.test.ts, fn-long-mut-reborrow.test.ts,
// writer-parent-mut-borrow.test.ts.

interface Frame {
  /** Function name; unique across the Rust tree. */
  name: string;
  /**
   * How the poll reaches the frame. `receiver`: a method on FilePoll itself.
   * `param`: a free function or a method on something else, with the poll as
   * an ordinary parameter. `tagged`: the entry point, which receives the
   * tagged `void*` from uSockets and decodes it in its body.
   */
  poll: "receiver" | "param" | "tagged";
  /** The next frame(s) of the chain; each must be called with this frame's pointer as the first argument. */
  handsTo: string[];
}

const CHAIN: Frame[] = [
  // Both calls are present in the source (one per `#[cfg]`), so both are checked
  // whatever the host platform is.
  { name: "Bun__internal_dispatch_ready_poll", poll: "tagged", handsTo: ["on_kqueue_event", "on_epoll_event"] },
  { name: "on_kqueue_event", poll: "receiver", handsTo: ["on_update"] },
  { name: "on_epoll_event", poll: "receiver", handsTo: ["on_update"] },
  { name: "on_update", poll: "receiver", handsTo: ["__bun_run_file_poll"] },
  // Matches the definition in dispatch.rs and the `extern "Rust"` declaration
  // in posix_event_loop.rs (declaration: signature only). `on_dns_poll` is the
  // one arm that passes the poll on to a handler which re-arms or deinits it.
  { name: "__bun_run_file_poll", poll: "param", handsTo: ["on_dns_poll"] },
  { name: "on_dns_poll", poll: "param", handsTo: [] },
];

// Documented, ratcheted exceptions: files allowed to report exactly N
// violations. Empty by design; prefer converting over adding an entry here.
const ALLOW: Record<string, number> = {};

const POLL_TYPE = String.raw`(?:[\w]+::)*(?:FilePoll|Self)\b`;
const RAW_POLL_PARAM = new RegExp(String.raw`^\s*(\w+)\s*:\s*\*\s*mut\s+${POLL_TYPE}`);
const REF_POLL_PARAM = new RegExp(String.raw`:\s*&\s*(?:'\w+\s+)?(?:mut\s+)?${POLL_TYPE}`);
const RECEIVER = /^\s*(?:&\s*(?:'\w+\s+)?(?:mut\s+)?self\b|(?:mut\s+)?self\b)/;
const RAW_RECEIVER = /^\s*self\s*:\s*\*\s*(?:mut|const)\b/;
// The entry point's decoded pointer: `let file_poll: *mut FilePoll = ..`.
const RAW_POLL_BINDING = new RegExp(String.raw`\blet\s+(\w+)\s*:\s*\*\s*mut\s+${POLL_TYPE}\s*=`);

// `let x: &mut FilePoll = ..` / `let x: &FilePoll = ..`, any path prefix.
const REF_POLL_BINDING = new RegExp(
  String.raw`\blet\s+(?:mut\s+)?\w+\s*:\s*&\s*(?:'\w+\s+)?(?:mut\s+)?${POLL_TYPE}`,
  "g",
);
// A reborrow as the whole initializer: `let x = unsafe { &mut *p };`,
// `let x = &mut *p;`, `let x = unsafe { p.as_mut().unwrap_unchecked() };`.
// `unsafe { &*loop_ }.current_ready_event()` and other statement-scoped
// reborrows continue past the `}` and do not match.
const REBORROW_BINDING =
  /\blet\s+(?:mut\s+)?\w+\s*(?::[^=;{}]*)?=\s*(?:unsafe\s*\{\s*&mut\s+\*[^;{}]*\}|&mut\s+\*[^;{}]*|unsafe\s*\{[^;{}]*\.as_mut\(\)[^;{}]*\})\s*;/g;

function splitParams(params: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < params.length; i++) {
    const c = params[i];
    if (c === "(" || c === "[" || c === "<" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === ">" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      out.push(params.slice(start, i));
      start = i + 1;
    }
  }
  const last = params.slice(start);
  if (last.trim() !== "") out.push(last);
  return out;
}

/** Index just past the delimiter matching the opener at `open`. */
function matchDelimiter(text: string, open: number, openCh: string, closeCh: string): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === openCh) depth++;
    else if (text[i] === closeCh && --depth === 0) return i + 1;
  }
  return text.length;
}

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

function squash(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

interface Analysis {
  /** `file:line: name` for every frame definition or declaration seen. */
  found: string[];
  /** `file:line: name: reason` for every violation. */
  offenders: string[];
}

/** Analyze one comment-stripped Rust file. */
function analyze(source: string, stripped: string): Analysis {
  const found: string[] = [];
  const offenders: string[] = [];
  for (const frame of CHAIN) {
    const header = new RegExp(String.raw`\bfn\s+${frame.name}\s*(?:<[^>]*>)?\s*\(`, "g");
    for (const m of stripped.matchAll(header)) {
      const line = lineOf(stripped, m.index);
      const where = `${source}:${line}: ${frame.name}`;
      found.push(where);
      const complain = (reason: string) => offenders.push(`${where}: ${reason}`);

      const paramsOpen = m.index + m[0].length - 1;
      const paramsEnd = matchDelimiter(stripped, paramsOpen, "(", ")");
      const params = splitParams(stripped.slice(paramsOpen + 1, paramsEnd - 1));

      // The name this frame holds the pointer under; `undefined` until the
      // signature (or, for the entry point, the body) provides one.
      let pointer: string | undefined;
      if (frame.poll !== "tagged") {
        const receiver = params.length > 0 && RECEIVER.test(params[0]) ? params[0].trim() : null;
        if (receiver !== null && RAW_RECEIVER.test(receiver)) {
          pointer = "self";
        } else if (receiver !== null && frame.poll === "receiver") {
          complain(`takes the poll as \`${receiver}\`; it must arrive as \`this: *mut FilePoll\``);
        }
        for (const p of params) {
          if (REF_POLL_PARAM.test(p)) complain(`parameter \`${squash(p)}\` takes the poll by reference`);
          pointer ??= RAW_POLL_PARAM.exec(p)?.[1];
        }
        if (pointer === undefined) complain("has no `*mut FilePoll` parameter");
      }

      // Declarations (`extern` blocks) end in `;` and have no body.
      const afterParams = stripped.slice(paramsEnd);
      const bodyRel = afterParams.search(/[;{]/);
      if (bodyRel === -1 || afterParams[bodyRel] === ";") continue;
      const bodyOpen = paramsEnd + bodyRel;
      const body = stripped.slice(bodyOpen, matchDelimiter(stripped, bodyOpen, "{", "}"));
      const bodyLine = (offset: number) => lineOf(stripped, bodyOpen + offset);

      if (frame.poll === "tagged") {
        pointer = RAW_POLL_BINDING.exec(body)?.[1];
        if (pointer === undefined) complain("does not bind the decoded poll as `let <name>: *mut FilePoll = ..`");
      }

      for (const b of body.matchAll(REF_POLL_BINDING)) {
        complain(`line ${bodyLine(b.index)} binds the poll as a reference: ${squash(b[0])}`);
      }
      for (const b of body.matchAll(REBORROW_BINDING)) {
        complain(`line ${bodyLine(b.index)} keeps a reborrow for the rest of the frame: ${squash(b[0])}`);
      }

      for (const callee of frame.handsTo) {
        const calls = [...body.matchAll(new RegExp(String.raw`\b${callee}\s*\(`, "g"))];
        if (calls.length === 0) {
          complain(`never calls \`${callee}\` itself; whatever now sits between them belongs in CHAIN`);
          continue;
        }
        // Without a pointer to compare against (already reported above) the
        // argument check would only repeat that complaint per call.
        if (pointer === undefined) continue;
        for (const call of calls) {
          const argsOpen = call.index + call[0].length - 1;
          const args = splitParams(body.slice(argsOpen + 1, matchDelimiter(body, argsOpen, "(", ")") - 1));
          const first = squash(args[0] ?? "");
          if (first !== pointer) {
            complain(`line ${bodyLine(call.index)} passes \`${callee}\` \`${first}\` first, not \`${pointer}\``);
          }
        }
      }
    }
  }
  return { found, offenders };
}

function strip(content: string): string {
  // Full-line comments (including `///` docs) out, newlines kept, so prose
  // mentions of the banned spellings do not count and line numbers stay right.
  return content.replace(/^[ \t]*\/\/.*$/gm, "");
}

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

const found: string[] = [];
const offenders: string[] = [];
const counts: Record<string, number> = {};
let scanned = 0;
for (const abs of rustSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  // `src/cli` is a symlink into `src/runtime/cli`; count each file once under
  // its canonical path.
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  const content = await file(abs).text();
  // Cheap pre-filter; `analyze` re-locates the frames precisely.
  if (!CHAIN.some(frame => content.includes(frame.name))) continue;
  const analysis = analyze(source, strip(content));
  found.push(...analysis.found);
  if (analysis.offenders.length > 0) counts[source] = analysis.offenders.length;
  offenders.push(...analysis.offenders.slice(ALLOW[source] ?? 0));
}

test("scans a non-empty set of tracked Rust sources and finds every frame of the chain", () => {
  // Guards against the filters above over-firing, or a frame being renamed out
  // from under CHAIN, either of which would make the ban below pass vacuously.
  expect(scanned).toBeGreaterThan(0);
  const names = found.map(entry => entry.slice(entry.lastIndexOf(": ") + 2));
  for (const frame of CHAIN) {
    expect(names).toContain(frame.name);
  }
});

// The chain as it was before the conversion.
const BEFORE = strip(`
impl FilePoll {
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    pub(crate) fn on_kqueue_event(&mut self, kqueue_event: &KQueueEvent) {
        self.update_flags(Flags::from_kqueue_event(kqueue_event));
        #[cfg(target_os = "macos")]
        if kqueue_event.filter == bun_sys::darwin::EVFILT::MEMORYSTATUS {
            self.on_update(kqueue_event.fflags as i64);
            return;
        }
        self.on_update(kqueue_event.data as i64);
    }

    pub(crate) fn on_epoll_event(&mut self, epoll_event: &bun_sys::linux::epoll_event) {
        self.update_flags(Flags::from_epoll_event(epoll_event));
        self.on_update(0);
    }

    pub(crate) fn on_update(&mut self, size_or_offset: i64) {
        unsafe { __bun_run_file_poll(self, size_or_offset) };
    }
}

unsafe extern "C" fn Bun__internal_dispatch_ready_poll(
    loop_: *mut Loop,
    tagged_pointer: *mut c_void,
) {
    let tag = Pollable::from(tagged_pointer);
    // SAFETY: tag matched FilePoll.
    let file_poll: &mut FilePoll = unsafe { &mut *tag.as_file_poll() };
    if file_poll.flags.contains(Flags::IgnoreUpdates) {
        return;
    }
    let ev = unsafe { &*loop_ }.current_ready_event();
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    file_poll.on_kqueue_event(&ev);
    #[cfg(any(target_os = "linux", target_os = "android"))]
    file_poll.on_epoll_event(&ev);
}

pub(crate) unsafe fn __bun_run_file_poll(poll: *mut FilePoll, size_or_offset: i64) {
    let poll_ref = unsafe { &mut *poll };
    let owner = poll_ref.owner;
    match owner.tag() {
        poll_tag::DNS_RESOLVER => {
            let resolver = unsafe { &*owner.ptr.cast_const().cast::<DNSResolver>() };
            resolver.on_dns_poll(unsafe { &mut *poll });
        }
        _ => {}
    }
}

impl Resolver {
    pub(crate) fn on_dns_poll(&self, poll: &mut FilePoll) {
        poll.deinit();
    }
}
`);

// The chain as converted. Exercises a raw `self` receiver, a path-qualified
// pointee type in the declaration, a return type before the body, the
// statement-scoped spellings that must not match, and the non-chain arms of
// `__bun_run_file_poll` (a macro binding, a shared reborrow of the owner, a
// statement-scoped `&mut *poll` argument to a handler outside the chain).
const AFTER = strip(`
unsafe extern "Rust" {
    fn __bun_run_file_poll(poll: *mut crate::FilePoll, size_or_offset: i64);
}

impl FilePoll {
    pub(crate) unsafe fn on_kqueue_event(this: *mut FilePoll, kqueue_event: &KQueueEvent) {
        // SAFETY: caller contract.
        unsafe { (*this).update_flags(Flags::from_kqueue_event(kqueue_event)) };
        syslog!("onKQueueEvent: {}", unsafe { &*this });
        #[cfg(target_os = "macos")]
        if kqueue_event.filter == bun_sys::darwin::EVFILT::MEMORYSTATUS {
            unsafe { Self::on_update(this, kqueue_event.fflags as i64) };
            return;
        }
        unsafe { Self::on_update(this, kqueue_event.data as i64) };
    }

    pub(crate) unsafe fn on_epoll_event(
        this: *mut FilePoll,
        epoll_event: &bun_sys::linux::epoll_event,
    ) {
        unsafe { (*this).update_flags(Flags::from_epoll_event(epoll_event)) };
        unsafe { Self::on_update(this, 0) };
    }

    pub(crate) unsafe fn on_update(self: *mut Self, size_or_offset: i64) {
        unsafe {
            if (*self).flags.contains(Flags::OneShot) {
                (*self).flags.insert(Flags::NeedsRearm);
            }
        }
        unsafe { __bun_run_file_poll(self, size_or_offset) };
    }
}

unsafe extern "C" fn Bun__internal_dispatch_ready_poll(
    loop_: *mut Loop,
    tagged_pointer: *mut c_void,
) -> () {
    let tag = Pollable::from(tagged_pointer);
    let file_poll: *mut FilePoll = tag.as_file_poll();
    if unsafe { (*file_poll).flags.contains(Flags::IgnoreUpdates) } {
        return;
    }
    let ev = unsafe { &*loop_ }.current_ready_event();
    unsafe {
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        FilePoll::on_kqueue_event(file_poll, &ev);
        #[cfg(any(target_os = "linux", target_os = "android"))]
        FilePoll::on_epoll_event(file_poll, &ev);
    }
}

pub(crate) unsafe fn __bun_run_file_poll(poll: *mut FilePoll, size_or_offset: i64) {
    let (owner, hup) = unsafe { ((*poll).owner, (*poll).flags.contains(PollFlag::Hup)) };
    macro_rules! poll_arm {
        ($Ty:ty, |$h:ident| $body:expr) => {{
            let $h: *mut $Ty = owner.ptr.cast::<$Ty>();
            $body;
        }};
    }
    match owner.tag() {
        poll_tag::MEMORY_PRESSURE => {
            crate::node::memory_pressure::on_poll(unsafe { &mut *poll }, size_or_offset);
        }
        poll_tag::SHELL_BUFFERED_WRITER => poll_arm!(ShellBufferedWriterPoll, |h| {
            unsafe { crate::shell::io_writer::on_poll(&mut *h, size_or_offset as isize, hup) }
        }),
        poll_tag::DNS_RESOLVER => {
            let resolver = unsafe { &*owner.ptr.cast_const().cast::<DNSResolver>() };
            unsafe { resolver.on_dns_poll(poll) };
        }
        _ => {}
    }
}

impl Resolver {
    pub(crate) unsafe fn on_dns_poll(&self, poll: *mut FilePoll) {
        let fd = unsafe { (*poll).fd.native() };
        let Some(channel) = self.channel.get() else {
            unsafe { (*poll).deinit() };
            return;
        };
        let (readable, writable) = unsafe { ((*poll).is_readable(), (*poll).is_writable()) };
        unsafe { (*channel).process(fd, readable, writable) };
    }
}
`);

/** `AFTER` with `from` (which must occur exactly once) replaced by `to`. */
function mutate(from: string, to: string): string {
  const at = AFTER.indexOf(from);
  expect(at).toBeGreaterThanOrEqual(0);
  expect(AFTER.indexOf(from, at + 1)).toBe(-1);
  return AFTER.slice(0, at) + to + AFTER.slice(at + from.length);
}

test("the analysis reports the pre-conversion chain", () => {
  expect(analyze("before.rs", BEFORE)).toEqual({
    found: [
      "before.rs:24: Bun__internal_dispatch_ready_poll",
      "before.rs:4: on_kqueue_event",
      "before.rs:14: on_epoll_event",
      "before.rs:19: on_update",
      "before.rs:41: __bun_run_file_poll",
      "before.rs:54: on_dns_poll",
    ],
    offenders: [
      "before.rs:24: Bun__internal_dispatch_ready_poll: does not bind the decoded poll as `let <name>: *mut FilePoll = ..`",
      "before.rs:24: Bun__internal_dispatch_ready_poll: line 30 binds the poll as a reference: let file_poll: &mut FilePoll",
      "before.rs:24: Bun__internal_dispatch_ready_poll: line 30 keeps a reborrow for the rest of the frame: let file_poll: &mut FilePoll = unsafe { &mut *tag.as_file_poll() };",
      "before.rs:4: on_kqueue_event: takes the poll as `&mut self`; it must arrive as `this: *mut FilePoll`",
      "before.rs:4: on_kqueue_event: has no `*mut FilePoll` parameter",
      "before.rs:14: on_epoll_event: takes the poll as `&mut self`; it must arrive as `this: *mut FilePoll`",
      "before.rs:14: on_epoll_event: has no `*mut FilePoll` parameter",
      "before.rs:19: on_update: takes the poll as `&mut self`; it must arrive as `this: *mut FilePoll`",
      "before.rs:19: on_update: has no `*mut FilePoll` parameter",
      "before.rs:41: __bun_run_file_poll: line 42 keeps a reborrow for the rest of the frame: let poll_ref = unsafe { &mut *poll };",
      "before.rs:41: __bun_run_file_poll: line 47 passes `on_dns_poll` `unsafe { &mut *poll }` first, not `poll`",
      "before.rs:54: on_dns_poll: parameter `poll: &mut FilePoll` takes the poll by reference",
      "before.rs:54: on_dns_poll: has no `*mut FilePoll` parameter",
    ],
  });
});

test("the analysis accepts the converted chain", () => {
  expect(analyze("after.rs", AFTER)).toEqual({
    found: [
      "after.rs:37: Bun__internal_dispatch_ready_poll",
      "after.rs:7: on_kqueue_event",
      "after.rs:19: on_epoll_event",
      "after.rs:27: on_update",
      "after.rs:3: __bun_run_file_poll",
      "after.rs:55: __bun_run_file_poll",
      "after.rs:79: on_dns_poll",
    ],
    offenders: [],
  });
});

test("the analysis reports a reference frame re-introduced anywhere on the chain", () => {
  // A helper taking `&mut FilePoll` interposed between on_update and the owner.
  const helperParam = mutate(
    "unsafe { __bun_run_file_poll(self, size_or_offset) };",
    "Self::run_owner(unsafe { &mut *self }, size_or_offset);\n    }\n" +
      "    fn run_owner(poll: &mut FilePoll, size_or_offset: i64) {\n" +
      "        unsafe { __bun_run_file_poll(poll, size_or_offset) };",
  );
  expect(analyze("m.rs", helperParam).offenders).toEqual([
    "m.rs:27: on_update: never calls `__bun_run_file_poll` itself; whatever now sits between them belongs in CHAIN",
  ]);

  // The same helper as a `&mut self` method invoked through the pointer.
  const helperMethod = mutate(
    "unsafe { __bun_run_file_poll(self, size_or_offset) };",
    "unsafe { (*self).run_owner(size_or_offset) };\n    }\n" +
      "    fn run_owner(&mut self, size_or_offset: i64) {\n" +
      "        unsafe { __bun_run_file_poll(self, size_or_offset) };",
  );
  expect(analyze("m.rs", helperMethod).offenders).toEqual([
    "m.rs:27: on_update: never calls `__bun_run_file_poll` itself; whatever now sits between them belongs in CHAIN",
  ]);

  // A reborrow handed to the next frame on an edge other than the DNS one.
  const reborrowArgument = mutate("Self::on_update(this, 0)", "Self::on_update(&mut *this, 0)");
  expect(analyze("m.rs", reborrowArgument).offenders).toEqual([
    "m.rs:19: on_epoll_event: line 24 passes `on_update` `&mut *this` first, not `this`",
  ]);

  // A fn-long reborrow spelled through `as_mut()` rather than `&mut *`.
  const asMutBinding = mutate(
    "unsafe { __bun_run_file_poll(self, size_or_offset) };",
    "let slot = unsafe { self.as_mut().unwrap_unchecked() };\n" +
      "        slot.flags.remove(Flags::Hup);\n" +
      "        unsafe { __bun_run_file_poll(self, size_or_offset) };",
  );
  expect(analyze("m.rs", asMutBinding).offenders).toEqual([
    "m.rs:27: on_update: line 33 keeps a reborrow for the rest of the frame: let slot = unsafe { self.as_mut().unwrap_unchecked() };",
  ]);

  // The entry point has to name the pointer's type for its hand-offs to be checkable.
  const untypedEntry = mutate(
    "let file_poll: *mut FilePoll = tag.as_file_poll();",
    "let file_poll = tag.as_file_poll();",
  );
  expect(analyze("m.rs", untypedEntry).offenders).toEqual([
    "m.rs:37: Bun__internal_dispatch_ready_poll: does not bind the decoded poll as `let <name>: *mut FilePoll = ..`",
  ]);

  // The chain is spelled `*mut FilePoll`; a `NonNull` would be dereferenced
  // with `as_mut()`, which the body check only sees in the form above.
  const nonNullParam = mutate("on_dns_poll(&self, poll: *mut FilePoll)", "on_dns_poll(&self, poll: NonNull<FilePoll>)");
  expect(analyze("m.rs", nonNullParam).offenders).toEqual(["m.rs:79: on_dns_poll: has no `*mut FilePoll` parameter"]);
});

test("every frame of the FilePoll dispatch chain carries the poll as a raw pointer", () => {
  expect(offenders).toEqual([]);
});

test("allowlisted files still report exactly their documented count", () => {
  // Ratchet: once an allowlisted frame is converted, delete its entry so a new
  // violation cannot take its place.
  for (const [source, n] of Object.entries(ALLOW)) {
    expect(counts[source] ?? 0).toBe(n);
  }
});
