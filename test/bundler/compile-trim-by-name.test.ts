import { describe, expect, test } from "bun:test";
import { bunEnv, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
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
  "evaluates.ts": `
    console.log((0, eval)("1 + 1"));
    if (process.argv[2]) console.log(typeof (0, eval)(process.argv[2]));
  `,
};

async function build(folder: string, entry: string, outfile: string, compile: Compile) {
  const built = await Bun.build({ entrypoints: [join(folder, entry)], compile: { outfile: join(folder, outfile, "program"), ...compile } });
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
const run = (folder: string, outfile: string, ...args: string[]) => spawned([join(folder, outfile, "program"), ...args], folder, bunEnv);
const hasIslands = !(await refusal({ trim: true })).includes("nothing can be left out of this Bun");

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
    expect(refused.stderr).toBe("error: compile.trim removed HTMLRewriter from this executable, and something has just asked for it.\n");
    expect(refused.exitCode).toBe(70);
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
    expect(said[1]).toBe(`compile.trim: native libraries left out: ${spelled(["libjpeg-turbo", "libspng", "libwebp", "SQLite"]).join(", ")}`);
    expect(said[2]).toStartWith("compile.trim: native libraries in the executable: ");
    const left = said[2].slice(said[2].lastIndexOf(": ") + 2).split(", ");
    expect(left).toContain(spelled(["libarchive"])[0]);
    expect(left).toContain(spelled(["mimalloc"])[0]);
    expect([...left, ...spelled(["libjpeg-turbo", "libspng", "libwebp", "SQLite"])].sort()).toEqual(
      all.libraries.filter(library => isWindows || library.name !== "libuv").map(library => `${library.name} ${library.version}`).sort(),
    );
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
    expect(await build(folder, "hello.ts", "old", { trimRuntime: true })).toEqual(await build(folder, "hello.ts", "new", { trim: true }));
  });

  test("a name that does not exist stops the build, which lists the names", async () => {
    const said = await refusal({ trim: ["no-such-part"] });
    expect(said).toContain(`compile.trim: there is no "no-such-part". The names are ${all.names.map(each => `"${each.name}"`).join(", ")}`);
    expect(await refusal({ trim: ["htmlrewriter" as never] })).toContain(`compile.trim: there is no "htmlrewriter"`);
    expect(await refusal({ trim: { keep: ["no-such-part"] } })).toContain(`compile.trim: there is no "no-such-part"`);
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
      try {
        expect((await build(folder, "hello.ts", "trimmed", { trim: [name, ...others] as never })).leftOut).toContain(name);
      } catch (error) {
        expect((error as AggregateError).errors.map(each => each.message)).toEqual(["compile.trim: what is named is too small to be cut out of the executable by itself. Name a larger part too"]);
        return;
      }
      expect(await run(folder, "trimmed")).toMatchObject({ stdout: "hello world\n", stderr: "", exitCode: 0 });
    },
  );

  test("a name cannot be both removed and kept", async () => {
    expect(await refusal({ trim: { remove: ["color"], keep: ["color"] } })).toContain(`compile.trim: "color" is in both remove and keep`);
  });

  describe.skipIf(!!unsupported)("with aot", () => {
    test("keep holds what nothing in the program was seen to use, with what it needs", async () => {
      using dir = tempDir("compile-trim-by-name", programs);
      const folder = String(dir);
      const byUse = await build(folder, "hello.ts", "by-use", { aot: true, trim: true });
      expect(byUse.leftOut).toContain("ffi");
      expect(byUse.leftOut).toContain("native-addons");
      const kept = await build(folder, "hello.ts", "kept", { aot: true, trim: { keep: ["ffi"] } });
      expect(kept.leftOut).not.toContain("ffi");
      expect(kept.leftOut).not.toContain("native-addons");
      expect(kept.leftOut).toContain("html-rewriter");
      expect(kept.size).toBeGreaterThan(byUse.size);
      expect(await run(folder, "kept")).toEqual(await run(folder, "by-use"));
      expect(await refusal({ aot: true, trim: { keep: ["ffi"], remove: ["native-addons"] } })).toContain(`"native-addons" is needed by "ffi"`);
    });

    test("remove adds to what the program does not use", async () => {
      using dir = tempDir("compile-trim-by-name", programs);
      const folder = String(dir);
      const byUse = await build(folder, "rewrites.ts", "by-use", { aot: true, trim: true });
      expect(byUse.leftOut).not.toContain("html-rewriter");
      expect(await run(folder, "by-use")).toMatchObject({ stdout: "started\n<p>hello</p>\n", exitCode: 0 });
      const removed = await build(folder, "rewrites.ts", "removed", { aot: true, trim: { remove: ["html-rewriter"] } });
      expect(removed.leftOut.toSorted()).toEqual([...byUse.leftOut, "html-rewriter"].sort());
      expect(await run(folder, "removed")).toMatchObject({ stdout: "started\n", exitCode: 70 });
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
      expect(refused).toMatchObject({ stdout: "2\n", exitCode: 70 });
      expect(refused.stderr).toBe("error: compile.trim removed HTMLRewriter from this executable, and something has just asked for it.\n");
    });
  });
});
