import { file } from "bun";
import { describe, expect, test } from "bun:test";
import path from "path";

// A handoff publisher is a function whose lock release is what lets the
// thread blocked on the primitive return, and that thread then frees the
// primitive: `AsyncHTTP::send_sync` heap-allocates a `SingleHTTPChannel`,
// blocks in `read_item`, and frees the channel on the next line, so the HTTP
// thread's publish may find the channel gone the instant its release lands.
//
// Under both aliasing models a reference passed as a function argument
// (`&self` included) is protected until that function returns, and freeing
// memory a protected reference covers is rejected even if the callee never
// touches it again (self-receiver-reclaim.test.ts describes the same rule for
// frees; rustc also marks such arguments `dereferenceable`). A publisher
// written as `fn write_item(&self)` with a guard, or anything that ends in
// `Mutex::unlock(&self)`, therefore still holds references into the channel
// after the release, while the owner frees it. `cargo miri test -p
// bun_threading guarded::` rejects that shape within a few dozen iterations
// of the model in src/threading/guarded.rs.
//
// So each publisher below takes the object as a raw pointer, keeps no
// reference to it in a binding, and releases through the raw-release helper
// named in `releasesVia`, whose releasing store is the last access to the
// object; the frame that calls the publisher makes that call its last
// statement. A new handoff of this shape (a primitive freed by the thread its
// release wakes) adds its publisher, and its caller, to these tables.

const root = path.resolve(import.meta.dir, "..", "..", "..");

interface Publisher {
  file: string;
  /** Function name; must be defined exactly once in `file`. */
  fn: string;
  /** The raw-release call the body has to go through. */
  releasesVia: string;
}

const PUBLISHERS: Publisher[] = [
  // The primitive-level publisher: locks, mutates, then `Mutex::unlock_raw`.
  { file: "src/threading/guarded.rs", fn: "with_lock_raw", releasesVia: "Mutex::unlock_raw" },
  // `send_sync`'s one-shot result slot; `send_sync` frees the channel as soon
  // as `read_item` returns.
  { file: "src/http/AsyncHTTP.rs", fn: "write_item", releasesVia: "Guarded::with_lock_raw" },
];

interface Caller {
  file: string;
  /** Function name; must be defined exactly once in `file`. */
  fn: string;
  /** The publisher it calls; nothing may follow that call in the body. */
  publishes: string;
}

const CALLERS: Caller[] = [{ file: "src/http/AsyncHTTP.rs", fn: "send_sync_callback", publishes: "write_item" }];

// `this: *const T` / `this: *mut T` as the first parameter. A `self` receiver
// of any spelling fails this.
const RAW_THIS_PARAM = /^\s*this\s*:\s*\*\s*(?:const|mut)\b/;
// A binding that keeps a reference to the object for the rest of the frame:
// `let ch = &*this;`, `let ch = unsafe { &mut *this };`. Statement-scoped
// `(*this).field` accesses are the intended shape and do not match.
const REF_BINDING = /\blet\b[^;=]*=\s*(?:unsafe\s*\{\s*)?&\s*(?:mut\s+)?\*\s*this\b/;
// Reference-based releases: `Mutex::unlock(&self)` as a method call or a path
// call (`unlock_raw(` does not match: `(` has to follow `unlock` directly), and
// the guards whose `Drop` calls it.
const REF_RELEASE = /(?:\.|::)unlock\s*\(|\block_guard\s*\(|\bGuardedLock\b/;

interface Fn {
  params: string;
  body: string;
}

function stripComments(content: string): string {
  return content.replace(/^[ \t]*\/\/.*$/gm, "");
}

/** Index just past the delimiter matching the opener at `open`. */
function matchDelimiter(text: string, open: number, openCh: string, closeCh: string): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === openCh) depth++;
    else if (text[i] === closeCh && --depth === 0) return i + 1;
  }
  throw new Error(`unbalanced ${openCh}${closeCh} starting at offset ${open}`);
}

/** The single definition of `fn name` in comment-stripped Rust source. */
function findFn(stripped: string, name: string): Fn | null {
  const headers = [...stripped.matchAll(new RegExp(String.raw`\bfn\s+${name}\s*(?:<[^>]*>)?\s*\(`, "g"))];
  if (headers.length !== 1) return null;
  const paramsOpen = headers[0].index + headers[0][0].length - 1;
  const paramsEnd = matchDelimiter(stripped, paramsOpen, "(", ")");
  const bodyOpen = stripped.indexOf("{", paramsEnd);
  const bodyEnd = matchDelimiter(stripped, bodyOpen, "{", "}");
  return {
    params: stripped.slice(paramsOpen + 1, paramsEnd - 1),
    // Without the outer braces.
    body: stripped.slice(bodyOpen + 1, bodyEnd - 1),
  };
}

function publisherProblems(stripped: string, { fn, releasesVia }: Publisher): string[] {
  const def = findFn(stripped, fn);
  if (def === null) return [`\`fn ${fn}\` is not defined exactly once`];
  const problems: string[] = [];
  if (!RAW_THIS_PARAM.test(def.params)) {
    problems.push(`takes \`${def.params.split(",")[0].trim()}\`; the object must arrive as \`this: *const _\``);
  }
  if (!def.body.includes(`${releasesVia}(`)) problems.push(`does not release through \`${releasesVia}\``);
  const binding = REF_BINDING.exec(def.body);
  if (binding !== null) problems.push(`keeps a reference to the object: \`${binding[0].trim()}\``);
  const release = REF_RELEASE.exec(def.body);
  if (release !== null) problems.push(`releases through a reference: \`${release[0].trim()}\``);
  return problems;
}

