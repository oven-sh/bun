import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { tmpdir } from "os";
import { join } from "path";

describe("import.meta in CJS format", () => {
  test("import.meta should be transformed to object in CJS format", async () => {
    const dir = mkdtempSync(join(tmpdir(), "import-meta-cjs-"));

    try {
      const entryFile = join(dir, "entry.js");
      const outFile = join(dir, "out.js");

      writeFileSync(
        entryFile,
        `console.log(typeof import.meta);
console.log(import.meta);`,
      );

      const result = Bun.spawnSync({
        cmd: [bunExe(), "build", entryFile, "--format=cjs", `--outfile=${outFile}`],
        env: bunEnv,
        stderr: "pipe",
      });

      expect(result.exitCode).toBe(0);

      const output = await Bun.file(outFile).text();

      // import.meta should be transformed into an object
      expect(output).toContain("{url: require('url').pathToFileURL(__filename).href}");
      expect(output).not.toContain("import.meta");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("import.meta.url should be transformed in CJS format", async () => {
    const dir = mkdtempSync(join(tmpdir(), "import-meta-url-cjs-"));

    try {
      const entryFile = join(dir, "entry.js");
      const outFile = join(dir, "out.js");

      writeFileSync(entryFile, `console.log(import.meta.url);`);

      const result = Bun.spawnSync({
        cmd: [bunExe(), "build", entryFile, "--format=cjs", `--outfile=${outFile}`],
        env: bunEnv,
        stderr: "pipe",
      });

      expect(result.exitCode).toBe(0);

      const output = await Bun.file(outFile).text();

      // import.meta.url should be transformed
      expect(output).toContain("require('url').pathToFileURL(__filename).href");
      expect(output).not.toContain("import.meta.url");
      expect(output).not.toContain("import.meta");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("multiple import.meta.url references should be transformed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "import-meta-url-multiple-"));

    try {
      const entryFile = join(dir, "entry.js");
      const outFile = join(dir, "out.js");

      writeFileSync(
        entryFile,
        `const url1 = import.meta.url;
const url2 = import.meta.url;
console.log(url1, url2);`,
      );

      const result = Bun.spawnSync({
        cmd: [bunExe(), "build", entryFile, "--format=cjs", `--outfile=${outFile}`],
        env: bunEnv,
        stderr: "pipe",
      });

      expect(result.exitCode).toBe(0);

      const output = await Bun.file(outFile).text();

      // All import.meta.url should be transformed
      expect(output).not.toContain("import.meta");
      const matches = output.match(/require\('url'\)\.pathToFileURL\(__filename\)\.href/g);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("import.meta in ESM format should remain unchanged", async () => {
    const dir = mkdtempSync(join(tmpdir(), "import-meta-esm-"));

    try {
      const entryFile = join(dir, "entry.js");
      const outFile = join(dir, "out.js");

      writeFileSync(
        entryFile,
        `console.log(import.meta);
console.log(import.meta.url);`,
      );

      const result = Bun.spawnSync({
        cmd: [bunExe(), "build", entryFile, "--format=esm", `--outfile=${outFile}`],
        env: bunEnv,
        stderr: "pipe",
      });

      expect(result.exitCode).toBe(0);

      const output = await Bun.file(outFile).text();

      // import.meta should remain in ESM format
      expect(output).toContain("import.meta");
      expect(output).not.toContain("require('url').pathToFileURL(__filename).href");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
