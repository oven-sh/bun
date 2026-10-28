import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { run } from "../aot/harness/run";

const files = {
  "app.ts": "console.log(1);\n",
  "app.order": "",
  "package.json": JSON.stringify({ name: "app", type: "module" }),
};

async function bun(cwd: string, ...args: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), ...args], cwd, { ...bunEnv, NO_COLOR: "1" });
  return { stdout, stderr, exitCode };
}

const unsupported = /^(error: --aot|compile\.aot) (only supports|isn't available)/m;

describe.concurrent("an option that configures bytecode has no effect with --aot", () => {
  test.each(["--bytecode-depth=1", "--bytecode-order=app.order"])(
    "bun build --compile --aot %s",
    async flag => {
      using dir = tempDir("aot-bytecode-flag", files);
      const { stderr, exitCode } = await bun(
        String(dir),
        "build",
        "--compile",
        "--aot",
        flag,
        "app.ts",
        "--outfile",
        "out",
      );
      if (unsupported.test(stderr)) return;
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
      expect(await run([join(String(dir), isWindows ? "out.exe" : "out")], String(dir), bunEnv)).toMatchObject({
        stdout: "1\n",
        exitCode: 0,
      });
    },
    60_000,
  );

  test.each([
    ["bytecodeDepth: 1", ""],
    ["", 'bytecodeOrder: "./app.order"'],
    ["bytecode: true", 'bytecodeOrder: "./app.order"'],
  ])(
    "Bun.build: %s %s",
    async (option, ofCompile) => {
      using dir = tempDir("aot-bytecode-option", {
        ...files,
        "build.ts": `try {
  await Bun.build({ entrypoints: ["./app.ts"], ${option}${option && ","} compile: { outfile: "./out", aot: true, ${ofCompile} } });
  console.log("built");
} catch (error) {
  console.log((error as Error).message);
}
`,
      });
      const { stdout } = await bun(String(dir), "build.ts");
      if (unsupported.test(stdout)) return;
      expect(stdout).toBe("built\n");
      expect(await run([join(String(dir), isWindows ? "out.exe" : "out")], String(dir), bunEnv)).toMatchObject({
        stdout: "1\n",
        exitCode: 0,
      });
    },
    60_000,
  );

  test("--bytecode may be combined with --aot, where it has no effect", async () => {
    using dir = tempDir("aot-with-bytecode", files);
    const { stderr, exitCode } = await bun(
      String(dir),
      "build",
      "--compile",
      "--aot",
      "--bytecode",
      "app.ts",
      "--outfile",
      "out",
    );
    if (unsupported.test(stderr)) return;
    expect({ stderr: stderr.includes("error"), exitCode }).toEqual({ stderr: false, exitCode: 0 });
  }, 60_000);

  test("without --aot they are accepted as before", async () => {
    using dir = tempDir("bytecode-flags-without-aot", files);
    const { stderr, exitCode } = await bun(
      String(dir),
      "build",
      "--compile",
      "--bytecode",
      "--format=esm",
      "--bytecode-depth=1",
      "app.ts",
      "--outfile",
      "out",
    );
    expect({ stderr: stderr.includes("error"), exitCode }).toEqual({ stderr: false, exitCode: 0 });
  }, 60_000);
});

describe("environment variables and --aot builds", () => {
  test("removed environment variables do not change the executable", async () => {
    using dir = tempDir("aot-removed-variables", files);
    const folder = String(dir);
    const removed = {
      BUN_AOT_TYPED_FILE: join(folder, "typed-file"),
      BUN_AOT_TYPED_SNAPSHOT: join(folder, "snapshot"),
      BUN_AOT_LAYOUT_SEED: "7",
      BUN_TRIM_RUNTIME_WITHOUT: "no_such_feature",
    };
    const hashes: string[] = [];
    for (const env of [{}, removed]) {
      rmSync(join(folder, isWindows ? "out.exe" : "out"), { force: true });
      const { stderr, exitCode } = await run(
        [bunExe(), "build", "--compile", "--aot", "app.ts", "--outfile", "out"],
        folder,
        { ...bunEnv, NO_COLOR: "1", ...env },
      );
      if (unsupported.test(stderr)) return;
      expect({ stderr: exitCode ? stderr : "", exitCode }).toEqual({ stderr: "", exitCode: 0 });
      hashes.push(
        new Bun.CryptoHasher("sha256").update(readFileSync(join(folder, isWindows ? "out.exe" : "out"))).digest("hex"),
      );
    }
    expect(hashes[1]).toBe(hashes[0]);
    expect([existsSync(removed.BUN_AOT_TYPED_FILE), existsSync(removed.BUN_AOT_TYPED_SNAPSHOT)]).toEqual([
      false,
      false,
    ]);
  }, 120_000);
});
