import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("--no-env-file disables .env loading", async () => {
  using dir = tempDir("no-env-file", {
    ".env": "FOO=bar",
    "index.js": "console.log(process.env.FOO);",
  });

  // Without --no-env-file, .env should be loaded
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("bar");
    expect(exitCode).toBe(0);
  }

  // With --no-env-file, .env should NOT be loaded
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--no-env-file", "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("undefined");
    expect(exitCode).toBe(0);
  }
});

test("--no-env-file disables .env.local loading", async () => {
  using dir = tempDir("no-env-file-local", {
    ".env": "FOO=bar",
    ".env.local": "FOO=local",
    "index.js": "console.log(process.env.FOO);",
  });

  // Without --no-env-file, .env.local should override .env
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("local");
    expect(exitCode).toBe(0);
  }

  // With --no-env-file, neither should be loaded
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--no-env-file", "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("undefined");
    expect(exitCode).toBe(0);
  }
});

test("--no-env-file disables .env.development.local loading", async () => {
  using dir = tempDir("no-env-file-dev-local", {
    ".env": "FOO=bar",
    ".env.development.local": "FOO=dev-local",
    "index.js": "console.log(process.env.FOO);",
  });

  // Without --no-env-file, .env.development.local should be loaded
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("dev-local");
    expect(exitCode).toBe(0);
  }

  // With --no-env-file, it should NOT be loaded
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--no-env-file", "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("undefined");
    expect(exitCode).toBe(0);
  }
});

