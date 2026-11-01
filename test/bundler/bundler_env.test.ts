import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { itBundled } from "./expectBundled";

for (let backend of ["api", "cli"] as const) {
  describe(`bundler/${backend}`, () => {
    // TODO: make this work as expected with process.env isntead of relying on the initial env vars.
    if (backend === "cli")
      itBundled("env/inline", {
        env: {
          FOO: "bar",
          BAZ: "123",
        },
        backend: backend,
        dotenv: "inline",
        files: {
          "/a.js": `
        console.log(process.env.FOO);
        console.log(process.env.BAZ);
      `,
        },
        run: {
          env: {
            FOO: "barz",
            BAZ: "123z",
          },
          stdout: "bar\n123\n",
        },
      });

    // An inlined value is 8-bit text. No fold reads one byte of it as one character where the text is not ASCII, so
    // each of these reads gives what it gives at run time. The path still joins with a literal at build time.
    if (backend === "cli")
      itBundled("env/inline non-ascii", {
        env: {
          INLINE_NON_ASCII: "é😀",
          INLINE_LS_NUMBER: "\u2028 12 ",
          INLINE_DIR: "./dér",
        },
        backend: backend,
        dotenv: "inline",
        minifySyntax: true,
        files: {
          "/a.js": `
        const v = process.env.INLINE_NON_ASCII;
        const m = require(process.env.INLINE_DIR + "/m.js");
        console.log(JSON.stringify([v, process.env.INLINE_NON_ASCII[0], process.env.INLINE_NON_ASCII?.[1], \`\${process.env.INLINE_NON_ASCII}\`.length, process.env.INLINE_NON_ASCII === "é😀", +process.env.INLINE_LS_NUMBER, ~process.env.INLINE_LS_NUMBER, m]));
      `,
          "/dér/m.js": `module.exports = "from m";`,
        },
        onAfterBundle(api) {
          expect(api.readFile("/out.js")).toContain("from m");
        },
        run: {
          env: {
            INLINE_NON_ASCII: "the run-time value, which inlining should have replaced",
            INLINE_LS_NUMBER: "0",
          },
          stdout: '["é😀","é","\\ud83d",3,true,12,-13,"from m"]',
        },
      });

    // A variable from the process environment (not a .env file) is inlined at build time. It has to be one this
    // process started with (the api backend builds in-process), spelled as the environment spells it (on Windows the
    // inlined name is case-sensitive even though process.env is not: `Path`, not `PATH`).
    const systemKey = ["HOME", "OS", "NUMBER_OF_PROCESSORS", "COMPUTERNAME", "USER", "LANG"].find(
      key => process.env[key] && /^[\x20-\x7e]+$/.test(process.env[key]!) && !/["`$\\]/.test(process.env[key]!),
    )!;
    const systemValue = process.env[systemKey]!;
    itBundled("env/inline system", {
      env: {
        [systemKey]: systemValue,
      },
      backend: backend,
      dotenv: "inline",
      files: {
        "/a.js": `
        console.log(process.env.${systemKey});
      `,
      },
      run: {
        env: {
          [systemKey]: "the run-time value, which inlining should have replaced",
        },
        stdout: systemValue + "\n",
      },
    });

    // Test disable mode - no env vars are inlined
    itBundled("env/disable", {
      env: {
        FOO: "bar",
        BAZ: "123",
      },
      backend: backend,
      dotenv: "disable",
      files: {
        "/a.js": `
        console.log(process.env.FOO);
        console.log(process.env.BAZ);
      `,
      },
      run: {
        stdout: "undefined\nundefined\n",
      },
    });

    // TODO: make this work as expected with process.env isntead of relying on the initial env vars.
    // Test pattern matching - only vars with prefix are inlined
    if (backend === "cli")
      itBundled("env/pattern-matching", {
        env: {
          PUBLIC_FOO: "public_value",
          PUBLIC_BAR: "another_public",
          PRIVATE_SECRET: "secret_value",
        },
        dotenv: "PUBLIC_*",
        backend: backend,
        files: {
          "/a.js": `
        console.log(process.env.PUBLIC_FOO);
        console.log(process.env.PUBLIC_BAR);
        console.log(process.env.PRIVATE_SECRET);
      `,
        },
        run: {
          env: {
            PUBLIC_FOO: "BAD_FOO",
            PUBLIC_BAR: "BAD_BAR",
          },
          stdout: "public_value\nanother_public\nundefined\n",
        },
      });

    if (backend === "cli")
      // Test nested environment variable references
      itBundled("nested-refs", {
        env: {
          BASE_URL: "https://api.example.com",
          SHOULD_PRINT_BASE_URL: "process.env.BASE_URL",
          SHOULD_PRINT_$BASE_URL: "$BASE_URL",
        },
        dotenv: "inline",
        backend: backend,
        files: {
          "/a.js": `
      // Test nested references
      console.log(process.env.SHOULD_PRINT_BASE_URL);
      console.log(process.env.SHOULD_PRINT_$BASE_URL);
    `,
        },
        run: {
          env: {
            "BASE_URL": "https://api.example.com",
          },
          stdout: "process.env.BASE_URL\n$BASE_URL",
        },
      });
  });
}

// Assigning to a proxy variable in process.env updates the native env map and frees the old value.
test("Bun.build inlines the env values from when it was called", async () => {
  const atCall = "http://proxy-when-the-build-was-scheduled.example:1111/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const duringBuild = "http://proxy-assigned-while-bundling.example:2222/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  using dir = tempDir("bun-build-env-copy", {
    "entry.ts": "export {};",
    "build-fixture.ts": /* ts */ `
      process.env.HTTPS_PROXY = ${JSON.stringify(atCall)};
      const result = await Bun.build({
        entrypoints: ["./entry.ts"],
        env: "inline",
        plugins: [
          {
            name: "assign-proxy-env-while-bundling",
            setup(build) {
              build.onLoad({ filter: /entry\\.ts$/ }, () => {
                process.env.HTTPS_PROXY = ${JSON.stringify(duringBuild)};
                return { loader: "ts", contents: "console.log(process.env.HTTPS_PROXY);" };
              });
            },
          },
        ],
      });
      process.stdout.write(await result.outputs[0].text());
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build-fixture.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain(`console.log(${JSON.stringify(atCall)})`);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

// A `.env` file is read as bytes, so an inlined value can be 8-bit text that is not UTF-8. A comparison of two such
// values stays for run time: it gives what the same comparison gives for values that the bundler cannot see through.
test("bun build --env leaves a comparison of values that are not UTF-8 for run time", async () => {
  using dir = tempDir("bun-build-env-bytes", {
    ".env": Buffer.concat([
      Buffer.from("PUB_A=a"),
      Buffer.from([0xff]),
      Buffer.from("\nPUB_B=a"),
      Buffer.from([0xef, 0xbf, 0xbe]),
      Buffer.from("\n"),
    ]),
    "entry.mjs": /* js */ `
      const id = x => x;
      console.log(process.env.PUB_A < process.env.PUB_B, process.env.PUB_A >= process.env.PUB_B);
      console.log(id(process.env.PUB_A) < id(process.env.PUB_B), id(process.env.PUB_A) >= id(process.env.PUB_B));
    `,
  });
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--env", "PUB_*", "--minify-syntax", "entry.mjs", "--outfile", "out.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  expect({ stderr: await build.stderr.text(), exitCode: await build.exited }).toEqual({ stderr: "", exitCode: 0 });

  await using run = Bun.spawn({
    cmd: [bunExe(), "out.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
  const [folded, opaque] = stdout.trim().split("\n");
  expect({ folded, stderr, exitCode }).toEqual({ folded: opaque, stderr: "", exitCode: 0 });
});
