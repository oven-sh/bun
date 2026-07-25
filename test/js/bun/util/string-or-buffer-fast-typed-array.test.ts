// A fresh `new Uint8Array(n)` with n ≤ JSC::fastSizeLimit lives inline in the
// GC heap (FastTypedArray mode) until someone touches `.buffer`. Borrowing its
// bytes for an async call should copy them, not force the view through
// `slowDownAndWasteMemory()` (malloc + byte copy + butterfly allocation) just
// to take a pin on storage that cannot be detached anyway.
//
// `jscDescribe` prints `butterfly (nil)` (or `0x0` on some platforms) for a
// FastTypedArray and a real pointer once the view has been wastefully
// materialized, so comparing the descriptor before/after tells us whether the
// call allocated a backing ArrayBuffer.

import { describe, test, expect } from "bun:test";
import { jscDescribe } from "bun:jsc";
import { tempDir } from "harness";
import fs from "fs";
import crypto from "crypto";
import { promisify } from "util";

const pbkdf2 = promisify(crypto.pbkdf2);

// Control: accessing `.buffer` DOES allocate a butterfly. If jscDescribe ever
// stops exposing that, every assertion below would pass vacuously; guard once.
{
  const u8 = new Uint8Array(64);
  const before = jscDescribe(u8);
  void u8.buffer;
  const after = jscDescribe(u8);
  if (before === after) {
    throw new Error(
      "control: jscDescribe no longer distinguishes FastTypedArray from a " +
        "materialized view; this test needs a new observable",
    );
  }
}

async function expectNoMaterialize(label: string, run: (u8: Uint8Array) => unknown | Promise<unknown>) {
  const u8 = new Uint8Array(64);
  u8.fill(0x61);
  const before = jscDescribe(u8);
  await run(u8);
  const after = jscDescribe(u8);
  expect(after, `${label}: FastTypedArray was materialized (slowDownAndWasteMemory)`).toBe(before);
}

describe("StringOrBuffer does not materialize a FastTypedArray input", () => {
  test("fs.promises.writeFile", async () => {
    using dir = tempDir("sob-fast", { out: "" });
    await expectNoMaterialize("writeFile", u8 => fs.promises.writeFile(`${dir}/out`, u8));
  });

  test("fs.promises.appendFile", async () => {
    using dir = tempDir("sob-fast", { out: "" });
    await expectNoMaterialize("appendFile", u8 => fs.promises.appendFile(`${dir}/out`, u8));
  });

  test("crypto.pbkdf2 password", async () => {
    await expectNoMaterialize("pbkdf2 password", u8 => pbkdf2(u8, "salt", 1, 16, "sha256"));
  });

  test("crypto.pbkdf2 salt", async () => {
    await expectNoMaterialize("pbkdf2 salt", u8 => pbkdf2("pass", u8, 1, 16, "sha256"));
  });

  test("crypto.scrypt password", async () => {
    const scrypt = promisify(crypto.scrypt);
    await expectNoMaterialize("scrypt password", u8 => scrypt(u8, "salt", 16));
  });

  test("Bun.Transpiler#transform", async () => {
    const t = new Bun.Transpiler({ loader: "js" });
    const src = new Uint8Array([49, 59, 10]); // "1;\n"
    const before = jscDescribe(src);
    await t.transform(src);
    const after = jscDescribe(src);
    expect(after, "transform: FastTypedArray was materialized").toBe(before);
  });

  test("the borrowed bytes are read correctly", async () => {
    // Duping must preserve the contents: hash a FastTypedArray and the same
    // bytes wrapped in a Buffer (already WastefulTypedArray) and compare.
    const u8 = new Uint8Array(64);
    for (let i = 0; i < u8.length; i++) u8[i] = i;
    const viaFast = await pbkdf2(u8, "salt", 1, 32, "sha256");
    const viaBuffer = await pbkdf2(Buffer.from(u8), "salt", 1, 32, "sha256");
    expect(viaFast.equals(viaBuffer)).toBe(true);
  });

  test("zero-length FastTypedArray", async () => {
    const u8 = new Uint8Array(0);
    const [out, ref] = await Promise.all([
      pbkdf2(u8, "salt", 1, 32, "sha256"),
      pbkdf2("", "salt", 1, 32, "sha256"),
    ]);
    expect(out.equals(ref)).toBe(true);
  });

  test("an OversizeTypedArray is still pinned, not copied", async () => {
    // > fastSizeLimit (1000) elements: storage lives in fastMalloc and is
    // adopted in place by possiblySharedBuffer(). That path should still run;
    // transfer() during the async work must leave the source attached.
    const u8 = new Uint8Array(4096);
    for (let i = 0; i < u8.length; i++) u8[i] = i & 0xff;
    const ref = await pbkdf2(Buffer.from(u8), "salt", 1, 32, "sha256");

    const p = pbkdf2(u8, "salt", 1, 32, "sha256");
    u8.buffer.transfer();
    expect(u8.byteLength).toBe(4096);
    expect((await p).equals(ref)).toBe(true);
  });
});
