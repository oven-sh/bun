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
// `on_update` just set, a reader at EOF / an exited process / a closed c-ares
// socket deinits the slot, and `Store::put` marks it `IgnoreUpdates`. Those are
// accesses through a pointer foreign to any `&mut self` / `&mut FilePoll`
// argument still live up the stack, and a reference argument is protected for
// the whole call under both aliasing models (the same protector rule
// self-receiver-reclaim.test.ts describes for frees; rustc also emits
// `noalias` for such arguments). The chain therefore carries the raw pointer
// all the way down, reads the slot only through statement-scoped `(*p).field`
// accesses, and never touches it after the owner returns. `FilePollRef::inner`
// and `PollerPosix::fd_poll_mut` document their `&mut FilePoll` as the only live
// reference to the slot; that is only true while this holds.
//
// This lint pins, for each frame in CHAIN below (located by name, wherever it
// lives):
//   - signature: the poll arrives as `*mut FilePoll` (a `self` receiver on the
//     FilePoll methods counts as taking it by reference unless spelled
//     `self: *mut Self`), and no parameter takes it as `&FilePoll` / `&mut
//     FilePoll`;
//   - body: no `let` binding holds it as a reference for the rest of the frame
//     (a typed `&[mut] FilePoll` binding, or a `&mut *..` reborrow as the whole
//     initializer; fn-long-mut-reborrow.test.ts bans the latter tree-wide for
//     the usual parameter names). Statement-scoped reborrows (`(*p).flags`,
//     `(*p).update_flags(..)`) are the intended shape and are not matched;
//   - hand-off: the arms that pass the poll on to code which re-arms or
//     deinits it (`rawHandoffs`) pass the pointer parameter itself, since a
//     `&mut *poll` argument coerces to `*mut` and would compile.
//
// A new frame on the chain (or a new arm that hands the poll to re-entrant
// code) goes into CHAIN. `FilePoll::deinit*` themselves (the owner's side of
// the same contract) are converted in #37803, together with the two frames in
// ALLOW below. Siblings: self-receiver-reclaim.test.ts,
// fn-long-mut-reborrow.test.ts, writer-parent-mut-borrow.test.ts.

interface Frame {
  /** Function name; unique across the Rust tree. */
  name: string;
  /**
   * How the poll reaches the frame. `receiver`: a method on FilePoll itself.
   * `param`: a free function or a method on something else, with the poll as
   * an ordinary parameter. `tagged`: the entry point, which receives the
   * tagged `void*` from uSockets and decodes it; only its body is checked.
   */
  poll: "receiver" | "param" | "tagged";
  /** Callees inside the body that must be passed the poll pointer parameter as-is. */
  rawHandoffs?: string[];
}

const CHAIN: Frame[] = [
  { name: "Bun__internal_dispatch_ready_poll", poll: "tagged" },
  { name: "on_kqueue_event", poll: "receiver" },
  { name: "on_epoll_event", poll: "receiver" },
  { name: "on_update", poll: "receiver" },
  // Matches the definition in dispatch.rs and the `extern "Rust"` declaration
  // in posix_event_loop.rs (declaration: signature only).
  { name: "__bun_run_file_poll", poll: "param", rawHandoffs: ["on_dns_poll"] },
  { name: "on_dns_poll", poll: "param" },
];

// Documented, ratcheted exceptions: files allowed to report exactly N
// violations. Prefer converting over adding an entry here.
const ALLOW: Record<string, number> = {
  // `__bun_run_file_poll` keeps a `&mut` into the slot for its `owner`/`hup`
  // reads and hands `on_dns_poll` a `&mut *poll`; `on_dns_poll` takes it as
  // `&mut FilePoll`. Both are converted in #37803 along with `FilePoll::deinit*`;
  // delete these entries when it lands (the ratchet test below says so).
  "src/runtime/dispatch.rs": 2,
  "src/runtime/dns_jsc/dns.rs": 2,
};

