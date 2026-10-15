import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";

// A pseudo-class or a pseudo-element can follow ::details-content and
// ::picker(), as after ::part(). 1.4.0 built these sheets. 1.4.1 refused the
// first and the third, and emptied the :is() in the second.
const partLikeSheets = {
  "select.css": `
    .label { color: red }
    select, ::picker(select) { appearance: base-select }
    ::picker(select) { opacity: 0; transition: opacity 0.4s }
    ::picker(select):popover-open { opacity: 1 }
    @starting-style { ::picker(select):popover-open { opacity: 0 } }
    .footer { color: blue }
  `,
  "is.css": `::picker(select):is(:popover-open) { opacity: 1 }`,
  "details.css": `details::details-content::before { content: "" }`,
};
const partLikeMinified = {
  "select.css":
    ".label{color:red}select{appearance:base-select}::picker(select){appearance:base-select}::picker(select){opacity:0;transition:opacity .4s}::picker(select):popover-open{opacity:1}@starting-style{::picker(select):popover-open{opacity:0}}.footer{color:#00f}",
  "is.css": "::picker(select):popover-open{opacity:1}",
  "details.css": 'details::details-content:before{content:""}',
};

// https://github.com/oven-sh/bun/issues/41120
// ::details-content, ::picker(), ::checkmark and ::picker-icon are known
// pseudo-elements (css-pseudo-4 and css-forms-1, also in lightningcss's
// tables). Bundling them must not emit an "Unsupported pseudo-class or
// pseudo-element" warning.
describe("css", () => {
  test("known form pseudo-elements do not warn (#41120)", async () => {
    using dir = tempDir("css-41120", {
      "in.css": `
        .a::details-content { height: auto }
        .b::picker(select) { border: none }
        .c::checkmark { color: teal }
        .d::picker-icon { rotate: 90deg }
      `,
    });
    const result = await Bun.build({
      entrypoints: [path.join(String(dir), "in.css")],
      minify: true,
      throw: true,
    });
    expect(result.logs.map(String)).toEqual([]);
    const out = await result.outputs[0].text();
    expect(out.trim()).toBe(
      ".a::details-content{height:auto}.b::picker(select){border:none}.c::checkmark{color:teal}.d::picker-icon{rotate:90deg}",
    );
  });

  test("the pseudo-element lookup is case-insensitive (#41120)", async () => {
    using dir = tempDir("css-41120-case", {
      "in.css": `
        .a::DETAILS-CONTENT { height: auto }
        .b::Checkmark { color: teal }
      `,
    });
    const result = await Bun.build({
      entrypoints: [path.join(String(dir), "in.css")],
      minify: true,
      throw: true,
    });
    expect(result.logs.map(String)).toEqual([]);
    const out = await result.outputs[0].text();
    expect(out.trim()).toBe(".a::details-content{height:auto}.b::checkmark{color:teal}");
  });

  test.concurrent("a pseudo-class or a pseudo-element after ::picker() and ::details-content builds", async () => {
    using dir = tempDir("css-part-like", partLikeSheets);
    const result = await Bun.build({
      entrypoints: Object.keys(partLikeSheets).map(file => path.join(String(dir), file)),
      minify: true,
      throw: true,
    });
    expect(result.logs.map(String)).toEqual([]);
    const outputs = await Promise.all(
      result.outputs.map(async output => [path.basename(output.path), (await output.text()).trim()]),
    );
    expect(Object.fromEntries(outputs)).toEqual(partLikeMinified);
  });

  test.concurrent("bun build writes a sheet that has ::picker(select):popover-open", async () => {
    using dir = tempDir("css-part-like-cli", partLikeSheets);
    const files = Object.keys(partLikeSheets);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", ...files.map(file => `./${file}`), "--minify", "--outdir", "out"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const written = await Promise.all(
      files.map(async file => [file, (await Bun.file(path.join(String(dir), "out", file)).text()).trim()]),
    );
    expect(Object.fromEntries(written)).toEqual(partLikeMinified);
    expect(exitCode).toBe(0);
  });

  // Nesting is lowered to `::picker(select):popover-open`. That output is a
  // valid sheet, so a second build of it gives the same bytes.
  test.concurrent("the lowered form of a rule nested in ::picker() builds again", async () => {
    using dir = tempDir("css-part-like-nested", {
      "nested.css": `::picker(select) { opacity: 0; &:popover-open { opacity: 1 } }`,
    });
    const build = async (file: string) => {
      const result = await Bun.build({ entrypoints: [path.join(String(dir), file)], minify: true, throw: true });
      expect(result.logs.map(String)).toEqual([]);
      return (await result.outputs[0].text()).trim();
    };
    const lowered = await build("nested.css");
    expect(lowered).toBe("::picker(select){opacity:0}::picker(select):popover-open{opacity:1}");
    await Bun.write(path.join(String(dir), "lowered.css"), lowered);
    expect(await build("lowered.css")).toBe(lowered);
  });
});
