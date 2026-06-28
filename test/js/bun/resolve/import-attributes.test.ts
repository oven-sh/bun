import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// tc39/proposal-import-attributes: the same specifier imported with different
// `with { type }` attributes designates different modules, so the module
// registry key must include the attribute. Without that, every Bun-defined
// attribute type collapsed onto one registry entry and whichever import
// evaluated first decided what every other attribute form received.
// https://github.com/oven-sh/bun/issues/19834
// https://github.com/oven-sh/WebKit/pull/258

/** Runs `files["index.ts"]` as a module in a temp dir and parses its JSON stdout. */
async function run(prefix: string, files: Record<string, string>) {
  using dir = tempDir(prefix, files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) {
    throw new Error(`bun exited with ${exitCode}\n--- stderr ---\n${stderr}\n--- stdout ---\n${stdout}`);
  }
  return JSON.parse(stdout);
}

const dataTxt = { "data.txt": "hello\n" };

// `type: "text"` yields the file contents and `type: "file"` yields the
// absolute path. The expected path is computed inside the child so the
// assertion is independent of tempDir symlink resolution. Both orders are
// covered because the bug was order dependent: whichever import ran first
// decided what both received.
test.each([
  ["text", "file"],
  ["file", "text"],
] as const)(
  "dynamic import of one path with type %s then type %s yields two distinct modules",
  async (first, second) => {
    const out = await run("import-attr-key", {
      ...dataTxt,
      "index.ts": /* ts */ `
      import { join } from "node:path";
      const a = await import("./data.txt", { with: { type: ${JSON.stringify(first)} } });
      const b = await import("./data.txt", { with: { type: ${JSON.stringify(second)} } });
      console.log(JSON.stringify({
        abs: join(import.meta.dir, "data.txt"),
        ${JSON.stringify(first)}: a.default,
        ${JSON.stringify(second)}: b.default,
        sameNamespace: a === b,
      }));
    `,
    });
    const { abs, ...rest } = out;
    expect(rest).toEqual({ text: "hello\n", file: abs, sameNamespace: false });
  },
);

// Negative contract: repeating the same attribute must still dedupe to one module.
test("repeating the same attribute still resolves to one shared module", async () => {
  const out = await run("import-attr-dedup", {
    ...dataTxt,
    "index.ts": /* ts */ `
      const a = await import("./data.txt", { with: { type: "text" } });
      const b = await import("./data.txt", { with: { type: "file" } });
      const a2 = await import("./data.txt", { with: { type: "text" } });
      const b2 = await import("./data.txt", { with: { type: "file" } });
      console.log(JSON.stringify({
        text: a.default,
        textAgainIsSame: a === a2,
        fileAgainIsSame: b === b2,
        textAndFileAreSame: a === b,
      }));
    `,
  });
  expect(out).toEqual({
    text: "hello\n",
    textAgainIsSame: true,
    fileAgainIsSame: true,
    textAndFileAreSame: false,
  });
});

// Namespace identity is asserted instead of each loader's value so this test
// does not depend on what `type: "base64"` happens to produce for a .txt file.
test("three different attribute types on one path yield three distinct module namespaces", async () => {
  const out = await run("import-attr-three", {
    ...dataTxt,
    "index.ts": /* ts */ `
      const text = await import("./data.txt", { with: { type: "text" } });
      const file = await import("./data.txt", { with: { type: "file" } });
      const base64 = await import("./data.txt", { with: { type: "base64" } });
      console.log(JSON.stringify({
        text: text.default,
        textVsFile: text === file,
        fileVsBase64: file === base64,
        textVsBase64: text === base64,
      }));
    `,
  });
  expect(out).toEqual({
    text: "hello\n",
    textVsFile: false,
    fileVsBase64: false,
    textVsBase64: false,
  });
});

// https://github.com/oven-sh/bun/issues/19834
// The bare import (no attribute) resolves to an HTMLBundle, `type: "html"`
// also resolves to an HTMLBundle (via its own registry entry), and
// `type: "file"` resolves to the path string. All three must be distinct
// modules. The bare form keys on a different Type enum value than the
// attributed forms; "html" and "file" both key on Type::HostDefined and are
// only distinguished by the attribute string, in either order.
test.each([
  ["html", "file"],
  ["file", "html"],
] as const)("an .html imported with no attribute, type %s, and type %s yields three modules", async (first, second) => {
  const out = await run("import-attr-html", {
    "index.html": "<!doctype html><title>x</title>\n",
    "index.ts": /* ts */ `
      import { join } from "node:path";
      const bare = await import("./index.html");
      const a = await import("./index.html", { with: { type: ${JSON.stringify(first)} } });
      const b = await import("./index.html", { with: { type: ${JSON.stringify(second)} } });
      const shape = ns => typeof ns.default === "string" ? "path:" + ns.default : "bundle:" + ns.default.index;
      console.log(JSON.stringify({
        abs: join(import.meta.dir, "index.html"),
        bare: shape(bare),
        ${JSON.stringify(first)}: shape(a),
        ${JSON.stringify(second)}: shape(b),
        bareVsFirst: bare === a,
        firstVsSecond: a === b,
      }));
    `,
  });
  const { abs, ...rest } = out;
  expect(rest).toEqual({
    bare: `bundle:${abs}`,
    html: `bundle:${abs}`,
    file: `path:${abs}`,
    bareVsFirst: false,
    firstVsSecond: false,
  });
});
