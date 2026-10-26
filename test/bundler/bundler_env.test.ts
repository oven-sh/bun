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

    // An inlined value is the bytes of the environment, stored 8-bit. The folds have to read a non-ASCII value per
    // UTF-16 code unit, with U+2028 and U+00A0 as white space for a number. Every condition below is true: a branch
    // whose condition folds is removed, so the build needs no "./missing-*.js", and a row fails the build if its fold
    // is wrong or left out. `require(process.env.DIR + "/m.js")` still resolves.
    if (backend === "cli") {
      const V = "process.env.INLINE_NON_ASCII";
      const E = "process.env.INLINE_E";
      const conditions = [
        `${V}.length === 3`,
        `+${V} !== +${V}`,
        `!(${V} < "z")`,
        `+process.env.INLINE_NBSP_ONE === 1`,
        // the result of [n] in a second fold
        `${E}[0] + "x" === "éx"`,
        "`${" + E + '[0]}x` === "éx"',
        `${E}[0] > "z" && ${E}[0] < "ê"`,
        `${E}[0] + ${E}[0] === "éé"`,
        `(${E}[0] + "x")[0] === "é"`,
        `(${E}[0] + "x").charCodeAt(0) === 233`,
        `${V}[1] + ${V}[2] === "😀"`,
        `(${E}[0] + "x").length === 2`,
        "`${" + E + "[0]}x`.length === 2",
        `+${E}[0] !== +${E}[0]`,
        `(${E}[0] + ${E}[0]).length === 2`,
      ];
      itBundled("env/inline non-ascii", {
        env: {
          INLINE_NON_ASCII: "é😀",
          INLINE_E: "é",
          INLINE_NBSP_ONE: "\u00a01",
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
        ${conditions.map((condition, i) => `if (${condition}) console.log(${i}); else require("./missing-${i}.js");`).join("\n        ")}
        console.log(JSON.stringify([v, process.env.INLINE_NON_ASCII[0], process.env.INLINE_NON_ASCII?.[1], process.env.INLINE_NON_ASCII.charCodeAt(2), \`\${process.env.INLINE_NON_ASCII}\`.length, process.env.INLINE_NON_ASCII === "é😀", +process.env.INLINE_LS_NUMBER, ~process.env.INLINE_LS_NUMBER, m]));
      `,
          "/dér/m.js": `module.exports = "from m";`,
        },
        onAfterBundle(api) {
          expect(api.readFile("/out.js")).toContain("from m");
        },
        run: {
          env: {
            INLINE_NON_ASCII: "the run-time value, which inlining should have replaced",
            INLINE_E: "E",
            INLINE_NBSP_ONE: "0",
            INLINE_LS_NUMBER: "0",
          },
          stdout: [...conditions.map((_, i) => i), '["é😀","é","\\ud83d",56832,3,true,12,-13,"from m"]'].join("\n"),
        },
      });
    }

    if (backend === "cli")
      itBundled("env/pattern-matching non-ascii", {
        env: {
          PUBLIC_X: "é",
          PUBLIC_EURO: "€",
        },
        dotenv: "PUBLIC_*",
        backend: backend,
        minifySyntax: true,
        files: {
          "/a.js": `
        console.log(JSON.stringify([(process.env.PUBLIC_X + "x")[1], (process.env.PUBLIC_X + "x").length, (process.env.PUBLIC_X + "x")[0], ("x" + process.env.PUBLIC_X)[1], \`\${process.env.PUBLIC_X}x\`[1], \`\${process.env.PUBLIC_X}x\`.length]));
        console.log(JSON.stringify([(process.env.PUBLIC_EURO + "x")[1], (process.env.PUBLIC_EURO + "x").length, process.env.PUBLIC_EURO.charCodeAt(0)]));
      `,
        },
        run: {
          env: {
            PUBLIC_X: "BAD_X",
            PUBLIC_EURO: "BAD_EURO",
          },
          stdout: '["x",2,"é","é","x",2]\n["x",2,8364]',
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

// A .env file is read as bytes, and `process.env` has the text that `TextDecoder` reads from them: what is no sequence
// of UTF-8 is U+FFFD. A fold of an inlined value has to compute what that text gives.
test("bun build --env folds a .env value as the text that process.env has for its bytes", async () => {
  using dir = tempDir("bun-build-env-bytes", {
    ".env": Buffer.concat([
      Buffer.from("PUB_L=é\nPUB_BAD=a"),
      Buffer.from([0xff]),
      Buffer.from("b\nPUB_NAME=Caf"),
      Buffer.from([0xe9]),
      Buffer.from("-bar\nPUB_CUT=x"),
      Buffer.from([0xe2, 0x82]),
      Buffer.from("y\nPUB_HEAD=caf"),
      Buffer.from([0xc3]),
      Buffer.from("\nPUB_TAIL="),
      Buffer.from([0xa9]),
      Buffer.from("!\nPUB_FF=k"),
      Buffer.from([0xff]),
      Buffer.from("\nPUB_FE=k"),
      Buffer.from([0xfe]),
      Buffer.from("\n"),
    ]),
    "entry.mjs": /* js */ `
      console.log(JSON.stringify([process.env.PUB_L.length, process.env.PUB_L[0], process.env.PUB_L.charCodeAt(0), (process.env.PUB_L + "x")[1], \`\${process.env.PUB_L}x\`.length]));
      // "a\\uFFFDb"
      console.log(JSON.stringify([process.env.PUB_BAD.length, process.env.PUB_BAD.charCodeAt(1), process.env.PUB_BAD[2], +process.env.PUB_BAD, process.env.PUB_BAD < "b", (process.env.PUB_BAD + "!").length, (process.env.PUB_BAD + "!!")[4]]));
      // "Caf\\uFFFD-bar": one byte that is no sequence is one code unit.
      console.log(JSON.stringify([process.env.PUB_NAME[5], process.env.PUB_NAME.charCodeAt(5), (process.env.PUB_NAME + "/x").length, process.env.PUB_NAME < "D", process.env.PUB_NAME.length]));
      // "x\\uFFFDy": the start of a sequence that does not go on is one U+FFFD, however many bytes it has.
      console.log(JSON.stringify([process.env.PUB_CUT.length, process.env.PUB_CUT[2], process.env.PUB_CUT.charCodeAt(1)]));
      // "caf\\uFFFD" and "\\uFFFD!": the second value does not go on with the sequence that the first one cuts off.
      console.log(JSON.stringify([(process.env.PUB_HEAD + process.env.PUB_TAIL).length, (process.env.PUB_HEAD + process.env.PUB_TAIL)[5], process.env.PUB_HEAD + process.env.PUB_TAIL === "caf\\uFFFD\\uFFFD!"]));
      // Two bytes that start no sequence are the same text, and no name of a property after a dot.
      console.log(JSON.stringify([process.env.PUB_FF === process.env.PUB_FE, process.env.PUB_FF === "k\\uFFFD"]));
      globalThis.byKey = {};
      byKey[process.env.PUB_FF] = 1;
      if (process.env.PUB_NAME[5] === "b" && process.env.PUB_CUT.length === 3) console.log("folded");
      else require("./missing.js");
    `,
  });
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--env", "PUB_*", "--minify-syntax", "entry.mjs", "--outfile", "out.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, buildStderr, buildExitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
  await using run = Bun.spawn({
    cmd: [bunExe(), "out.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
  expect({ buildStderr, buildExitCode, stdout, stderr }).toEqual({
    buildStderr: "",
    buildExitCode: 0,
    stdout:
      '[1,"é",233,"x",2]\n[3,65533,"b",null,true,4,"!"]\n["b",98,10,true,8]\n[3,"y",65533]\n[6,"!",true]\n[true,true]\nfolded\n',
    stderr: "",
  });
  expect(exitCode).toBe(0);
  // The key with a byte that starts no sequence stays in brackets.
  expect(await Bun.file(`${dir}/out.mjs`).text()).toContain('byKey["k');
});
