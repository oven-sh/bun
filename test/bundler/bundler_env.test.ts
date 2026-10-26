import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
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

// An inlined env value is the bytes of the .env file. Under --minify-syntax a value and the string that is joined to it
// print as one literal. A value that ends in a cut-off UTF-8 sequence must not take the start of that string.
test.concurrent("--minify-syntax keeps the string joined to an env value that ends in a cut-off sequence", async () => {
  using dir = tempDir("bun-build-env-cut-off", {
    ".env": Buffer.from("PUB_NAME=Caf\xE9\nPUB_TWO=a\xE2\x82\n", "latin1"),
    "entry.mjs": /* js */ `
      console.log(JSON.stringify([process.env.PUB_NAME + "!", \`\${process.env.PUB_NAME}!\`, "<" + process.env.PUB_TWO + ">"]));
    `,
  });
  const outputOf = async (...flags: string[]) => {
    const outfile = `out${flags.length}.mjs`;
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--env", "PUB_*", "--target=node", ...flags, "entry.mjs", "--outfile", outfile],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, buildStderr, buildExitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    await using run = Bun.spawn({
      cmd: [bunExe(), outfile],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
    return { buildStderr, buildExitCode, stdout, stderr, exitCode };
  };
  const [plain, minified] = await Promise.all([outputOf(), outputOf("--minify-syntax")]);
  expect(minified).toEqual({
    buildStderr: "",
    buildExitCode: 0,
    stdout: '["Caf\uFFFD!","Caf\uFFFD!","<a\uFFFD>"]\n',
    stderr: "",
    exitCode: 0,
  });
  expect(plain).toEqual(minified);
});

