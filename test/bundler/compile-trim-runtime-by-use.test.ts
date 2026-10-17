import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { slot, spawned, unsupported } from "../aot/run-programs";

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
      Bun.serve({ port: 0, development: true, routes: { "/*": { dir: process.env.FOLDER, style: "nextjs-pages" } } as never, fetch: () => new Response("") });
    } catch (error) {
      console.log((error as Error).message);
    }
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

describe.skipIf(!hasIslands || !!unsupported)("--compile --aot --compile-trim-runtime leaves out what the program does not name", () => {
  async function build(folder: string, entry: string, outfile: string, without?: string, flags: string[] = []) {
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", "--compile-trim-runtime", ...flags, entry, "--outfile", outfile],
      folder,
      { ...bunEnv, BUN_TRIM_RUNTIME_WITHOUT: without },
    );
    expect(built.stderr).not.toContain("error:");
    expect(built.exitCode).toBe(0);
    return statSync(join(folder, outfile + (isWindows ? ".exe" : ""))).size;
  }

  test("a program that names none of them has none of them", async () => {
    using dir = tempDir("compile-trim-runtime-by-use", files);
    const folder = String(dir);
    const byUse = await build(folder, "hello.ts", "hello");
    const byName = await build(folder, "hello.ts", "hello-without", Object.keys(features).join(","));
    expect(byUse).toBe(byName);
    expect(await run([join(folder, "hello")], folder)).toEqual({ stdout: "hello world\n", stderr: "", exitCode: 0 });
  });

  for (const [name, feature] of Object.entries(features)) {
    test(`${name}: a program that names it keeps it; without it the executable says so`, async () => {
      using dir = tempDir("compile-trim-runtime-by-use", files);
      const folder = String(dir);
      const env = { ...bunEnv, FOLDER: folder };
      const kept = await build(folder, `uses-${name}.ts`, "kept");
      const leftOut = await build(folder, `uses-${name}.ts`, "left-out", name);
      expect(leftOut).toBeLessThan(kept);
      expect(await run([join(folder, "kept")], folder, env)).toEqual({ stdout: feature.prints, stderr: "", exitCode: 0 });
      const refused = await run([join(folder, "left-out")], folder, env);
      expect(refused.stderr).toContain("this executable was built with --compile-trim-runtime, " + feature.leftOut);
      expect(refused.exitCode).toBe(70);
    });
  }

  test("what only Bun.serve needs is kept for an entry point with a default export, and for no other", async () => {
    using dir = tempDir("compile-trim-runtime-by-use", files);
    const folder = String(dir);
    const onlyForServers = "http3,mux,serve";
    expect(await build(folder, "hello.ts", "hello")).toBe(await build(folder, "hello.ts", "hello-without", onlyForServers));
    const kept = await build(folder, "serves-its-default-export.ts", "kept");
    expect(await build(folder, "serves-its-default-export.ts", "left-out", onlyForServers)).toBeLessThan(kept);
    const served = await run([join(folder, "kept")], folder);
    expect(served.stdout).toMatch(/^Started (development )?server: http:\/\/localhost:\d+\n$/);
    expect({ stderr: served.stderr, exitCode: served.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  });

  test.each([
    ["package_files", ["--compile-autoload-package-json"]],
    ["package_files", ["--compile-autoload-tsconfig"]],
    ["bunfig", []],
    ["cli_options", ["--compile-exec-argv=--smol"]],
    ["cli_options", []],
    ["profiler", []],
    ["valkey", []],
    ["worker", []],
  ])("%s is kept for an executable built with %j", async (feature, flags) => {
    using dir = tempDir("compile-trim-runtime-by-use", files);
    const folder = String(dir);
    const kept = await build(folder, "hello.ts", "kept", undefined, flags);
    expect(await build(folder, "hello.ts", "left-out", feature, flags)).toBeLessThan(kept);
    expect(await run([join(folder, "kept")], folder)).toEqual({ stdout: "hello world\n", stderr: "", exitCode: 0 });
  });

  test.each([
    ["package_files", []],
    ["source_maps", []],
    ["performance_timeline", []],
    ["structured_clone", []],
  ])("%s is left out of an executable built with %j", async (feature, flags) => {
    using dir = tempDir("compile-trim-runtime-by-use", files);
    const folder = String(dir);
    expect(await build(folder, "hello.ts", "hello", undefined, flags)).toBe(await build(folder, "hello.ts", "hello-without", feature, flags));
    expect(await run([join(folder, "hello")], folder)).toEqual({ stdout: "hello world\n", stderr: "", exitCode: 0 });
  });

  test.each([["--trace-requests"], ["--trace-warnings"], ["--stack-trace-limit=1"], ["--trace-env", "--trace-exit", "--trace-event-categories=node"]])(
    "the arguments %j belong to the program",
    async (...args) => {
      using dir = tempDir("compile-trim-runtime-by-use", files);
      const folder = String(dir);
      await build(folder, "hello.ts", "hello");
      expect(await run([join(folder, "hello"), ...args], folder)).toEqual({ stdout: "hello world\n", stderr: "", exitCode: 0 });
    },
  );

  test.each(["--trace-warnings", "--trace-deprecation", "--trace-uncaught", "--trace-sigint"])("BUN_OPTIONS=%s needs nothing that is left out", async option => {
    using dir = tempDir("compile-trim-runtime-by-use", files);
    const folder = String(dir);
    await build(folder, "hello.ts", "hello");
    expect(await run([join(folder, "hello")], folder, { ...bunEnv, BUN_OPTIONS: option })).toEqual({ stdout: "hello world\n", stderr: "", exitCode: 0 });
  });

  test("a program that comes near what is left out, and calls none of it, runs as whole", async () => {
    using dir = tempDir("compile-trim-runtime-by-use", files);
    const folder = String(dir);
    await build(folder, "near-what-is-left-out.ts", "near");
    expect(await run([join(folder, "near")], folder)).toEqual({ stdout: "true true function true\ntrue\n", stderr: "", exitCode: 0 });
  });

  test("a program that evaluates text keeps all of them", async () => {
    using dir = tempDir("compile-trim-runtime-by-use", files);
    const folder = String(dir);
    await build(folder, "evaluates.ts", "evaluates");
    expect(await run([join(folder, "evaluates")], folder)).toEqual({ stdout: "function function\n", stderr: "", exitCode: 0 });
  });

  test("the operations that compiled code never calls go, in a program that evaluates text too", async () => {
    using dir = tempDir("compile-trim-runtime-by-use", files);
    const folder = String(dir);
    const families = [...descriptions.keys()].filter(name => name.startsWith("operations_")).join(",");
    expect(await build(folder, "hello.ts", "by-use")).toBe(await build(folder, "hello.ts", "by-name", families));
    expect(await build(folder, "evaluates.ts", "by-use")).toBe(await build(folder, "evaluates.ts", "by-name", "operations_rare_numbers"));
    expect(await run([join(folder, "by-use")], folder)).toEqual({ stdout: "function function\n", stderr: "", exitCode: 0 });
  });

  test("a route that asks for the development server by an option gets a TypeError that says why", async () => {
    using dir = tempDir("compile-trim-runtime-by-use", files);
    const folder = String(dir);
    await build(folder, "styled-route.ts", "styled-route");
    const ran = await run([join(folder, "styled-route")], folder, { ...bunEnv, FOLDER: folder });
    expect(ran.stdout).toContain("style: this executable was built with --compile-trim-runtime, without the bundler and the development server");
    expect(ran.exitCode).toBe(0);
  });
});

const programs = join(import.meta.dir, "compile-trim-runtime-by-use");
const descriptions = new Map(
  readFileSync(join(import.meta.dir, "..", "..", "scripts", "build", "islands.doors"), "utf8")
    .split("\n")
    .filter(line => line.startsWith("feature "))
    .map(line => [line.split(" ")[1], line.split(" ").slice(2).join(" ")] as const),
);

(!hasIslands || unsupported || isWindows ? describe.skip : describe.concurrent)("--compile --aot --compile-trim-runtime, part by part", () => {
  for (const file of readdirSync(programs).filter(name => name.endsWith(".ts")).sort()) {
    const name = basename(file, ".ts");
    const options: { features?: string[]; build?: string[]; env?: Record<string, string> } = existsSync(join(programs, name + ".json"))
      ? JSON.parse(readFileSync(join(programs, name + ".json"), "utf8"))
      : {};
    const features = (options.features ?? [name.replaceAll("-", "_")]).filter(feature => descriptions.has(feature));

    test.skipIf(features.length === 0)(
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

  const neighbors = join(programs, "near");
  for (const name of readdirSync(neighbors).sort()) {
    const files = Object.fromEntries(readdirSync(join(neighbors, name)).map(file => [file, readFileSync(join(neighbors, name, file), "utf8")]));
    const options: { features: string[]; keptToday?: boolean } = files["features.json"] ? JSON.parse(files["features.json"]) : { features: [name.replaceAll("-", "_")] };
    const features = options.features.filter(feature => descriptions.has(feature));

    test.skipIf(features.length === 0)(
      `${name}: a program that comes near ${features.join(", ")} and names none of it runs as whole without it`,
      () =>
        slot(async () => {
          using dir = tempDir("compile-trim-runtime-near", { ...files, "tsconfig.json": `{ "compilerOptions": { "noImplicitAny": false } }`, "cwd/empty": "" });
          const folder = String(dir);
          const built = async (outfile: string, flags: string[], without?: string) => {
            const build = await run([bunExe(), "build", "--compile", "--aot", ...flags, "near.ts", "--outfile", outfile], folder, { ...bunEnv, BUN_TRIM_RUNTIME_WITHOUT: without });
            expect(build.stderr).not.toContain("error:");
            expect(build.exitCode).toBe(0);
            return { ...(await spawned([join(folder, outfile)], join(folder, "cwd"), bunEnv)), bytes: statSync(join(folder, outfile)).size };
          };
          const whole = await built("whole", []);
          expect(whole.exitCode).toBe(0);
          expect(whole.stdout).not.toBe("");
          const byUse = await built("by-use", ["--compile-trim-runtime"]);
          expect(byUse).toMatchObject({ stdout: whole.stdout, exitCode: 0 });
          const leftOut = await built("left-out", ["--compile-trim-runtime"], features.join(","));
          expect(leftOut).toMatchObject({ stdout: whole.stdout, exitCode: 0 });
          if (!options.keptToday) expect(leftOut.bytes).toBe(byUse.bytes);
        }),
      600_000,
    );
  }
});
