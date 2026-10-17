import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test.concurrent.each([["--aot"], ["--bytecode"]])(
  "an environment variable of the compiler that nothing reads is named: --compile %s",
  async flag => {
    using dir = tempDir("aot-build-environment", {
      "app.ts": "console.log(1);\n",
      "package.json": JSON.stringify({ name: "app", type: "module" }),
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          strict: true,
          module: "esnext",
          moduleResolution: "bundler",
          target: "esnext",
          types: [],
          lib: ["esnext", "dom"],
        },
      }),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", flag, "--format=esm", "app.ts", "--outfile", "app"],
      cwd: String(dir),
      env: {
        ...bunEnv,
        NO_COLOR: "1",
        AOT_SWITCH_OUTLINE: "off",
        AOT_X_COLD_SET: "66:e",
        BUN_AOT: "1",
        BUN_AOT_IMMUTABLE_INTRINSICS: "1",
        BUN_AOT_VERBOSE: "1",
        BUN_SOUND_TYPES: "infer",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    // Where --aot is not supported the build stops before it looks at the environment.
    if (flag === "--aot" && /^error: --aot: /m.test(stderr)) return;
    expect(stderr.match(/\S+ is set and has no effect/g)?.sort()).toEqual([
      "AOT_SWITCH_OUTLINE is set and has no effect",
      "AOT_X_COLD_SET is set and has no effect",
      "BUN_AOT is set and has no effect",
      "BUN_AOT_IMMUTABLE_INTRINSICS is set and has no effect",
      "BUN_SOUND_TYPES is set and has no effect",
    ]);
    expect(exitCode).toBe(0);
  },
  120_000,
);
