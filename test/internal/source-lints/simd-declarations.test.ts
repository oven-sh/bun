import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// C++ declares by hand what bun_simd_kernels and bun_hash export, and the linker only compares names.
const root = path.resolve(import.meta.dir, "..", "..", "..");
const read = (pattern: string) =>
  [...new Glob(pattern).scanSync(root)].map(file => readFileSync(path.join(root, file), "utf8").replace(/\/\/.*/g, ""));
const name = "bun_(?:simd|hash)_\\w+";

const numbers = { usize: "size_t", bool: "bool", AtomicU8: "uint8_t" };
function toC(rust: string): string {
  const pointer = /^(\*const |\*mut |&mut |&)(.*)$/.exec(rust);
  // An array is passed as a pointer to its first number. Atomics can be written through `*const`.
  if (pointer) {
    const target = pointer[2].replace(/\[|;[^\]]*\]/g, "");
    const isConst = target.startsWith("Atomic") ? "(const )?" : pointer[1].includes("mut") ? "" : "const ";
    return isConst + toC(target) + "\\*";
  }
  return numbers[rust] ?? rust.replace(/^(u?)i?(\d+)$/, "$1int$2_t");
}
function signature(parameters: string, result = "void") {
  const types = [...parameters.matchAll(/:\s*([^,]+)/g)].map(it => toC(it[1].trim()));
  return new RegExp("^" + [toC(result), ...types].join(", ") + "$");
}

function exported(sources: string[]) {
  const found = new Map<string, RegExp>();
  const head = (fn: string) => `extern "C" fn ${fn}\\(([^{]*?)\\)(?: -> (\\w+))? {`;
  for (const source of sources) {
    for (const [, fn, parameters, result] of source.matchAll(new RegExp(head(`(${name})`), "g")))
      found.set(fn, signature(parameters, result));
    // A macro with a row for each function: `name(arguments) = ...;`
    for (const [, , rule, rows] of source.matchAll(/^macro_rules! (\w+) {(.*?)^}\n\1! {(.*?)^}/gms)) {
      const variables: string[] = /\$export:ident\((.*?)\)(?: =|;)/.exec(rule)?.[1].match(/\$\w+/g) ?? [];
      const [, parameters, result] = new RegExp(head("\\$export")).exec(rule)!;
      for (const [, fn, list = ""] of rows.matchAll(new RegExp(`^ +(${name})(?:\\((.*?)\\))?`, "gm"))) {
        const filled = parameters
          .replace(/\$\((.*?)\)\?/g, list ? "$1" : "")
          .replace(/\$\w+/g, variable => list.split(", ")[variables.indexOf(variable)]);
        found.set(fn, signature(filled, result));
      }
    }
  }
  return found;
}

function declared(sources: string[]) {
  const declaration = new RegExp(
    `^\\s*(?:extern "C" )?(?!return |else )(\\w[\\w ]+?\\**) (${name})\\(([^)]*)\\)`,
    "gm",
  );
  return sources
    .flatMap(source => [...source.matchAll(declaration)])
    .map(([, result, fn, parameters]) => {
      const types = parameters.split(",").map(it => it.replace(/\w+\s*$/, "").trim());
      return [fn, [result, ...types.filter(Boolean)].join(", ")];
    });
}

function differences(rust: string[], cxx: string[]) {
  const exports = exported(rust);
  return declared(cxx).filter(([fn, types]) => !exports.get(fn)?.test(types));
}

const rust = read("src/{simd_kernels,hash}/ffi*.rs");
const cxx = read("src/jsc/bindings/**/*.{h,cpp}")
  .filter(it => new RegExp(name).test(it))
  // These two take any address.
  .map(it => it.replace(/plain_memr?mem16\(const.*/g, line => line.replaceAll("uint8_t", "uint16_t")));

test("C++ declares the exports of the SIMD kernels with the types that they have in Rust", () => {
  // What the patterns miss is not compared.
  const named = new Set(cxx.join().match(new RegExp(name + "(?=\\()", "g")));
  expect(new Set(declared(cxx).map(([fn]) => fn))).toEqual(named);
  expect(named.size).toBeGreaterThan(50);
  expect(differences(rust, cxx)).toEqual([]);
});

test.each([
  ["first_non_ascii16(const uint16_t*", "first_non_ascii16(const uint8_t*"],
  ["size_t* width, size_t* done", "size_t* width"],
  ["size_t len, uint8_t* to, size_t to_len", "size_t len, const uint8_t* to, size_t to_len"],
  ["void bun_simd_bswap32", "size_t bun_simd_bswap32"],
  ["narrow_to_latin1(u16, u8)", "narrow_to_latin1(u8, u16)"],
  ["seed: u64", "seed: u32"],
])("it notices if %p becomes %p", (from, to) => {
  const change = (sources: string[]) => sources.map(it => it.replace(from, to));
  expect(differences(change(rust), change(cxx))).toHaveLength(1);
});
