import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { slot, spawned, unsupported } from "../aot/run-programs";

function executableAt(path: string) {
  const bytes = readFileSync(path + (isWindows ? ".exe" : ""));
  return { size: bytes.length, contents: new Bun.CryptoHasher("sha256").update(bytes).digest("hex") };
}

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined> = bunEnv) {
  await using child = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout, stderr, exitCode };
}

const features: Record<string, { leftOut: string; program: string; prints: string }> = {
  htmlrewriter: {
    leftOut: "without HTMLRewriter",
    program: `
      const rewriter = new HTMLRewriter().on("p", {
        element(element: { setAttribute(name: string, value: string): void }) {
          element.setAttribute("class", "seen");
        },
      });
      console.log(await rewriter.transform(new Response("<p>one</p><p>two</p>")).text());
    `,
    prints: `<p class="seen">one</p><p class="seen">two</p>\n`,
  },
  color: {
    leftOut: "without Bun.color",
    program: `console.log(Bun.color("red", "hex"));`,
    prints: "#ff0000\n",
  },
  bundler: {
    leftOut: "without Bun.build, HTML imports and the development server",
    program: `
      const built = await Bun.build({ entrypoints: [process.env.FOLDER + "/bundled.ts"], target: "bun" });
      console.log(built.success, built.outputs.length);
    `,
    prints: "true 1\n",
  },
};

const files = {
  "hello.ts": `console.log("hello world");`,
  "bundled.ts": `export const answer: number = 42;`,
  "serves-its-default-export.ts": `
    export default { port: 0, fetch: () => new Response("served") };
    setTimeout(() => process.exit(0), 50);
  `,
  "evaluates.ts": `console.log(typeof (0, eval)("HTMLRewriter"), typeof (0, eval)("Bun.color"));`,
  "near-what-is-left-out.ts": `
    const started = performance.now();
    console.log(performance.now() >= started, performance.timeOrigin > 0, typeof performance.mark, "mark" in performance);
    try {
      throw new Error("caught");
    } catch (error) {
      console.log(String((error as Error).stack).split("\\n").length > 1);
    }
  `,
  "styled-route.ts": `
    try {
      const server = Bun.serve({ port: 0, development: true, routes: { "/*": { dir: process.env.FOLDER, style: "nextjs-pages" } } as never, fetch: () => new Response("") });
      console.log("serves", typeof server.port);
    } catch (error) {
      console.log((error as Error).message);
    }
    process.exit(0);
  `,
  "serves.ts": `
    const server = Bun.serve({
      port: 0,
      routes: { "/a": () => new Response("a"), "/b": { GET: () => new Response("b") }, "/c/*": { dir: process.env.FOLDER } } as never,
      fetch: () => new Response("served"),
    });
    for (const path of ["/", "/a", "/b", "/c/bundled.ts"]) console.log(await (await fetch(new URL(path, server.url))).text());
    server.stop(true);
  `,
  "reloads.ts": `
    const server = Bun.serve({ port: 0, development: true, fetch: () => new Response("first") });
    const dir = process.env.FOLDER;
    for (const style of ["nextjs-pages", "no such style", () => {}, 1]) {
      try {
        server.reload({ routes: { "/pages/*": { dir, style }, "/by-method/*": { GET: { dir, style } } }, fetch: () => new Response("second") } as never);
        console.log("reloaded");
      } catch (error) {
        console.log((error as Error).message);
      }
    }
    for (const path of ["/", "/pages/bundled.ts"]) console.log(await (await fetch(new URL(path, server.url))).text());
    try {
      server.reload({ development: false, routes: { "/pages/*": { dir, style: "nextjs-pages" } } } as never);
      console.log("reloaded");
    } catch (error) {
      console.log((error as Error).message);
    }
    server.stop(true);
  `,
  ...Object.fromEntries(Object.entries(features).map(([name, feature]) => [`uses-${name}.ts`, feature.program])),
};

using probe = tempDir("compile-trim-runtime-by-use-probe", { "hello.ts": files["hello.ts"] });
const probed = Bun.spawnSync({
  cmd: [bunExe(), "build", "--compile", "--compile-trim-runtime", "hello.ts", "--outfile", "hello"],
  cwd: String(probe),
  env: bunEnv,
  stdout: "pipe",
  stderr: "pipe",
});
const hasIslands = !probed.stderr.toString().includes("nothing can be left out of this Bun");

