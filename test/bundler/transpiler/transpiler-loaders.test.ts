import path from "node:path";
import { promises as fs } from "node:fs";

const dirname = import.meta.dirname;

describe("toml", async () => {
  // TODO: .multi
  const glob = new Bun.Glob("**/*.{toml,json}");
  type TestSuite = {
    files: [name: string, path: string][];
    folders: [name: string, path: string][];
  };

  const loadTests = async (group: string) => {
    const fixtureDir = path.resolve(import.meta.dirname, "fixtures", "toml", group);
    const entries = await fs.readdir(fixtureDir);
    const cases: TestSuite = {
      files: [],
      folders: [],
    };
    for (const entry of entries) {
      if (entry.endsWith(".toml") || entry.endsWith(".json")) {
        const filepath = path.resolve(fixtureDir, entry);
        cases.files.push([entry, filepath]);
      } else {
        const dirpath = path.resolve(fixtureDir, entry);
        cases.folders.push([entry, dirpath]);
      }
    }

    return cases;
  };

  const allCases = Promise.all([loadTests("valid"), loadTests("invalid")]) as Promise<
    [valid: TestSuite, invalid: TestSuite]
  >;

  describe("valid", async () => {
    const valids = (await allCases)[0];

    it.each(valids.files)("parses %s", async (_name, filePath) => {
      expect(() => import(filePath)).not.toThrow();
    });

    describe.each(valids.folders)("%s", async (_name, dirpath) => {
      const validCases = (await Array.fromAsync(glob.scan(dirpath))).map(file => [
        path.basename(file),
        path.join(dirpath, file),
      ]);
      test.each(validCases)("parses %s", async (__filename, filePath) => {
        expect(() => import(filePath)).not.toThrow();
      });
    });
  });

  describe("invalid", async () => {
    const invalids = (await allCases)[1];

    it.each(invalids.files)("throws on %s", async (_name, filePath) => {
      expect(() => import(filePath)).toThrow();
    });

    describe.each(invalids.folders)("%s", async (_name, dirpath) => {
      const invalidCases = (await Array.fromAsync(glob.scan(dirpath))).map(file => [
        path.basename(file),
        path.join(dirpath, file),
      ]);
      test.each(invalidCases)("throws on %s", async (__filename, filePath) => {
        expect(() => import(filePath)).toThrow();
      });
    });
  });
});
