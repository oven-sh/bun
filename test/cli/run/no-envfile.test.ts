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

// A switch that keeps the default `.env` files out of a process keeps them out of what runs inside it: a
// `Bun.build()`, a macro, a `Bun.serve()` HTML route, a child process and a Worker.
describe("the switch covers a build, a macro, an HTML route and a Worker of the process", () => {
  const markers = ["key-from-dot-env", "only-from-dot-env", "key-from-custom-env"];
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

  // The variables of the fixtures come from a `.env` file only, whatever the environment of this test run has.
  const cleanEnv = {
    ...bunEnv,
    NODE_ENV: undefined,
    BUN_OPTIONS: undefined,
    API_KEY: undefined,
    ONLY_IN_DOT_ENV: undefined,
  };

  type Options = { env?: Record<string, string | undefined>; argv0?: string };
  async function run(cwd: string, args: string[], { env, argv0 }: Options = {}) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      argv0,
      env: { ...cleanEnv, ...env },
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
    using dir = tempDir("env-opt-out", files);
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
    using dir = tempDir("env-opt-out", bunfig ? { ...files, "bunfig.toml": bunfig } : files);
    expect(await run(String(dir), args, options)).toEqual({ report: everyPlace([]), exitCode: 0 });
  });

  test("--env-file: each of them has the values of that file only", async () => {
    using dir = tempDir("env-opt-out", files);
    expect(await run(String(dir), ["--env-file=custom.env", "main.ts"])).toEqual({
      report: everyPlace(["key-from-custom-env"]),
      exitCode: 0,
    });
  });

  // A `bun test --parallel` worker reads no env file when it starts: it has the environment of the coordinator. That
  // is not a switch. What a test builds there reads a default `.env` as under `bun test`, unless the command has one.
  const testFile = String.raw`
    import { test } from "bun:test";
    import { seen } from "./seen.ts";

    test("a build in another directory", async () => {
      process.chdir(import.meta.dir + "/pkg");
      const result = await Bun.build({ entrypoints: ["./client.ts"], env: "inline" });
      console.log("REPORT " + JSON.stringify(seen(await result.outputs[0].text())));
    });
  `;
  const testRuns: [string, string[], string[]][] = [
    ["bun test", ["test"], ["key-from-dot-env", "only-from-dot-env"]],
    ["bun test --parallel", ["test", "--parallel=2"], ["key-from-dot-env", "only-from-dot-env"]],
    ["bun test --parallel --no-env-file", ["test", "--parallel=2", "--no-env-file"], []],
    ["bun test --parallel --env-file", ["test", "--parallel=2", "--env-file=custom.env"], ["key-from-custom-env"]],
  ];
  test.concurrent.each(testRuns)("%s: a build in a directory with a .env of its own", async (_, args, values) => {
    using dir = tempDir("env-opt-out", {
      "custom.env": files["custom.env"],
      "seen.ts": seen,
      "pkg/.env": files[".env"],
      "pkg/client.ts": files["client.ts"],
      "a.test.ts": testFile,
      "b.test.ts": testFile,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      env: { ...cleanEnv, BUN_TEST_PARALLEL_SCALE_MS: "0" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const reports = [...(stdout + stderr).matchAll(/^REPORT (.*)$/gm)].map(match => JSON.parse(match[1]));
    expect({ reports: reports.length === 2 ? reports : { stdout, stderr }, exitCode }).toEqual({
      reports: [values, values],
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
    using dir = tempDir("env-opt-out", bunfig ? { ...buildFiles, "bunfig.toml": bunfig } : buildFiles);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", ...flags, "./entry.ts"],
      env: cleanEnv,
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

  const htmlRoutes: [string, string[], boolean, string[]][] = [
    ["no switch, development: false", [], false, ["key-from-dot-env", "only-from-dot-env"]],
    ["no switch, development: true", [], true, ["key-from-dot-env", "only-from-dot-env"]],
    ["--no-env-file, development: false", ["--no-env-file"], false, []],
    ["--no-env-file, development: true", ["--no-env-file"], true, []],
  ];
  test.concurrent.each(htmlRoutes)(
    "%s: an HTML route with [serve.static] env = 'inline'",
    async (_, flags, development, values) => {
      using dir = tempDir("env-opt-out", {
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
          for (const src of scripts) {
            const response = await fetch(new URL(src, server.url));
            if (!response.ok) throw new Error(src + " is " + response.status);
            route.push(...seen(await response.text()));
          }
          const own = seen([process.env.API_KEY, process.env.ONLY_IN_DOT_ENV].join());
          console.log("REPORT " + JSON.stringify({ scripts: scripts.length, route, own }));
          await server.stop(true);
        `,
      });
      const args = [...flags, "main.ts", ...(development ? ["--development"] : [])];
      expect(await run(String(dir), args)).toEqual({ report: { scripts: 1, route: values, own: values }, exitCode: 0 });
    },
  );
});