// A .env value is bytes, and `process.env` has the text that `TextDecoder` reads from them: one U+FFFD for each maximal
// subpart that is not UTF-8. An inlined value is that text for a fold, for the literal that is printed, and for a build
// that needs a constant.
describe("an inlined env value that is not UTF-8", () => {
  const dotEnv = Buffer.from(
    [
      "PUB_NAME=Caf\xE9-bar",
      "PUB_CUT=a\xE2\x82z",
      "PUB_WORD=na\xEFve",
      "PUB_E9=x\xE9y",
      "PUB_E8=x\xE8y",
      "PUB_OVER=\xC0\xAF",
      "PUB_STRAY=a\xA9b",
      "PUB_KEY=caf\xFC",
      "",
    ].join("\n"),
    "latin1",
  );
  // `E` is `process.env` where the values are inlined, and a lookup at run time where they are not.
  const moduleFor = (E: string) => /* js */ `
    console.log(JSON.stringify({
      name: [${E}.PUB_NAME[5], ${E}.PUB_NAME.charCodeAt(5), (${E}.PUB_NAME + "/x").length, ${E}.PUB_NAME < "D", ${E}.PUB_NAME.length],
      cut: [${E}.PUB_CUT.length, ${E}.PUB_CUT[3], ${E}.PUB_CUT[1], ${E}.PUB_CUT.charCodeAt(1), ${E}.PUB_CUT[2]],
      word: [${E}.PUB_WORD[2], ${E}.PUB_WORD.charCodeAt(2), ${E}.PUB_WORD.length, ${E}.PUB_WORD < "nb", (${E}.PUB_WORD + "!").length, (${E}.PUB_WORD + "!")[5], \`\${${E}.PUB_WORD}!\`.length, +${E}.PUB_WORD],
      equal: [${E}.PUB_E9 === ${E}.PUB_E8, ${E}.PUB_E9 == ${E}.PUB_E8, ${E}.PUB_E9 !== ${E}.PUB_E8, ${E}.PUB_E9 === "x\\uFFFDy", ${E}.PUB_E9 < ${E}.PUB_E8],
      over: [${E}.PUB_OVER.length, ${E}.PUB_OVER.charCodeAt(0), ${E}.PUB_OVER.charCodeAt(1), ${E}.PUB_OVER[1]],
      stray: [${E}.PUB_STRAY.length, ${E}.PUB_STRAY.charCodeAt(1), ${E}.PUB_STRAY[2], ${E}.PUB_STRAY === "a\\uFFFDb"],
    }));
  `;
  const text = {
    name: ["b", 98, 10, true, 8],
    cut: [3, null, "\uFFFD", 65533, "z"],
    word: ["\uFFFD", 65533, 5, true, 6, "!", 6, null],
    equal: [true, true, false, true, false],
    over: [2, 65533, 65533, "\uFFFD"],
    stray: [3, 65533, "b", true],
  };
  // PUB_OVER and PUB_STRAY have a byte that starts no sequence. The printer writes that byte of a literal as Latin-1, so
  // only a fold has the text of those two.
  const { over: _over, stray: _stray, ...textOfLiterals } = text;

  const files = {
    ".env": dotEnv,
    "entry.mjs": moduleFor("process.env"),
    "not-inlined.mjs": `const env = Reflect.get(process, "env");\n${moduleFor("env")}`,
    // Each bundle prints one line.
    "run.mjs": `for (const bundle of process.argv.slice(2)) await import(bundle);`,
    "build.mjs": /* js */ `
      for (const target of ["browser", "bun"]) {
        for (const syntax of [false, true]) {
          const built = await Bun.build({
            entrypoints: ["./entry.mjs"],
            env: "PUB_*",
            target,
            minify: { syntax },
          });
          if (!built.success) throw new AggregateError(built.logs);
          await Bun.write(\`./api-\${target}-\${syntax ? "minify" : "plain"}.mjs\`, await built.outputs[0].text());
        }
      }
    `,
  };
  const bundles = (backend: string) =>
    ["browser", "bun"].flatMap(target => ["plain", "minify"].map(mode => `./${backend}-${target}-${mode}.mjs`));
  const run = async (cwd: string, ...cmd: string[]) => {
    await using proc = Bun.spawn({ cmd, env: bunEnv, cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  };
  const rowsOf = (stdout: string) =>
    stdout
      .trim()
      .split("\n")
      .map(line => JSON.parse(line));

  test.concurrent("the text is what process.env has at run time", async () => {
    using dir = tempDir("bun-build-env-not-inlined", files);
    const { stdout, stderr, exitCode } = await run(String(dir), bunExe(), "not-inlined.mjs");
    expect({ rows: rowsOf(stdout), stderr }).toEqual({ rows: [text], stderr: "" });
    expect(exitCode).toBe(0);
  });

  for (const backend of ["cli", "api"] as const) {
    test.concurrent(`${backend}: a fold and the printed literal are that text`, async () => {
      using dir = tempDir(`bun-build-env-bytes-${backend}`, files);
      const cwd = String(dir);
      if (backend === "api") {
        expect(await run(cwd, bunExe(), "build.mjs")).toEqual({ stdout: "", stderr: "", exitCode: 0 });
      } else {
        const builds = ["browser", "bun"].flatMap(target =>
          ["plain", "minify"].map(async mode => {
            const flags = mode === "minify" ? ["--minify-syntax"] : [];
            const outfile = `cli-${target}-${mode}.mjs`;
            const cmd = ["build", "--env", "PUB_*", `--target=${target}`, ...flags, "entry.mjs", "--outfile", outfile];
            return { outfile, ...(await run(cwd, bunExe(), ...cmd)), stdout: "" };
          }),
        );
        expect(await Promise.all(builds)).toEqual(
          bundles(backend).map(outfile => ({ outfile: outfile.slice(2), stdout: "", stderr: "", exitCode: 0 })),
        );
      }
      const { stdout, stderr, exitCode } = await run(cwd, bunExe(), "run.mjs", ...bundles(backend));
      const [browserPlain, browserMinify, bunPlain, bunMinify] = rowsOf(stdout);
      expect({ browserMinify, bunMinify, stderr }).toEqual({ browserMinify: text, bunMinify: text, stderr: "" });
      expect({ browserPlain, bunPlain }).toEqual({
        browserPlain: expect.objectContaining(textOfLiterals),
        bunPlain: expect.objectContaining(textOfLiterals),
      });
      expect(exitCode).toBe(0);
    });
  }
  test.concurrent("a fold is the constant that a dead branch, a macro argument and a computed key need", async () => {
    using dir = tempDir("bun-build-env-constant", {
      ".env": dotEnv,
      "macro.mjs": `export const units = (length, char) => [length * 2, char.charCodeAt(0)];`,
      "entry.mjs": /* js */ `
        import { units } from "./macro.mjs" with { type: "macro" };
        if (process.env.PUB_NAME[5] === "b") console.log("name");
        else require("./missing-1.js");
        if (process.env.PUB_CUT.length === 3) console.log("cut");
        else require("./missing-2.js");
        if (process.env.PUB_WORD.charCodeAt(2) === 0xfffd) console.log("word");
        else require("./missing-3.js");
        if (process.env.PUB_E9 === process.env.PUB_E8) console.log("equal");
        else require("./missing-4.js");
        console.log(JSON.stringify(units(process.env.PUB_NAME.length, process.env.PUB_CUT[1])));
        globalThis.byKey = {};
        byKey[process.env.PUB_KEY] = 1;
      `,
    });
    const cwd = String(dir);
    const built = await run(
      cwd,
      bunExe(),
      "build",
      "--env",
      "PUB_*",
      "--minify-syntax",
      "entry.mjs",
      "--outfile",
      "out.mjs",
    );
    expect({ ...built, stdout: "" }).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    expect(await run(cwd, bunExe(), "out.mjs")).toEqual({
      stdout: "name\ncut\nword\nequal\n[16,65533]\n",
      stderr: "",
      exitCode: 0,
    });
    // A key that is not UTF-8 is no name to write after a dot.
    expect(await Bun.file(`${cwd}/out.mjs`).text()).toContain('byKey["caf');
  });

  // The shell gives the bytes of the script to bun as they are.
  test.skipIf(isWindows).concurrent("a --define value with the same bytes is the same text", async () => {
    using dir = tempDir("bun-build-define-bytes", {
      "build.sh": Buffer.from(`exec "$1" build --define 'NAME="Caf\xE9-bar"' $3 entry.mjs --outfile "$2"\n`, "latin1"),
      "entry.mjs": `console.log(JSON.stringify([NAME[5], NAME.charCodeAt(5), (NAME + "/x").length, NAME < "D", NAME.length]));`,
      "run.mjs": files["run.mjs"],
    });
    const cwd = String(dir);
    const build = async (outfile: string, ...flags: string[]) => ({
      ...(await run(cwd, "sh", "build.sh", bunExe(), outfile, ...flags)),
      stdout: "",
    });
    const built = { stdout: "", stderr: "", exitCode: 0 };
    expect(await Promise.all([build("plain.mjs"), build("minify.mjs", "--minify-syntax")])).toEqual([built, built]);
    expect(await run(cwd, bunExe(), "run.mjs", "./plain.mjs", "./minify.mjs")).toEqual({
      stdout: '["b",98,10,true,8]\n["b",98,10,true,8]\n',
      stderr: "",
      exitCode: 0,
    });
  });

  // The resolver needs the bytes of a joined path as they are: a join does not make text of them.
  test.skipIf(!isLinux).concurrent("a path through bytes that are not UTF-8 resolves", async () => {
    using dir = tempDir("bun-build-env-path-bytes", {
      ".env": Buffer.from(
        "PUB_DIR=./d\xE9r\nPUB_A=./d\xC3\nPUB_B=\xA9r\nPUB_HIGH=./d\xED\xA0\xBD\nPUB_LOW=\xED\xB8\x80r\n",
        "latin1",
      ),
      "entry.mjs": /* js */ `
        console.log(require(process.env.PUB_DIR + "/m.js"));
        console.log(require(\`\${process.env.PUB_DIR}/m.js\`));
        console.log((await import(process.env.PUB_DIR + "/m.js")).default);
        // A sequence that the two values have a part of each.
        console.log(require(process.env.PUB_A + process.env.PUB_B + "/m.js"));
        // The two halves of a surrogate pair, three bytes each.
        console.log(require(process.env.PUB_HIGH + process.env.PUB_LOW + "/m.js"));
      `,
      "nested/dir.cjs": `console.log(require(import.meta.dir + "/m.cjs"));`,
      "nested/m.cjs": `module.exports = "in the directory of the module";`,
    });
    const cwd = String(dir);
    const at = (name: string) => Buffer.concat([Buffer.from(cwd + "/"), Buffer.from(name, "latin1")]);
    for (const name of ["d\xE9r", "d\xC3\xA9r", "d\xED\xA0\xBD\xED\xB8\x80r"]) {
      mkdirSync(at(name));
      writeFileSync(
        at(`${name}/m.js`),
        `module.exports = ${JSON.stringify(Buffer.from(name, "latin1").toString("hex"))};`,
      );
    }
    renameSync(`${cwd}/nested`, at("p\xEFx"));
    const built = { stdout: "", stderr: "", exitCode: 0 };
    const build = async (...cmd: string[]) => ({ ...(await run(cwd, ...cmd)), stdout: "" });
    const bundle = (outfile: string, ...flags: string[]) =>
      build(bunExe(), "build", "--env", "PUB_*", "--target=bun", ...flags, "entry.mjs", "--outfile", outfile);
    // `import.meta.dir` of a module in a directory with such a name.
    const inDir = `cd p*x && exec "$0" build --target=bun --format=cjs dir.cjs --outfile ../dir.cjs`;
    expect(
      await Promise.all([
        bundle("plain.mjs"),
        bundle("minify.mjs", "--minify-syntax"),
        build("sh", "-c", inDir, bunExe()),
      ]),
    ).toEqual([built, built, built]);
    const modules = { stdout: "64e972\n64e972\n64e972\n64c3a972\n64eda0bdedb88072\n", stderr: "", exitCode: 0 };
    expect(
      await Promise.all([
        run(cwd, bunExe(), "plain.mjs"),
        run(cwd, bunExe(), "minify.mjs"),
        run(cwd, bunExe(), "dir.cjs"),
      ]),
    ).toEqual([modules, modules, { stdout: "in the directory of the module\n", stderr: "", exitCode: 0 }]);
  });
});
