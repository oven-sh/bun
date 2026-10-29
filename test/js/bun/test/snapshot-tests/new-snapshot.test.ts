import { describe, expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, tempDir, tmpdirSync } from "harness";
import { join } from "path";

test("it will create a snapshot file and directory if they don't exist", () => {
  const tempDir = tmpdirSync();
  fs.rmSync(tempDir, { force: true, recursive: true });
  fs.mkdirSync(tempDir, { recursive: true });

  fs.copyFileSync(import.meta.dir + "/new-snapshot.ts", tempDir + "/new-snapshot.test.ts");
  const { exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "test"],
    cwd: tempDir,
    env: { ...bunEnv, CI: "false" },
  });

  expect(exitCode).toBe(0);
  expect(fs.existsSync(tempDir + "/__snapshots__/new-snapshot.test.ts.snap")).toBe(true);

  // remove the snapshot file but leave the directory and test again.
  fs.rmSync(tempDir + "/__snapshots__/new-snapshot.test.ts.snap", { force: true });
  const { exitCode: exitCode2 } = Bun.spawnSync({
    cmd: [bunExe(), "test"],
    cwd: tempDir,
    env: { ...bunEnv, CI: "false" },
  });

  expect(exitCode2).toBe(0);
  expect(fs.existsSync(tempDir + "/__snapshots__/new-snapshot.test.ts.snap")).toBe(true);
});

test("--update-snapshots keeps the old file until the new contents are written", async () => {
  const header = "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n";
  const before = header + '\nexports[`one 1`] = `"old"`;\n\nexports[`removed 1`] = `"old"`;\n';
  using dir = tempDir("snapshot-update-bail", {
    "a.test.ts": `
      import { test, expect } from "bun:test";
      test("one", () => { expect("new").toMatchSnapshot(); });
      test("fails", () => { expect(process.env.FAIL).toBeUndefined(); });
    `,
    "__snapshots__/a.test.ts.snap": before,
  });
  async function update(env: Record<string, string>) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--update-snapshots", "--bail"],
      cwd: String(dir),
      env: { ...bunEnv, CI: "false", ...env },
      stdout: "ignore",
      stderr: "ignore",
    });
    return { exitCode: await proc.exited, snap: fs.readFileSync(`${dir}/__snapshots__/a.test.ts.snap`, "utf8") };
  }
  expect(await update({ FAIL: "1" })).toEqual({ exitCode: 1, snap: before });
  expect(await update({})).toEqual({ exitCode: 0, snap: header + '\nexports[`one 1`] = `"new"`;\n' });
});

