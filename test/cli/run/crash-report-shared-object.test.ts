import { expect, test } from "bun:test";
import { bunEnv, bunExe, compileFixture, isLinux } from "harness";
import { basename, join } from "node:path";

// A crash report frame is an offset into the ELF object that maps it. For a
// frame inside a shared object (libc, a native addon) the report has to carry
// that object's name, or bun.report symbolizes the offset against bun's own
// debug info and shows a bun function that never ran.
//
// NOTE: kept separate from run-crash-handler.test.ts on purpose — that file is
// skip-listed in test/expectations.txt, so anything added there never runs in CI.
//
// Trace string layout: `{platform}{command}{version char}{7-char sha}`, the
// feature bits as two VLQs, then one frame per VLQ until a VLQ(0). A frame is
// `_` (unknown), a bare VLQ offset (into bun), or VLQ(1) VLQ(len) name VLQ(offset)
// for a frame inside another object. See `StackLine::write_encoded` in
// src/crash_handler/lib.rs and bun.report's lib/parser.ts.

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function decodeVlq(s: string, i: number): [value: number, next: number] {
  let shift = 0;
  let value = 0;
  for (;;) {
    const digit = BASE64.indexOf(s[i++]);
    if (digit < 0) throw new Error(`bad VLQ digit at ${i - 1} in ${JSON.stringify(s)}`);
    value |= (digit & 31) << shift;
    shift += 5;
    if (!(digit & 32)) break;
  }
  return [value & 1 ? -(value >>> 1) : value >>> 1, i];
}

function decodeFrames(payload: string): { address: number; object: string }[] {
  let i = 10;
  [, i] = decodeVlq(payload, i);
  [, i] = decodeVlq(payload, i);
  const frames: { address: number; object: string }[] = [];
  for (;;) {
    if (payload[i] === "_") {
      frames.push({ address: 0, object: "?" });
      i++;
      continue;
    }
    let address: number;
    [address, i] = decodeVlq(payload, i);
    if (address === 0) break;
    let object = "bun";
    if (address === 1) {
      let len: number;
      [len, i] = decodeVlq(payload, i);
      object = payload.slice(i, i + len);
      i += len;
      [address, i] = decodeVlq(payload, i);
    }
    frames.push({ address, object });
  }
  return frames;
}

// macOS reports shared object frames as unknown and Windows already names the
// module. Only the ELF encoder dropped the name.
test.if(isLinux)("crash report names the shared object of a frame outside bun", async () => {
  // The fixture keeps its frame pointer so the walk can read the return
  // address into it out of the callback's frame.
  const libPath = compileFixture(join(import.meta.dir, "crash-report-shared-object.fixture.c"), {
    flags: ["-fno-omit-frame-pointer", "-fno-optimize-sibling-calls"],
  });

  using server = Bun.serve({ port: 0, fetch: () => new Response("OK") });
  const base = new URL(server.url).origin;

  // The panic is raised from a JS callback that the shared object called, so
  // the trace has a frame inside the shared object above the bun frames.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { dlopen, JSCallback } = require("bun:ffi");
       const { crash_handler } = require("bun:internal-for-testing");
       const lib = dlopen(process.env.FIXTURE_LIB, { call_through: { args: ["ptr"], returns: "i32" } });
       const callback = new JSCallback(() => crash_handler.panic(), { args: [], returns: "void" });
       lib.symbols.call_through(callback.ptr);`,
    ],
    env: { ...bunEnv, BUN_CRASH_REPORT_URL: base, BUN_ENABLE_CRASH_REPORTING: "1", FIXTURE_LIB: libPath },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("invoked crashByPanic() handler");
  expect(exitCode).not.toBe(0);

  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const trace = stderr.match(new RegExp(`${escaped}/[^/\\s]+/(\\S+)`));
  expect(trace, stderr).not.toBeNull();
  const frames = decodeFrames(trace![1]);

  // bun's own frames stay nameless (bun.report symbolizes those), the
  // fixture's frame carries the object it belongs to.
  expect(frames.map(f => f.object)).toContain("bun");
  expect(frames.map(f => f.object)).toContain(basename(libPath));
});
