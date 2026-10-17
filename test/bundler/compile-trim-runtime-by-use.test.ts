import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { statSync } from "node:fs";
import { join } from "node:path";
import { unsupported } from "../aot/run-programs";

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
  "evaluates.ts": `console.log(typeof (0, eval)("HTMLRewriter"), typeof (0, eval)("Bun.color"));`,
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

describe.skipIf(!hasIslands || !!unsupported)(
  "--compile --aot --compile-trim-runtime leaves out what the program does not name",
  () => {
    async function build(folder: string, entry: string, outfile: string, without?: string) {
      const built = await run(
        [bunExe(), "build", "--compile", "--aot", "--compile-trim-runtime", entry, "--outfile", outfile],
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
        expect(await run([join(folder, "kept")], folder, env)).toEqual({
          stdout: feature.prints,
          stderr: "",
          exitCode: 0,
        });
        const refused = await run([join(folder, "left-out")], folder, env);
        expect(refused.stderr).toContain("this executable was built with --compile-trim-runtime, " + feature.leftOut);
        expect(refused.exitCode).toBe(70);
      });
    }

    test("a program that evaluates text keeps all of them", async () => {
      using dir = tempDir("compile-trim-runtime-by-use", files);
      const folder = String(dir);
      await build(folder, "evaluates.ts", "evaluates");
      expect(await run([join(folder, "evaluates")], folder)).toEqual({
        stdout: "function function\n",
        stderr: "",
        exitCode: 0,
      });
    });

    test("a route that asks for the development server by an option gets a TypeError that says why", async () => {
      using dir = tempDir("compile-trim-runtime-by-use", files);
      const folder = String(dir);
      await build(folder, "styled-route.ts", "styled-route");
      const ran = await run([join(folder, "styled-route")], folder, { ...bunEnv, FOLDER: folder });
      expect(ran.stdout).toContain(
        "style: this executable was built with --compile-trim-runtime, without the bundler and the development server",
      );
      expect(ran.exitCode).toBe(0);
    });
  },
);
