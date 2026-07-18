// expect() failure messages must render user data verbatim: angle-bracketed
// strings (HTML/JSX/XML) were being consumed by the `<tag>` → ANSI markup pass
// because the pass ran over the rendered message instead of the template.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const fixture = /* ts */ `
import { test, expect } from "bun:test";

test("toBe html", () => {
  expect('<div class="active">Hello</div>').toBe('<div class="inactive">Hello</div>');
});
test("toContain", () => {
  expect("hello").toContain("<i>");
});
test("toHaveProperty", () => {
  expect({}).toHaveProperty("<b>key</b>");
});
test("not.toBe", () => {
  expect("<red>x</red>").not.toBe("<red>x</red>");
});
test("toThrow", () => {
  expect(() => {
    throw new Error("<u>underlined</u>");
  }).not.toThrow();
});
test("custom label", () => {
  expect("a", "<blue>label</blue>").toBe("b");
});
test("pass msg", () => {
  expect(0).not.pass("<magenta>nope</magenta>");
});
test("toBeGreaterThan glyph", () => {
  expect(1).toBeGreaterThan(2);
});
test("resolves non-promise", async () => {
  await expect("<d>plain</d>").resolves.toBe(1);
});
test("custom matcher message", () => {
  expect.extend({
    toBeFoo(received) {
      return { pass: false, message: () => "want <i>foo</i> got " + received };
    },
  });
  // @ts-ignore
  expect("<b>bar</b>").toBeFoo();
});
`;

async function run(env: Record<string, string | undefined>) {
  using dir = tempDir("expect-angle", { "angle.test.ts": fixture });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "angle.test.ts"],
    env: { ...bunEnv, ...env },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe("expect() failure messages preserve <...> in user data", () => {
  test("colors disabled: angle-bracketed strings render verbatim", async () => {
    const { stderr, exitCode } = await run({ NO_COLOR: "1", FORCE_COLOR: undefined });

    // toBe on HTML strings: Expected/Received must show the full string, not
    // just the text between tags.
    expect(stderr).toContain('Expected: "<div class="inactive">Hello</div>"');
    expect(stderr).toContain('Received: "<div class="active">Hello</div>"');

    // toContain("<i>"): must show the literal "<i>", not an empty span.
    expect(stderr).toContain('Expected to contain: "<i>"');

    // toHaveProperty: the path string is user data.
    expect(stderr).toContain('Expected path: "<b>key</b>"');

    // not.toBe: a string that happens to match a colour tag name.
    expect(stderr).toContain('Expected: not "<red>x</red>"');

    // toThrow: error message from a thrown Error is user data.
    expect(stderr).toContain('Error message: "<u>underlined</u>"');

    // expect(v, label): the custom label is user data. The label heads the
    // error line so match it immediately after `error: `.
    expect(stderr).toContain("error: <blue>label</blue>");

    // .not.pass(msg): the message is user data.
    expect(stderr).toContain("<magenta>nope</magenta>");

    // toBeGreaterThan: the `>` glyph must still render.
    expect(stderr).toContain("Expected: > 2");

    // .resolves on a non-promise: received value is user data.
    expect(stderr).toContain('Received: "<d>plain</d>"');

    // expect.extend: the custom matcher's returned message is user data.
    expect(stderr).toContain("want <i>foo</i> got <b>bar</b>");

    expect(exitCode).toBe(1);
  });

  test("colors enabled: user data is not interpreted as ANSI markup", async () => {
    const { stderr, exitCode } = await run({ FORCE_COLOR: "1", NO_COLOR: undefined });

    // `<i>` → `\x1b[3m` would be the bug: user data interpreted as markup.
    // Match the exact `"<payload>"` span the failure message emits.
    expect(stderr).not.toContain('"\x1b[3m"');
    // With the fix the green-wrapped expected value is the literal "<i>".
    expect(stderr).toContain('\x1b[32m"<i>"\x1b[0m');

    // toBe on HTML strings: the diff body (not the source snippet) must carry
    // the tag text. The diff colours the changed span mid-string, so match the
    // trailing `…Hello</div>"` + reset which is common to both and proves the
    // `</div>` was not stripped.
    expect(stderr).toContain('active">Hello</div>"\x1b[0m');
    expect(stderr).toContain('\x1b[32m"<div class="');

    // `<red>` in user data must not become a red escape inside the quoted
    // value; it must appear literally after the *template's* green escape.
    expect(stderr).toContain('\x1b[32m"<red>x</red>"\x1b[0m');

    // The custom label is user data — must not emit a blue escape. The label
    // heads the bold error line.
    expect(stderr).toContain("\x1b[1m<blue>label</blue>");

    // `<d>` in user data must not emit a dim escape inside the quoted value.
    expect(stderr).toContain('"<d>plain</d>"');

    // Custom matcher returned message is user data.
    expect(stderr).toContain("want <i>foo</i> got <b>bar</b>");

    // Template markup (the green around Expected values) must still work.
    expect(stderr).toContain("\x1b[32m");

    expect(exitCode).toBe(1);
  });
});
