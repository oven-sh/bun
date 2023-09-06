import { describe, expect, test } from "bun:test";
import { bunRun, tempDirWithFiles } from "harness";

describe("config", () => {
  test("read bun.json", () => {
    {
      const dir = tempDirWithFiles("dotenv", {
        "bun.json": `{"define": { "caterpillar": "'butterfly'" }}`,
        "index.ts": "console.log(caterpillar);",
      });
      const { stdout } = bunRun(`${dir}/index.ts`);
      expect(stdout).toBe("butterfly");
    }
  });

  test("read bunfig.toml", () => {
    {
      const dir = tempDirWithFiles("dotenv", {
        "bunfig.toml": `[define]\n"caterpillar" = "'butterfly'"`,
        "index.ts": "console.log(caterpillar);",
      });
      const { stdout } = bunRun(`${dir}/index.ts`);
      expect(stdout).toBe("butterfly");
    }
  });

  test("ignore bunfig.toml if bun.json is found", () => {
    {
      const dir = tempDirWithFiles("dotenv", {
        "bun.json": `{"define": { "caterpillar": "'correct'" }}`,
        "bunfig.toml": `[define]\n"caterpillar" = "'wrong'"`,
        "index.ts": "console.log(caterpillar);",
      });
      const { stdout } = bunRun(`${dir}/index.ts`);
      expect(stdout).toBe("correct");
    }
  });

  test("read --config *.json", () => {
    {
      const dir = tempDirWithFiles("dotenv", {
        "bun2.json": `{"define": { "caterpillar": "'butterfly'" }}`,
        "index.ts": "console.log(caterpillar);",
      });
      const { stdout } = bunRun(`${dir}/index.ts`, {}, { flags: ["--config", "bun2.json"] });
      expect(stdout).toBe("butterfly");
    }
  });

  test("read -c *.json", () => {
    {
      const dir = tempDirWithFiles("dotenv", {
        "bun2.json": `{"define": { "caterpillar": "'butterfly'" }}`,
        "index.ts": "console.log(caterpillar);",
      });
      const { stdout } = bunRun(`${dir}/index.ts`, {}, { flags: ["-c", "bun2.json"] });
      expect(stdout).toBe("butterfly");
    }
  });

  test("read --config *.json absolute path", () => {
    {
      const dir = tempDirWithFiles("dotenv", {
        "bun2.json": `{"define": { "caterpillar": "'butterfly'" }}`,
        "index.ts": "console.log(caterpillar);",
      });
      const { stdout } = bunRun(`${dir}/index.ts`, {}, { flags: ["-c", `${dir}/bun2.json`] });
      expect(stdout).toBe("butterfly");
    }
  });

  test("read --config *.toml", () => {
    {
      const dir = tempDirWithFiles("dotenv", {
        "bun2.toml": `[define]\n"caterpillar" = "'butterfly'"`,
        "index.ts": "console.log(caterpillar);",
      });
      const { stdout } = bunRun(`${dir}/index.ts`, {}, { flags: ["--config", "bun2.toml"] });
      expect(stdout).toBe("butterfly");
    }
  });

  test("read -c *.toml", () => {
    {
      const dir = tempDirWithFiles("dotenv", {
        "bun2.toml": `[define]\n"caterpillar" = "'butterfly'"`,
        "index.ts": "console.log(caterpillar);",
      });
      const { stdout } = bunRun(`${dir}/index.ts`, {}, { flags: ["-c", "bun2.toml"] });
      expect(stdout).toBe("butterfly");
    }
  });

  test("read --config absolute path", () => {
    {
      const dir = tempDirWithFiles("dotenv", {
        "bun2.toml": `[define]\n"caterpillar" = "'butterfly'"`,
        "index.ts": "console.log(caterpillar);",
      });
      const { stdout } = bunRun(`${dir}/index.ts`, {}, { flags: ["-c", `${dir}/bun2.toml`] });
      expect(stdout).toBe("butterfly");
    }
  });

  test("fail if --config absolute path can't be found", () => {
    {
      const dir = tempDirWithFiles("dotenv", {
        "index.ts": "console.log(caterpillar);",
      });

      {
        expect(() => {
          bunRun(`${dir}/index.ts`, {}, { flags: ["-c", `${dir}/notreal.json`] });
        }).toThrow();
      }
    }
  });
  // test("read --config absolute path", () => {
  //   {
  //     const dir = tempDirWithFiles("dotenv", {
  //       "bun2.toml": `[define]\n"caterpillar" = "'butterfly'"`,
  //       "index.ts": "console.log(caterpillar);",
  //     });
  //     const { stdout } = bunRun(`${dir}/index.ts`, {}, { flags: ["-c", "bun2.toml"] });
  //     expect(stdout).toBe("butterfly");
  //   }
  // });
});
