import { beforeEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("// @bun", () => {
  beforeEach(() => {
    delete require.cache[require.resolve("./async-transpiler-entry")];
    delete require.cache[require.resolve("./async-transpiler-imported")];
  });

  test("async transpiler", async () => {
    const { default: value, hbs } = await import("./async-transpiler-entry");
    expect(value).toBe(42);
    expect(hbs).toBeString();
  });

  test("require()", async () => {
    const { default: value, hbs } = require("./async-transpiler-entry");
    expect(value).toBe(42);
    expect(hbs).toBeString();
  });

  test("synchronous", async () => {
    const { stdout, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), require.resolve("./async-transpiler-imported")],
      cwd: import.meta.dir,
      env: bunEnv,
      stderr: "inherit",
    });
    expect(stdout.toString()).toBe("Hello world!\n");
    expect(exitCode).toBe(0);
  });
});

describe("json imports", () => {
  test("require(*.json)", () => {
    const {
      name,
      description,
      players,
      version,
      creator,
      ...other
    } = require("./runtime-transpiler-json-fixture.json");
    delete require.cache[require.resolve("./runtime-transpiler-json-fixture.json")];
    const obj = {
      "name": "Spiral 4v4 NS",
      "description": "4v4 unshared map. 4 spawns in a spiral. Preferred to play with 4v4 NS.",
      "version": "1.0",
      "creator": "Grand Homie",
      "players": [8, 8],
    };
    expect({
      name,
      description,
      players,
      version,
      creator,
    }).toEqual(obj);
    expect(other).toEqual({});
  });

  test("import(*.json)", async () => {
    const {
      name,
      description,
      players,
      version,
      creator,
      default: defaultExport,
      // @ts-ignore
    } = await import("./runtime-transpiler-json-fixture.json");
    delete require.cache[require.resolve("./runtime-transpiler-json-fixture.json")];
    const obj = {
      "name": "Spiral 4v4 NS",
      "description": "4v4 unshared map. 4 spawns in a spiral. Preferred to play with 4v4 NS.",
      "version": "1.0",
      "creator": "Grand Homie",
      "players": [8, 8],
    };
    expect({
      name,
      description,
      players,
      version,
      creator,
    }).toEqual(obj);
    // They should be strictly equal
    expect(defaultExport.players).toBe(players);
    expect(defaultExport).toEqual(obj);
  });

  test("should support comments in tsconfig.json", async () => {
    // @ts-ignore
    const { buildOptions, default: defaultExport } = await import("./tsconfig.with-commas.json");
    delete require.cache[require.resolve("./tsconfig.with-commas.json")];
    const obj = {
      "buildOptions": {
        "outDir": "dist",
        "baseUrl": ".",
        "paths": {
          "src/*": ["src/*"],
        },
      },
    };
    expect({
      buildOptions,
    }).toEqual(obj);
    // They should be strictly equal
    expect(defaultExport.buildOptions).toBe(buildOptions);
    expect(defaultExport).toEqual(obj);
  });

  test("should handle non-boecjts in tsconfig.json", async () => {
    // @ts-ignore
    const { default: num } = await import("./tsconfig.is-just-a-number.json");
    delete require.cache[require.resolve("./tsconfig.is-just-a-number.json")];
    expect(num).toBe(1);
  });

  test("should handle duplicate keys", async () => {
    // @ts-ignore
    expect((await import("./runtime-transpiler-fixture-duplicate-keys.json")).a).toBe("4");
  });
});
