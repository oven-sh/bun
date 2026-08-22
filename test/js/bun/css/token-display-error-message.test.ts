import { cssInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const { minifyTest } = cssInternals;

function parseError(src: string): string {
  try {
    minifyTest(src, "");
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error(`expected parse error for: ${src}`);
}

describe("CSS parse errors render the full token shape", () => {
  test("hash token (#foo, #123)", () => {
    expect(parseError("@media screen and #foo {}")).toBe("parsing failed: Unexpected token: #foo");
    expect(parseError("@media screen and #123 {}")).toBe("parsing failed: Unexpected token: #123");
  });

  test("at-keyword token (@foo)", () => {
    expect(parseError("@media screen and @foo {}")).toBe("parsing failed: Unexpected token: @foo");
  });

  test("function token (foo()", () => {
    expect(parseError("@media screen and foo() {}")).toBe("parsing failed: Unexpected token: foo(");
  });

  test('quoted-string token ("bar")', () => {
    expect(parseError('@media screen and "bar" {}')).toBe('parsing failed: Unexpected token: "bar"');
  });

  test("bad-url token (url(a b))", () => {
    expect(parseError("a { background: url(a b) }")).toBe("parsing failed: Unexpected token: url(a b)");
  });

  test("selector errors that embed a token", () => {
    expect(parseError("[@foo] {}")).toBe(
      "parsing failed: Invalid selector. Missing qualified name in attribute selector: @foo",
    );
    expect(parseError("a[b=#foo] {}")).toBe(
      "parsing failed: Invalid selector. Invalid value in attribute selector: #foo",
    );
  });
});

test("`bun build` surfaces the full token shape in the CLI diagnostic", async () => {
  using dir = tempDir("css-token-display", {
    "entry.css": "@media screen and #foo { a { b: 1 } }\n",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "entry.css"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "",
    stderr: expect.stringContaining("error: Unexpected token: #foo"),
    exitCode: 1,
  });
});
