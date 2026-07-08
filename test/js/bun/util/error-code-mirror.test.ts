import { expect, test } from "bun:test";
import path from "node:path";

// `src/jsc/ErrorCode.rs` is a hand-maintained mirror of the table generated from
// `src/jsc/bindings/ErrorCode.ts`. Its discriminants index a fixed C++ `errors[]`
// array with no bounds check, so an entry inserted anywhere but the end silently
// shifts every later code (and can read past the array). Nothing else checks this.
const SRC = path.join(__dirname, "..", "..", "..", "..", "src");

function parseRows(ts: string) {
  const body = ts.split("const errors: ErrorCodeMapping = [")[1].split("\n];")[0];
  return body.match(/^\s*\[.+?\],\s*$/gm)!.map(row => {
    const code = row.match(/"([A-Z0-9_]+)"/)![1];
    const fields = row
      .trim()
      .replace(/^\[|\],?$/g, "")
      .split(/,(?![^[]*\])/);
    const extras = fields
      .slice(3)
      .map(f => f.trim())
      .filter(f => f && f !== "null" && f !== "undefined");
    return { code, extras };
  });
}

// Mirrors generate-node-errors.ts: each row emits its code once, plus once more
// per extra constructor after the third field.
async function expected() {
  const ts = await Bun.file(path.join(SRC, "jsc", "bindings", "ErrorCode.ts")).text();
  const rows = parseRows(ts);
  const codes: string[] = [];
  const enumNames: string[] = [];
  for (const { code, extras } of rows) {
    codes.push(code, ...extras.map(() => code));
    enumNames.push(code, ...extras.map(c => `${code}_${c}`));
  }
  return { codes, enumNames };
}

async function rustMirror() {
  const rs = await Bun.file(path.join(SRC, "jsc", "ErrorCode.rs")).text();
  const count = Number(rs.match(/pub const COUNT: u16 = (\d+);/)![1]);
  const table = rs.match(/static CODE_STR: \[&str; ErrorCode::COUNT as usize\] = \[([\s\S]*?)\n\];/)![1];
  const codes = [...table.matchAll(/"([^"]+)"/g)].map(m => m[1]);
  const consts = [...rs.matchAll(/pub const ([A-Za-z0-9_]+): ErrorCode = ErrorCode\((\d+)\);/g)].map(m => ({
    name: m[1],
    value: Number(m[2]),
  }));
  return { count, codes, consts };
}

test("ErrorCode.rs CODE_STR stays index-aligned with ErrorCode.ts", async () => {
  const { codes: want } = await expected();
  const { codes } = await rustMirror();
  // Report the first divergence: a bare toEqual on 300+ strings is unreadable.
  const at = want.findIndex((c, i) => codes[i] !== c);
  expect({ at, detail: at === -1 ? null : { want: want[at], got: codes[at] } }).toEqual({ at: -1, detail: null });
  expect(codes.length).toBe(want.length);
});

test("ErrorCode.rs COUNT matches the generated error count", async () => {
  const { codes: want } = await expected();
  const { count } = await rustMirror();
  expect(count).toBe(want.length);
});

// The discriminants themselves. Rust names strip the leading ERR_ (except
// ERR_MODULE_NOT_FOUND); extra constructors get a `_RangeError`-style suffix.
test("ErrorCode.rs discriminants match their position in ErrorCode.ts", async () => {
  const { enumNames } = await expected();
  const index = new Map(enumNames.map((n, i) => [n, i]));
  const { consts } = await rustMirror();
  const mismatches = consts
    .map(({ name, value }) => ({ name, value, want: index.get(index.has(name) ? name : `ERR_${name}`) }))
    .filter(({ value, want }) => value !== want);
  expect(mismatches).toEqual([]);
  expect(consts.length).toBe(enumNames.length);
});
