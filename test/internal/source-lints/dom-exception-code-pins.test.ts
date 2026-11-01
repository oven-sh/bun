import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// `bun_jsc::DOMExceptionCode` (src/jsc/JSErrorCode.rs) holds the `WebCore::ExceptionCode` values Rust sends to
// `EncodedSlice__toDOMExceptionInstance`. Each variant is a number that rustc cannot compare with the C++ enum
// (src/jsc/bindings/ExceptionCode.h), so bindings.cpp compares it: one `static_assert` per variant. A variant with no
// assert compiles with any number, and a wrong number makes Rust throw another error. `AbortError` is the likely slip:
// its value in the enum is 16, and the `code` of the DOMException it makes is 20.
//
// The two sides must also agree on the size of the value. One more assert holds the C++ enum to one byte, and the Rust
// enum must stay `#[repr(u8)]`: rustc rejects the enum with no repr, and accepts it with a wider one.
test("each DOMExceptionCode variant has its number and its static_assert in bindings.cpp", () => {
  const root = path.resolve(import.meta.dir, "..", "..", "..");
  const rust = readFileSync(path.join(root, "src", "jsc", "JSErrorCode.rs"), "utf8");
  const cpp = readFileSync(path.join(root, "src", "jsc", "bindings", "bindings.cpp"), "utf8");

  // The attribute and comment lines above the enum, then its body.
  const declaration = /((?:^(?:#\[.*\]|\/\/.*)\r?\n)*)^pub enum DOMExceptionCode \{\r?\n([\s\S]*?)^\}/m.exec(rust);
  // No match means the enum moved or changed shape and this lint checks nothing.
  expect(declaration).not.toBeNull();
  const [, attributes, body] = declaration!;
  expect(attributes.split(/\r?\n/)).toContain("#[repr(u8)]");

  // Blank lines, comments and attributes are not variants.
  const lines = body.split(/\r?\n/).filter(line => !/^\s*(?:\/\/.*|#\[.*\])?$/.test(line));
  expect(lines).not.toBeEmpty();

  const variant = /^ {4}(\w+) = (\d+),(?: *\/\/.*)?$/;
  const unnumbered = lines.filter(line => !variant.test(line));
  expect(unnumbered).toEqual([]);

  const expected = [
    'static_assert(sizeof(WebCore::ExceptionCode) == 1, "bun_jsc::DOMExceptionCode is #[repr(u8)]");',
    ...lines.map(line => {
      const [, name, value] = variant.exec(line)!;
      return `static_assert(WebCore::${name} == ${value}, "bun_jsc::DOMExceptionCode::${name}");`;
    }),
  ];
  const actual = cpp.split(/\r?\n/).filter(line => line.includes('"bun_jsc::DOMExceptionCode'));
  expect(actual.sort()).toEqual(expected.sort());
});
