import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import path from "node:path";
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

// The bytes of an env value or of a command line do not have to be UTF-8. process.env and process.argv read each part
// that is not UTF-8 as one U+FFFD, as TextDecoder does. A value that the bundler inlines has to be that text.
describe("inlined values that are not UTF-8", () => {
  // The bytes of a value, as Latin-1, and what `new TextDecoder().decode()` is for them in Node.js.
  const values: [bytes: string, text: string][] = [
    ["x\xE2\x82", "x\uFFFD"],
    // $PUB_0 ends in the middle of "€", and the byte after it here is the rest.
    ["${PUB_0}\xACy", "x€y"],
    ["a\xA9b", "a\uFFFDb"],
    ["caf\xFC", "caf\uFFFD"],
    ["caf\xE9", "caf\uFFFD"],
    ["x\xE2\x82y", "x\uFFFDy"],
    ["s\xED\xA0\x80t", "s\uFFFD\uFFFD\uFFFDt"],
    ["o\xC0\xAFv", "o\uFFFD\uFFFDv"],
    ["\xF0\x9F\x98", "\uFFFD"],
    ["a\xF0\x9F\x98b", "a\uFFFDb"],
    ["\xF4\x90\x80\x80", "\uFFFD\uFFFD\uFFFD\uFFFD"],
    ["\xE0\x80\x80", "\uFFFD\uFFFD\uFFFD"],
    ["\xF0\x80\x80\x80", "\uFFFD\uFFFD\uFFFD\uFFFD"],
    ["\xC1\xBF", "\uFFFD\uFFFD"],
    ["\xF5\x80", "\uFFFD\uFFFD"],
    ["\xFF\xFE", "\uFFFD\uFFFD"],
    ["\xE2\x82\xE2\x82\xAC", "\uFFFD€"],
    ["\xED\xA0\xBD\xED\xB8\x80", "\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD"],
    ["\xC3\xA9\x80\xF0\x9F\x98\x80", "é\uFFFD😀"],
    // UTF-8 stays what it is.
    ["\xC3\xA9\xE2\x82\xAC\xF0\x9F\x98\x80", "é€😀"],
  ];
  const names = values.map((_, i) => `PUB_${i}`);
  const hex = (text: string) => Array.from(text, c => c.codePointAt(0)!.toString(16)).join(" ");
  // Prints each value, then PUB_4 and PUB_0 in expressions that the bundler folds.
  const print = (env: string) => `
    console.log(JSON.stringify([${names.map(name => `${env}.${name}`).join(", ")}].map(text => Array.from(text, c => c.codePointAt(0).toString(16)).join(" "))));
    console.log(JSON.stringify([${env}.PUB_4 === "caf\\uFFFD", ${env}.PUB_4 + "!", \`<\${${env}.PUB_0}>\`]));
  `;
  const files = {
    ".env": Buffer.from(values.map(([bytes], i) => `${names[i]}=${bytes}\n`).join(""), "latin1"),
    "entry.mjs": print("process.env"),
    // The bundler does not take this for process.env, so it reads the values at run time.
    "runtime.mjs": `const env = Reflect.get(process, "env");\n${print("env")}`,
    // The bundles run in this directory, which has no .env file.
    "away": {},
  };
  const texts = {
    stdout: JSON.stringify(values.map(([, text]) => hex(text))) + '\n[true,"caf\uFFFD!","<x\uFFFD>"]\n',
    stderr: "",
    exitCode: 0,
  };
  const spawn = async (cwd: string, cmd: string[]) => {
    await using proc = Bun.spawn({ cmd, env: bunEnv, cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  };
  const run = (cwd: string, ...args: string[]) => spawn(cwd, [bunExe(), ...args]);
  // Builds "entry.mjs" of `dir` and runs the bundle in "away".
  const inlined = async (dir: string, ...flags: string[]) => {
    const outfile = path.join(dir, "away", "out.mjs");
    const build = await run(dir, "build", "--env", "PUB_*", ...flags, "entry.mjs", "--outfile", outfile);
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    return await run(path.dirname(outfile), "out.mjs");
  };

  test("process.env and bun build --env --target=bun have the text that TextDecoder has", async () => {
    using dir = tempDir("bun-build-env-not-utf8", files);
    const [atRunTime, built] = await Promise.all([
      run(String(dir), "runtime.mjs"),
      inlined(String(dir), "--target=bun"),
    ]);
    expect({ atRunTime, built }).toEqual({ atRunTime: texts, built: texts });
  });

  test("bun build --env --target=bun --minify-syntax inlines the text that process.env has", async () => {
    using dir = tempDir("bun-build-env-not-utf8-minify", files);
    expect(await inlined(String(dir), "--target=bun", "--minify-syntax")).toEqual(texts);
  });

  test("bun build --env --target=browser inlines the text that process.env has, as UTF-8", async () => {
    using dir = tempDir("bun-build-env-not-utf8-browser", files);
    expect(await inlined(String(dir), "--target=browser")).toEqual(texts);
    // This throws if the bundle is not UTF-8. A browser bundle has text as it is.
    const bundle = await Bun.file(path.join(String(dir), "away", "out.mjs")).bytes();
    expect(new TextDecoder("utf-8", { fatal: true }).decode(bundle)).toContain('"é€😀"');
  });

  test("Bun.build({ env }) inlines the text that process.env has", async () => {
    using dir = tempDir("bun-build-api-env-not-utf8", {
      ...files,
      "build.mjs": `
        const result = await Bun.build({ entrypoints: ["./entry.mjs"], env: "PUB_*", target: "bun", outdir: "./away" });
        if (!result.success) throw new AggregateError(result.logs);
      `,
    });
    expect(await run(String(dir), "build.mjs")).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    expect(await run(path.join(String(dir), "away"), "entry.js")).toEqual(texts);
  });

  // `--env` makes `bun build` read the .env file. Neither name starts with PUB_: what is inlined is the define that
  // every build has for process.env.NODE_ENV and process.env.BUN_ENV.
  test("bun build inlines NODE_ENV and BUN_ENV as the text that process.env has", async () => {
    const fixture = (line: string, name: string) => ({
      ".env": Buffer.from(line + "\n", "latin1"),
      "entry.mjs": `console.log(Array.from(process.env.${name}, c => c.codePointAt(0).toString(16)).join(" "));`,
      "away": {},
    });
    using dir = tempDir("bun-build-node-env-not-utf8", {
      "bare": fixture("NODE_ENV=caf\xE9", "NODE_ENV"),
      // The value has the double quotes. The build takes such a value for a string literal.
      "quoted": fixture(`BUN_ENV='"b\xFFn"'`, "BUN_ENV"),
    });
    const [bare, quoted] = await Promise.all([
      inlined(path.join(String(dir), "bare"), "--target=bun"),
      inlined(path.join(String(dir), "quoted"), "--target=bun"),
    ]);
    expect({ bare, quoted }).toEqual({
      bare: { stdout: "63 61 66 fffd\n", stderr: "", exitCode: 0 },
      quoted: { stdout: expect.stringContaining("62 fffd 6e"), stderr: "", exitCode: 0 },
    });
  });

  // JavaScript cannot spawn a process with a command line that is not UTF-8. `sh` can.
  describe.skipIf(isWindows)("--define", () => {
    // The bytes of each word, as Latin-1.
    const words = ["caf\xE9", "k\xE9", "v\xA9", "x\xE2\x82y", "a\xAAb"];
    const defines = [
      `S="${words[0]}"`,
      `O={"${words[1]}":["${words[2]}"]}`,
      // A word that is not JSON and not an identifier is a string.
      `B=${words[3]}`,
      // U+00AA can be in an identifier, and this byte is not U+00AA.
      `I=${words[4]}`,
      // An escape is text, not bytes.
      `L="\\uD800"`,
    ].flatMap(define => ["--define", define]);
    // What `new TextDecoder().decode()` is for the bytes of `words` in Node.js, then the value of L.
    const defined = ["63 61 66 fffd", "6b fffd", "76 fffd", "78 fffd 79", "61 fffd 62", "d800"];
    const printAll = (strings: string) =>
      `console.log(JSON.stringify(${strings}.map(text => Array.from(text, c => c.codePointAt(0).toString(16)).join(" "))));`;
    const fixture = {
      "entry.mjs": printAll("[S, Object.keys(O)[0], Object.values(O)[0][0], B, I, L]"),
      "argv.mjs": printAll("process.argv.slice(2)"),
    };
    // Runs bun with `args`, each the bytes of a Latin-1 string.
    const sh = (cwd: string, ...args: string[]) => {
      const octal = (arg: string) =>
        Array.from(Buffer.from(arg, "latin1"), byte => "\\" + byte.toString(8).padStart(3, "0")).join("");
      const script = `exec "$0" ${args.map(arg => `"$(printf '${octal(arg)}')"`).join(" ")}`;
      return spawn(cwd, ["sh", "-c", script, bunExe()]);
    };
    const printed = (strings: string[]) => ({ stdout: JSON.stringify(strings) + "\n", stderr: "", exitCode: 0 });

    test("process.argv and bun build --define have the text that TextDecoder has", async () => {
      using dir = tempDir("bun-build-define-not-utf8", fixture);
      const [argv, build] = await Promise.all([
        sh(String(dir), "argv.mjs", ...words),
        sh(String(dir), "build", ...defines, "--target=bun", "entry.mjs", "--outfile=out.mjs"),
      ]);
      expect(argv).toEqual(printed(defined.slice(0, words.length)));
      expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: "", exitCode: 0 });
      expect(await run(String(dir), "out.mjs")).toEqual(printed(defined));
    });

    test("bun --define inlines the text that process.argv has", async () => {
      using dir = tempDir("bun-run-define-not-utf8", fixture);
      expect(await sh(String(dir), ...defines, "entry.mjs")).toEqual(printed(defined));
    });
  });
});
