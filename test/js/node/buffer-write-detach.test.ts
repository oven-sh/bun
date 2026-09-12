import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Buffer#write when a user toString() (on the encoding argument, or on a
// non-string value argument) detaches or resizes the backing ArrayBuffer
// after offset/length were validated. Node re-validates inside the
// per-encoding native writer and throws ERR_BUFFER_OUT_OF_BOUNDS, or rejects
// a non-string value with ERR_INVALID_ARG_TYPE before its toString runs; Bun
// matches both. Expected values below were produced by Node v24.
//
// Each case runs in a fresh subprocess via `bun -e` so a build that still
// crashes here takes down the child (visible in stderr / exitCode) rather
// than the test runner.

// stderr lines emitted by the runtime itself that don't indicate failure.
// Under bun bd, ASAN prints a WARNING on startup; anything else on stderr
// (Bun crash banner, DEADLYSIGNAL dump, thrown exception text) is a real
// failure.
const BENIGN_STDERR = /^WARNING: ASAN interferes with JSC signal handlers;[^\n]*\n$/;

async function runPoc(script: string): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, rawStderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const stderr = BENIGN_STDERR.test(rawStderr) ? "" : rawStderr;
  return { stdout, stderr, exitCode };
}

describe.concurrent("Buffer.write with detach / resize via encoding toString", () => {
  test("write throws ERR_BUFFER_OUT_OF_BOUNDS(offset) when buffer is detached via encoding toString (crash repro)", async () => {
    const { stdout, stderr, exitCode } = await runPoc(`
      const ab = new ArrayBuffer(16);
      const buf = Buffer.from(ab);
      try {
        buf.write("x", 5, 10, { toString() { structuredClone(ab, { transfer: [ab] }); return "utf8"; } });
        console.log(JSON.stringify({ threw: false }));
      } catch (e) {
        console.log(JSON.stringify({ threw: true, code: e.code, byteLength: buf.byteLength }));
      }
    `);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ threw: true, code: "ERR_BUFFER_OUT_OF_BOUNDS", byteLength: 0 });
    expect(exitCode).toBe(0);
  });

  test("write throws ERR_BUFFER_OUT_OF_BOUNDS(length) when buffer is detached via encoding toString with offset=0", async () => {
    const { stdout, stderr, exitCode } = await runPoc(`
      const ab = new ArrayBuffer(16);
      const buf = Buffer.from(ab);
      try {
        buf.write("x", 0, 10, { toString() { ab.transfer(0); return "utf8"; } });
        console.log(JSON.stringify({ threw: false }));
      } catch (e) {
        console.log(JSON.stringify({ threw: true, code: e.code, msg: e.message }));
      }
    `);
    expect(stderr).toBe("");
    const out = JSON.parse(stdout);
    expect(out).toEqual({ threw: true, code: "ERR_BUFFER_OUT_OF_BOUNDS", msg: '"length" is outside of buffer bounds' });
    expect(exitCode).toBe(0);
  });

  test("write throws ERR_BUFFER_OUT_OF_BOUNDS(offset) when buffer is resized smaller than offset via encoding toString", async () => {
    const { stdout, stderr, exitCode } = await runPoc(`
      const ab = new ArrayBuffer(16, { maxByteLength: 32 });
      const buf = Buffer.from(ab);
      try {
        buf.write("xxxxxxxxxxxx", 5, 10, { toString() { ab.resize(3); return "utf8"; } });
        console.log(JSON.stringify({ threw: false }));
      } catch (e) {
        console.log(JSON.stringify({ threw: true, code: e.code, msg: e.message, byteLength: buf.byteLength }));
      }
    `);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      threw: true,
      code: "ERR_BUFFER_OUT_OF_BOUNDS",
      msg: '"offset" is outside of buffer bounds',
      byteLength: 3,
    });
    expect(exitCode).toBe(0);
  });

  test("write throws ERR_BUFFER_OUT_OF_BOUNDS(length) when buffer is resized smaller than offset+length via encoding toString", async () => {
    const { stdout, stderr, exitCode } = await runPoc(`
      const ab = new ArrayBuffer(16, { maxByteLength: 32 });
      const buf = Buffer.from(ab);
      try {
        buf.write("xxxxxxxxxxxx", 2, 10, { toString() { ab.resize(8); return "utf8"; } });
        console.log(JSON.stringify({ threw: false }));
      } catch (e) {
        console.log(JSON.stringify({ threw: true, code: e.code, msg: e.message, byteLength: buf.byteLength }));
      }
    `);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      threw: true,
      code: "ERR_BUFFER_OUT_OF_BOUNDS",
      msg: '"length" is outside of buffer bounds',
      byteLength: 8,
    });
    expect(exitCode).toBe(0);
  });

  test("write succeeds when encoding toString resizes but offset/length still fit", async () => {
    const { stdout, stderr, exitCode } = await runPoc(`
      const ab = new ArrayBuffer(16, { maxByteLength: 32 });
      const buf = Buffer.from(ab);
      const n = buf.write("abc", 2, 3, { toString() { ab.resize(8); return "utf8"; } });
      console.log(JSON.stringify({ n, byteLength: buf.byteLength, b2: buf[2], b3: buf[3], b4: buf[4] }));
    `);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ n: 3, byteLength: 8, b2: 0x61, b3: 0x62, b4: 0x63 });
    expect(exitCode).toBe(0);
  });

  test("write still works correctly with a non-detaching encoding toString", async () => {
    const { stdout, stderr, exitCode } = await runPoc(`
      const buf = Buffer.alloc(16);
      const n = buf.write("hello", 0, 5, { toString() { return "utf8"; } });
      console.log(JSON.stringify({ n, str: buf.toString("utf8", 0, 5) }));
    `);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ n: 5, str: "hello" });
    expect(exitCode).toBe(0);
  });

  test("write with plain string encoding keeps working", async () => {
    const { stdout, stderr, exitCode } = await runPoc(`
      const buf = Buffer.alloc(16);
      const n = buf.write("hello", 2, 5, "utf8");
      console.log(JSON.stringify({ n, str: buf.toString("utf8", 2, 7) }));
    `);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ n: 5, str: "hello" });
    expect(exitCode).toBe(0);
  });
});

