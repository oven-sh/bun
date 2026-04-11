import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

async function runBundle(dir: string, entry: string) {
  const build = await Bun.build({
    entrypoints: [dir + "/" + entry],
    target: "bun",
  });
  expect(build.success).toBe(true);
  expect(build.outputs.length).toBe(1);
  const code = await build.outputs[0].text();

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe("XML bundler", () => {
  test("bundles .xml imports", async () => {
    using dir = tempDir("xml-bundler", {
      "data.xml": `<?xml version="1.0"?><root id="1"><item>a</item><item>b</item></root>`,
      "entry.ts": `
        import data from "./data.xml";
        console.log(JSON.stringify(data));
      `,
    });

    const { stdout, exitCode } = await runBundle(String(dir), "entry.ts");
    expect(JSON.parse(stdout.trim())).toEqual({
      root: { "@id": "1", item: ["a", "b"] },
    });
    expect(exitCode).toBe(0);
  });

  test("bundles with { type: 'xml' } attribute", async () => {
    using dir = tempDir("xml-bundler-attr", {
      "data.txt": `<root><v>hello</v></root>`,
      "entry.ts": `
        import data from "./data.txt" with { type: "xml" };
        console.log(JSON.stringify(data));
      `,
    });

    const { stdout, exitCode } = await runBundle(String(dir), "entry.ts");
    expect(JSON.parse(stdout.trim())).toEqual({ root: { v: "hello" } });
    expect(exitCode).toBe(0);
  });

  test("reports parse errors with location", async () => {
    using dir = tempDir("xml-bundler-err", {
      "bad.xml": `<root><unclosed></root>`,
      "entry.ts": `import data from "./bad.xml"; console.log(data);`,
    });

    let errStr = "";
    try {
      const build = await Bun.build({
        entrypoints: [String(dir) + "/entry.ts"],
        target: "bun",
      });
      expect(build.success).toBe(false);
      errStr = build.logs.map(l => String(l.message ?? l)).join("\n");
    } catch (e: any) {
      // Bun.build throws an AggregateError when the build fails.
      errStr = String(e?.message ?? e) + "\n" + (e?.errors?.map((x: any) => String(x?.message ?? x)).join("\n") ?? "");
    }
    expect(errStr).toContain("Closing tag does not match");
  });

  test("bundled xml with non-identifier keys (#text, @attr) prints correctly", async () => {
    // Regression analogue of TOML #17926 (numeric/special keys).
    using dir = tempDir("xml-bundler-special", {
      "data.xml": `<r a="1">hello</r>`,
      "entry.ts": `
        import data from "./data.xml";
        console.log(JSON.stringify(data));
      `,
    });

    const { stdout, exitCode } = await runBundle(String(dir), "entry.ts");
    expect(JSON.parse(stdout.trim())).toEqual({ r: { "@a": "1", "#text": "hello" } });
    expect(exitCode).toBe(0);
  });
});
