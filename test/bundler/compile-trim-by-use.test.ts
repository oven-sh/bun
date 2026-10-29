// What `bun build --compile --aot --trim` keeps and removes for a handful of programs and build options. trim-by-use/ has a program for each part of Bun.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, isWindows } from "harness";
import { readFileSync } from "node:fs";
import { unsupported } from "../aot/harness/compiler";
import { run } from "../aot/harness/run";
import { sharedBuilds, sizeOf, type Build } from "../aot/harness/shared-builds";
import { readRemovedFeatures } from "../aot/trimmed-against-whole/removed-features";
import {
  canTrim,
  featureNamed,
  featureOf,
  model,
  saysFeatureWasRemoved,
  withoutFeatures,
} from "./compile-trim-features";

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
  tar: ["Damaged tar archive", "Truncated tar archive", "Malformed pax attribute"],
  lsquic: [
    "Attempt to create second control stream",
    "Client cannot send HANDSHAKE_DONE frame",
    "Packet Tolerance of zero is invalid",
  ],
  BoringSSL: [
    "ALPN_MISMATCH_ON_EARLY_DATA",
    "APPLICATION_DATA_ON_SHUTDOWN",
    "ATTEMPT_TO_REUSE_SESSION_IN_DIFFERENT_CONTEXT",
  ],
  "the compiler of regular expressions": ["back reference of subpattern #", "<unicode non-word ignore case>"],
  SQLite: ["malformed database schema", "unable to open database file", "SQLite format 3"],
  TinyCC: ["cannot use local functions", "invalid operand types for binary operation"],
  "lol-html": ["The selector is empty", "Unexpected token in selector"],
};
const linkedLibraries = Object.keys(textsOfLibraries).filter(library => !(isMacOS && library === "SQLite"));
const textsOfLibrariesIn = (file: Buffer) =>
  linkedLibraries.flatMap(library =>
    textsOfLibraries[library]!.filter(text => file.includes(text)).map(text => `${library}: ${text}`),
  );

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