// Sibling branch: `buf.write(value, encoding)` — the 2-arg "string + primitive
// encoding" form. Here the second argument is already a primitive string, so
// parseEncoding can't fire user JS; but the *first* argument skipped
// validateString, so a detaching toString on an object value would crash the
// process. Node's internal/buffer.js rejects non-string `value` up front via
// validateString; Bun now matches. See issue #30417.
describe.concurrent("Buffer.write(value, encoding) validates string argument", () => {
  test("write(obj-with-detaching-toString, 'utf8') throws ERR_INVALID_ARG_TYPE (crash repro)", async () => {
    const { stdout, stderr, exitCode } = await runPoc(`
      const buf = Buffer.alloc(1024, 0xab);
      let called = false;
      try {
        buf.write(
          { toString() { called = true; buf.buffer.transfer(0); return "hello"; } },
          "utf8",
        );
        console.log(JSON.stringify({ threw: false, called }));
      } catch (e) {
        console.log(JSON.stringify({ threw: true, code: e.code, called }));
      }
    `);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ threw: true, code: "ERR_INVALID_ARG_TYPE", called: false });
    expect(exitCode).toBe(0);
  });

  test("write(obj-with-detaching-toString) with no encoding also throws ERR_INVALID_ARG_TYPE", async () => {
    // Sibling branch (offsetValue undefined) already had validateString;
    // this just pins the two paths as behaviorally identical.
    const { stdout, stderr, exitCode } = await runPoc(`
      const buf = Buffer.alloc(1024, 0xab);
      let called = false;
      try {
        buf.write({ toString() { called = true; buf.buffer.transfer(0); return "hello"; } });
        console.log(JSON.stringify({ threw: false, called }));
      } catch (e) {
        console.log(JSON.stringify({ threw: true, code: e.code, called }));
      }
    `);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ threw: true, code: "ERR_INVALID_ARG_TYPE", called: false });
    expect(exitCode).toBe(0);
  });
});

