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

// `::error file=..,line=..,col=..,title=..::message` lines: what `bun test`
// prints for a failure when GITHUB_ACTIONS is set (property values escape
// `%` `\r` `\n` `:` `,` as %25 %0D %0A %3A %2C; the message only escapes the
// first three), and what workflow steps print by hand (`echo "::error::msg"`).
describe("GitHub Actions workflow commands", () => {
  test("a bun test failure becomes an annotation titled by its title= property", () => {
    const line =
      "::error file=test/odd%2Cname%25.test.ts,line=3,col=5,title=error: ENOENT%3A no such file%2C open '100%25'" +
      '::Expected: "::1"%0A      at f (test/odd,name%.test.ts:3:5)';

    const { annotations, content } = parseAnnotations(["before", line, "after"].join("\n"));
    expect(annotations).toEqual([
      {
        source: undefined,
        level: "error",
        title: "error: ENOENT: no such file, open '100%'",
        filename: "test/odd,name%.test.ts",
        line: 3,
        column: 5,
        // The message runs from the first `::` after the properties, so a `::`
        // inside it stays in the body instead of being taken for the separator.
        content: 'Expected: "::1"\n      at f (test/odd,name%.test.ts:3:5)',
        metadata: {},
      },
    ]);
    expect(content).toBe("before\nafter");
  });

  test("title= is optional: the level names the annotation", () => {
    expect(parseAnnotations("::error file=app.js,line=1::Missing semicolon").annotations).toEqual([
      {
        level: "error",
        title: "error",
        filename: "app.js",
        line: 1,
        column: undefined,
        content: "Missing semicolon",
        metadata: {},
      },
    ]);
  });

  test("the whole property list is optional", () => {
    expect(parseAnnotations("::warning::Prettier failed\n::notice::100%25 done%0Asecond line").annotations).toEqual([
      { level: "warning", title: "warning", content: "Prettier failed", metadata: {} },
      { level: "notice", title: "notice", content: "100% done\nsecond line", metadata: {} },
    ]);
  });

  test("a property value may contain '=' and the message may be empty", () => {
    // bun test's timeout line.
    expect(parseAnnotations('::error title=error: Test "a = b" timed out after 5000ms::').annotations).toEqual([
      {
        level: "error",
        title: 'error: Test "a = b" timed out after 5000ms',
        filename: undefined,
        line: undefined,
        column: undefined,
        content: "",
        metadata: {},
      },
    ]);
  });

  test("a bare workflow command line does not cost the build its compiler annotations", () => {
    // ci.ts parses the whole captured output of a failed build in one call and
    // falls back to a single generic annotation if that call throws.
    const clang = ["src/jsc/bindings/Foo.cpp:12:5: error: use of undeclared identifier 'bar'", "1 error generated."];
    const { annotations } = parseAnnotations([...clang, "::error::ninja failed"].join("\n"));
    expect(annotations.map(({ source, title, content }) => ({ source, title, content }))).toEqual([
      { source: "clang", title: "clang error", content: clang.join("\n") },
      { source: undefined, title: "error", content: "ninja failed" },
    ]);
  });

  test("escapes are decoded in one pass, and %3A/%2C only where they are escapes", () => {
    expect(parseAnnotations("::error title=a%3Ab%2Cc%25 %250A::x%3Ay%2Cz%25 %250A").annotations).toEqual([
      {
        level: "error",
        // "%250A" is an escaped literal "%0A", not a newline.
        title: "a:b,c% %0A",
        // The message is not delimited by `:` or `,`, so writers leave them raw
        // there and a literal "%3A" in a message is data.
        content: "x%3Ay%2Cz% %0A",
        metadata: {},
      },
    ]);
  });

  test("other commands and non-commands are not annotations", () => {
    const output = [
      "::group::build",
      "::set-output name=x::1",
      "::error file=a.ts", // no closing `::`
      "::errors::not a command",
      "::endgroup::",
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