const POLL_TYPE = String.raw`(?:[\w]+::)*(?:FilePoll|Self)\b`;
const RAW_POLL_PARAM = new RegExp(
  String.raw`^\s*(\w+)\s*:\s*(?:\*\s*mut\s+${POLL_TYPE}|(?:[\w]+::)*NonNull\s*<\s*${POLL_TYPE}\s*>)`,
);
const REF_POLL_PARAM = new RegExp(String.raw`:\s*&\s*(?:'\w+\s+)?(?:mut\s+)?${POLL_TYPE}`);
const RECEIVER = /^\s*(?:&\s*(?:'\w+\s+)?(?:mut\s+)?self\b|(?:mut\s+)?self\b)/;
const RAW_RECEIVER = /^\s*self\s*:\s*\*\s*(?:mut|const)\b/;

// `let x: &mut FilePoll = ..` / `let x: &FilePoll = ..`, any path prefix.
const REF_POLL_BINDING = new RegExp(
  String.raw`\blet\s+(?:mut\s+)?\w+\s*:\s*&\s*(?:'\w+\s+)?(?:mut\s+)?${POLL_TYPE}`,
  "g",
);
// `let x = unsafe { &mut *p };` / `let x = &mut *p;`, i.e. the reborrow is the
// whole initializer. `unsafe { &*loop_ }.current_ready_event()` and other
// call-scoped reborrows continue past the `}` and do not match.
const MUT_REBORROW_BINDING =
  /\blet\s+(?:mut\s+)?\w+\s*(?::[^=;{}]*)?=\s*(?:unsafe\s*\{\s*&mut\s+\*[^;{}]*\}|&mut\s+\*[^;{}]*)\s*;/g;

function splitParams(params: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < params.length; i++) {
    const c = params[i];
    if (c === "(" || c === "[" || c === "<") depth++;
    else if (c === ")" || c === "]" || c === ">") depth--;
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

      if (frame.poll !== "tagged") {
        const receiver = params.length > 0 && RECEIVER.test(params[0]) ? params[0].trim() : null;
        if (frame.poll === "receiver" && receiver !== null && !RAW_RECEIVER.test(receiver)) {
          complain(`takes the poll as \`${receiver}\`; it must arrive as \`this: *mut FilePoll\``);
        }
        for (const p of params) {
          if (REF_POLL_PARAM.test(p)) complain(`parameter \`${p.trim()}\` takes the poll by reference`);
        }
        const hasRaw = params.some(p => RAW_POLL_PARAM.test(p)) || (receiver !== null && RAW_RECEIVER.test(receiver));
        if (!hasRaw) complain("has no `*mut FilePoll` parameter");
      }

      // Declarations (`extern` blocks) end in `;` and have no body.
      const afterParams = stripped.slice(paramsEnd);
      const bodyRel = afterParams.search(/[;{]/);
      if (bodyRel === -1 || afterParams[bodyRel] === ";") continue;
      const bodyOpen = paramsEnd + bodyRel;
      const body = stripped.slice(bodyOpen, matchDelimiter(stripped, bodyOpen, "{", "}"));
      const bodyLine = (offset: number) => lineOf(stripped, bodyOpen + offset);

      for (const b of body.matchAll(REF_POLL_BINDING)) {
        complain(`line ${bodyLine(b.index)} binds the poll as a reference: ${b[0].replace(/\s+/g, " ")}`);
      }
      for (const b of body.matchAll(MUT_REBORROW_BINDING)) {
        complain(`line ${bodyLine(b.index)} holds a \`&mut\` reborrow: ${b[0].replace(/\s+/g, " ")}`);
      }

      for (const callee of frame.rawHandoffs ?? []) {
        const pollParam = params.map(p => RAW_POLL_PARAM.exec(p)?.[1]).find(name => name !== undefined);
        const calls = [...body.matchAll(new RegExp(String.raw`\b${callee}\s*\(`, "g"))];
        if (calls.length === 0) {
          complain(`never hands the poll to \`${callee}\`; update CHAIN if that arm moved`);
          continue;
        }
        for (const call of calls) {
          const argsOpen = call.index + call[0].length - 1;
          const args = body.slice(argsOpen + 1, matchDelimiter(body, argsOpen, "(", ")") - 1).trim();
          if (pollParam === undefined || args !== pollParam) {
            complain(`line ${bodyLine(call.index)} hands \`${callee}\` \`${args}\` instead of the pointer parameter`);
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

test("the analysis recognizes the spellings it claims to", () => {
  const before = strip(`
    impl FilePoll {
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        pub(crate) fn on_kqueue_event(&mut self, kqueue_event: &KQueueEvent) {
            self.update_flags(Flags::from_kqueue_event(kqueue_event));
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
  expect(analyze("before.rs", before)).toEqual({
    found: [
      "before.rs:19: Bun__internal_dispatch_ready_poll",
      "before.rs:4: on_kqueue_event",
      "before.rs:9: on_epoll_event",
      "before.rs:14: on_update",
      "before.rs:33: __bun_run_file_poll",
      "before.rs:46: on_dns_poll",
    ],
    offenders: [
      "before.rs:19: Bun__internal_dispatch_ready_poll: line 25 binds the poll as a reference: let file_poll: &mut FilePoll",
      "before.rs:19: Bun__internal_dispatch_ready_poll: line 25 holds a `&mut` reborrow: let file_poll: &mut FilePoll = unsafe { &mut *tag.as_file_poll() };",
      "before.rs:4: on_kqueue_event: takes the poll as `&mut self`; it must arrive as `this: *mut FilePoll`",
      "before.rs:4: on_kqueue_event: has no `*mut FilePoll` parameter",
      "before.rs:9: on_epoll_event: takes the poll as `&mut self`; it must arrive as `this: *mut FilePoll`",
      "before.rs:9: on_epoll_event: has no `*mut FilePoll` parameter",
      "before.rs:14: on_update: takes the poll as `&mut self`; it must arrive as `this: *mut FilePoll`",
      "before.rs:14: on_update: has no `*mut FilePoll` parameter",
      "before.rs:33: __bun_run_file_poll: line 34 holds a `&mut` reborrow: let poll_ref = unsafe { &mut *poll };",
      "before.rs:33: __bun_run_file_poll: line 39 hands `on_dns_poll` `unsafe { &mut *poll }` instead of the pointer parameter",
      "before.rs:46: on_dns_poll: parameter `poll: &mut FilePoll` takes the poll by reference",
      "before.rs:46: on_dns_poll: has no `*mut FilePoll` parameter",
    ],
  });

  const after = strip(`
    unsafe extern "Rust" {
        fn __bun_run_file_poll(poll: *mut crate::FilePoll, size_or_offset: i64);
    }

    impl FilePoll {
        pub(crate) unsafe fn on_kqueue_event(this: *mut FilePoll, kqueue_event: &KQueueEvent) {
            // SAFETY: caller contract.
            unsafe { (*this).update_flags(Flags::from_kqueue_event(kqueue_event)) };
            syslog!("onKQueueEvent: {}", unsafe { &*this });
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
        unsafe { FilePoll::on_epoll_event(file_poll, &ev) };
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
            let (readable, writable) = unsafe { ((*poll).is_readable(), (*poll).is_writable()) };
            unsafe { (*channel).process(fd, readable, writable) };
        }
    }
  `);
  const afterAnalysis = analyze("after.rs", after);
  expect(afterAnalysis.offenders).toEqual([]);
  expect(afterAnalysis.found).toEqual([
    "after.rs:32: Bun__internal_dispatch_ready_poll",
    "after.rs:7: on_kqueue_event",
    "after.rs:14: on_epoll_event",
    "after.rs:22: on_update",
    "after.rs:3: __bun_run_file_poll",
    "after.rs:45: __bun_run_file_poll",
    "after.rs:69: on_dns_poll",
  ]);

  // `NonNull<FilePoll>` is a raw spelling too; an `on_dns_poll` that hands the
  // pointer on under another name, or one whose caller wraps it, is not.
  const variants = strip(`
    pub(crate) unsafe fn on_dns_poll(&self, poll: ptr::NonNull<FilePoll>) {}

    pub(crate) unsafe fn __bun_run_file_poll(poll: *mut FilePoll, size_or_offset: i64) {
        let p = poll;
        resolver.on_dns_poll(p);
        resolver.on_dns_poll(poll.cast());
    }
  `);
  expect(analyze("v.rs", variants).offenders).toEqual([
    "v.rs:4: __bun_run_file_poll: line 6 hands `on_dns_poll` `p` instead of the pointer parameter",
    "v.rs:4: __bun_run_file_poll: line 7 hands `on_dns_poll` `poll.cast()` instead of the pointer parameter",
  ]);
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
