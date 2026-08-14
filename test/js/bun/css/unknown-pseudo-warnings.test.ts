import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { join } from "node:path";

// An unknown pseudo-class or pseudo-element is kept as written and warned
// about unless its name carries a vendor prefix (`:-moz-foo`), the rule
// lightningcss uses. `:foo` used to warn only when the name started with `_`,
// while `:foo()`, `::foo` and `::foo()` already followed the vendor-prefix rule.

async function build(fileName: string, css: string) {
  using dir = tempDir("css-unknown-pseudo", { [fileName]: css });
  const result = await Bun.build({ entrypoints: [join(String(dir), fileName)], throw: false });
  const output = result.success ? await result.outputs[0].text() : null;
  return {
    success: result.success,
    logs: result.logs.map(log => `${log.level}: ${log.message}`),
    // Drop the leading `/* <path relative to cwd> */` comment.
    output: output === null ? null : output.slice(output.indexOf("\n") + 1),
  };
}

function unsupported(name: string) {
  return `warn: Invalid selector. Unsupported pseudo-class or pseudo-element '${name}'`;
}

describe.concurrent("unknown pseudo-classes and pseudo-elements", () => {
  test.each([
    ["a:weird", [unsupported("weird")]],
    ["a:weird(x)", [unsupported("weird")]],
    ["a::weird", [unsupported("weird")]],
    ["a::weird(x)", [unsupported("weird")]],
    ["a:_weird", [unsupported("_weird")]],
    ["a:-x-weird", []],
    ["a:-x-weird(x)", []],
    ["a::-x-weird", []],
    ["a::-x-weird(x)", []],
  ])("%s is kept as written and warns unless vendor prefixed", async (selector, logs) => {
    expect(await build("in.css", `${selector} { color: red }`)).toEqual({
      success: true,
      logs,
      output: `${selector} {\n  color: red;\n}\n`,
    });
  });

  test("every occurrence warns, wherever the pseudo-class appears in the selector", async () => {
    const css = [
      "a:not(:weird) { color: red }",
      "a:is(:weird, .x) { color: red }",
      ".a { &:weird { color: red } }",
      "a:WEIRD { color: red }",
    ].join("\n");
    const { success, logs } = await build("in.css", css);
    expect(logs).toEqual([unsupported("weird"), unsupported("weird"), unsupported("weird"), unsupported("WEIRD")]);
    expect(success).toBe(true);
  });

  test("known pseudo-classes and pseudo-elements do not warn", async () => {
    const css = [
      "a:hover, a:focus-visible, a:any-link, input:user-valid, [popover]:popover-open { color: red }",
      "dialog:modal, video:paused, my-element:defined, input:placeholder-shown, a:HOVER { color: red }",
      "input:-webkit-autofill, input:-moz-read-only, div:-webkit-full-screen { color: red }",
      ":root, li:first-child, li:nth-child(2n of .x), p:lang(en), a:not(.x), :host, a:-webkit-any(.x) { color: red }",
      "a::before, a::-webkit-scrollbar-thumb, p::first-line, ::cue(v), a::before:hover { color: red }",
      "::-webkit-scrollbar-button:horizontal:decrement { color: red }",
    ].join("\n");
    const { success, logs } = await build("in.css", css);
    expect(logs).toEqual([]);
    expect(success).toBe(true);
  });

  test("a stylesheet that is not a CSS module treats :local as an unknown pseudo-class", async () => {
    expect(await build("in.css", ":local { color: red }")).toEqual({
      success: true,
      logs: [unsupported("local")],
      output: ":local {\n  color: red;\n}\n",
    });
  });

  test.each(["global", "local"])(":%s without a selector argument is still an error in a CSS module", async name => {
    expect(await build("in.module.css", `:${name} { color: red }`)).toEqual({
      success: false,
      logs: [`error: Invalid selector. CSS module class: '${name}' is currently not supported.`],
      output: null,
    });
  });

  test("bun build reports the warnings on stderr and still emits the rules", async () => {
    using dir = tempDir("css-unknown-pseudo-cli", {
      "in.css": "a:weird { color: red }\na:-x-weird { color: red }\nb:odd { color: red }\n",
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "./in.css"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
      "warn: Invalid selector. Unsupported pseudo-class or pseudo-element 'weird'

      warn: Invalid selector. Unsupported pseudo-class or pseudo-element 'odd'"
    `);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "/* in.css */
      a:weird {
        color: red;
      }

      a:-x-weird {
        color: red;
      }

      b:odd {
        color: red;
      }"
    `);
    expect(exitCode).toBe(0);
  });
});
