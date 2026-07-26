import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// A Uint8Array can have length up to MAX_ARRAY_BUFFER_SIZE (2**32 on 64-bit),
// so 4294967295 (UINT32_MAX) is a valid index. Regular JS arrays top out at
// MAX_ARRAY_INDEX (2**32 - 2), and the TypedArray [[Get]]/[[Set]] paths were
// reusing that cap, which left the last element unreachable via bracket access
// while [[HasProperty]] and DataView could still see it.
// https://tc39.es/ecma262/#sec-isvalidintegerindex

const fixture = /* js */ `
"use strict";
const LEN = 2 ** 32;
const IDX = LEN - 1; // 4294967295
const KEY = String(IDX); // "4294967295"

let u;
try {
  u = new Uint8Array(LEN);
} catch {
  console.log(JSON.stringify({ skipped: true }));
  process.exit(0);
}
if (u.length !== LEN) throw new Error("unexpected length " + u.length);

// Seed the last byte via a path that was never broken.
new DataView(u.buffer).setUint8(IDX, 11);

const out = {
  initialGetNum: u[IDX],
  initialGetStr: u[KEY],
  at: u.at(IDX),
  inNum: IDX in u,
  inStr: KEY in u,
  hasOwn: Object.hasOwn(u, KEY),
  gopd: Object.getOwnPropertyDescriptor(u, KEY),
};

u[IDX] = 22;
out.afterIndexedSet = u[IDX];
out.afterIndexedSetDV = new DataView(u.buffer).getUint8(IDX);

Reflect.set(u, KEY, 33);
out.afterReflectSet = u[IDX];
out.afterReflectSetDV = new DataView(u.buffer).getUint8(IDX);

try {
  Object.defineProperty(u, KEY, { value: 44, writable: true, enumerable: true, configurable: true });
  out.afterDefine = new DataView(u.buffer).getUint8(IDX);
} catch (e) {
  out.afterDefine = "threw: " + e.constructor.name;
}

out.deleteInBounds = Reflect.deleteProperty(u, KEY);

// Keep matching spec for adjacent cases:
out.oneBeyond = u["4294967296"];
out.minusZero = u["-0"];

// On a short view, the same index is out of bounds.
const small = new Uint8Array(8);
out.smallGet = small[IDX];
out.smallIn = KEY in small;
out.smallDelete = Reflect.deleteProperty(small, KEY);
let smallDefineThrew = false;
try {
  Object.defineProperty(small, KEY, { value: 1, writable: true, enumerable: true, configurable: true });
} catch {
  smallDefineThrew = true;
}
out.smallDefineThrew = smallDefineThrew;

// Other 1-byte element types at max length.
const i8 = new Int8Array(u.buffer);
i8[IDX] = -7;
out.i8 = i8[IDX];
const uc = new Uint8ClampedArray(u.buffer);
uc[IDX] = 300;
out.uc = uc[IDX];

console.log(JSON.stringify(out));
`;

test("TypedArray indexed access at 4294967295 on a 2**32-length view", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const out = JSON.parse(stdout.trim());
  if (out.skipped) {
    console.log("skipping: could not allocate a 2**32-byte Uint8Array");
    expect(exitCode).toBe(0);
    return;
  }

  expect(out).toEqual({
    initialGetNum: 11,
    initialGetStr: 11,
    at: 11,
    inNum: true,
    inStr: true,
    hasOwn: true,
    gopd: { value: 11, writable: true, enumerable: true, configurable: true },
    afterIndexedSet: 22,
    afterIndexedSetDV: 22,
    afterReflectSet: 33,
    afterReflectSetDV: 33,
    afterDefine: 44,
    deleteInBounds: false,
    oneBeyond: undefined,
    minusZero: undefined,
    smallGet: undefined,
    smallIn: false,
    smallDelete: true,
    smallDefineThrew: true,
    i8: -7,
    uc: 255,
  });
  expect(exitCode).toBe(0);
});
