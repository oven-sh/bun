import { describe, expect, test } from "bun:test";

// Malformed stylesheets the CSS parser has to get through. Each one is bundled
// from memory as written and again after every corruption below. The build may
// succeed or report errors; the assertions only check that it came back with a
// well-formed result, the process surviving is the point.

const invalid: Record<string, string[]> = {
  selectors: [
    "}{color:red}",
    "&*#@.class{color:red}",
    "..double.dot{color:red}",
    ".{color:red}",
    "#{color:red}",
    ".outer { .inner { color: red } }",
  ],
  declarations: [".test{color:}", ".test{:red}", ".test{color::red}", ".test{;color:red}", ".test{color:red;;;}"],
  "unclosed blocks and comments": [
    ".test { color: red\n.another { padding: 10px }",
    "/* unclosed comment .test{color:red}",
    ".test{color:red} /* unclosed",
    "/**//**//* .test{color:red}",
    "@media screen { @media print { } ",
  ],
  "at-rules": [
    "@media ;",
    "@{color:red}",
    "@media screen and and {color:red}",
    "@keyframes { @keyframes { } }",
    "@import url('test.css'",
    "@import 'file' 'screen';",
    "@import url(;",
    "@import url('test.css') print",
  ],
  "null bytes": [".test{color:red\0;}", ".te\0st{color:red}", "\0.test{color:red}"],
};

const corruptions: ((css: string) => string)[] = [
  css => css.replaceAll("{", "}"),
  css => css.replaceAll("}", "{"),
  css => css.replaceAll(":", ";"),
  css => css.replaceAll(";", ":"),
  css => css.slice(0, css.length >> 1),
  css => css + "}}}}",
  css => Array.from(css).reverse().join(""),
];

const invalidUtf8: Record<string, number[]> = {
  "overlong two byte NUL": [0xc0, 0x80],
  "overlong three byte NUL": [0xe0, 0x80, 0x80],
  "overlong four byte NUL": [0xf0, 0x80, 0x80, 0x80],
  "truncated three byte sequence": [0xe2],
};

function splice(before: string, bytes: number[], after: string): Uint8Array {
  return new Uint8Array([...Buffer.from(before), ...bytes, ...Buffer.from(after)]);
}

// The sources only exist inside the `files` option; nothing is written to disk.
const virtualDir = import.meta.dir.replaceAll("\\", "/") + "/css-fuzz-input";

// Builds every source in one Bun.build call. A batch produces no output once any
// of its sources is rejected, so a source that should also reach the printer has
// to be built on its own.
async function build(sources: (string | Uint8Array)[]) {
  const files: Record<string, string | Uint8Array> = {};
  sources.forEach((source, i) => {
    files[`${virtualDir}/${i}.css`] = source;
  });
  const entrypoints = Object.keys(files);

  const result = await Bun.build({ entrypoints, files, throw: false });

  for (const log of result.logs) {
    expect(log.message).toBeString();
  }
  if (result.success) {
    expect(result.outputs).toHaveLength(entrypoints.length);
  } else {
    expect(result.logs.length).toBeGreaterThan(0);
  }
  return result;
}

test("a valid stylesheet builds through the same path", async () => {
  const result = await build([".test{color:red}"]);
  expect(result.success).toBe(true);
  expect(await result.outputs[0].text()).toContain("color: red");
});

for (const [family, stylesheets] of Object.entries(invalid)) {
  describe(family, () => {
    for (const css of stylesheets) {
      test(JSON.stringify(css), async () => {
        await build([css]);
        await build(corruptions.map(corrupt => corrupt(css)));
      });
    }
  });
}

test("every control character inside a declaration value", async () => {
  await build(Array.from({ length: 32 }, (_, i) => `.test{color:${String.fromCharCode(i)}red}`));
});

describe("invalid UTF-8", () => {
  for (const [name, bytes] of Object.entries(invalidUtf8)) {
    test(`${name} inside a string`, async () => {
      await build([splice('.test{content:"', bytes, '"}')]);
    });

    test(`${name} inside an identifier`, async () => {
      await build([splice(".te", bytes, "st{color:red}")]);
    });
  }
});

describe("oversized input", () => {
  test("a selector with 100000 compound parts", async () => {
    await build([Buffer.alloc(".test".length * 100_000, ".test").toString() + "{color:red}"]);
  });

  test("a rule with 10000 declarations", async () => {
    await build([".test{" + Buffer.alloc("color:red;\n".length * 10_000, "color:red;\n").toString() + "}"]);
  });
});
