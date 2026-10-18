import { describe, expect, test } from "bun:test";
import { bunEnv, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { join } from "node:path";
import { doorsPath, readTrimFeatures, removedOnlyWith } from "../../scripts/build/trim-features";
import { spawned, unsupported } from "../aot/run-programs";

type Compile = Exclude<Bun.BuildConfig["compile"], boolean | string | undefined>;

const programs = {
  "hello.ts": `console.log("hello world");`,
  "rewrites.ts": `
    console.log("started");
    console.log(await new HTMLRewriter().transform(new Response("<p>hello</p>")).text());
  `,
  "imports-by-computed-names.ts": `
    for (const name of process.argv.slice(2)) {
      try {
        console.log(name, typeof require(name));
      } catch (error) {
        console.log("require:", (error as Error).message);
      }
      try {
        console.log(name, typeof (await import(name)));
      } catch (error) {
        console.log("import:", (error as Error).message);
      }
    }
  `,
  "asks-about-modules.ts": `
    import { builtinModules, isBuiltin } from "node:module";
    for (const name of process.argv.slice(2))
      console.log(name, typeof process.getBuiltinModule(name), isBuiltin(name), builtinModules.includes(name) || builtinModules.includes(name.replace("node:", "")));
  `,
  "imports-by-name.ts": `
    import { Database } from "bun:sqlite";
    console.log(typeof Database);
  `,
  "falls-back.ts": `
    for (const generate of [() => new Function("return 1")(), () => Function("return 2")(), () => (0, eval)("3")]) {
      try {
        console.log(generate());
      } catch (error) {
        console.log(String(error));
      }
    }
  `,
  "evaluates.ts": `
    console.log((0, eval)("1 + 1"));
    if (process.argv[2]) console.log(typeof (0, eval)(process.argv[2]));
  `,
};

function logged(trim: Compile["trim"]): Compile["trim"] {
  if (trim === true) return { log: true };
  if (Array.isArray(trim)) return { auto: false, remove: trim, log: true };
  return trim && { ...trim, log: true };
}

async function build(folder: string, entry: string, outfile: string, compile: Compile) {
  const built = await Bun.build({ entrypoints: [join(folder, entry)], compile: { outfile: join(folder, outfile, "program"), ...compile, ...("trim" in compile && { trim: logged(compile.trim) }) } });
  const bytes = readFileSync(join(folder, outfile, "program") + (isWindows ? ".exe" : ""));
  const said = built.logs.map(log => log.message).filter(message => message.startsWith("compile.trim: "));
  return {
    size: bytes.length,
    contents: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
    leftOut: said.slice(0, 1).flatMap(message => message.slice(message.lastIndexOf(": ") + 2).split(", ")),
    said,
  };
}

async function refusal(compile: Compile) {
  using dir = tempDir("compile-trim-by-name-refused", programs);
  try {
    await Bun.build({ entrypoints: [join(String(dir), "hello.ts")], compile: { outfile: join(String(dir), "hello"), ...compile } });
  } catch (error) {
    return [error, ...((error as AggregateError).errors ?? [])].map(each => (each as Error).message).join("\n");
  }
  return "it was built";
}

const all = readTrimFeatures(readFileSync(doorsPath, "utf8"));
const featuresOf = (name: string) => all.names.find(each => each.name === name)?.features ?? [];
const partsOf = (names: string[]) => all.names.filter(each => names.some(name => each.features.every(feature => featuresOf(name).includes(feature)))).map(each => each.name);
const run = (folder: string, outfile: string, ...args: string[]) => spawned([join(folder, outfile, "program"), ...args], folder, bunEnv);
const hasIslands = !(await refusal({ trim: true })).includes("nothing can be left out of this Bun");

function expectAUseOfWhatWasRemoved(result: { stderr: string; exitCode: number | null }, description: string) {
  if (result.exitCode === 70) expect(result.stderr).toBe(`error: compile.trim removed ${description} from this executable, and something has just asked for it.\n`);
  else expect({ exitCode: result.exitCode, error: /TypeError|compile\.trim removed /.exec(result.stderr)?.[0] ?? result.stderr }).toEqual({ exitCode: 1, error: expect.any(String) });
}

test.each([5, "sqlite", [1], { remove: "sqlite" }, { keep: [{}] }])("compile.trim: %j is refused", async trim => {
  expect(await refusal({ trim: trim as never })).toMatch(/compile\.trim|must be an array/);
});

test("compile.trim: false, [] and { auto: false } leave the executable whole", async () => {
  using dir = tempDir("compile-trim-by-name", programs);
  const folder = String(dir);
  const whole = await build(folder, "hello.ts", "whole", {});
  for (const trim of [false, [], { auto: false }]) expect(await build(folder, "hello.ts", "same", { trim })).toEqual(whole);
});

describe.skipIf(!hasIslands)("compile.trim", () => {
  test("an array takes exactly what it names, though the program uses it", async () => {
    using dir = tempDir("compile-trim-by-name", programs);
    const folder = String(dir);
    const whole = await build(folder, "rewrites.ts", "whole", {});
    expect(await run(folder, "whole")).toMatchObject({ stdout: "started\n<p>hello</p>\n", stderr: "", exitCode: 0 });
    const trimmed = await build(folder, "rewrites.ts", "trimmed", { trim: ["html-rewriter"] });
    expect(trimmed.leftOut).toEqual(["html-rewriter"]);
    expect(trimmed.contents).not.toBe(whole.contents);
    const refused = await run(folder, "trimmed");
    expect(refused.stdout).not.toContain("hello");
    expectAUseOfWhatWasRemoved(refused, "HTMLRewriter");
    expect(await spawned([join(folder, "trimmed", "program"), "--help"], folder, { ...bunEnv, BUN_BE_BUN: "1" })).toMatchObject({ stdout: expect.stringContaining("Usage:"), exitCode: 0 });
  });

  test("the build says how much went, and a program that reaches none of it runs as whole", async () => {
    using dir = tempDir("compile-trim-by-name", programs);
    const folder = String(dir);
    const whole = await build(folder, "hello.ts", "whole", {});
    const trimmed = await build(folder, "hello.ts", "trimmed", { trim: ["cli", "html-rewriter"] });
    expect(trimmed.leftOut.sort()).toEqual(["cli", "html-rewriter"]);
    expect(trimmed.said[0]).toMatch(/^compile\.trim: \d+\.\d MB of the runtime left out: /);
    expect(trimmed.size).toBeLessThan(whole.size - 10_000_000);
    expect(await run(folder, "trimmed")).toEqual(await run(folder, "whole"));
    const asBun = await spawned([join(folder, "trimmed", "program"), "--help"], folder, { ...bunEnv, BUN_BE_BUN: "1" });
    expect(asBun.stderr).toStartWith("error: BUN_BE_BUN is set, but compile.trim removed the Bun command line");
    expect(asBun.exitCode).toBe(70);
  });

  test("the build says which native libraries went and which are still in the executable", async () => {
    using dir = tempDir("compile-trim-by-name", programs);
    const spelled = (names: string[]) => all.libraries.filter(library => names.includes(library.name)).map(library => `${library.name} ${library.version}`);
    const { said } = await build(String(dir), "hello.ts", "trimmed", { trim: ["image", "sqlite"] });
    expect(said[1]).toBe(`compile.trim: native libraries ${isWindows ? "whose code was left out" : "left out"}: ${spelled(["libjpeg-turbo", "libspng", "libwebp", "SQLite"]).join(", ")}`);
    expect(said[2]).toStartWith("compile.trim: native libraries in the executable: ");
    const left = said[2].slice(said[2].lastIndexOf(": ") + 2).split(", ");
    expect(left).toContain(spelled(["libarchive"])[0]);
    expect(left).toContain(spelled(["mimalloc"])[0]);
    expect([...left, ...spelled(["libjpeg-turbo", "libspng", "libwebp", "SQLite"])].sort()).toEqual(
      all.libraries.filter(library => isWindows || library.name !== "libuv").map(library => `${library.name} ${library.version}`).sort(),
    );
  });

  test("an import of a built-in module that was removed throws an error that can be caught", async () => {
    using dir = tempDir("compile-trim-by-name", programs);
    const folder = String(dir);
    await build(folder, "imports-by-computed-names.ts", "trimmed", { trim: ["sqlite"] });
    const gone = (how: string, name: string) => `${how}: Cannot find module '${name}': compile.trim removed "sqlite" from this executable\n`;
    expect(await run(folder, "trimmed", "bun:sqlite", "node:sqlite", "node:path")).toMatchObject({
      stdout: gone("require", "bun:sqlite") + gone("import", "bun:sqlite") + gone("require", "node:sqlite") + gone("import", "node:sqlite") + "node:path object\nnode:path object\n",
      stderr: "",
      exitCode: 0,
    });
    const warned = await Bun.build({ entrypoints: [join(folder, "imports-by-name.ts")], compile: { outfile: join(folder, "named", "program"), trim: ["sqlite"] } });
    expect(warned.logs.filter(log => log.message.startsWith("compile.trim removes ")).map(log => ({ message: log.message, file: log.position?.file, line: log.position?.line }))).toEqual([
      { message: `compile.trim removes "sqlite": this import of "bun:sqlite" will throw`, file: join(folder, "imports-by-name.ts"), line: 2 },
    ]);
    const named = await run(folder, "named");
    expect(named.stderr).toContain(`Cannot find module 'bun:sqlite': compile.trim removed "sqlite" from this executable`);
    expect(named).toMatchObject({ stdout: "", exitCode: 1 });
  });

  describe.each([false, ...(unsupported ? [] : [true])])("with aot: %p", aot => {
    test.concurrent.each(all.names.filter(each => each.modules.length).map(each => [each.name, each] as const))("every import of a module of %s can be caught", async (name, each) => {
      using dir = tempDir("compile-trim-by-name", programs);
      const folder = String(dir);
      const spellings = each.modules.flatMap(module => (isBuiltin(module.slice(module.indexOf(":") + 1)) ? [module, module.slice(module.indexOf(":") + 1)] : [module]));
      await build(folder, "imports-by-computed-names.ts", "trimmed", { aot, trim: [name, ...removedOnlyWith(all, each)] as never });
      const { stdout, ...rest } = await run(folder, "trimmed", ...spellings);
      expect(rest).toMatchObject({ stderr: "", exitCode: 0 });
      expect(stdout.split("\n").filter(line => line && !/^(require|import): (Cannot find module '.*': )?compile\.trim removed .* from this executable$/.test(line))).toEqual([]);
      expect(stdout.split("\n").length - 1).toBe(2 * spellings.length);
    });

    test.concurrent.each(all.names.filter(each => each.modules.length).map(each => [each.name, each] as const))("a module of %s is no built-in module any more", async (name, each) => {
      using dir = tempDir("compile-trim-by-name", programs);
      const folder = String(dir);
      const spellings = each.modules.flatMap(module => (isBuiltin(module.slice(module.indexOf(":") + 1)) ? [module, module.slice(module.indexOf(":") + 1)] : [module]));
      await build(folder, "asks-about-modules.ts", "trimmed", { aot, trim: [name, ...removedOnlyWith(all, each)] as never });
      expect(await run(folder, "trimmed", ...spellings, "node:path", "path")).toMatchObject({
        stdout: spellings.map(spelling => spelling + " undefined false false\n").join("") + "node:path object true true\npath object true true\n",
        stderr: "",
        exitCode: 0,
      });
    });

    test("a program that imports a removed module by name ends with the reason", async () => {
      using dir = tempDir("compile-trim-by-name", programs);
      const folder = String(dir);
      await build(folder, "imports-by-name.ts", "named", { aot, trim: ["sqlite"] });
      const named = await run(folder, "named");
      expect(named.stderr).toContain(`Cannot find module 'bun:sqlite': compile.trim removed "sqlite" from this executable`);
      expect(named).toMatchObject({ stdout: "", exitCode: 1 });
    });
  });

  test("the build after a trimmed one is whole again", async () => {
    using dir = tempDir("compile-trim-by-name", programs);
    const folder = String(dir);
    const whole = await build(folder, "hello.ts", "whole", {});
    await build(folder, "hello.ts", "trimmed", { trim: true });
    expect(await build(folder, "hello.ts", "again", {})).toEqual(whole);
  });

  test("trimRuntime: true is trim: true", async () => {
    using dir = tempDir("compile-trim-by-name", programs);
    const folder = String(dir);
    expect((await build(folder, "hello.ts", "old", { trimRuntime: true })).contents).toBe((await build(folder, "hello.ts", "new", { trim: true })).contents);
  });

  test.each([[true], [["color", "sqlite"]], [{ remove: ["color"] }], [{ remove: ["color"], log: false }]] as [Compile["trim"]][])("the build says nothing about %j unless log is true", async trim => {
    using dir = tempDir("compile-trim-by-name", programs);
    const folder = String(dir);
    const silent = await Bun.build({ entrypoints: [join(folder, "hello.ts")], compile: { outfile: join(folder, "silent", "program"), trim } });
    expect(silent.logs.map(log => log.message)).toEqual([]);
    const told = await build(folder, "hello.ts", "told", { trim });
    expect(told.said.length).toBeGreaterThanOrEqual(2);
    expect(new Bun.CryptoHasher("sha256").update(readFileSync(join(folder, "silent", "program") + (isWindows ? ".exe" : ""))).digest("hex")).toBe(told.contents);
  });

  test("a name that does not exist stops the build, which lists the names", async () => {
    const said = await refusal({ trim: ["no-such-part"] });
    expect(said).toContain(`compile.trim: there is no "no-such-part". The names are ${all.names.map(each => `"${each.name}"`).join(", ")}`);
    expect(await refusal({ trim: ["htmlrewriter" as never] })).toContain(`compile.trim: there is no "htmlrewriter"`);
    expect(await refusal({ trim: { keep: ["no-such-part"] } })).toContain(`compile.trim: there is no "no-such-part"`);
    expect(await refusal({ trim: ["nothing", "color", "nobody"] as never })).toContain(`compile.trim: there is no "nothing" or "nobody". The names are "`);
    expect(await refusal({ trim: { remove: ["nothing", "nobody"], keep: ["nowhere", "nothing"] } as never })).toContain(`compile.trim: there is no "nothing", "nobody" or "nowhere". The names are "`);
  });

  test("what a part that stays needs cannot be removed", async () => {
    expect(await refusal({ trim: ["native-addons"] })).toContain(`compile.trim: "native-addons" is needed by "ffi". Remove those too, or keep "native-addons"`);
    expect(await refusal({ trim: ["native-addons", "ffi"] })).toBe("it was built");
  });

  test("what only stops a part of something that stays from working can be removed", async () => {
    expect(all.names.find(each => each.name === "sqlite")!.also.map(also => also.feature)).toEqual(["sql"]);
    expect(await refusal({ trim: ["sqlite"] })).toBe("it was built");
  });

  test("what runs the program's own text can be removed only from a program that was compiled ahead of time", async () => {
    expect(await refusal({ trim: ["interpreter", "bundler", "inspector", "node-vm"] })).toContain(`compile.trim: "interpreter" can be removed only with compile.aot`);
  });

  test.concurrent.each(all.names.filter(each => each.name !== "interpreter").map(each => [each.name, removedOnlyWith(all, each)] as const))(
    "%s can be removed with no more than %j, and a program that reaches none of it runs",
    async (name, others) => {
      using dir = tempDir("compile-trim-by-name", programs);
      const folder = String(dir);
      expect(partsOf((await build(folder, "hello.ts", "trimmed", { trim: [name, ...others] as never })).leftOut)).toContain(name);
      expect(await run(folder, "trimmed")).toMatchObject({ stdout: "hello world\n", stderr: "", exitCode: 0 });
    },
  );

  test("automatic install is refused where the package manager was removed", async () => {
    using dir = tempDir("compile-trim-by-name", { ...programs, "configured/bunfig.toml": `[install]\nauto = "force"\n` });
    const folder = String(dir);
    const isLeftOut = "cannot be used with this executable: the part of Bun that it needs was left out when it was built";
    await build(folder, "hello.ts", "trimmed", { trim: ["install"], autoloadBunfig: true });
    const program = join(folder, "trimmed", "program");
    expect(await run(folder, "trimmed")).toMatchObject({ stdout: "hello world\n", stderr: "", exitCode: 0 });
    for (const [option, name] of [["-i", "-i"], ["--install=fallback", "--install"]])
      expect(await spawned([program], folder, { ...bunEnv, BUN_OPTIONS: option })).toMatchObject({ stdout: "", stderr: `error: ${name} ${isLeftOut}\n`, exitCode: 1 });
    expect(await spawned([program], folder, { ...bunEnv, BUN_OPTIONS: "--no-install" })).toMatchObject({ stdout: "hello world\n", stderr: "", exitCode: 0 });
    expect(await spawned([program], join(folder, "configured"), bunEnv)).toMatchObject({ stdout: "", stderr: `error: "install.auto" in bunfig.toml ${isLeftOut}\n`, exitCode: 1 });
    expect(await refusal({ trim: ["install"], execArgv: ["-i"] })).toContain(`-i ${isLeftOut}`);
    expect(await refusal({ trim: ["color"], execArgv: ["-i"] })).toBe("it was built");
  });

  test.skipIf(isWindows)("without \"ipc\" the executable runs as one that was started without a channel", async () => {
    const tells = `
      console.log(typeof process.send, process.connected);
      process.once("message", () => {});
      process.removeAllListeners("message");
      process.send?.("hello");
      process.disconnect?.();
    `;
    using dir = tempDir("compile-trim-by-name", { "tells-its-parent.ts": tells });
    const folder = String(dir);
    const started = async (outfile: string, trim: Bun.Build.TrimFeature[]) => {
      await build(folder, "tells-its-parent.ts", outfile, { trim });
      const messages: unknown[] = [];
      await using child = Bun.spawn({ cmd: [join(folder, outfile, "program")], env: bunEnv, stdout: "pipe", stderr: "pipe", serialization: "json", ipc: message => void messages.push(message) });
      const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
      return { stdout, stderr, exitCode, messages };
    };
    expect(await started("whole", [])).toEqual({ stdout: "function true\n", stderr: "", exitCode: 0, messages: ["hello"] });
    const ipc = all.names.find(each => each.name === "ipc")!;
    expect(await started("trimmed", ["ipc", ...removedOnlyWith(all, ipc)] as never)).toEqual({ stdout: "undefined false\n", stderr: "", exitCode: 0, messages: [] });
  });

  test("a name cannot be both removed and kept", async () => {
    expect(await refusal({ trim: { remove: ["color"], keep: ["color"] } })).toContain(`compile.trim: "color" is in both remove and keep`);
  });

  describe.skipIf(!!unsupported)("with aot", () => {
    test("keep holds what nothing in the program was seen to use, with what it needs", async () => {
      using dir = tempDir("compile-trim-by-name", programs);
      const folder = String(dir);
      const byUse = await build(folder, "hello.ts", "by-use", { aot: true, trim: true });
      expect(partsOf(byUse.leftOut)).toContain("ffi");
      expect(partsOf(byUse.leftOut)).toContain("native-addons");
      const kept = await build(folder, "hello.ts", "kept", { aot: true, trim: { keep: ["ffi"] } });
      expect(partsOf(kept.leftOut)).not.toContain("ffi");
      expect(partsOf(kept.leftOut)).not.toContain("native-addons");
      expect(kept.leftOut).toContain("html-rewriter");
      expect(kept.size).toBeGreaterThan(byUse.size);
      expect(await run(folder, "kept")).toEqual(await run(folder, "by-use"));
      expect(await refusal({ aot: true, trim: { keep: ["ffi"], remove: ["native-addons"] } })).toContain(`"native-addons" is needed by "ffi"`);
    });

    test("eval and Function throw an EvalError where the interpreter was removed", async () => {
      using dir = tempDir("compile-trim-by-name", programs);
      const folder = String(dir);
      await build(folder, "falls-back.ts", "whole", { aot: true });
      expect(await run(folder, "whole")).toMatchObject({ stdout: "1\n2\n3\n", stderr: "", exitCode: 0 });
      const interpreter = all.names.find(each => each.name === "interpreter")!;
      await build(folder, "falls-back.ts", "removed", { aot: true, trim: ["interpreter", ...removedOnlyWith(all, interpreter)] as never });
      expect(await run(folder, "removed")).toMatchObject({
        stdout: `EvalError: Code generation from strings disallowed for this context: compile.trim removed "interpreter" from this executable\n`.repeat(3),
        stderr: "",
        exitCode: 0,
      });
    });

    test("remove adds to what the program does not use", async () => {
      using dir = tempDir("compile-trim-by-name", programs);
      const folder = String(dir);
      const byUse = await build(folder, "rewrites.ts", "by-use", { aot: true, trim: true });
      expect(byUse.leftOut).not.toContain("html-rewriter");
      expect(await run(folder, "by-use")).toMatchObject({ stdout: "started\n<p>hello</p>\n", exitCode: 0 });
      const removed = await build(folder, "rewrites.ts", "removed", { aot: true, trim: { remove: ["html-rewriter"] } });
      expect(removed.leftOut.toSorted()).toEqual([...byUse.leftOut, "html-rewriter"].sort());
      const refused = await run(folder, "removed");
      expect(refused.stdout).toBe("started\n");
      expectAUseOfWhatWasRemoved(refused, "HTMLRewriter");
    });

    test("a list works on a program that evaluates text, where nothing else can be proved unused", async () => {
      using dir = tempDir("compile-trim-by-name", programs);
      const folder = String(dir);
      const byUse = await build(folder, "evaluates.ts", "by-use", { aot: true, trim: true });
      expect(byUse.leftOut).not.toContain("html-rewriter");
      const list = ["html-rewriter", "sqlite", "sql", "webview"] as const;
      const removed = await build(folder, "evaluates.ts", "removed", { aot: true, trim: { remove: [...list] } });
      expect(removed.leftOut.toSorted()).toEqual([...byUse.leftOut, ...list].sort());
      expect(removed.size).toBeLessThanOrEqual(byUse.size);
      expect(await run(folder, "removed", "Bun.color")).toEqual(await run(folder, "by-use", "Bun.color"));
      expect(await run(folder, "by-use", "new HTMLRewriter()")).toMatchObject({ stdout: "2\nobject\n", exitCode: 0 });
      const refused = await run(folder, "removed", "new HTMLRewriter()");
      expect(refused.stdout).toBe("2\n");
      expectAUseOfWhatWasRemoved(refused, "HTMLRewriter");
    });
  });
});
