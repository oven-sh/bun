import { describe, expect, test } from "bun:test";
import { bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../aot/harness/run";
import { unsupported } from "../aot/run-programs";
import { canTrim, featureNamed, textOf, withoutFeatures } from "./compile-trim-features";

const files = {
  "no-property.ts": `
    const text = "2026-10-18 bun";
    console.log(/a|b/.test(text), /(?<year>\\d{4})-(?<month>\\d\\d)/.exec(text)!.groups!.year, /\\w+$/u.exec(text)![0]);
  `,
  "property.ts": `console.log(/^\\p{Lu}/u.test("Élan"));`,
};

describe.skipIf(!canTrim || !!unsupported)("--compile --aot --trim and Unicode property escapes", () => {
  const properties = [featureNamed("RegExpUnicodeProperties")];

  async function build(folder: string, entry: string, outfile: string, without: string[] = []) {
    const built = await run(
      [
        bunExe(),
        "build",
        "--compile",
        "--aot",
        "--trim",
        ...withoutFeatures(without),
        "--disallow-code-generation-from-strings",
        entry,
        "--outfile",
        join(outfile, "program"),
      ],
      folder,
    );
    expect(built.stderr).not.toMatch(/^error\b/m);
    expect(built.exitCode).toBe(0);
    const bytes = readFileSync(join(folder, outfile, "program") + (isWindows ? ".exe" : ""));
    return { size: bytes.length, contents: new Bun.CryptoHasher("sha256").update(bytes).digest("hex") };
  }

  test("literals that name no property leave the tables out", async () => {
    using dir = tempDir("compile-trim-regexp-unicode-properties", files);
    const folder = String(dir);
    expect(await build(folder, "no-property.ts", "by-use")).toEqual(
      await build(folder, "no-property.ts", "by-name", properties),
    );
    expect(await run([join(folder, "by-use", "program")], folder)).toEqual({
      stdout: "true 2026 bun\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("a literal doesn't count as a use of the RegExp constructor", async () => {
    using dir = tempDir("compile-trim-regexp-unicode-properties", files);
    const { stderr, exitCode } = await run(
      [
        bunExe(),
        "build",
        "--compile",
        "--aot",
        "--trim",
        "--explain=trim",
        "--disallow-code-generation-from-strings",
        "no-property.ts",
        "--outfile",
        "program",
      ],
      String(dir),
    );
    expect(stderr).toContain(`trim: kept ${textOf(featureNamed("RegExp"))}: used`);
    expect(stderr).toContain(`trim: removed ${textOf(featureNamed("RegExpFromString"))}: unused`);
    expect(stderr).toContain(`trim: removed ${textOf(featureNamed("RegExpUnicodeProperties"))}: unused`);
    expect(exitCode).toBe(0);
  });

  test("one literal that names a property retains the tables", async () => {
    using dir = tempDir("compile-trim-regexp-unicode-properties", files);
    const folder = String(dir);
    const retained = await build(folder, "property.ts", "by-use");
    expect((await build(folder, "property.ts", "by-name", properties)).size).toBeLessThan(retained.size);
    expect(await run([join(folder, "by-use", "program")], folder)).toEqual({
      stdout: "true\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
