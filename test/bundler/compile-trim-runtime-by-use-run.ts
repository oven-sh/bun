import { describe, expect, test } from "bun:test";
import { test as plainTest } from "bun:test";
import { bunEnv, bunExe, isMacOS, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { unpacked } from "../aot/generate";
import { slot, spawned, unsupported } from "../aot/run-programs";
import { canTrim, featureNamed, featureOf, findFeature, modulesLoadedFor, saysFeatureWasRemoved, textOf, withoutFeatures } from "./compile-trim-features";
import { run } from "../aot/harness/run";

const bytesAt = (path: string) => readFileSync(path + (isWindows ? ".exe" : ""));

function executableAt(path: string) {
  const bytes = bytesAt(path);
  return { size: bytes.length, contents: new Bun.CryptoHasher("sha256").update(bytes).digest("hex") };
}

const features: Record<string, { implements: string; program: string; prints: string }> = {
  "html-rewriter": {
    implements: "HTMLRewriter",
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
    implements: "Bun.color",
    program: `console.log(Bun.color("red", "hex"));`,
    prints: "#ff0000\n",
  },
  bundler: {
    implements: "Bun.build",
    program: `
      const built = await Bun.build({ entrypoints: [process.env.FOLDER + "/bundled.ts"], target: "bun" });
      console.log(built.success, built.outputs.length);
    `,
    prints: "true 1\n",
  },
};

const textsOfBundlerFeatures = [
  "The parent selector is not a single class selector because of the syntax here:",
  "expected a comma after parsing a gradient",
  "view-transition-group-children",
  "Calling setState from useMemo may trigger an infinite loop",
  "Cannot reassign variable after render completes",
  "Could not preserve existing manual memoization",
];

const textsOfLibraries: Record<string, string[]> = {
  "libjpeg-turbo": ["Bogus Huffman table definition", "Unsupported JPEG process", "Invalid JPEG file structure"],
  libwebp: ["Frame setup failed", "Premature end-of-partition0 encountered", "NULL VP8Io parameter"],
  libarchive: ["Damaged tar archive", "Truncated tar archive", "Can't allocate tar data"],
  SQLite: ["malformed database schema", "unable to open database file", "SQLite format 3"],
  TinyCC: ["cannot use local functions", "invalid operand types for binary operation"],
  "lol-html": ["The selector is empty", "Unexpected token in selector"],
};
const linkedLibraries = Object.keys(textsOfLibraries).filter(library => !(isMacOS && library === "SQLite"));
const textsOfLibrariesIn = (file: Buffer) => linkedLibraries.flatMap(library => textsOfLibraries[library]!.filter(text => file.includes(text)).map(text => `${library}: ${text}`));

const files = {
  "hello.ts": `console.log("hello world");`,
  "bundled.ts": `export const answer: number = 42;`,
  "serves-its-default-export.ts": `
    export default { port: 0, fetch: () => new Response("served") };
    setTimeout(() => process.exit(0), 50);
  `,
  "evaluates.ts": `console.log(typeof (0, eval)("HTMLRewriter"), typeof (0, eval)("Bun.color"));`,
  "own-properties.ts": `
    class Mailbox {
      sent: string[] = [];
      send(text: string) {
        this.sent.push(text);
        return this;
      }
      listen() {
        return this.sent.length;
      }
      on(event: string) {
        return event;
      }
    }
    const project = { sql: "select 1", file: "a.txt", build: () => "built", password: "secret", serve: () => "served", Image: class {}, $: 1, alert: () => "alerted", color: "red", fetch: () => "fetched" };
    const parsed = JSON.parse('{ "file": "b.txt", "send": 2, "password": 3 }');
    const mailbox = new Mailbox().send("one");
    console.log(project.sql, project.file, project.build(), project.password, project.serve(), typeof project.Image, project.$, project.alert(), project.color, project.fetch());
    console.log(mailbox.listen(), mailbox.on("message"), parsed.file, parsed.send, parsed.password);
  `,
  "near-removed-features.ts": `
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
  "bundles-a-component.ts": `
    const built = await Bun.build({
      entrypoints: [process.cwd() + "/component.tsx"],
      external: ["react", "react/*"],
      reactCompiler: true,
      minify: true,
    });
    for (const output of built.outputs) console.log(output.loader, await output.text());
  `,
  "component.tsx": `
    import "./style.css";
    export function Component({ name }: { name: string }) {
      const words = [name, name];
      return <div className="a">{words}</div>;
    }
  `,
  "style.css": `.a { color: red; & .b { margin: calc(1px + 2px); } }`,
  "serves-values-nobody-knows.ts": `
    import { createServer } from "node:http";
    const evaluate = new Function("value", process.env.BODY ?? "return typeof value");
    const server = createServer((request, response) => {
      let text = "";
      request.on("data", chunk => (text += chunk));
      request.on("end", () => {
        const value = JSON.parse(text);
        response.end([value.items, value.not, value.returns, value.parameters, value.instance, value.resolves, value.list.map((x: number) => x * 2), evaluate(value)].join(" "));
      });
    });
    server.listen(0, async () => {
      const { port } = server.address() as { port: number };
      const answer = await fetch("http://127.0.0.1:" + port, { method: "POST", body: JSON.stringify({ items: 1, not: 2, list: [3, 4] }) });
      console.log(await answer.text());
      server.close();
    });
  `,
  "transpiles.ts": `
    const sources = [
      ["ts", "enum Direction { Up } export const count: number = Direction.Up;"],
      ["tsx", "export function Component({ name }: { name: string }) { const words = [name, name]; return <div>{words}</div>; }"],
      ["jsx", "export function Component({ name }) { const words = [name, name]; return <div>{words}</div>; }"],
    ] as const;
    for (const [loader, source] of sources) {
      const options = { loader, reactCompiler: true };
      const transpiler = new Bun.Transpiler(options);
      console.log(transpiler.transformSync(source));
      console.log(await transpiler.transform(source));
      console.log(JSON.stringify(transpiler.scan(source)));
    }
  `,
  ...Object.fromEntries(Object.entries(features).map(([name, feature]) => [`uses-${name}.ts`, feature.program])),
};

const programs = unpacked(join(import.meta.dir, "compile-trim-runtime-by-use"));

export interface ProgramOptions {
  features?: string[];
  build?: string[];
  env?: Record<string, string>;
  posix?: boolean;
  says?: Record<string, string>;
  keptToday?: boolean;
  // Known gaps. Forced out, the feature still runs: a feature that stays needs the same code, or the feature owns less than the smallest group of the link (scripts/build/trim/partition.ts).
  runsToday?: string[];
  // One of Bun's own modules catches the error and does without the feature: the program ends like the untrimmed one and prints something else.
  fallsBack?: string[];
  // A known bug, in a sentence. The test is red as soon as the program runs.
  failsToday?: string;
}

export const optionsAt = (path: string): ProgramOptions => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {});
export const featuresOfProgram = (name: string, options: ProgramOptions) => (options.features ?? [name]).flatMap(spelling => findFeature(spelling) ?? []);
const programFiles = readdirSync(programs)
  .filter(name => name.endsWith(".ts"))
  .sort();
const neighbors = join(programs, "near");
const neighborNames = readdirSync(neighbors).sort();

function deal(part: number, parts: number) {
  let next = 0;
  const mine = () => next++ % parts === part - 1;
  const each: typeof test.each = (table: readonly any[]) => test.each(table.filter(mine));
  const dealtTest = (name: string, body: () => Promise<void>) => {
    if (mine()) test(name, body);
  };
  return { mine, test: Object.assign(dealtTest, { each }) };
}

export function testDeal() {
  test("every program and option file names a feature declared in src/trim/features, with the declared spelling", () => {
    const wrong: string[] = [];
    const check = (where: string, name: string, options: ProgramOptions) => {
      if (!options.features && findFeature(name) === undefined) wrong.push(`${where}: no feature is called ${name}; give it "features"`);
      for (const spelling of [...(options.features ?? []), ...Object.keys(options.says ?? {})])
        if (findFeature(spelling) !== spelling) wrong.push(`${where}: ${spelling} is ${findFeature(spelling) === undefined ? "no feature" : "spelled " + findFeature(spelling)}`);
    };
    for (const file of programFiles) check(file, basename(file, ".ts"), optionsAt(join(programs, basename(file, ".ts") + ".json")));
    for (const name of neighborNames) check("near/" + name, name, optionsAt(join(neighbors, name, "features.json")));
    expect(wrong).toEqual([]);
  });
}

export function testFeatures(part: number, parts: number) {
  const dealt = deal(part, parts);

  describe.skipIf(!canTrim || !!unsupported)("--compile --aot --trim removes what the program doesn't use", () => {
    const test = dealt.test;

    async function build(folder: string, entry: string, outfile: string, without: string[] = [], flags: string[] = []) {
      const built = await run([bunExe(), "build", "--compile", "--aot", "--trim", ...withoutFeatures(without), ...flags, entry, "--outfile", join(outfile, "program")], folder);
      expect(built.stderr).not.toMatch(/^error\b/m);
      expect(built.exitCode).toBe(0);
      return executableAt(join(folder, outfile, "program"));
    }

    test("a program that uses none of them has none of them", async () => {
      using dir = tempDir("compile-trim-runtime-by-use", files);
      const folder = String(dir);
      const byUse = await build(folder, "hello.ts", "hello");
      const forcedOut = await build(folder, "hello.ts", "hello-without", Object.values(features).map(feature => featureOf(feature.implements)));
      expect(byUse).toEqual(forcedOut);
      expect(await run([join(folder, "hello", "program")], folder)).toEqual({ stdout: "hello world\n", stderr: "", exitCode: 0 });
    });

    test("properties of the program's own objects keep no feature, whatever their names", async () => {
      using dir = tempDir("compile-trim-runtime-by-use", files);
      const folder = String(dir);
      const namesakes = [...new Set(["Bun.sql", "Bun.s3", "Bun.build", "Bun.password", "Bun.listen", "process.send", "Bun.serve", "Bun.Image", "Bun.$", "alert", "Bun.color", "fetch"].map(featureOf))];
      expect(await build(folder, "own-properties.ts", "by-use")).toEqual(await build(folder, "own-properties.ts", "forced-out", namesakes));
      expect(await run([join(folder, "by-use", "program")], folder)).toEqual({ stdout: "select 1 a.txt built secret served function 1 alerted red fetched\n1 message b.txt 2 3\n", stderr: "", exitCode: 0 });
    });

    for (const [name, feature] of Object.entries(features)) {
      test(`${name}: a program that uses it keeps it; with it forced out, the executable says so`, async () => {
        using dir = tempDir("compile-trim-runtime-by-use", files);
        const folder = String(dir);
        const env = { ...bunEnv, FOLDER: folder };
        const kept = await build(folder, `uses-${name}.ts`, "kept");
        const forcedOut = await build(folder, `uses-${name}.ts`, "forced-out", [featureOf(feature.implements)]);
        expect(forcedOut.size).toBeLessThan(kept.size);
        expect(await run([join(folder, "kept", "program")], folder, env)).toEqual({ stdout: feature.prints, stderr: "", exitCode: 0 });
        const failed = await run([join(folder, "forced-out", "program")], folder, env);
        expect({ stderr: failed.stderr, saysSo: saysFeatureWasRemoved(failed.stderr, featureOf(feature.implements)) }).toEqual({ stderr: failed.stderr, saysSo: true });
        expect([70, 1]).toContain(failed.exitCode);
      });
    }

    test("what only Bun.serve needs is kept for an entry point with a default export, and for no other", async () => {
      using dir = tempDir("compile-trim-runtime-by-use", files);
      const folder = String(dir);
      const onlyForServers = [featureNamed("ServeHttp2"), featureOf("Bun.serve")];
      expect(await build(folder, "hello.ts", "hello")).toEqual(await build(folder, "hello.ts", "hello-without", onlyForServers));
      const kept = await build(folder, "serves-its-default-export.ts", "kept");
      expect((await build(folder, "serves-its-default-export.ts", "forced-out", onlyForServers)).size).toBeLessThan(kept.size);
      const served = await run([join(folder, "kept", "program")], folder);
      expect(served.stdout).toMatch(/^Started (development )?server: http:\/\/localhost:\d+\n$/);
      expect({ stderr: served.stderr, exitCode: served.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    });

    test.each([
      ["PackageFiles", ["--compile-autoload-package-json"]],
      ["PackageFiles", ["--compile-autoload-tsconfig"]],
      ["Bunfig", []],
      ["CliOptions", ["--compile-exec-argv=--smol"]],
      ["Inspector", ["--compile-exec-argv=--inspect=127.0.0.1:0"]],
      ["CliOptions", []],
      ["Profilers", []],
    ])("%s is kept for an executable built with %j", async (feature, flags) => {
      using dir = tempDir("compile-trim-runtime-by-use", files);
      const folder = String(dir);
      const kept = await build(folder, "hello.ts", "kept", [], flags);
      expect((await build(folder, "hello.ts", "forced-out", [featureNamed(feature)], flags)).contents).not.toBe(kept.contents);
      expect(await run([join(folder, "kept", "program")], folder)).toEqual({ stdout: "hello world\n", stderr: "", exitCode: 0 });
    });

    test.each([
      ["PackageFiles", []],
      ["SourceMaps", []],
      ["RuntimeTranspiler", ["--compile-exec-argv=--smol"]],
      ["Inspector", ["--compile-exec-argv=--smol"]],
      ["Sql", ["--compile-exec-argv=--smol --title=hello"]],
      ["PerformanceTimeline", []],
      ["StructuredClone", []],
      ["WebStreams", []],
      ["HttpClient", []],
      ["Valkey", []],
      ["Tls", []],
      ["Worker", []],
      ["FileSink", []],
    ])("%s is removed from an executable built with %j", async (feature, flags) => {
      using dir = tempDir("compile-trim-runtime-by-use", files);
      const folder = String(dir);
      expect(await build(folder, "hello.ts", "hello", [], flags)).toEqual(await build(folder, "hello.ts", "hello-without", [featureNamed(feature)], flags));
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

    test.each(["--trace-warnings", "--trace-deprecation", "--trace-uncaught", "--trace-sigint"])("BUN_OPTIONS=%s needs nothing that was removed", async option => {
      using dir = tempDir("compile-trim-runtime-by-use", files);
      const folder = String(dir);
      await build(folder, "hello.ts", "hello");
      expect(await run([join(folder, "hello", "program")], folder, { ...bunEnv, BUN_OPTIONS: option })).toEqual({ stdout: "hello world\n", stderr: "", exitCode: 0 });
    });

    test("a program that comes near removed features, and calls none of them, runs like the untrimmed one", async () => {
      using dir = tempDir("compile-trim-runtime-by-use", files);
      const folder = String(dir);
      await build(folder, "near-removed-features.ts", "near");
      expect(await run([join(folder, "near", "program")], folder)).toEqual({ stdout: "true true function true\ntrue\n", stderr: "", exitCode: 0 });
    });

    test("a string passed to eval() still finds the names of the APIs that the source never uses", async () => {
      using dir = tempDir("compile-trim-runtime-by-use", files);
      const folder = String(dir);
      await build(folder, "evaluates.ts", "evaluates");
      expect(await run([join(folder, "evaluates", "program")], folder)).toEqual({ stdout: "function function\n", stderr: "", exitCode: 0 });
    });

    async function buildWhole(folder: string, entry: string) {
      expect(await run([bunExe(), "build", "--compile", "--aot", entry, "--outfile", "whole"], folder)).toMatchObject({ exitCode: 0 });
    }

    if (dealt.mine()) plainTest.todo("a route that asks for the development server by an option keeps it", async () => {
      using dir = tempDir("compile-trim-runtime-by-use", files);
      const folder = String(dir);
      const env = { ...bunEnv, FOLDER: folder };
      await buildWhole(folder, "styled-route.ts");
      const kept = await build(folder, "styled-route.ts", "kept");
      expect((await build(folder, "styled-route.ts", "forced-out", [featureOf("Bun.build")])).size).toBeLessThan(kept.size);
      expect(await run([join(folder, "kept", "program")], folder, env)).toEqual(await run([join(folder, "whole")], folder, env));
      const failed = await run([join(folder, "forced-out", "program")], folder, env);
      expect(failed.stdout).toContain("style: the bundler and the dev server were removed by --trim");
      expect(failed.exitCode).toBe(0);
    });

    test("known bug: a Bun.serve route with the style option doesn't count as a use of the bundler, and throws a catchable error", async () => {
      using dir = tempDir("compile-trim-runtime-by-use", files);
      const folder = String(dir);
      await build(folder, "styled-route.ts", "by-use");
      const ran = await run([join(folder, "by-use", "program")], folder, { ...bunEnv, FOLDER: folder });
      expect(ran.stdout).toContain("style: the bundler and the dev server were removed by --trim");
      expect({ stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    });

    test("a server whose options ask for neither has no bundler and no transpiler", async () => {
      using dir = tempDir("compile-trim-runtime-by-use", files);
      const folder = String(dir);
      expect(await build(folder, "serves.ts", "by-use")).toEqual(await build(folder, "serves.ts", "forced-out", [featureOf("Bun.build"), featureOf("Bun.Transpiler")]));
      expect(await run([join(folder, "by-use", "program")], folder, { ...bunEnv, FOLDER: folder })).toEqual({ stdout: `served\na\nb\n${files["bundled.ts"]}\n`, stderr: "", exitCode: 0 });
    });

    test("reload() never needs the development server, whatever its routes ask for", async () => {
      using dir = tempDir("compile-trim-runtime-by-use", files);
      const folder = String(dir);
      const env = { ...bunEnv, FOLDER: folder };
      await buildWhole(folder, "reloads.ts");
      expect(await build(folder, "reloads.ts", "by-use")).toEqual(await build(folder, "reloads.ts", "forced-out", [featureOf("Bun.build"), featureOf("Bun.Transpiler")]));
      const whole = await run([join(folder, "whole")], folder, env);
      expect(whole.stdout).toStartWith("reloaded\n");
      expect(await run([join(folder, "by-use", "program")], folder, env)).toEqual(whole);
    });

    test("a program that calls Bun.build() can bundle CSS and use the React Compiler", async () => {
      using dir = tempDir("compile-trim-runtime-by-use", files);
      const folder = String(dir);
      await buildWhole(folder, "bundles-a-component.ts");
      await build(folder, "bundles-a-component.ts", "by-use");
      const whole = await run([join(folder, "whole")], folder);
      expect(whole.stdout).toContain("react/compiler-runtime");
      expect(whole.stdout).toContain("margin:3px");
      expect(whole).toMatchObject({ stderr: "", exitCode: 0 });
      expect(await run([join(folder, "by-use", "program")], folder)).toEqual(whole);
    });

    test("a program that only uses Bun.Transpiler transpiles .ts, .tsx and .jsx like the untrimmed one", async () => {
      using dir = tempDir("compile-trim-runtime-by-use", files);
      const folder = String(dir);
      await buildWhole(folder, "transpiles.ts");
      await build(folder, "transpiles.ts", "by-use");
      const whole = await run([join(folder, "whole")], folder);
      expect(whole).toMatchObject({ stderr: "", exitCode: 0 });
      expect(await run([join(folder, "by-use", "program")], folder)).toEqual(whole);
    });

    test("a program that only uses Bun.Transpiler has neither the CSS parser nor the React Compiler", async () => {
      using dir = tempDir("compile-trim-runtime-by-use", files);
      const folder = String(dir);
      const textsIn = (file: Buffer) => textsOfBundlerFeatures.filter(text => file.includes(text));
      expect(textsIn(readFileSync(bunExe()))).toEqual(textsOfBundlerFeatures);
      await build(folder, "transpiles.ts", "by-use");
      if (!isWindows) expect(textsIn(bytesAt(join(folder, "by-use", "program")))).toEqual([]);
    });

    test("a server that never names bun:test has none of it, whatever names it reads off values nobody knows", async () => {
      using dir = tempDir("compile-trim-runtime-by-use", files);
      const folder = String(dir);
      await buildWhole(folder, "serves-values-nobody-knows.ts");
      expect(await build(folder, "serves-values-nobody-knows.ts", "by-use")).toEqual(await build(folder, "serves-values-nobody-knows.ts", "forced-out", [featureNamed("Test")]));
      const whole = await run([join(folder, "whole")], folder);
      expect(whole).toEqual({ stdout: "1 2     6,8 object\n", stderr: "", exitCode: 0 });
      expect(await run([join(folder, "by-use", "program")], folder)).toEqual(whole);
    });

    test("a native library leaves none of its texts in the file when its features are removed", async () => {
      using dir = tempDir("compile-trim-runtime-by-use", files);
      const folder = String(dir);
      expect(textsOfLibrariesIn(readFileSync(bunExe()))).toEqual(linkedLibraries.flatMap(library => textsOfLibraries[library]!.map(text => `${library}: ${text}`)));
      await build(folder, "hello.ts", "without");
      expect(await run([join(folder, "without", "program")], folder)).toEqual({ stdout: "hello world\n", stderr: "", exitCode: 0 });
      if (!isWindows) expect(textsOfLibrariesIn(bytesAt(join(folder, "without", "program")))).toEqual([]);
    });
  });
}

export function testPrograms(part: number, parts: number) {
  const { mine } = deal(part, parts);

  (!canTrim || unsupported ? describe.skip : describe.concurrent)("--compile --aot --trim, feature by feature", () => {
    for (const file of programFiles.filter(mine)) {
      const name = basename(file, ".ts");
      const options = optionsAt(join(programs, name + ".json"));
      const features = featuresOfProgram(name, options);
      const says = new Map(Object.entries(options.says ?? {}).map(([spelling, text]) => [findFeature(spelling), text]));
      const runsToday = new Set((options.runsToday ?? []).map(featureNamed));
      const fallsBack = new Set((options.fallsBack ?? []).map(featureNamed));

      const declare = isWindows && options.posix === true ? test.skip : options.failsToday !== undefined ? test.failing : test;
      declare(
        `${name}: the program runs like the untrimmed one` + (features.length > 0 ? `; with ${features.join(", ")} forced out, the executable says so` : ""),
        () =>
          slot(async () => {
            using dir = tempDir("compile-trim-runtime-part", {
              "program.ts": readFileSync(join(programs, file), "utf8"),
              "tsconfig.json": `{ "compilerOptions": { "noImplicitAny": false, "types": ["bun"], "skipLibCheck": true } }`,
              "cwd/empty": "",
            });
            const folder = String(dir);
            const env = { ...bunEnv, ...options.env };
            const built = async (outfile: string, flags: string[], without: string[] = []) => {
              const build = await run([bunExe(), "build", "--compile", "--aot", ...flags, ...withoutFeatures(without), ...(options.build ?? []), "program.ts", "--outfile", outfile], folder, env);
              expect(build.stderr).not.toMatch(/^error\b/m);
              expect(build.exitCode).toBe(0);
              return await spawned([join(folder, outfile)], join(folder, "cwd"), env);
            };
            const whole = await built("whole", []);
            expect(whole.exitCode).toBe(0);
            expect(whole.stdout).not.toBe("");
            expect(await built("kept", ["--trim"])).toMatchObject({ stdout: whole.stdout, exitCode: 0 });
            for (const feature of features) {
              const failed = await built("forced-out", ["--trim"], [feature]);
              if (runsToday.has(feature)) {
                expect(failed, `${feature} says that it was removed: take it out of runsToday in ${name}.json`).toMatchObject({ stdout: whole.stdout, exitCode: 0 });
                continue;
              }
              if (fallsBack.has(feature)) {
                expect({ stderr: failed.stderr, exitCode: failed.exitCode }).toEqual({ stderr: "", exitCode: 0 });
                expect(failed.stdout).not.toBe(whole.stdout);
                continue;
              }
              const sentence = `--trim removed ${textOf(feature)} from this executable`;
              const importFailed = modulesLoadedFor([feature]).find(specifier => failed.stderr.includes(`Cannot load '${specifier}': it isn't in this executable.`) && failed.stderr.includes("ERR_MODULE_NOT_FOUND"));
              const isCaughtByTheProgram = failed.stdout.includes("ERR_FEATURE_REMOVED") || failed.stdout.includes(`${textOf(feature)} was removed by --trim because your code never uses it.`);
              const isSaid = saysFeatureWasRemoved(failed.stderr, feature);
              if (importFailed === undefined && !isCaughtByTheProgram && !isSaid) expect(failed.stderr).toContain(says.get(feature) ?? sentence);
              // Where one of Bun's own modules catches the error and prints it, as Node's inspector.open() does, the program goes on.
              expect(isCaughtByTheProgram || isSaid ? [70, 1, 0] : [70, 1]).toContain(failed.exitCode);
            }
          }),
        600_000,
      );
    }

    for (const name of neighborNames.filter(mine)) {
      const files = Object.fromEntries(readdirSync(join(neighbors, name)).map(file => [file, readFileSync(join(neighbors, name, file), "utf8")]));
      const options: ProgramOptions = files["features.json"] ? JSON.parse(files["features.json"]) : {};
      const features = featuresOfProgram(name, options);

      test.skipIf(features.length === 0 || (isWindows && options.posix === true))(
        `${name}: a program that comes near ${features.join(", ")} and uses none of it runs like the untrimmed one without it`,
        () =>
          slot(async () => {
            using dir = tempDir("compile-trim-runtime-near", { ...files, "tsconfig.json": `{ "compilerOptions": { "noImplicitAny": false, "types": ["bun"], "skipLibCheck": true } }`, "cwd/empty": "" });
            const folder = String(dir);
            const built = async (outfile: string, flags: string[], without: string[] = []) => {
              const program = join(folder, outfile, "program");
              const build = await run([bunExe(), "build", "--compile", "--aot", ...flags, ...withoutFeatures(without), "near.ts", "--outfile", program], folder);
              expect(build.stderr).not.toMatch(/^error\b/m);
              expect(build.exitCode).toBe(0);
              return { ...(await spawned([program], join(folder, "cwd"), bunEnv)), executable: executableAt(program) };
            };
            const whole = await built("whole", []);
            expect(whole.exitCode).toBe(0);
            expect(whole.stdout).not.toBe("");
            const byUse = await built("by-use", ["--trim"]);
            expect(byUse).toMatchObject({ stdout: whole.stdout, exitCode: 0 });
            const forcedOut = await built("forced-out", ["--trim"], features);
            expect(forcedOut).toMatchObject({ stdout: whole.stdout, exitCode: 0 });
            if (!options.keptToday) expect(forcedOut.executable).toEqual(byUse.executable);
          }),
        600_000,
      );
    }
  });
}