// Writing into a buffer that was detached before the call. Node returns 0 from
// every form (byteLength is 0, so the native writer has nothing to do); Bun's
// encoding-taking forms used to throw a bare TypeError while the encoding-less
// forms returned 0.
describe.concurrent("Buffer.write on an already-detached buffer returns 0 (Node-compat)", () => {
  test("all four argument forms return 0", async () => {
    const { stdout, stderr, exitCode } = await runPoc(`
      function detached() { const ab = new ArrayBuffer(16); const b = Buffer.from(ab); ab.transfer(0); return b; }
      const out = {};
      out.noArgs = detached().write("x");
      out.encodingOnly = detached().write("x", "utf8");
      out.offsetOnly = detached().write("x", 0);
      out.full = detached().write("x", 0, 0, "utf8");
      console.log(JSON.stringify(out));
    `);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ noArgs: 0, encodingOnly: 0, offsetOnly: 0, full: 0 });
    expect(exitCode).toBe(0);
  });
});

// Node dispatches utf8/latin1/ascii through a JS wrapper that throws on an
// over-long length, but hex/base64/base64url/ucs2/utf16le go straight to the
// native binding, which clamps. An out-of-range offset throws for every
// encoding. Bun's hexWrite/base64Write/ucs2Write already clamp; .write() with
// one of those encodings must agree with them.
describe.concurrent("Buffer.write length re-check follows Node's per-encoding split", () => {
  test("over-long length after resize: utf8/latin1/ascii throw, the raw-binding encodings clamp", async () => {
    const { stdout, stderr, exitCode } = await runPoc(`
      const strs = { hex: "aabbccddeeff", base64: "aGVsbG8gd29ybGQ=", base64url: "aGVsbG8gd29ybGQ" };
      const out = {};
      for (const enc of ["utf8", "latin1", "ascii", "hex", "base64", "base64url", "ucs2", "utf16le"]) {
        const ab = new ArrayBuffer(16, { maxByteLength: 32 });
        const buf = Buffer.from(ab);
        try {
          out[enc] = buf.write(strs[enc] ?? "hello world!", 2, 10, { toString() { ab.resize(8); return enc; } });
        } catch (e) {
          out[enc] = e.code;
        }
      }
      console.log(JSON.stringify(out));
    `);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      utf8: "ERR_BUFFER_OUT_OF_BOUNDS",
      latin1: "ERR_BUFFER_OUT_OF_BOUNDS",
      ascii: "ERR_BUFFER_OUT_OF_BOUNDS",
      hex: 6,
      base64: 6,
      base64url: 6,
      ucs2: 6,
      utf16le: 6,
    });
    expect(exitCode).toBe(0);
  });

  test("offset beyond the resized buffer throws for every encoding", async () => {
    const { stdout, stderr, exitCode } = await runPoc(`
      const strs = { hex: "aabb", base64: "aGk=", base64url: "aGk" };
      const out = {};
      for (const enc of ["utf8", "hex", "base64", "ucs2"]) {
        const ab = new ArrayBuffer(16, { maxByteLength: 32 });
        const buf = Buffer.from(ab);
        try {
          out[enc] = buf.write(strs[enc] ?? "hi", 10, 2, { toString() { ab.resize(4); return enc; } });
        } catch (e) {
          out[enc] = e.code;
        }
      }
      console.log(JSON.stringify(out));
    `);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      utf8: "ERR_BUFFER_OUT_OF_BOUNDS",
      hex: "ERR_BUFFER_OUT_OF_BOUNDS",
      base64: "ERR_BUFFER_OUT_OF_BOUNDS",
      ucs2: "ERR_BUFFER_OUT_OF_BOUNDS",
    });
    expect(exitCode).toBe(0);
  });
});
