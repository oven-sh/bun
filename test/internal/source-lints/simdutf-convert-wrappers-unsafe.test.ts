import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// Every transcoder wrapper in `simdutf::convert` (src/simdutf_sys/simdutf.rs)
// must be declared `unsafe fn`.
//
// simdutf's convert_* entry points take an output *pointer* and write however
// many code units the input transcodes to (up to 3 bytes per UTF-16 unit, one
// UTF-16 unit per UTF-8 byte). The wrappers take `output: &mut [_]`, but
// `output.len()` never reaches C++, so as safe functions they let any caller
// overflow the slice; the only protection was whatever length check each caller
// made, and oven-sh/bun#20258 (fixed in #31694) was a caller that got it wrong.
// The wrappers cannot make the check themselves at an acceptable cost: the
// exact requirement is a SIMD length scan of the input, which the hot callers
// deliberately skip by sizing for the worst case. So they are `unsafe fn`, with
// the bound in their `# Safety` section, and every call site has to say which
// check establishes it (`base64::encode_raw` in the same file has the same
// shape).
//
// Not covered here, deliberately: `base64::encode` (its bound is O(1)
// arithmetic, so it can assert the length itself) and `base64::decode*` (they
// pass the output length through to C++).

const root = path.resolve(import.meta.dir, "..", "..", "..");
const file = "src/simdutf_sys/simdutf.rs";
const source = readFileSync(path.join(root, file), "utf8");

// Strip comments and string literals so neither prose nor the `{}` placeholders
// of assertion messages disturb the brace tracking below. Lines are preserved
// so the reported line numbers stay right.
const stripped = source.replace(/\/\/.*$/gm, "").replace(/"(?:[^"\\\n]|\\.)*"/g, '""');

interface Wrapper {
  // e.g. `convert::utf16::to::utf8::with_errors::le`
  name: string;
  line: number;
  unsafe: boolean;
}

// The file is rustfmt-formatted (one item header per line), so the module path
// can be tracked by brace depth. Collects every `pub fn` declared under
// `pub mod convert`, skipping `extern "C" { .. }` blocks: declarations in those
// are unsafe to call without carrying the keyword.
function convertWrappers(): Wrapper[] {
  const EXTERN_BLOCK = "<extern>";
  const scopes: Array<{ name: string; depth: number }> = [];
  let depth = 0;
  const found: Wrapper[] = [];
  const lines = stripped.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const mod = /^\s*pub(?:\([^)]*\))?\s+mod\s+(\w+)\s*\{/.exec(line);
    if (mod) {
      scopes.push({ name: mod[1], depth });
    } else if (/\bextern\s+""\s*\{/.test(line)) {
      scopes.push({ name: EXTERN_BLOCK, depth });
    } else if (scopes[0]?.name === "convert" && scopes.every(s => s.name !== EXTERN_BLOCK)) {
      const fn = /^\s*pub(?:\([^)]*\))?\s+(unsafe\s+)?fn\s+(\w+)\s*\(/.exec(line);
      if (fn) {
        found.push({
          name: [...scopes.map(s => s.name), fn[2]].join("::"),
          line: i + 1,
          unsafe: fn[1] !== undefined,
        });
      }
    }
    for (const ch of line) {
      if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        while (scopes.length > 0 && scopes[scopes.length - 1].depth >= depth) scopes.pop();
      }
    }
  }
  return found;
}

const wrappers = convertWrappers();

test("the walker still finds the two wrappers", () => {
  // Guards the assertion below against passing on an empty list after a
  // rename or restructuring of the module. These back UTF-8 -> UTF-16 string
  // conversion and UTF-16 -> UTF-8 encoding into caller buffers.
  const names = wrappers.map(w => w.name);
  expect(names).toContain("convert::utf8::to::utf16::with_errors::le");
  expect(names).toContain("convert::utf16::to::utf8::with_errors::le");
});

test("every simdutf::convert wrapper is declared `unsafe fn`", () => {
  expect(wrappers.filter(w => !w.unsafe).map(w => `${file}:${w.line}: ${w.name}`)).toEqual([]);
});
