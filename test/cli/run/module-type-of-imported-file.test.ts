import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// "type" in package.json -> extension -> what a file is whose text says neither
const byExtension = { cjs: "commonjs", cts: "commonjs", mjs: "module", mts: "module", jsx: "module", tsx: "module" };
const table = {
  commonjs: { ...byExtension, js: "commonjs", ts: "commonjs" },
  module: { ...byExtension, js: "module", ts: "module" },
  none: { ...byExtension, js: "module", ts: "module" },
};
const rows = Object.entries(table).flatMap(([type, kinds]) =>
  Object.entries(kinds).map(([extension, kind]) => ({ path: `./${type}/hello.${extension}`, kind })),
);
const files = {
  "commonjs/package.json": `{ "type": "commonjs" }`,
  "module/package.json": `{ "type": "module" }`,
  "none/package.json": `{}`,
  ...Object.fromEntries(
    rows.map(({ path }) => [
      path,
      `console.log(${JSON.stringify(path)}, eval("typeof module") === "undefined" ? "module" : "commonjs");`,
    ]),
  ),
};

// The transpiler threads load the first two, the JS thread the third.
test.concurrent.each([
  ["import", (path: string) => `import ${path};`],
  ["import()", (path: string) => `await import(${path});`],
  ["require()", (path: string) => `require(${path});`],
])("%s takes a file for what its extension and its package say", async (_, load) => {
  using dir = tempDir("module-type-of-imported-file", {
    ...files,
    "main.mjs": rows.map(row => load(JSON.stringify(row.path))).join("\n"),
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stderr, kinds: stdout.trim().split("\n").sort() }).toEqual({
    stderr: "",
    kinds: rows.map(row => `${row.path} ${row.kind}`).sort(),
  });
  expect(exitCode).toBe(0);
});

test("imported .cjs files run in the order in which they are imported", async () => {
  const names = Array.from({ length: 8 }, (_, index) => `file-${index}`);
  using dir = tempDir("module-type-of-imported-file", {
    ...Object.fromEntries(
      names.map((name, index) => [
        `${name}.cjs`,
        // The first files take the longest to transpile.
        `console.log(${JSON.stringify(name)});\nmodule.exports = {};\n` + "// padding\n".repeat((8 - index) * 2000),
      ]),
    ),
    "main.mjs": names.map(name => `import "./${name}.cjs";`).join("\n"),
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stderr, order: stdout.trim().split("\n") }).toEqual({ stderr: "", order: names });
  expect(exitCode).toBe(0);
});
