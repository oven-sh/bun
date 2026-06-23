import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Split out of structured-clone.test.ts: each child transiently needs 3-5GiB,
// so the suite is quarantined on the memory-tight linux-x64 CI shards
// (test/expectations.txt) while running everywhere else.
describe("structuredClone with ArrayBuffer larger than serialization buffer capacity", () => {
  // The serialization buffer is a WTF::Vector<uint8_t> capped at 2GiB. Cloning an
  // ArrayBuffer at or above that size must throw DataCloneError instead of aborting.
  // Run in a subprocess so the ~2GiB allocation does not bloat the test runner.
  for (const [label, expr] of [
    ["ArrayBuffer", "new ArrayBuffer(2 ** 31)"],
    ["resizable ArrayBuffer", "new ArrayBuffer(2 ** 31, { maxByteLength: 2 ** 31 + 1 })"],
    ["SharedArrayBuffer", "new SharedArrayBuffer(2 ** 31)"],
    ["growable SharedArrayBuffer", "new SharedArrayBuffer(2 ** 31, { maxByteLength: 2 ** 31 + 1 })"],
    ["Uint8Array", "new Uint8Array(2 ** 31)"],
  ] as const) {
    test(label, async () => {
      const script = `
        let buf;
        try {
          buf = ${expr};
        } catch {
          console.log("SKIP");
          process.exit(0);
        }
        try {
          structuredClone(buf);
          console.log("UNEXPECTED_SUCCESS");
        } catch (e) {
          console.log(e.name);
        }
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: bunEnv,
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(["DataCloneError", "SKIP"]).toContain(stdout.trim());
      expect(exitCode).toBe(0);
    });
  }

  // A large-but-under-2GiB ArrayBuffer nested inside an object/array fills the serialization
  // buffer to its reserved capacity; the subsequent terminator write then triggers vector
  // growth. The default 1.5x growth exceeds the 2GiB cap and would crash. These cases must
  // succeed and round-trip correctly since the total serialized size still fits under 2GiB.
  for (const [label, expr, check] of [
    ["ArrayBuffer in object", "{ h: new ArrayBuffer(size) }", "r.h.byteLength === size"],
    ["ArrayBuffer in array", "[new ArrayBuffer(size)]", "r[0].byteLength === size"],
    ["Uint8Array in object", "{ h: new Uint8Array(size) }", "r.h.byteLength === size"],
    ["nested ArrayBuffer", "{ a: { b: new ArrayBuffer(size) } }", "r.a.b.byteLength === size"],
    [
      "resizable ArrayBuffer in object",
      "{ h: new ArrayBuffer(size, { maxByteLength: size }) }",
      "r.h.byteLength === size",
    ],
  ] as const) {
    test(`${label} under 2GiB clones without crashing`, async () => {
      const script = `
        const size = 1600000000;
        let v;
        try {
          v = ${expr};
        } catch {
          console.log("SKIP");
          process.exit(0);
        }
        const r = structuredClone(v);
        console.log((${check}) ? "OK" : "BAD_ROUNDTRIP");
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: bunEnv,
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(["OK", "SKIP"]).toContain(stdout.trim());
      expect(proc.signalCode).toBe(null);
      expect(exitCode).toBe(0);
    });
  }
});
