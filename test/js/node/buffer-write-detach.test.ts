import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// TOCTOU guard for Buffer#write. When the encoding argument is an object,
// parseEncoding() calls toString() on it — user JS that can detach or
// resize the backing ArrayBuffer AFTER offset/length were validated against
// the original byteLength. Without the guard, writeToBuffer() computes
// vector()+offset on a null vector (detach) or writes past the new logical
// end (resize). Node.js re-validates offset/length inside the per-encoding
// native write (utf8Write et al) after encoding normalization and throws
// ERR_BUFFER_OUT_OF_BOUNDS; Bun matches that.
//
// Each case runs in a fresh subprocess via `bun -e` so an unpatched build
// segfaults the child (observable as exitCode !== 0) rather than taking the
// in-process test runner down.

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