test("bunfig env.file = false disables .env loading", async () => {
  using dir = tempDir("bunfig-env-file-false", {
    ".env": "FOO=bar",
    "bunfig.toml": `
[env]
file = false
`,
    "index.js": "console.log(process.env.FOO);",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("undefined");
  expect(exitCode).toBe(0);
});

test("bunfig env = false disables .env loading", async () => {
  using dir = tempDir("bunfig-env-false", {
    ".env": "FOO=bar",
    "bunfig.toml": `
env = false
`,
    "index.js": "console.log(process.env.FOO);",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("undefined");
  expect(exitCode).toBe(0);
});

test("--no-env-file with -e flag", async () => {
  using dir = tempDir("no-env-file-eval", {
    ".env": "FOO=bar",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--no-env-file", "-e", "console.log(process.env.FOO)"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("undefined");
  expect(exitCode).toBe(0);
});

test("--no-env-file combined with --env-file still loads explicit file", async () => {
  using dir = tempDir("no-env-file-with-env-file", {
    ".env": "FOO=bar",
    ".env.custom": "FOO=custom",
    "index.js": "console.log(process.env.FOO);",
  });

  // --no-env-file should skip .env but --env-file should load .env.custom
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--no-env-file", "--env-file", ".env.custom", "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("custom");
  expect(exitCode).toBe(0);
});

test("bunfig env = true still loads .env files", async () => {
  using dir = tempDir("bunfig-env-true", {
    ".env": "FOO=bar",
    "bunfig.toml": `
env = true
`,
    "index.js": "console.log(process.env.FOO);",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("bar");
  expect(exitCode).toBe(0);
});

test("--no-env-file in production mode", async () => {
  using dir = tempDir("no-env-file-production", {
    ".env": "FOO=bar",
    ".env.production": "FOO=prod",
    "index.js": "console.log(process.env.FOO);",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--no-env-file", "index.js"],
    env: { ...bunEnv, NODE_ENV: "production" },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("undefined");
  expect(exitCode).toBe(0);
});

// A `Bun.build()`, a macro, a `Bun.serve()` HTML route and a Worker use the environment of the process that starts
// them. They read no `.env` file themselves. So the files that the process did not read stay out of its bundles, its
// macros, its child processes and its Workers.
describe("a build, a macro, an HTML route and a Worker read no .env file themselves", () => {
  const markers = [
    "key-from-dot-env",
    "only-from-dot-env",
    "key-from-custom-env",
    "from-dot-env-local",
    "from-dot-env-development",
    "from-dot-env-production",
    "from-dot-env-test",
    "early-from-dot-env",
    "late-from-dot-env",
  ];
  // The values from the .env files that are in the text.
  const seenIn = (text: string) => markers.filter(marker => text.includes(marker));
  const seen = `
    const markers = ${JSON.stringify(markers)};
    export const seen = (text: string) => markers.filter(marker => text.includes(marker));
  `;
  const files = {
    ".env": "API_KEY=key-from-dot-env\nONLY_IN_DOT_ENV=only-from-dot-env\n",
    "custom.env": "API_KEY=key-from-custom-env\n",
    "client.ts": "console.log(process.env.API_KEY, process.env.ONLY_IN_DOT_ENV);\n",
    "values.ts": "export const values = () => [process.env.API_KEY, process.env.ONLY_IN_DOT_ENV].join();\n",
    "use-macro.ts": 'import { values } from "./values.ts" with { type: "macro" };\nconsole.log(values());\n',
    "worker.ts": "postMessage([process.env.API_KEY, process.env.ONLY_IN_DOT_ENV].join());\n",
    "seen.ts": seen,
    "report.ts": String.raw`
      import { seen } from "./seen.ts";

      const bundle = async (entry: string, env: any) => {
        const result = await Bun.build({ entrypoints: [entry], env });
        return seen(await result.outputs[0].text());
      };
      const macro =
        "import { values } from " +
        JSON.stringify(import.meta.dir.replaceAll("\\", "/") + "/values.ts") +
        ' with { type: "macro" };\nconsole.log(values());\n';
      const print = "console.log([process.env.API_KEY, process.env.ONLY_IN_DOT_ENV].join())";

      export async function report() {
        const inline = await bundle("./client.ts", "inline");
        const prefix = await bundle("./client.ts", "API_*");
        const buildMacro = await bundle("./use-macro.ts", "disable");
        // The async transform runs the macro in a VM of a pool thread, as a build does.
        const transpilerMacro = seen(await new Bun.Transpiler({ loader: "ts" }).transform(macro));
        const child = Bun.spawn({ cmd: [process.execPath, "--no-env-file", "-e", print], stdout: "pipe" });
        const [fromChild] = await Promise.all([child.stdout.text(), child.exited]);
        const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
        const fromWorker = await new Promise<string>((resolve, reject) => {
          worker.onmessage = event => resolve(event.data);
          worker.onerror = event => reject(new Error(event.message));
        });
        await worker.terminate();
        return {
          inline,
          prefix,
          buildMacro,
          transpilerMacro,
          child: seen(fromChild),
          worker: seen(fromWorker),
          // Read last: process.env gets the variables that the process has when it is first read.
          own: seen([process.env.API_KEY, process.env.ONLY_IN_DOT_ENV].join()),
        };
      }
    `,
    "main.ts": 'import { report } from "./report.ts";\nconsole.log("REPORT " + JSON.stringify(await report()));\n',
    "main.test.ts": String.raw`
      import { test } from "bun:test";
      import { report } from "./report.ts";

      test("report", async () => {
        console.log("REPORT " + JSON.stringify(await report()));
      });
    `,
  };

  // Each place of the report, with the values from the .env files that reached it.
  const everyPlace = (values: string[], prefixed = values) => ({
    inline: values,
    prefix: prefixed,
    buildMacro: values,
    transpilerMacro: values,
    child: values,
    worker: values,
    own: values,
  });

  type Options = { env?: Record<string, string | undefined>; argv0?: string };
  async function run(cwd: string, args: string[], { env, argv0 }: Options = {}) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      argv0,
      env: { ...bunEnv, NODE_ENV: undefined, BUN_OPTIONS: undefined, ...env },
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const line = stdout.split(/\r?\n/).find(line => line.startsWith("REPORT "));
    return { report: line ? JSON.parse(line.slice("REPORT ".length)) : { stdout, stderr }, exitCode };
  }

  // The tests that make the whole report run one at a time: each starts three builds, a transform, a child process and
  // a Worker, and that is too much at once for a debug build.
  test("with no switch, each of them has the values of .env", async () => {
    using dir = tempDir("env-of-the-process", files);
    expect(await run(String(dir), ["main.ts"])).toEqual({
      report: everyPlace(["key-from-dot-env", "only-from-dot-env"], ["key-from-dot-env"]),
      exitCode: 0,
    });
  });

  const switches: [string, string[], Options & { bunfig?: string }][] = [
    ["bun --no-env-file", ["--no-env-file", "main.ts"], {}],
    ["bun run --no-env-file", ["run", "--no-env-file", "main.ts"], {}],
    ["BUN_OPTIONS=--no-env-file", ["main.ts"], { env: { BUN_OPTIONS: "--no-env-file" } }],
    ["bunfig env = false", ["main.ts"], { bunfig: "env = false\n" }],
    ["bunfig [env] file = false", ["main.ts"], { bunfig: "[env]\nfile = false\n" }],
    ["bun invoked as node", ["main.ts"], { argv0: "node" }],
    ["bun test --no-env-file", ["test", "--no-env-file", "./main.test.ts"], {}],
  ];
  test.each(switches)("%s: none of them has a value of .env", async (_, args, { bunfig, ...options }) => {
    using dir = tempDir("env-of-the-process", bunfig ? { ...files, "bunfig.toml": bunfig } : files);
    expect(await run(String(dir), args, options)).toEqual({ report: everyPlace([]), exitCode: 0 });
  });

  test("--env-file: each of them has the values of that file only", async () => {
    using dir = tempDir("env-of-the-process", files);
    expect(await run(String(dir), ["--env-file=custom.env", "main.ts"])).toEqual({
      report: everyPlace(["key-from-custom-env"]),
      exitCode: 0,
    });
  });

  // `bun build` boots no VM. The VM of its macro gets the options of the command. What that macro starts does not:
  // here a transform with a macro of its own, which runs in one more VM.
  const buildFiles = {
    ".env": files[".env"],
    "custom.env": files["custom.env"],
    "values.ts": files["values.ts"],
    "nested.ts": String.raw`
      export async function nested() {
        const code =
          "import { values } from " +
          JSON.stringify(import.meta.dir.replaceAll("\\", "/") + "/values.ts") +
          ' with { type: "macro" };\nconsole.log(values());\n';
        return await new Bun.Transpiler({ loader: "ts" }).transform(code);
      }
    `,
    "entry.ts": String.raw`
      import { nested } from "./nested.ts" with { type: "macro" };
      import { values } from "./values.ts" with { type: "macro" };

      console.log("direct", values());
      console.log("nested", nested());
    `,
  };
  const builds: [string, string[], string | undefined, string[]][] = [
    ["bun build", [], undefined, ["key-from-dot-env", "only-from-dot-env"]],
    ["bun build --no-env-file", ["--no-env-file"], undefined, []],
    ["bun build with bunfig env = false", [], "env = false\n", []],
    ["bun build --env-file", ["--env-file=custom.env"], undefined, ["key-from-custom-env"]],
  ];
  test.concurrent.each(builds)("%s: a macro and what it starts", async (_, flags, bunfig, values) => {
    using dir = tempDir("env-of-the-process", bunfig ? { ...buildFiles, "bunfig.toml": bunfig } : buildFiles);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", ...flags, "./entry.ts"],
      env: { ...bunEnv, NODE_ENV: undefined, BUN_OPTIONS: undefined },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const lines = stdout.split(/\r?\n/);
    // The values that the call of the macro became in the bundle, or null if the bundle has no such line.
    const macro = (name: string) => {
      const line = lines.find(line => line.startsWith(`console.log("${name}"`));
      return line === undefined ? null : seenIn(line);
    };
    expect({ direct: macro("direct"), nested: macro("nested"), stderr, exitCode }).toEqual({
      direct: values,
      nested: values,
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent.each([false, true])(
    "--no-env-file: an HTML route with [serve.static] env = 'inline' and development: %p inlines no value of .env",
    async development => {
      using dir = tempDir("env-of-the-process", {
        ".env": files[".env"],
        "bunfig.toml": '[serve.static]\nenv = "inline"\n',
        "client.ts": files["client.ts"],
        "index.html": '<!doctype html><script type="module" src="./client.ts"></script>\n',
        "seen.ts": seen,
        "main.ts": String.raw`
          import index from "./index.html";
          import { seen } from "./seen.ts";

          const server = Bun.serve({
            port: 0,
            development: process.argv.includes("--development"),
            routes: { "/": index },
            fetch: () => new Response("not found", { status: 404 }),
          });
          const html = await (await fetch(server.url)).text();
          const scripts = [...html.matchAll(/src="([^"]+)"/g)].map(match => match[1]);
          const route: string[] = [];
          for (const src of scripts) route.push(...seen(await (await fetch(new URL(src, server.url))).text()));
          const own = seen([process.env.API_KEY, process.env.ONLY_IN_DOT_ENV].join());
          console.log("REPORT " + JSON.stringify({ scripts: scripts.length, route, own }));
          await server.stop(true);
        `,
      });
      const args = ["--no-env-file", "main.ts", ...(development ? ["--development"] : [])];
      expect(await run(String(dir), args)).toEqual({ report: { scripts: 1, route: [], own: [] }, exitCode: 0 });
    },
  );

  // `bun test` reads .env.test and .env. It does not read .env.local or .env.development, whatever NODE_ENV is.
  test.concurrent("NODE_ENV=development bun test: a build reads no .env file of another mode", async () => {
    using dir = tempDir("env-of-the-process", {
      ".env.local": "LOCAL_ONLY=from-dot-env-local\n",
      ".env.development": "DEVELOPMENT_ONLY=from-dot-env-development\n",
      ".env.test": "TEST_ONLY=from-dot-env-test\n",
      "client.ts": "console.log(process.env.LOCAL_ONLY, process.env.DEVELOPMENT_ONLY, process.env.TEST_ONLY);\n",
      "seen.ts": seen,
      "main.test.ts": String.raw`
        import { test } from "bun:test";
        import { seen } from "./seen.ts";

        test("report", async () => {
          const result = await Bun.build({ entrypoints: ["./client.ts"], env: "inline" });
          const inline = seen(await result.outputs[0].text());
          const print = "console.log([process.env.LOCAL_ONLY, process.env.DEVELOPMENT_ONLY, process.env.TEST_ONLY].join())";
          const child = Bun.spawn({ cmd: [process.execPath, "--no-env-file", "-e", print], stdout: "pipe" });
          const [fromChild] = await Promise.all([child.stdout.text(), child.exited]);
          const own = seen([process.env.LOCAL_ONLY, process.env.DEVELOPMENT_ONLY, process.env.TEST_ONLY].join());
          console.log("REPORT " + JSON.stringify({ inline, child: seen(fromChild), own }));
        });
      `,
    });
    expect(await run(String(dir), ["test", "./main.test.ts"], { env: { NODE_ENV: "development" } })).toEqual({
      report: { inline: ["from-dot-env-test"], child: ["from-dot-env-test"], own: ["from-dot-env-test"] },
      exitCode: 0,
    });
  });

  // The process chose its .env files before it read NODE_ENV in .env. A build reads no file of the other mode later.
  test.concurrent("NODE_ENV in .env: a build has the values of the files that the process read", async () => {
    using dir = tempDir("env-of-the-process", {
      ".env": "NODE_ENV=production\n",
      ".env.production": "PRODUCTION_ONLY=from-dot-env-production\n",
      ".env.development": "DEVELOPMENT_ONLY=from-dot-env-development\n",
      "client.ts": "console.log(process.env.PRODUCTION_ONLY, process.env.DEVELOPMENT_ONLY);\n",
      "seen.ts": seen,
      "main.ts": String.raw`
        import { seen } from "./seen.ts";

        const own = seen([process.env.PRODUCTION_ONLY, process.env.DEVELOPMENT_ONLY].join());
        const result = await Bun.build({ entrypoints: ["./client.ts"], env: "inline" });
        console.log("REPORT " + JSON.stringify({ own, inline: seen(await result.outputs[0].text()) }));
      `,
    });
    const { report, exitCode } = await run(String(dir), ["main.ts"]);
    expect(report.own).toHaveLength(1);
    expect({ inline: report.inline, exitCode }).toEqual({ inline: report.own, exitCode: 0 });
  });

  test.concurrent("a Worker has the variables of its parent: it does not read .env again", async () => {
    using dir = tempDir("env-of-the-process", {
      ".env": "EARLY=early-from-dot-env\n",
      "seen.ts": seen,
      "worker.ts": "postMessage([process.env.EARLY, process.env.LATE].join());\n",
      "main.ts": String.raw`
        import { appendFileSync } from "node:fs";
        import { seen } from "./seen.ts";

        appendFileSync(".env", "LATE=late-from-dot-env\n");
        const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
        const fromWorker = await new Promise<string>((resolve, reject) => {
          worker.onmessage = event => resolve(event.data);
          worker.onerror = event => reject(new Error(event.message));
        });
        await worker.terminate();
        const own = seen([process.env.EARLY, process.env.LATE].join());
        console.log("REPORT " + JSON.stringify({ worker: seen(fromWorker), own }));
      `,
    });
    expect(await run(String(dir), ["main.ts"])).toEqual({
      report: { worker: ["early-from-dot-env"], own: ["early-from-dot-env"] },
      exitCode: 0,
    });
  });

  test.concurrent("a .env file written after startup is not read by the macro of a build", async () => {
    using dir = tempDir("env-of-the-process", {
      "values.ts": "export const values = () => String(process.env.LATE);\n",
      "use-macro.ts": 'import { values } from "./values.ts" with { type: "macro" };\nconsole.log(values());\n',
      "seen.ts": seen,
      "main.ts": String.raw`
        import { writeFileSync } from "node:fs";
        import { seen } from "./seen.ts";

        writeFileSync(".env", "LATE=late-from-dot-env\n");
        const result = await Bun.build({ entrypoints: ["./use-macro.ts"], env: "disable" });
        const print = "console.log(String(process.env.LATE))";
        const child = Bun.spawn({ cmd: [process.execPath, "--no-env-file", "-e", print], stdout: "pipe" });
        const [fromChild] = await Promise.all([child.stdout.text(), child.exited]);
        const macro = seen(await result.outputs[0].text());
        console.log("REPORT " + JSON.stringify({ macro, child: seen(fromChild) }));
      `,
    });
    expect(await run(String(dir), ["main.ts"])).toEqual({ report: { macro: [], child: [] }, exitCode: 0 });
  });
});
