import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

// The Rust `bun_jsc::ErrorCode` discriminants index the C++ `errors[]` array
// (ErrorCode+Data.h) with no bounds check in `Bun__createErrorWithCode`, so the
// two tables must be generated from the same source of truth (ErrorCode.ts).
// This file guards two things: that the Rust side stays generated (not a
// hand-maintained mirror that can drift), and that the Rust→C++ FFI round-trip
// actually yields the expected `.code` / constructor across the index range.

const SRC = path.join(import.meta.dir, "..", "..", "..", "..", "src");

test("src/jsc/ErrorCode.rs does not hand-maintain the discriminant table", async () => {
  const rs = await Bun.file(path.join(SRC, "jsc", "ErrorCode.rs")).text();
  // A hand-maintained mirror shows up as literal `= ErrorCode(N)` assignments.
  const hardcoded = [...rs.matchAll(/= ErrorCode\(\d+\)/g)].map(m => m[0]);
  expect({ hardcoded: hardcoded.slice(0, 3), count: hardcoded.length }).toEqual({ hardcoded: [], count: 0 });
  expect(rs).toContain('include!(concat!(env!("BUN_CODEGEN_DIR"), "/ErrorCode.generated.rs"))');
});

// Each case goes Rust `ErrorCode::<X>.fmt()` → `Bun__createErrorWithCode`,
// which reads `errors[discriminant]` on the C++ side. A misaligned discriminant
// surfaces here as the wrong `.code` or constructor. Cases are picked to span
// low / mid / high indices of the table.
test("Rust-thrown error codes round-trip through Bun__createErrorWithCode", async () => {
  const fixture = `
    const out = [];
    function t(fn) { try { fn(); out.push("NO THROW"); } catch (e) { out.push(e.code + ":" + e.constructor.name); } }
    async function ta(fn) { try { await fn(); out.push("NO THROW"); } catch (e) { out.push(e.code + ":" + e.constructor.name); } }
    t(() => require("crypto").timingSafeEqual(Buffer.alloc(1), Buffer.alloc(2)));
    t(() => new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array([0xff])));
    t(() => new TextDecoder("nope"));
    t(() => Bun.randomUUIDv5());
    t(() => Bun.randomUUIDv5("n", "bad-namespace"));
    t(() => Bun.S3Client.presign("f.txt", {}));
    t(() => new (require("net").SocketAddress)({ port: 99999 }));
    t(() => Bun.randomUUIDv7("bogus"));
    await ta(() => new Response("x").formData());
    console.log(JSON.stringify(out));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: { ...bunEnv, AWS_ACCESS_KEY_ID: undefined, AWS_SECRET_ACCESS_KEY: undefined },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stderr, out: JSON.parse(stdout.trim()) }).toEqual({
    stderr: "",
    out: [
      "ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH:RangeError", // index 48
      "ERR_ENCODING_INVALID_ENCODED_DATA:TypeError", // index 56
      "ERR_ENCODING_NOT_SUPPORTED:RangeError", // index 57
      "ERR_INVALID_ARG_TYPE:TypeError", // index 119
      "ERR_INVALID_ARG_VALUE:TypeError", // index 120
      "ERR_S3_MISSING_CREDENTIALS:Error", // index 214
      "ERR_SOCKET_BAD_PORT:RangeError", // index 221
      "ERR_UNKNOWN_ENCODING:TypeError", // index 261
      "ERR_FORMDATA_PARSE_ERROR:TypeError", // index 61
    ],
  });
  expect(exitCode).toBe(0);
});