const programs = join(import.meta.dir, "compile-trim-runtime-by-use");
const descriptions = new Map(
  readFileSync(join(import.meta.dir, "..", "..", "scripts", "build", "islands.doors"), "utf8")
    .split("\n")
    .filter(line => line.startsWith("feature "))
    .map(line => [line.split(" ")[1], line.split(" ").slice(2).join(" ")] as const),
);
const programFiles = readdirSync(programs)
  .filter(name => name.endsWith(".ts"))
  .sort();
const neighbors = join(programs, "near");
const neighborNames = readdirSync(neighbors).sort();

const mostProgramsInAPart = 16;
const mostTestsInAPart = 12;

function partNumbers(kind: "" | "features-") {
  const pattern = new RegExp(`^compile-trim-runtime-by-use-${kind}(\\d+)\\.test\\.ts$`);
  return readdirSync(import.meta.dir)
    .flatMap(name => pattern.exec(name)?.slice(1) ?? [])
    .map(Number)
    .sort((a, b) => a - b);
}

function deal(part: number, parts: number) {
  let next = 0;
  let held = 0;
  const mine = () => {
    const isMine = next++ % parts === part - 1;
    if (isMine) held++;
    return isMine;
  };
  const each: typeof test.each = (table: readonly any[]) => test.each(table.filter(mine));
  const dealtTest = (name: string, body: () => Promise<void>) => {
    if (mine()) test(name, body);
  };
  return { mine, held: () => held, test: Object.assign(dealtTest, { each }) };
}

export function testDeal() {
  test.each(["", "features-"] as const)("the files compile-trim-runtime-by-use-%s<n>.test.ts are numbered from 1 with no gap", kind => {
    const numbers = partNumbers(kind);
    expect(numbers).toEqual(numbers.map((_, index) => index + 1));
  });

  test(`no part holds more than ${mostProgramsInAPart} programs`, () => {
    const parts = partNumbers("").length;
    expect(
      Math.ceil((programFiles.length + neighborNames.length) / parts),
      `A test file has five minutes in CI. Add test/bundler/compile-trim-runtime-by-use-${parts + 1}.test.ts, a copy of the one before it with its number raised.`,
    ).toBeLessThanOrEqual(mostProgramsInAPart);
  });
}