(!canTrim || unsupported ? describe.skip : describe.concurrent)(
  "--compile --aot --trim removes what the program doesn't use",
  () => {
    const { folder, build } = sharedBuilds("compile-trim-by-use", {
      ...files,
      "tsconfig.json": `{ "compilerOptions": { "types": ["bun"] } }`,
    });
    const env = { ...bunEnv, FOLDER: folder };
    const trimmed = (entry: string, ...flags: string[]) => build(entry, "--aot", "--trim", ...flags);
    const without = (entry: string, ...removed: string[]) => trimmed(entry, ...withoutFeatures(removed));
    const started = (built: Build, ...args: string[]) => run([built.executable, ...args], folder, env);
    const plain = (entry: string) => run([bunExe(), entry], folder, env);
    function removedFrom(built: Build) {
      const indexes = readRemovedFeatures(built.file);
      expect(indexes).toBeDefined();
      return model.features.filter(feature => indexes!.includes(feature.index)).map(feature => feature.name);
    }
    const hello = { stdout: "hello world\n", stderr: "", exitCode: 0 };

    test("a program that uses none of them has none of them", async () => {
      const built = await trimmed("hello.ts");
      expect(removedFrom(built)).toEqual(
        expect.arrayContaining(Object.values(features).map(feature => featureOf(feature.implements))),
      );
      expect(await started(built)).toEqual(hello);
    });

    test("properties of the program's own objects keep no feature, whatever their names", async () => {
      const namesakes = [
        ...new Set(
          [
            "Bun.sql",
            "Bun.s3",
            "Bun.build",
            "Bun.password",
            "Bun.listen",
            "process.send",
            "Bun.serve",
            "Bun.Image",
            "Bun.$",
            "alert",
            "Bun.color",
            "fetch",
          ].map(featureOf),
        ),
      ];
      const built = await trimmed("own-properties.ts");
      expect(removedFrom(built)).toEqual(expect.arrayContaining(namesakes));
      expect(await started(built)).toEqual({
        stdout: "select 1 a.txt built secret served function 1 alerted red fetched\n1 message b.txt 2 3\n",
        stderr: "",
        exitCode: 0,
      });
    });

    test.each(Object.entries(features))(
      "%s: a program that uses it keeps it; with it forced out, the executable says so",
      async (name, feature) => {
        const kept = await trimmed(`uses-${name}.ts`);
        const forcedOut = await without(`uses-${name}.ts`, featureOf(feature.implements));
        expect(removedFrom(kept)).not.toContain(featureOf(feature.implements));
        expect(sizeOf(forcedOut)).toBeLessThan(sizeOf(kept));
        expect(await started(kept)).toEqual({ stdout: feature.prints, stderr: "", exitCode: 0 });
        const failed = await started(forcedOut);
        expect({
          stderr: failed.stderr,
          saysSo: saysFeatureWasRemoved(failed.stderr, featureOf(feature.implements)),
        }).toEqual({ stderr: failed.stderr, saysSo: true });
        expect([70, 1]).toContain(failed.exitCode);
      },
    );

    test("what only Bun.serve needs is kept for an entry point with a default export, and for no other", async () => {
      const onlyForServers = [featureNamed("ServeHttp2"), featureOf("Bun.serve")];
      expect(removedFrom(await trimmed("hello.ts"))).toEqual(expect.arrayContaining(onlyForServers));
      const kept = await trimmed("serves-its-default-export.ts");
      expect(removedFrom(kept)).not.toContain(featureOf("Bun.serve"));
      const served = await started(kept);
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
      const kept = await trimmed("hello.ts", ...flags);
      expect(removedFrom(kept)).not.toContain(featureNamed(feature));
      expect(await started(kept)).toEqual(hello);
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
      const built = await trimmed("hello.ts", ...flags);
      expect(removedFrom(built)).toContain(featureNamed(feature));
      expect(await started(built)).toEqual(hello);
    });

    test.each<string[]>([
      ["--trace-requests"],
      ["--trace-warnings"],
      ["--stack-trace-limit=1"],
      ["--trace-env", "--trace-exit", "--trace-event-categories=node"],
    ])("the arguments %j belong to the program", async (...args) =>
      expect(await started(await trimmed("hello.ts"), ...args)).toEqual(hello),
    );

    test.each(["--trace-warnings", "--trace-deprecation", "--trace-uncaught", "--trace-sigint"])(
      "BUN_OPTIONS=%s needs nothing that was removed",
      async option => {
        expect(await run([(await trimmed("hello.ts")).executable], folder, { ...bunEnv, BUN_OPTIONS: option })).toEqual(
          hello,
        );
      },
    );

    test("a program that comes near removed features, and calls none of them, runs", async () => {
      expect(await started(await trimmed("near-removed-features.ts"))).toEqual({
        stdout: "true true function true\ntrue\n",
        stderr: "",
        exitCode: 0,
      });
    });

    test("a string passed to eval() still finds the names of the APIs that the source never uses", async () => {
      expect(await started(await trimmed("evaluates.ts"))).toEqual({
        stdout: "function function\n",
        stderr: "",
        exitCode: 0,
      });
    });

    test.todo("a route that asks for the development server by an option keeps it", async () => {
      const kept = await trimmed("styled-route.ts");
      expect(removedFrom(kept)).not.toContain(featureOf("Bun.build"));
      expect(await started(kept)).toEqual(await plain("styled-route.ts"));
    });

    test("known bug: a Bun.serve route with the style option doesn't count as a use of the bundler, and throws a catchable error", async () => {
      const ran = await started(await trimmed("styled-route.ts"));
      expect(ran.stdout).toContain("style: the bundler and the dev server were removed by --trim");
      expect({ stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    });

    test("a server whose options ask for neither has no bundler and no transpiler", async () => {
      const built = await trimmed("serves.ts");
      expect(removedFrom(built)).toEqual(expect.arrayContaining([featureOf("Bun.build"), featureOf("Bun.Transpiler")]));
      expect(await started(built)).toEqual({
        stdout: `served\na\nb\n${files["bundled.ts"]}\n`,
        stderr: "",
        exitCode: 0,
      });
    });

    test("reload() never needs the development server, whatever its routes ask for", async () => {
      const built = await trimmed("reloads.ts");
      expect(removedFrom(built)).toEqual(expect.arrayContaining([featureOf("Bun.build"), featureOf("Bun.Transpiler")]));
      const whole = await started(await build("reloads.ts", "--aot"));
      expect(whole.stdout).toStartWith("reloaded\n");
      expect(await started(built)).toEqual(whole);
    });

    test("a program that calls Bun.build() can bundle CSS and use the React Compiler", async () => {
      const whole = await plain("bundles-a-component.ts");
      expect(whole.stdout).toContain("react/compiler-runtime");
      expect(whole.stdout).toContain("margin:3px");
      expect(whole).toMatchObject({ stderr: "", exitCode: 0 });
      expect(await started(await trimmed("bundles-a-component.ts"))).toEqual(whole);
    });

    test("a program that only uses Bun.Transpiler transpiles .ts, .tsx and .jsx like plain Bun, and has neither the CSS parser nor the React Compiler", async () => {
      const whole = await plain("transpiles.ts");
      expect(whole).toMatchObject({ stderr: "", exitCode: 0 });
      const built = await trimmed("transpiles.ts");
      expect(await started(built)).toEqual(whole);
      const textsIn = (file: Buffer) => textsOfBundlerFeatures.filter(text => file.includes(text));
      expect(textsIn(readFileSync(bunExe()))).toEqual(textsOfBundlerFeatures);
      if (!isWindows) expect(textsIn(readFileSync(built.file))).toEqual([]);
    });

    test("a server that never names bun:test has none of it, whatever names it reads off values nobody knows", async () => {
      const built = await trimmed("serves-values-nobody-knows.ts");
      expect(removedFrom(built)).toContain(featureNamed("Test"));
      expect(await started(built)).toEqual({ stdout: "1 2     6,8 object\n", stderr: "", exitCode: 0 });
    });

    test("a native library leaves none of its texts in the file when its features are removed", async () => {
      expect(textsOfLibrariesIn(readFileSync(bunExe()))).toEqual(
        linkedLibraries.flatMap(library => textsOfLibraries[library]!.map(text => `${library}: ${text}`)),
      );
      if (!isWindows) expect(textsOfLibrariesIn(readFileSync((await trimmed("hello.ts")).file))).toEqual([]);
    });
  },
);
