import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isCI, isLinux, isMacOS, isWindows, readElf64ProgramHeaders } from "harness";
import { closeSync, constants, openSync, readFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { unsupported } from "../aot/harness/compiler";
import { run } from "../aot/harness/run";
import { sharedBuilds, sizeOf, type Build } from "../aot/harness/shared-builds";
import { copyWithoutDebugInformation as executablePath } from "../aot/harness/without-debug-information";
import { canTrim, featureNamed, followedRequirements, probeTrim, textOf, trimFeatures } from "./compile-trim-features";

type Compile = Exclude<Bun.BuildConfig["compile"], boolean | string | undefined>;

const { folder, build } = sharedBuilds("compile-trim-runtime", {
  "tsconfig.json": `{ "compilerOptions": { "types": ["bun"] } }`,
  "hello.ts": `
    console.log("hello world");
    if (process.argv[2] === "deep") console.log({ a: { b: { c: 1 } } });
  `,
  "helper.ts": `export function double(x: number): number { return x * 2; }`,
  "entry.ts": `import { double } from "./helper"; console.log(double(21));`,
  "on-disk.ts": `export const fromDisk: string = [1, 2, 3].map((x: number) => x * 2).join(",");`,
  "near-removed-features.ts": `
    const built = await Bun.build({ entrypoints: [process.env.FOLDER + "/entry.ts"], target: "bun" });
    console.log(built.success, built.outputs.length);
    console.log(new Bun.Transpiler({ loader: "ts" }).transformSync("const x: number = 1; export default x;").trim());
    console.log(new Function("a", "b", "return a * b")(6, 7), (0, eval)("1 + 1"));
    console.log((await import(process.env.FOLDER + "/on-disk.ts")).fromDisk);
    console.log(new RegExp(process.env.FOLDER ? "(a+)b" : "x").exec("caab")![1]);
    let sum = 0;
    for (let i = 0; i < 3_000_000; i++) sum = (sum + i) | 0;
    console.log(sum);
  `,
  "everything-by-name.ts": `
    import { builtinModules } from "node:module";
    process.noDeprecation = true;
    const names: string[] = [...builtinModules, "bun", "bun:test", "bun:jsc", "bun:ffi", "bun:sqlite", "node:test", "node:sqlite"];
    for (const name of [...new Set(names)].sort()) {
      try {
        console.log(name, Object.keys(require(name) as object).length);
      } catch (error) {
        console.log(name, "throws", (error as Error).message);
      }
    }
    for (const object of [Bun, globalThis, process] as unknown as Record<string, unknown>[]) {
      const kinds: string[] = [];
      for (const key of Object.getOwnPropertyNames(object).sort()) {
        try {
          kinds.push(key + ":" + typeof object[key]);
        } catch {
          kinds.push(key + ":throws");
        }
      }
      console.log(kinds.join(" "));
    }
  `,
  "asks-for-the-checker.ts": `
    const entrypoints = [process.env.FOLDER + "/entry.ts"];
    for (const options of [{ check: true }, { compile: { aot: true } }]) {
      try {
        await Bun.build({ entrypoints, ...options });
      } catch (error) {
        console.log(((error as AggregateError).errors?.[0] ?? (error as Error)).message);
      }
    }
    console.log((await Bun.build({ entrypoints, target: "bun" })).success);
  `,
  "waits.ts": `console.log("ready"); for await (const _ of Bun.stdin.stream()) break;`,
  "preloaded.js": `console.log("preloaded");`,
  "prints-one-level/bunfig.toml": "[console]\ndepth = 1\n",
});
const inFolder = { ...bunEnv, FOLDER: folder };
const saysHello = { stdout: "hello world\n", stderr: "", exitCode: 0 };

function printedBy(trimmed: Build) {
  const [, size, removed] =
    new RegExp(
      ` compile +${trimmed.name}(?:\\.exe)? +(\\d+\\.\\d) MB \\((\\d+\\.\\d) MB of unused Bun APIs removed\\)\\n`,
    ).exec(trimmed.stdout) ?? [];
  return { size, removed: Number(removed) };
}

let lastBuildInThisProcess: Promise<unknown> = Promise.resolve();
let buildsInThisProcess = 0;

// One after the other: what a build leaves behind in the process is for the next one to find.
function buildWithApi(compile: Compile) {
  const outfile = join(folder, `api-${buildsInThisProcess++}`, "program");
  const mine = lastBuildInThisProcess.then(async () => {
    const built = await Bun.build({
      entrypoints: [join(folder, "hello.ts")],
      compile: { outfile, ...(executablePath && { executablePath }), ...compile },
    });
    const bytes = readFileSync(outfile + (isWindows ? ".exe" : ""));
    const messages = built.logs.map(log => log.message);
    const logged = messages.filter(message => message.startsWith("compile.trim: "));
    return {
      outfile,
      messages,
      logged,
      removed: logged.slice(0, 1).flatMap(message => message.slice(message.lastIndexOf(": ") + 2).split(", ")),
      file: { size: bytes.length, contents: new Bun.CryptoHasher("sha256").update(bytes).digest("hex") },
    };
  });
  lastBuildInThisProcess = mine.catch(() => {});
  return mine;
}

const builtWithApi = new Map<string, ReturnType<typeof buildWithApi>>();
const builtOnceWithApi = (compile: Compile) =>
  builtWithApi.getOrInsertComputed(JSON.stringify(compile), () => buildWithApi(compile));

async function failureOf(compile: Compile) {
  try {
    await Bun.build({
      entrypoints: [join(folder, "hello.ts")],
      compile: { outfile: join(folder, "invalid", "hello"), ...compile },
    });
  } catch (error) {
    return [error, ...((error as AggregateError).errors ?? [])].map(each => (each as Error).message).join("\n");
  }
  return "it was built";
}

const featuresOfName = (name: string) => trimFeatures.find(each => each.name === name)?.features ?? [];
const namesCoveredBy = (names: string[]) =>
  trimFeatures
    .filter(each => names.some(name => each.features.every(feature => featuresOfName(name).includes(feature))))
    .map(each => each.name);

test.skipIf(canTrim)("a Bun that can't trim says so", () => {
  const { stderr, exitCode } = probeTrim();
  expect(stderr).toContain("error: this build of Bun doesn't support --trim (");
  expect(exitCode).not.toBe(0);
});

test.skipIf(!isCI || isASAN)("every Bun that CI builds can trim, except the one with AddressSanitizer", () => {
  expect(probeTrim()).toEqual({ stderr: "", exitCode: 0 });
});

test.skipIf(canTrim)("Bun.build rejects compile.trim on a Bun that can't trim", async () => {
  expect(await failureOf({ trim: true })).toContain("this build of Bun doesn't support --trim");
});

test.each([
  [5],
  ["sqlite"],
  [[]],
  [["sqlite"]],
  [{ auto: false }],
  [{ deny: ["sqlite"] }],
  [{ keep: ["sqlite"] }],
  [{ allow: [{}] }],
  [{ remove: [{}] }],
  [{ locales: [1] }],
])("compile.trim: %j is not a valid value", async trim => {
  expect(await failureOf({ trim: trim as never })).toContain(
    "compile.trim must be true, false or an object: { allow, remove, locales, log }",
  );
});

test.each([
  ["allow", { allow: "sqlite" }],
  ["remove", { remove: "sqlite" }],
  ["locales", { locales: "en" }],
])("compile.trim.%s must be an array", async (key, trim) => {
  expect(await failureOf({ trim: trim as never })).toContain(`${key} must be an array`);
});

test.concurrent("compile.trim: false and undefined don't change the executable", async () => {
  const untrimmed = await builtOnceWithApi({});
  for (const trim of [false, undefined]) expect((await buildWithApi({ trim })).file).toEqual(untrimmed.file);
});

test.concurrent("--trim requires --compile", async () => {
  const built = await run([bunExe(), "build", "--trim", "hello.ts"], folder);
  expect(built.stderr).toContain("--trim requires --compile");
  expect(built.exitCode).not.toBe(0);
});

(canTrim ? describe.concurrent : describe.skip)("--trim", () => {
  test("--trim-without rejects an unknown feature name", async () => {
    const built = await run(
      [bunExe(), "build", "--compile", "--trim", "--trim-without=NoSuchFeature", "hello.ts", "--outfile", "unknown"],
      folder,
    );
    expect(built.stderr).toContain("NoSuchFeature");
    expect(built.stderr).not.toContain("this build of Bun doesn't support --trim");
    expect(built.exitCode).toBe(1);
  });

  for (const flags of [[], ["--aot"]]) {
    const how = ["--compile", ...flags].join(" ");
    const isAot = flags.length > 0;

    async function isSmallerAndPrintsTheSame(program: string) {
      const whole = await build(`${program}.ts`, ...flags);
      const trimmed = await build(`${program}.ts`, ...flags, "--trim");
      const printed = await run([whole.executable], folder, inFolder);
      expect(await run([trimmed.executable], folder, inFolder)).toEqual(printed);
      expect(printed).toMatchObject({ exitCode: 0 });
      expect(sizeOf(whole) - sizeOf(trimmed)).toBeGreaterThan(isAot ? 15_000_000 : 30_000_000);
    }

    test.skipIf(isAot && !!unsupported)(
      `${how}: hello: the trimmed executable is much smaller and prints the same output`,
      () => isSmallerAndPrintsTheSame("hello"),
    );

    if (!isAot)
      test(`${how}: near-removed-features: the trimmed executable is much smaller and prints the same output`, () =>
        isSmallerAndPrintsTheSame("near-removed-features"));

    (isAot ? test.todo : test)(
      `${how}: a program that loads every built-in module from a dynamic path: the trimmed executable is much smaller and prints the same output` +
        (isAot
          ? " (loading a built-in module from a dynamic path should fail like a package that is not installed, with and without --trim)"
          : ""),
      () => isSmallerAndPrintsTheSame("everything-by-name"),
    );

    test.skipIf(isAot && !!unsupported)(
      `${how}: the build prints the executable's size and how much was removed`,
      async () => {
        expect((await build("hello.ts", ...flags)).stdout).not.toContain(" MB");
        const trimmed = await build("hello.ts", ...flags, "--trim");
        const { size, removed } = printedBy(trimmed);
        expect({ size, stdout: trimmed.stdout }).toEqual({
          size: (sizeOf(trimmed) / 1e6).toFixed(1),
          stdout: trimmed.stdout,
        });
        expect(removed).toBeGreaterThan(30);
      },
    );

    test.skipIf(isAot && !!unsupported)(
      `${how}: bunfig.toml is read only by an executable that was built to read it`,
      async () => {
        const byDefault = await build("hello.ts", ...flags, "--trim");
        const asked = await build("hello.ts", ...flags, "--trim", "--compile-autoload-bunfig");
        const besideTheFile = join(folder, "prints-one-level");
        expect(await run([byDefault.executable, "deep"], besideTheFile)).toEqual({
          ...saysHello,
          stdout: "hello world\n{\n  a: {\n    b: {\n      c: 1,\n    },\n  },\n}\n",
        });
        expect(await run([asked.executable, "deep"], besideTheFile)).toEqual({
          ...saysHello,
          stdout: "hello world\n{\n  a: {\n    b: [Object ...],\n  },\n}\n",
        });
      },
    );

    test.skipIf(!isLinux || (isAot && !!unsupported))(
      `${how}: the program is mapped past the end of Bun's image, never where a feature was removed, and the zeros of .bss are not in the file`,
      async () => {
        const hello = await build("hello.ts", ...flags, "--trim");
        const segments = readElf64ProgramHeaders(hello.file).filter(header => header.type === 1);
        for (const [index, segment] of segments.entries()) {
          if (index)
            expect(segment.vaddr).toBeGreaterThanOrEqual(segments[index - 1].vaddr + segments[index - 1].memsz);
        }
        const endOfBun = segments.findLastIndex(segment => segment.filesz < segment.memsz);
        expect(endOfBun).toBeGreaterThanOrEqual(0);
        expect(segments.slice(endOfBun + 1).length).toBeGreaterThan(0);
        expect(await run([hello.executable], folder)).toEqual(saysHello);
      },
    );

    test.skipIf(isWindows || (isAot && !!unsupported))(
      `${how}: using a removed feature ends the program even when file descriptor 2 takes no more bytes`,
      async () => {
        const hello = await build("hello.ts", ...flags, "--trim");
        const pipe = join(folder, isAot ? "pipe-aot" : "pipe");
        expect(Bun.spawnSync(["mkfifo", pipe]).exitCode).toBe(0);
        const readerThatNeverReads = openSync(pipe, constants.O_RDWR | constants.O_NONBLOCK);
        const descriptor2 = openSync(pipe, constants.O_WRONLY);
        try {
          expect(() => {
            while (true) writeSync(readerThatNeverReads, Buffer.alloc(512, "y"));
          }).toThrow(expect.objectContaining({ code: "EAGAIN" }));
          await using asked = Bun.spawn({
            cmd: [hello.executable, "install"],
            cwd: folder,
            env: { ...bunEnv, BUN_BE_BUN: "1" },
            stdout: "pipe",
            stderr: descriptor2,
          });
          expect(await Promise.race([asked.exited, Bun.sleep(20_000).then(() => "it hangs")])).toBe(70);
        } finally {
          closeSync(descriptor2);
          closeSync(readerThatNeverReads);
        }
      },
    );

    test.skipIf(isAot && !!unsupported)(`${how}: BUN_BE_BUN=1 fails with the name of the removed feature`, async () => {
      const hello = await build("hello.ts", ...flags, "--trim");
      const asked = await run([hello.executable, "install"], folder, { ...bunEnv, BUN_BE_BUN: "1" });
      // It is written to C's descriptor 2, which translates line ends on Windows.
      expect(asked.stderr).toBe(
        `error: BUN_BE_BUN is set, but this executable doesn't include ${textOf(featureNamed("Tools"))}. Run bun instead.${isWindows ? "\r\n" : "\n"}`,
      );
      expect(asked).toMatchObject({ stdout: "", exitCode: 70 });
      const version = await run([hello.executable, "--version"], folder, { ...bunEnv, BUN_BE_BUN: "1" });
      expect(version).toEqual({ stdout: Bun.version + "\n", stderr: "", exitCode: 0 });
    });
  }

  // Its build compiles all of Bun's own modules, so there is one. Without --trim: ../aot/cli/admitted-code.test.ts.
  test.skipIf(!!unsupported)(
    "--compile --aot --compile-inspector: near-removed-features: much is removed, and the executable prints what bun prints, also with --preload in BUN_OPTIONS",
    async () => {
      const trimmed = await build("near-removed-features.ts", "--aot", "--compile-inspector", "--trim");
      expect(printedBy(trimmed).removed).toBeGreaterThan(15);
      const plain = await run([bunExe(), "run", "near-removed-features.ts"], folder, inFolder);
      expect({ ...plain, stdout: plain.stdout.split("\n")[0] }).toEqual({ stdout: "true 1", stderr: "", exitCode: 0 });
      expect(await run([trimmed.executable], folder, inFolder)).toEqual(plain);
      expect(await run([trimmed.executable], folder, { ...inFolder, BUN_OPTIONS: "--preload ./preloaded.js" })).toEqual(
        { ...plain, stdout: "preloaded\n" + plain.stdout },
      );
    },
  );

  test("Bun.build({ check }) and ({ compile: { aot } }) called by a trimmed executable throw", async () => {
    const asks = await build("asks-for-the-checker.ts", "--trim");
    expect(await run([asks.executable], folder, inFolder)).toEqual({
      stdout:
        "check: this executable doesn't include the type checker\n" +
        "compile.aot isn't available in this build of Bun\n" +
        "true\n",
      stderr: "",
      exitCode: 0,
    });
  });

  const canSeeMemory =
    isMacOS &&
    Bun.spawnSync({ cmd: ["vmmap", String(process.pid)], stdout: "ignore", stderr: "ignore" }).exitCode === 0;

  test.skipIf(!canSeeMemory)(
    "macOS: no piece of the constants that hold addresses can be written while the program runs",
    async () => {
      const waits = await build("waits.ts", "--trim");
      await using child = Bun.spawn({
        cmd: [waits.executable],
        env: bunEnv,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "inherit",
      });
      expect(new TextDecoder().decode((await child.stdout.getReader().read()).value)).toBe("ready\n");
      const map = await run(["vmmap", String(child.pid)], folder);
      const pieces = map.stdout
        .split("\n")
        .filter(line => line.startsWith("__DATA_CONST") && line.endsWith("/" + waits.name));
      expect(pieces.length).toBeGreaterThan(0);
      expect(pieces.filter(line => !line.includes("] r--/"))).toEqual([]);
      child.stdin.end();
    },
  );

  describe("compile.trim", () => {
    const started = (built: { outfile: string }) => run([built.outfile], folder);

    test("an untrimmed build after a trimmed one is the same as before it", async () => {
      const untrimmed = await builtOnceWithApi({});
      await builtOnceWithApi({ trim: true });
      expect((await buildWithApi({})).file).toEqual(untrimmed.file);
    });

    test.each([[true], [{ allow: ["color"] }], [{ log: false }]] as [true | Bun.TrimOptions][])(
      "%j: the build logs nothing about it",
      async trim => {
        expect((await builtOnceWithApi({ trim })).messages).toEqual([]);
      },
    );

    test("log: true lists how much was removed and the names of the removed features, and changes no byte", async () => {
      const untrimmed = await builtOnceWithApi({});
      const trimmed = await builtOnceWithApi({ trim: { log: true } });
      expect(trimmed.logged[0]).toMatch(
        /^compile\.trim: removed \d+\.\d MB of the runtime, \d+\.\d MB of it from the file: /,
      );
      expect(trimmed.removed.filter(name => !trimFeatures.some(each => each.name === name))).toEqual([]);
      expect(trimmed.file.size).toBeLessThan(untrimmed.file.size - 30_000_000);
      expect(trimmed.file).toEqual((await builtOnceWithApi({ trim: true })).file);
      expect(await started(trimmed)).toEqual(await started(untrimmed));
      expect(await started(trimmed)).toEqual(saysHello);
    });

    test("an unknown name in allow fails the build with the closest name, or with every valid name", async () => {
      const validNames = trimFeatures.map(each => `"${each.name}"`).join(", ");
      expect(await failureOf({ trim: { allow: ["htmlrewriter" as never] } })).toContain(
        `compile.trim: unknown name "htmlrewriter". Did you mean "html-rewriter"?`,
      );
      expect(await failureOf({ trim: { allow: ["no-such-feature" as never] } })).toContain(
        `compile.trim: unknown name "no-such-feature". Valid names are ${validNames}`,
      );
      expect(await failureOf({ trim: { allow: ["nothing", "color", "nobody", "nothing"] as never } })).toContain(
        `compile.trim: unknown names "nothing" and "nobody". Valid names are ${validNames}`,
      );
    });

    test.skipIf(!!unsupported)(
      "with aot, allow keeps a feature that the code never uses, and what that feature needs",
      async () => {
        const byUse = await builtOnceWithApi({ aot: true, trim: { log: true } });
        const removedByUse = namesCoveredBy(byUse.removed);
        const [requirement] = followedRequirements.filter(
          ({ name, requiredName }) => removedByUse.includes(name) && removedByUse.includes(requiredName),
        );
        expect(requirement).toBeDefined();
        const { name, requiredName } = requirement!;
        const allowed = await builtOnceWithApi({
          aot: true,
          trim: { allow: [name as Bun.Build.TrimFeature], log: true },
        });
        expect(namesCoveredBy(allowed.removed)).not.toContain(name);
        expect(namesCoveredBy(allowed.removed)).not.toContain(requiredName);
        expect(allowed.removed).toContain("html-rewriter");
        expect(allowed.file.size).toBeGreaterThan(byUse.file.size);
        expect(await started(allowed)).toEqual(await started(byUse));
      },
    );
  });
});