export function testFeatures(part: number) {
  const parts = partNumbers("features-").length;
  const dealt = deal(part, parts);

  describe.skipIf(!hasIslands || !!unsupported)("--compile --aot --compile-trim-runtime leaves out what the program does not name", () => {
    const test = dealt.test;

    async function build(folder: string, entry: string, outfile: string, without?: string, flags: string[] = []) {
      const built = await run(
        [bunExe(), "build", "--compile", "--aot", "--compile-trim-runtime", ...flags, entry, "--outfile", join(outfile, "program")],
        folder,
        { ...bunEnv, BUN_TRIM_RUNTIME_WITHOUT: without },
      );
      expect(built.stderr).not.toContain("error:");
      expect(built.exitCode).toBe(0);
      return executableAt(join(folder, outfile, "program"));
    }

    test("a program that names none of them has none of them", async () => {
      using dir = tempDir("compile-trim-runtime-by-use", files);
      const folder = String(dir);
      const byUse = await build(folder, "hello.ts", "hello");
      const byName = await build(folder, "hello.ts", "hello-without", Object.keys(features).join(","));
      expect(byUse).toEqual(byName);
      expect(await run([join(folder, "hello", "program")], folder)).toEqual({ stdout: "hello world\n", stderr: "", exitCode: 0 });
    });

    for (const [name, feature] of Object.entries(features)) {
      test(`${name}: a program that names it keeps it; without it the executable says so`, async () => {
        using dir = tempDir("compile-trim-runtime-by-use", files);
        const folder = String(dir);
        const env = { ...bunEnv, FOLDER: folder };
        const kept = await build(folder, `uses-${name}.ts`, "kept");
        const leftOut = await build(folder, `uses-${name}.ts`, "left-out", name);
        expect(leftOut.size).toBeLessThan(kept.size);
        expect(await run([join(folder, "kept", "program")], folder, env)).toEqual({ stdout: feature.prints, stderr: "", exitCode: 0 });
        const refused = await run([join(folder, "left-out", "program")], folder, env);
        expect(refused.stderr).toContain("this executable was built with --compile-trim-runtime, " + feature.leftOut);
        expect(refused.exitCode).toBe(70);
      });
    }

    test("what only Bun.serve needs is kept for an entry point with a default export, and for no other", async () => {
      using dir = tempDir("compile-trim-runtime-by-use", files);
      const folder = String(dir);
      const onlyForServers = "mux,serve";
      expect(await build(folder, "hello.ts", "hello")).toEqual(await build(folder, "hello.ts", "hello-without", onlyForServers));
      const kept = await build(folder, "serves-its-default-export.ts", "kept");
      expect((await build(folder, "serves-its-default-export.ts", "left-out", onlyForServers)).size).toBeLessThan(kept.size);
      const served = await run([join(folder, "kept", "program")], folder);
      expect(served.stdout).toMatch(/^Started (development )?server: http:\/\/localhost:\d+\n$/);
      expect({ stderr: served.stderr, exitCode: served.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    });

    test.each([
      ["package_files", ["--compile-autoload-package-json"]],
      ["package_files", ["--compile-autoload-tsconfig"]],
      ["bunfig", []],
      ["cli_options", ["--compile-exec-argv=--smol"]],
      ["inspector", ["--compile-exec-argv=--inspect=127.0.0.1:0"]],
      ["cli_options", []],
      ["profiler", []],
      ["worker", []],
      ["file_sink", []],
    ])("%s is kept for an executable built with %j", async (feature, flags) => {
      using dir = tempDir("compile-trim-runtime-by-use", files);
      const folder = String(dir);
      const kept = await build(folder, "hello.ts", "kept", undefined, flags);
      expect((await build(folder, "hello.ts", "left-out", feature, flags)).contents).not.toBe(kept.contents);
      expect(await run([join(folder, "kept", "program")], folder)).toEqual({ stdout: "hello world\n", stderr: "", exitCode: 0 });
    });

    test.each([
      ["package_files", []],
      ["source_maps", []],
      ["text", ["--compile-exec-argv=--smol"]],
      ["inspector", ["--compile-exec-argv=--smol"]],
      ["sql", ["--compile-exec-argv=--smol --title=hello"]],
      ["performance_timeline", []],
      ["structured_clone", []],
      ["web_streams", []],
      ["fetch", []],
      ["valkey", []],
      ["tls", []],
    ])("%s is left out of an executable built with %j", async (feature, flags) => {
      using dir = tempDir("compile-trim-runtime-by-use", files);
      const folder = String(dir);
      expect(await build(folder, "hello.ts", "hello", undefined, flags)).toEqual(await build(folder, "hello.ts", "hello-without", feature, flags));
      expect(await run([join(folder, "hello", "program")], folder)).toEqual({ stdout: "hello world\n", stderr: "", exitCode: 0 });
    });

    test.each<string[]>([["--trace-requests"], ["--trace-warnings"], ["--stack-trace-limit=1"], ["--trace-env", "--trace-exit", "--trace-event-categories=node"]])(
      "the arguments %j belong to the program",
      async (...args) => {
        using dir = tempDir("compile-trim-runtime-by-use", files);
        const folder = String(dir);
        await build(folder, "hello.ts", "hello");
        expect(await run([join(folder, "hello", "program"), ...args], folder)).toEqual({ stdout: "hello world\n", stderr: "", exitCode: 0 });
      },
    );

    test.each(["--trace-warnings", "--trace-deprecation", "--trace-uncaught", "--trace-sigint"])("BUN_OPTIONS=%s needs nothing that is left out", async option => {
      using dir = tempDir("compile-trim-runtime-by-use", files);
      const folder = String(dir);
      await build(folder, "hello.ts", "hello");
      expect(await run([join(folder, "hello", "program")], folder, { ...bunEnv, BUN_OPTIONS: option })).toEqual({ stdout: "hello world\n", stderr: "", exitCode: 0 });
    });

    test("a program that comes near what is left out, and calls none of it, runs as whole", async () => {
      using dir = tempDir("compile-trim-runtime-by-use", files);
      const folder = String(dir);
      await build(folder, "near-what-is-left-out.ts", "near");
      expect(await run([join(folder, "near", "program")], folder)).toEqual({ stdout: "true true function true\ntrue\n", stderr: "", exitCode: 0 });
    });

    test("a program that evaluates text keeps all of them", async () => {
      using dir = tempDir("compile-trim-runtime-by-use", files);
      const folder = String(dir);
      await build(folder, "evaluates.ts", "evaluates");
      expect(await run([join(folder, "evaluates", "program")], folder)).toEqual({ stdout: "function function\n", stderr: "", exitCode: 0 });
    });

    test("the operations that compiled code never calls go, in a program that evaluates text too", async () => {
      using dir = tempDir("compile-trim-runtime-by-use", files);
      const folder = String(dir);
      const families = [...descriptions.keys()].filter(name => name.startsWith("operations_")).join(",");
      expect((await build(folder, "hello.ts", "by-use")).size).toBe((await build(folder, "hello.ts", "by-name", families)).size);
      expect(await build(folder, "evaluates.ts", "by-use")).toEqual(await build(folder, "evaluates.ts", "by-name", "operations_rare_numbers"));
      expect(await run([join(folder, "by-use", "program")], folder)).toEqual({ stdout: "function function\n", stderr: "", exitCode: 0 });
    });

    async function buildWhole(folder: string, entry: string) {
      expect(await run([bunExe(), "build", "--compile", "--aot", entry, "--outfile", "whole"], folder)).toMatchObject({ exitCode: 0 });
    }

    test("a route that asks for the development server by an option keeps it", async () => {
      using dir = tempDir("compile-trim-runtime-by-use", files);
      const folder = String(dir);
      const env = { ...bunEnv, FOLDER: folder };
      await buildWhole(folder, "styled-route.ts");
      const kept = await build(folder, "styled-route.ts", "kept");
      expect((await build(folder, "styled-route.ts", "left-out", "bundler")).size).toBeLessThan(kept.size);
      expect(await run([join(folder, "kept", "program")], folder, env)).toEqual(await run([join(folder, "whole")], folder, env));
      const refused = await run([join(folder, "left-out", "program")], folder, env);
      expect(refused.stdout).toContain("style: this executable was built with --compile-trim-runtime, without the bundler and the development server");
      expect(refused.exitCode).toBe(0);
    });

    test("a server none of whose options asks for them has neither the bundler nor what turns text into code", async () => {
      using dir = tempDir("compile-trim-runtime-by-use", files);
      const folder = String(dir);
      expect(await build(folder, "serves.ts", "by-use")).toEqual(await build(folder, "serves.ts", "by-name", "bundler,text"));
      expect(await run([join(folder, "by-use", "program")], folder, { ...bunEnv, FOLDER: folder })).toEqual({ stdout: `served\na\nb\n${files["bundled.ts"]}\n`, stderr: "", exitCode: 0 });
    });

    test("reload() never needs the development server, whatever its routes ask for", async () => {
      using dir = tempDir("compile-trim-runtime-by-use", files);
      const folder = String(dir);
      const env = { ...bunEnv, FOLDER: folder };
      await buildWhole(folder, "reloads.ts");
      expect(await build(folder, "reloads.ts", "by-use")).toEqual(await build(folder, "reloads.ts", "by-name", "bundler,text"));
      const whole = await run([join(folder, "whole")], folder, env);
      expect(whole.stdout).toStartWith("reloaded\n");
      expect(await run([join(folder, "by-use", "program")], folder, env)).toEqual(whole);
    });
  });

  test(`part ${part} of ${parts} holds no more than ${mostTestsInAPart} of these tests`, () => {
    expect(
      dealt.held(),
      `A test file has five minutes in CI. Add test/bundler/compile-trim-runtime-by-use-features-${parts + 1}.test.ts, a copy of the one before it with its number raised.`,
    ).toBeLessThanOrEqual(mostTestsInAPart);
  });
}

export function testPrograms(part: number) {
  const { mine } = deal(part, partNumbers("").length);

  (!hasIslands || unsupported ? describe.skip : describe.concurrent)("--compile --aot --compile-trim-runtime, part by part", () => {
    for (const file of programFiles.filter(mine)) {
      const name = basename(file, ".ts");
      const options: { features?: string[]; build?: string[]; env?: Record<string, string>; posix?: boolean } = existsSync(join(programs, name + ".json"))
        ? JSON.parse(readFileSync(join(programs, name + ".json"), "utf8"))
        : {};
      const features = (options.features ?? [name.replaceAll("-", "_")]).filter(feature => descriptions.has(feature));

      test.skipIf(features.length === 0 || (isWindows && options.posix === true))(
        `${name}: as whole where the program names it; without ${features.join(", ")} the executable says so`,
        () =>
          slot(async () => {
            using dir = tempDir("compile-trim-runtime-part", {
              "program.ts": readFileSync(join(programs, file), "utf8"),
              "tsconfig.json": `{ "compilerOptions": { "noImplicitAny": false } }`,
              "cwd/empty": "",
            });
            const folder = String(dir);
            const env = { ...bunEnv, ...options.env };
            const built = async (outfile: string, flags: string[], without?: string) => {
              const build = await run([bunExe(), "build", "--compile", "--aot", ...flags, ...(options.build ?? []), "program.ts", "--outfile", outfile], folder, {
                ...env,
                BUN_TRIM_RUNTIME_WITHOUT: without,
              });
              expect(build.stderr).not.toContain("error:");
              expect(build.exitCode).toBe(0);
              return await spawned([join(folder, outfile)], join(folder, "cwd"), env);
            };
            const whole = await built("whole", []);
            expect(whole.exitCode).toBe(0);
            expect(whole.stdout).not.toBe("");
            expect(await built("kept", ["--compile-trim-runtime"])).toMatchObject({ stdout: whole.stdout, exitCode: 0 });
            for (const feature of features) {
              const refused = await built("left-out", ["--compile-trim-runtime"], feature);
              expect(refused.stderr).toContain(`this executable was built with --compile-trim-runtime, without ${descriptions.get(feature)}, and something has just asked for it.`);
              expect(refused.exitCode).toBe(70);
            }
          }),
        600_000,
      );
    }

    for (const name of neighborNames.filter(mine)) {
      const files = Object.fromEntries(readdirSync(join(neighbors, name)).map(file => [file, readFileSync(join(neighbors, name, file), "utf8")]));
      const options: { features: string[]; keptToday?: boolean; posix?: boolean } = files["features.json"] ? JSON.parse(files["features.json"]) : { features: [name.replaceAll("-", "_")] };
      const features = options.features.filter(feature => descriptions.has(feature));

      test.skipIf(features.length === 0 || (isWindows && options.posix === true))(
        `${name}: a program that comes near ${features.join(", ")} and names none of it runs as whole without it`,
        () =>
          slot(async () => {
            using dir = tempDir("compile-trim-runtime-near", { ...files, "tsconfig.json": `{ "compilerOptions": { "noImplicitAny": false } }`, "cwd/empty": "" });
            const folder = String(dir);
            const built = async (outfile: string, flags: string[], without?: string) => {
              const program = join(folder, outfile, "program");
              const build = await run([bunExe(), "build", "--compile", "--aot", ...flags, "near.ts", "--outfile", program], folder, { ...bunEnv, BUN_TRIM_RUNTIME_WITHOUT: without });
              expect(build.stderr).not.toContain("error:");
              expect(build.exitCode).toBe(0);
              return { ...(await spawned([program], join(folder, "cwd"), bunEnv)), executable: executableAt(program) };
            };
            const whole = await built("whole", []);
            expect(whole.exitCode).toBe(0);
            expect(whole.stdout).not.toBe("");
            const byUse = await built("by-use", ["--compile-trim-runtime"]);
            expect(byUse).toMatchObject({ stdout: whole.stdout, exitCode: 0 });
            const leftOut = await built("left-out", ["--compile-trim-runtime"], features.join(","));
            expect(leftOut).toMatchObject({ stdout: whole.stdout, exitCode: 0 });
            if (!options.keptToday) expect(leftOut.executable).toEqual(byUse.executable);
          }),
        600_000,
      );
    }
  });
}