// Bun does not transpile a file that starts with `// @bun` (what `bun build --target=bun` writes). JSC runs the bytes
// on disk, as Latin-1, and reports a call at the end of its callee.
describe.concurrent("inline snapshots in a `// @bun` test file", () => {
  async function bunTest(cwd: string, ...args: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", ...args],
      env: { ...bunEnv, CI: "false" },
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }
  function read(dir: string, names: string[]) {
    return Object.fromEntries(names.map(name => [name, fs.readFileSync(join(dir, name), "utf8")]));
  }
  // `code(v)` has `v(literal)` in the arguments of each matcher call: nothing before the run, `literal` after it.
  function beforeAndAfter(code: (v: (literal: string) => string) => string) {
    return { before: code(() => ""), after: code(literal => literal) };
  }
  const one = (prefix: string, name: string, suffix = "") =>
    beforeAndAfter(
      v =>
        `${prefix}import { test, expect } from "bun:test";\n` +
        `test("${name}", () => {\n` +
        `  expect("${name}").toMatchInlineSnapshot(${v('`"' + name + '"`')});\n` +
        `});\n${suffix}`,
    );
  // Line 4, where `one()` has its matcher call, is line 43 of another file.
  const sourceMap = JSON.stringify({
    version: 3,
    sources: ["orig.test.ts"],
    sourcesContent: ["x"],
    names: [],
    mappings: ";;;AA0CA",
  });

  const handWritten: Record<string, { before: string; after: string }> = {
    "forms.test.js": beforeAndAfter(
      v => `// @bun
import { test, expect } from "bun:test";
test("forms", async () => {
  expect(1 + 1).toMatchInlineSnapshot(${v("`2`")});
  expect(() => {
    throw new Error("boom");
  }).toThrowErrorMatchingInlineSnapshot(${v('`"boom"`')});
  await expect(Promise.resolve("resolved")).resolves.toMatchInlineSnapshot(${v('`"resolved"`')});
  expect({ a: 1, d: new Date() }).toMatchInlineSnapshot({ d: expect.any(Date) }${v(', `\n    {\n      "a": 1,\n      "d": Any<Date>,\n    }\n  `')});
  expect("a").toMatchInlineSnapshot(${v('`"a"`')}); expect("b").toMatchInlineSnapshot(${v('`"b"`')}); expect("c").toMatchInlineSnapshot(${v('`"c"`')});
  expect("spaced") . toMatchInlineSnapshot ( ${v('`"spaced"`')}) ;
  expect("next line")
    .toMatchInlineSnapshot(${v('`"next line"`')});
  expect("h\\xE9llo \\u{1F600}").toMatchInlineSnapshot(${v('`"h\\xE9llo \\uD83D\\uDE00"`')});
});
`,
    ),
    "sidecar-map.test.js": one("// @bun\n", "sidecar map", "//# sourceMappingURL=sidecar-map.test.js.map\n"),
    "inline-map.test.js": one(
      "// @bun\n",
      "inline map",
      `//# sourceMappingURL=data:application/json;base64,${Buffer.from(sourceMap).toString("base64")}\n`,
    ),
    "missing-map.test.js": one("// @bun\n", "missing map", "//# sourceMappingURL=missing.map\n"),
    "cjs.test.js": beforeAndAfter(
      v => `// @bun @bun-cjs
(function(exports, require, module, __filename, __dirname) {var import_bun_test = require("bun:test");
import_bun_test.test("cjs", () => {
  import_bun_test.expect("cjs").toMatchInlineSnapshot(${v('`"cjs"`')});
});
})
`,
    ),
    "hashbang.test.js": one("#!/usr/bin/env bun\n// @bun\n", "hashbang"),
    "bom.test.js": one("\uFEFF// @bun\n", "byte order mark"),
    "crlf.test.js": (({ before, after }) => ({
      before: before.replaceAll("\n", "\r\n"),
      after: after.replaceAll("\n", "\r\n"),
    }))(one("// @bun\n", "crlf")),
    // A column of JSC is a byte here, and "é" is two.
    "non-ascii.test.js": beforeAndAfter(
      v => `// @bun
import { test, expect } from "bun:test";
test("non-ascii", () => {
  const text = "éé"; expect(text.length).toMatchInlineSnapshot(${v("`4`")});
});
`,
    ),
  };
  const names = Object.keys(handWritten);
  const paths = names.map(name => `./${name}`);
  const written = Object.fromEntries(names.map(name => [name, handWritten[name].after]));
  const withSourceMap = (files: Record<string, string>) => ({ ...files, "sidecar-map.test.js.map": sourceMap });

  test("the snapshot is written at the call, whatever source map the file has", async () => {
    using dir = tempDir(
      "inline-snapshot-at-bun",
      withSourceMap(Object.fromEntries(names.map(name => [name, handWritten[name].before]))),
    );
    const { stderr, exitCode } = await bunTest(String(dir), ...paths);
    expect(stderr).not.toContain("error:");
    expect(stderr).not.toContain("sourcemap");
    expect({ files: read(String(dir), names), exitCode }).toEqual({ files: written, exitCode: 0 });
  });

  test("the next run reads the snapshot back", async () => {
    using dir = tempDir("inline-snapshot-at-bun-again", withSourceMap(written));
    const { stderr, exitCode } = await bunTest(String(dir), ...paths);
    expect(stderr).not.toContain("error:");
    expect(stderr).toContain(`\n ${names.length} pass\n 0 fail\n`);
    expect({ files: read(String(dir), names), exitCode }).toEqual({ files: written, exitCode: 0 });
  });

  test("--update-snapshots replaces a snapshot that does not match", async () => {
    const stale = {
      ...written,
      "forms.test.js": written["forms.test.js"].replace("(`2`)", "(`3`)").replace('(`"c"`)', '(`"d"`)'),
      "non-ascii.test.js": written["non-ascii.test.js"].replace("(`4`)", "(`2`)"),
    };
    expect(stale).not.toEqual(written);
    using dir = tempDir("inline-snapshot-at-bun-update", withSourceMap(stale));
    const { stderr, exitCode } = await bunTest(String(dir), "--update-snapshots", ...paths);
    expect(stderr).not.toContain("error:");
    expect({ files: read(String(dir), names), exitCode }).toEqual({ files: written, exitCode: 0 });
  });

  const helperTs = `import { expect } from "bun:test";
export type Received = unknown;
export function check(received: Received) {
  expect(received).toMatchInlineSnapshot();
}
`;
  const ownAndHelperTs = beforeAndAfter(
    v => `import { test, expect } from "bun:test";
import { check } from "./helper";
type Foo = { a: number };
interface Bar {
  b: string;
}

test("own", () => {
  const foo: Foo = { a: 1 };
  expect(foo).toMatchInlineSnapshot(${v('`\n    {\n      "a": 1,\n    }\n  `')});
});
test("helper", () => {
  check("from the helper");
});
`,
  );
  // What `bun build --target=bun --sourcemap=linked <entry> --outdir <outdir>` writes.
  async function build(entry: string, outdir: string, options: Partial<Bun.BuildConfig> = {}) {
    const { success, logs } = await Bun.build({
      entrypoints: [entry],
      outdir,
      target: "bun",
      sourcemap: "linked",
      ...options,
    });
    expect({ success, logs }).toEqual({ success: true, logs: [] });
  }
  // `bundle` with a literal in each matcher call, in the order the calls are written.
  function withLiterals(bundle: string, literals: string[]) {
    expect(bundle).toStartWith("// @bun");
    const parts = bundle.split("toMatchInlineSnapshot()");
    expect(parts).toBeArrayOfSize(literals.length + 1);
    return parts.map((part, i) => (i === 0 ? part : `toMatchInlineSnapshot(${literals[i - 1]})${part}`)).join("");
  }

  test("a bundle of a test and its helper gets both snapshots, and its sources get none", async () => {
    using dir = tempDir("inline-snapshot-at-bun-bundle", {
      "src/x.test.ts": ownAndHelperTs.before,
      "src/helper.ts": helperTs,
    });
    const cwd = String(dir);
    await build(join(cwd, "src", "x.test.ts"), join(cwd, "dist"));
    const map = fs.readFileSync(join(cwd, "dist", "x.test.js.map"), "utf8");
    expect(JSON.parse(map).sources).toEqual(["../src/x.test.ts", "../src/helper.ts"]);
    const after = {
      "dist/x.test.js": withLiterals(fs.readFileSync(join(cwd, "dist", "x.test.js"), "utf8"), [
        '`"from the helper"`',
        '`\n    {\n      "a": 1,\n    }\n  `',
      ]),
      "dist/x.test.js.map": map,
      "src/x.test.ts": ownAndHelperTs.before,
      "src/helper.ts": helperTs,
    };

    // The JUnit reporter asks for the line of each test(), which loads the source map before a matcher runs.
    const { stderr, exitCode } = await bunTest(cwd, "./dist/x.test.js", "--reporter=junit", "--reporter-outfile=j.xml");
    expect(stderr).not.toContain("error:");
    expect({ files: read(cwd, Object.keys(after)), exitCode }).toEqual({ files: after, exitCode: 0 });
  });

  test("a bundle that replaced its source gets the snapshot at the call that made it", async () => {
    using dir = tempDir("inline-snapshot-at-bun-in-place", {
      "x.test.js": `import { test, expect } from "bun:test";
test("in place", () => {
  expect(1).toMatchInlineSnapshot(\`1\`);
  expect(2).toMatchInlineSnapshot(\`2\`);
  expect(3).toMatchInlineSnapshot();
});
`,
    });
    const cwd = String(dir);
    await build(join(cwd, "x.test.js"), cwd);
    expect(JSON.parse(fs.readFileSync(join(cwd, "x.test.js.map"), "utf8")).sources).toEqual(["x.test.js"]);
    const after = withLiterals(fs.readFileSync(join(cwd, "x.test.js"), "utf8"), ["`3`"]);

    const { stderr, exitCode } = await bunTest(cwd, "./x.test.js");
    expect(stderr).not.toContain("error:");
    expect({ file: fs.readFileSync(join(cwd, "x.test.js"), "utf8"), exitCode }).toEqual({ file: after, exitCode: 0 });
  });

  // The bytecode of such a bundle is of the text before the snapshot was written.
  for (const textIsNewer of [false, true]) {
    const title = textIsNewer
      ? "a bundle with bytecode runs its text once a snapshot was written into it"
      : "a bundle with bytecode gets the snapshot";
    test(title, async () => {
      using dir = tempDir("inline-snapshot-at-bun-bytecode", { "src/x.test.ts": one("", "bytecode").before });
      const cwd = String(dir);
      await build(join(cwd, "src", "x.test.ts"), join(cwd, "dist"), { format: "cjs", bytecode: true });
      const bundle = fs.readFileSync(join(cwd, "dist", "x.test.js"), "utf8");
      expect(bundle).toStartWith("// @bun @bytecode @bun-cjs\n");
      const after = withLiterals(bundle, ['`"bytecode"`']);
      if (textIsNewer) fs.writeFileSync(join(cwd, "dist", "x.test.js"), after);

      const { stderr, exitCode } = await bunTest(cwd, "./dist/x.test.js");
      expect(stderr).not.toContain("error:");
      expect(stderr).toContain("\n 1 pass\n 0 fail\n");
      expect({ file: fs.readFileSync(join(cwd, "dist", "x.test.js"), "utf8"), exitCode }).toEqual({
        file: after,
        exitCode: 0,
      });
    });
  }

  test("a call that does not name the matcher, or that another file makes, is refused", async () => {
    const files = {
      "names.test.js": `// @bun
import { test, expect } from "bun:test";
test("computed name", () => {
  expect(1)["toMatchInlineSnapshot"]();
});
test("escaped name", () => {
  expect(2).t\\u{6f}MatchInlineSnapshot();
});
test("longer name", () => {
  const received = expect(3);
  received.$toMatchInlineSnapshot = received.toMatchInlineSnapshot;
  received.$toMatchInlineSnapshot();
});
`,
      "other-file.test.js": `// @bun
import { test } from "bun:test";
import { check } from "./helper.ts";
test("other file", () => {
  check("from the helper");
});
`,
      "helper.ts": helperTs,
    };
    using dir = tempDir("inline-snapshot-at-bun-refused", files);
    const cwd = String(dir);

    const { stderr, exitCode } = await bunTest(cwd, "./names.test.js", "./other-file.test.js");
    const notFound = "error: Failed to update inline snapshot: Could not find 'toMatchInlineSnapshot' here";
    expect(stderr.split(notFound)).toBeArrayOfSize(4);
    expect(stderr).toContain("Inline snapshot matchers must be called from the test file");
    expect(stderr).toMatch(/toMatchInlineSnapshot called from file: "[^"\n]*helper\.ts"/);
    expect({ files: read(cwd, Object.keys(files)), exitCode }).toEqual({ files, exitCode: 1 });
  });

  // The text of these two modules is not the test file: a position in it is not a position in the file, and the
  // source map of the bundle is what leads to the file.
  test("a bundle that a plugin returns for the test file gets no snapshot: the test file does", async () => {
    using dir = tempDir("inline-snapshot-at-bun-plugin", {
      "x.test.ts": ownAndHelperTs.before,
      "helper.ts": helperTs,
      "preload.ts": `import { plugin } from "bun";
plugin({
  name: "bundle the test",
  setup(builder) {
    builder.onLoad({ filter: /x\\.test\\.ts$/ }, async ({ path }) => {
      const { outputs } = await Bun.build({ entrypoints: [path], target: "bun", sourcemap: "inline" });
      return { contents: await outputs[0].text(), loader: "js" };
    });
  },
});
`,
    });
    const cwd = String(dir);

    const { stderr, exitCode } = await bunTest(cwd, "--preload", "./preload.ts", "./x.test.ts");
    expect(stderr).toContain("Inline snapshot matchers must be called from the test file");
    expect(stderr).toMatch(/toMatchInlineSnapshot called from file: "[^"\n]*helper\.ts"/);
    expect({ files: read(cwd, ["x.test.ts", "helper.ts"]), exitCode }).toEqual({
      files: { "x.test.ts": ownAndHelperTs.after, "helper.ts": helperTs },
      exitCode: 1,
    });
  });

  test("a bundle that a plugin resolves the test file to gets no snapshot: the test file does", async () => {
    const source = one("", "redirected");
    using dir = tempDir("inline-snapshot-at-bun-redirect", {
      "src/x.test.ts": `type Unused = never;\n\n${source.before}`,
      "preload.ts": `import { plugin } from "bun";
import { join } from "node:path";
plugin({
  name: "run the bundle",
  setup(builder) {
    builder.onResolve({ filter: /x\\.test\\.ts$/ }, () => ({ path: join(import.meta.dir, "dist", "x.test.js") }));
  },
});
`,
    });
    const cwd = String(dir);
    await build(join(cwd, "src", "x.test.ts"), join(cwd, "dist"));
    const bundle = fs.readFileSync(join(cwd, "dist", "x.test.js"), "utf8");
    expect(bundle).toStartWith("// @bun\n");

    const { stderr, exitCode } = await bunTest(cwd, "--preload", "./preload.ts", "./src/x.test.ts");
    expect(stderr).not.toContain("error:");
    expect({ files: read(cwd, ["src/x.test.ts", "dist/x.test.js"]), exitCode }).toEqual({
      files: { "src/x.test.ts": `type Unused = never;\n\n${source.after}`, "dist/x.test.js": bundle },
      exitCode: 0,
    });
  });
});
