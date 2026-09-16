/**
 * parseAnnotations() (scripts/utils.mjs) turns compiler output captured from a
 * failed CI build into Buildkite annotations (scripts/build/ci.ts). Each
 * matcher reads the lines following the one it matched into the annotation
 * body with readUntil(); these pin what ends up in the body.
 */
import { describe, expect, test } from "bun:test";

import { parseAnnotation, parseAnnotations, type Annotation } from "../../../scripts/utils.mjs";

// rustc's human-readable format (`cargo build` output): a header line, the
// `-->` location, the rendered span with `|` gutters, optional `=` notes, and
// the blank line rustc prints after every diagnostic.
const mismatchedTypes = [
  "error[E0308]: mismatched types",
  "   --> src/http/lib.rs:553:5",
  "    |",
  "551 | pub fn f() -> u8 {",
  "    |               -- expected `u8` because of return type",
  '553 |     "str"',
  "    |     ^^^^^ expected `u8`, found `&str`",
  "    |",
  "    = note: this function returns a `u8`",
];
const unusedVariable = [
  "warning: unused variable: `x`",
  "  --> src/http/lib.rs:10:9",
  "   |",
  "10 |     let x = 1;",
  "   |         ^ help: if this is intentional, prefix it with an underscore: `_x`",
  "   |",
  "   = note: `#[warn(unused_variables)]` on by default",
];

const expectedMismatchedTypes: Annotation = {
  source: "rustc",
  level: "error",
  title: "[E0308] mismatched types",
  filename: "src/http/lib.rs",
  line: 553,
  column: 5,
  content: mismatchedTypes.join("\n"),
  metadata: {},
};
const expectedUnusedVariable: Annotation = {
  source: "rustc",
  level: "warning",
  title: "unused variable: `x`",
  filename: "src/http/lib.rs",
  line: 10,
  column: 9,
  content: unusedVariable.join("\n"),
  metadata: {},
};

describe("rustc diagnostics", () => {
  test("each diagnostic becomes one annotation carrying its whole body", () => {
    const output = [
      "   Compiling bun_http v0.0.0 (/workspace/bun/src/http)",
      ...mismatchedTypes,
      "",
      ...unusedVariable,
      "",
      "warning: `bun_http` (lib) generated 1 warning",
      "",
    ].join("\n");

    const { annotations, content } = parseAnnotations(output);
    expect(annotations).toEqual([expectedMismatchedTypes, expectedUnusedVariable]);
    // Body lines belong to their annotation; only the cargo chatter is left over.
    expect(content).toBe(
      [
        "   Compiling bun_http v0.0.0 (/workspace/bun/src/http)",
        "warning: `bun_http` (lib) generated 1 warning",
        "",
      ].join("\n"),
    );
  });

  test("the location is read through the colors cargo emits in CI (CARGO_TERM_COLOR=always)", () => {
    // Verbatim `rustc --color=always` styling: the header is split across
    // several escape sequences and `-->` is styled separately from the path.
    const bold = "\x1b[1m";
    const red = "\x1b[91m";
    const blue = "\x1b[94m";
    const reset = "\x1b[0m";
    const colored = [
      `${bold}${red}error[E0308]${reset}${bold}: mismatched types${reset}`,
      ` ${bold}${blue}--> ${reset}src/http/lib.rs:553:5`,
      `  ${bold}${blue}|${reset}`,
      `${bold}${blue}3${reset} ${bold}${blue}|${reset}     "str"`,
      `  ${bold}${blue}|${reset}     ${bold}${red}^^^^^${reset} ${bold}${red}expected \`u8\`, found \`&str\`${reset}`,
    ];

    expect(parseAnnotations([...colored, "", ""].join("\n")).annotations).toEqual([
      {
        ...expectedMismatchedTypes,
        // The body is kept as emitted; formatAnnotationToHtml() strips or
        // renders the colors depending on the destination.
        content: colored.join("\n"),
      },
    ]);
  });

  test("a diagnostic without a span keeps the next diagnostic separate", () => {
    const linkFailure = [
      "error: linking with `cc` failed: exit status: 1",
      "  |",
      "  = note: some arguments are omitted. use `--verbose` to show all linker arguments",
      "  = note: rust-lld: error: undefined symbol: Bun__missing",
    ];
    const output = [...linkFailure, "", "error: aborting due to 1 previous error", "", ...unusedVariable, ""].join(
      "\n",
    );

    expect(parseAnnotations(output).annotations).toEqual([
      {
        source: "rustc",
        level: "error",
        title: "linking with `cc` failed: exit status: 1",
        filename: undefined,
        line: undefined,
        column: undefined,
        content: linkFailure.join("\n"),
        metadata: {},
      },
      {
        source: "rustc",
        level: "error",
        title: "aborting due to 1 previous error",
        filename: undefined,
        line: undefined,
        column: undefined,
        content: "error: aborting due to 1 previous error",
        metadata: {},
      },
      expectedUnusedVariable,
    ]);
  });

  test("output that never reaches a blank line is capped rather than swallowed whole", () => {
    const header = "error: aborting due to 1 previous error";
    const filler = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    const { annotations } = parseAnnotations([header, ...filler].join("\n"));
    expect(annotations).toHaveLength(1);
    const body = String(annotations[0]!.content).split("\n");
    expect(body[0]).toBe(header);
    expect(body.length).toBeLessThan(filler.length);
  });

  test("cargo's per-crate warning summaries are not diagnostics", () => {
    const output = [
      "warning: `bun_http` (lib) generated 2 warnings",
      "warning: 2 warnings emitted",
      "error: could not compile `bun_http` (lib) due to 1 previous error; 2 warnings emitted",
      "",
    ].join("\n");
    expect(parseAnnotations(output).annotations).toEqual([]);
  });
});

describe("other sources", () => {
  test("CMake messages are attributed to the innermost call-stack frame with a single-spaced body", () => {
    const message = [
      "CMake Error at cmake/targets/BuildBun.cmake:12 (message):",
      "  something bad",
      "Call Stack (most recent call first):",
      "  CMakeLists.txt:5 (include)",
    ];
    const output = [...message, "", "", "-- Configuring incomplete, errors occurred!"].join("\n");

    expect(parseAnnotations(output).annotations).toEqual([
      {
        source: "cmake",
        level: "error",
        title: "cmake error",
        filename: "CMakeLists.txt",
        line: 5,
        column: undefined,
        content: message.join("\n"),
        metadata: {},
      },
    ]);
  });

  test("clang diagnostics run through the 'N errors generated' trailer", () => {
    const diagnostic = [
      "src/jsc/bindings/Foo.cpp:12:5: error: use of undeclared identifier 'bar'",
      "   12 |     bar();",
      "      |     ^",
      "1 error generated.",
    ];

    expect(
      parseAnnotations([...diagnostic, "ninja: build stopped: subcommand failed."].join("\n")).annotations,
    ).toEqual([
      {
        source: "clang",
        level: "error",
        title: "clang error",
        filename: "src/jsc/bindings/Foo.cpp",
        line: 12,
        column: 5,
        content: diagnostic.join("\n"),
        metadata: {},
      },
    ]);
  });

  test("string content is split into lines, not triple-spaced", () => {
    expect(parseAnnotation({ level: "error", content: "first\nsecond\r\nthird\n\n" })).toMatchObject({
      content: "first\nsecond\nthird",
    });
  });
});