function callerProblems(stripped: string, { fn, publishes }: Caller): string[] {
  const def = findFn(stripped, fn);
  if (def === null) return [`\`fn ${fn}\` is not defined exactly once`];
  const call = def.body.lastIndexOf(`${publishes}(`);
  if (call === -1) return [`never calls \`${publishes}\``];
  const callEnd = matchDelimiter(def.body, call + publishes.length, "(", ")");
  // After the publish only the statement's `;` and the closing braces of the
  // blocks it sits in may follow: the object may already be freed by then.
  const tail = def.body.slice(callEnd);
  return /^\s*;?[\s}]*$/.test(tail)
    ? []
    : [`\`${publishes}\` is not its last statement; this follows it: ${tail.trim()}`];
}

describe("publishers take the object by pointer and release through the raw path", () => {
  for (const publisher of PUBLISHERS) {
    test(`${publisher.file}: ${publisher.fn}`, async () => {
      const stripped = stripComments(await file(path.join(root, publisher.file)).text());
      expect(publisherProblems(stripped, publisher)).toEqual([]);
    });
  }
});

describe("the frame that publishes does nothing after the publish", () => {
  for (const caller of CALLERS) {
    test(`${caller.file}: ${caller.fn}`, async () => {
      const stripped = stripComments(await file(path.join(root, caller.file)).text());
      expect(callerProblems(stripped, caller)).toEqual([]);
    });
  }
});

describe("the checks recognize the shapes they claim to", () => {
  const publisher: Publisher = { file: "", fn: "write_item", releasesVia: "Guarded::with_lock_raw" };

  test("the raw shape passes", () => {
    const source = `
      unsafe fn write_item(this: *const Self, item: Item) {
          unsafe {
              bun_threading::Guarded::with_lock_raw(&raw const (*this).slot, |slot| {
                  *slot = Some(item);
                  (*this).cv.notify_one();
              });
          }
      }
    `;
    expect(publisherProblems(source, publisher)).toEqual([]);
  });

  test("the guard shape this replaced is reported", () => {
    const source = `
      fn write_item(&self, item: Item) {
          let mut g = self.slot.lock();
          *g = Some(item);
          self.cv.notify_one();
      }
    `;
    expect(publisherProblems(source, publisher)).toEqual([
      "takes `&self`; the object must arrive as `this: *const _`",
      "does not release through `Guarded::with_lock_raw`",
    ]);
  });

  test("a raw receiver that still releases through a reference is reported", () => {
    const source = `
      unsafe fn write_item(this: *const Self, item: Item) {
          let channel = unsafe { &*this };
          let mut g = channel.slot.lock();
          *g = Some(item);
          channel.cv.notify_one();
          drop(g);
          Guarded::with_lock_raw(&raw const (*this).slot, |_| {});
          channel.mutex.unlock();
      }
    `;
    expect(publisherProblems(source, publisher)).toEqual([
      "keeps a reference to the object: `let channel = unsafe { &*this`",
      "releases through a reference: `.unlock(`",
    ]);
  });

  test.each([
    ["Mutex::unlock(&(*this).mutex);", "::unlock("],
    ["let _guard = (*this).mutex.lock_guard();", "lock_guard("],
    ["let g: GuardedLock<'_, Item, Mutex> = (*this).slot.lock();", "GuardedLock"],
  ])("%s is a release through a reference", (statement, reported) => {
    const source = `
      unsafe fn write_item(this: *const Self, item: Item) {
          ${statement}
          Guarded::with_lock_raw(&raw const (*this).slot, |_| {});
      }
    `;
    expect(publisherProblems(source, publisher)).toEqual([`releases through a reference: \`${reported}\``]);
  });

  test("the raw release itself is not mistaken for one", () => {
    const source = `
      pub unsafe fn write_item(this: *const Self) {
          unsafe { (*this).mutex.lock() };
          unsafe { Mutex::unlock_raw(&raw const (*this).mutex) };
          Guarded::with_lock_raw(&raw const (*this).slot, |_| {});
      }
    `;
    expect(publisherProblems(source, publisher)).toEqual([]);
  });

  test("a missing or duplicated definition is reported", () => {
    expect(publisherProblems("fn read_item(&self) {}", publisher)).toEqual([
      "`fn write_item` is not defined exactly once",
    ]);
    expect(
      publisherProblems("fn write_item(this: *const Self) {}\nfn write_item(this: *const Self) {}", publisher),
    ).toEqual(["`fn write_item` is not defined exactly once"]);
  });

  const caller: Caller = { file: "", fn: "send_sync_callback", publishes: "write_item" };

  test("a publish as the last statement passes, through nested blocks and with a wrapped argument list", () => {
    const source = `
      fn send_sync_callback(this: *mut Channel, mut result: Result<'_>) {
          unsafe {
              result.body_into(&mut (*(*this).response_buffer).list);
              Channel::write_item(
                  this,
                  result.detach_lifetime(),
              );
          }
      }
    `;
    expect(callerProblems(source, caller)).toEqual([]);
  });

  test("anything after the publish is reported", () => {
    const source = `
      fn send_sync_callback(this: *mut Channel, result: Result<'_>) {
          unsafe {
              Channel::write_item(this, result);
              (*this).done.store(true, Ordering::Release);
          }
      }
    `;
    expect(callerProblems(source, caller)).toEqual([
      expect.stringContaining("`write_item` is not its last statement; this follows it: ;"),
    ]);
    expect(callerProblems(source, caller)[0]).toContain("(*this).done.store(true, Ordering::Release);");
  });
});
