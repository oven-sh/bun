import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

// `bun <file>` parses bunfig.toml before it applies argv; `bun run <file>` (and
// everything else that boots through RunCommand) parses it after argv. A key
// with a command-line counterpart has to lose to the flag in both orders and
// still apply when the flag is absent.

async function run(cwd: string, args: string[], env: Record<string, string | undefined> = bunEnv) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

type Expected = { stdout: unknown; stderr: unknown; exitCode: number };
const ok = (stdout: string): Expected => ({ stdout, stderr: "", exitCode: 0 });

// An import source for the automatic runtime, so nothing is fetched from a
// registry. The dev and prod entry points report the same thing so the tests do
// not depend on how `development` is derived.
function jsxImportSource(name: string, output: string) {
  return {
    [`node_modules/${name}/package.json`]: JSON.stringify({ name }),
    [`node_modules/${name}/jsx-runtime/index.js`]: `exports.jsx = exports.jsxs = () => ${JSON.stringify(output)};`,
    [`node_modules/${name}/jsx-dev-runtime/index.js`]: `exports.jsxDEV = () => ${JSON.stringify(output)};`,
  };
}

const settings: {
  name: string;
  files: Record<string, string>;
  entry: string;
  flags: string[];
  withFlag: Expected;
  withoutFlag: Expected;
}[] = [
  {
    name: "[define] / --define",
    files: {
      "bunfig.toml": `[define]\nTAG = '"bunfig"'\n`,
      "index.js": `console.log(TAG);\n`,
    },
    entry: "index.js",
    flags: ["--define", 'TAG="cli"'],
    withFlag: ok("cli\n"),
    withoutFlag: ok("bunfig\n"),
  },
  {
    name: "[loader] / --loader",
    files: {
      "bunfig.toml": `[loader]\n".data" = "text"\n`,
      "payload.data": `{"loaded": true}`,
      "index.js": `import payload from "./payload.data";\nconsole.log(typeof payload);\n`,
    },
    entry: "index.js",
    flags: ["--loader", ".data:json"],
    withFlag: ok("object\n"),
    withoutFlag: ok("string\n"),
  },
  {
    name: "[console] depth / --console-depth",
    files: {
      "bunfig.toml": `[console]\ndepth = 1\n`,
      "index.js": `console.log({ a: { b: { c: 1 } } });\n`,
    },
    entry: "index.js",
    flags: ["--console-depth", "5"],
    withFlag: ok("{\n  a: {\n    b: {\n      c: 1,\n    },\n  },\n}\n"),
    withoutFlag: ok("{\n  a: {\n    b: [Object ...],\n  },\n}\n"),
  },
  {
    name: "jsx / --jsx-runtime",
    files: {
      ...jsxImportSource("react", "runtime:bunfig"),
      "bunfig.toml": `jsx = "react-jsx"\n`,
      "index.jsx": `globalThis.React = { createElement: () => "runtime:cli" };\nconsole.log(<div />);\n`,
    },
    entry: "index.jsx",
    flags: ["--jsx-runtime", "classic"],
    withFlag: ok("runtime:cli\n"),
    withoutFlag: ok("runtime:bunfig\n"),
  },
  {
    // The runtime still comes from bunfig.toml here; only the factory is
    // taken from the command line.
    name: "jsxFactory / --jsx-factory",
    files: {
      "bunfig.toml": `jsx = "react"\njsxFactory = "bunfigFactory"\n`,
      "index.jsx": [
        `globalThis.bunfigFactory = () => "factory:bunfig";`,
        `globalThis.cliFactory = () => "factory:cli";`,
        `console.log(<div />);`,
        ``,
      ].join("\n"),
    },
    entry: "index.jsx",
    flags: ["--jsx-factory", "cliFactory"],
    withFlag: ok("factory:cli\n"),
    withoutFlag: ok("factory:bunfig\n"),
  },
  {
    name: "jsxFragment / --jsx-fragment",
    files: {
      "bunfig.toml": `jsx = "react"\njsxFragment = "BunfigFragment"\n`,
      "index.jsx": [
        `globalThis.React = { createElement: fragment => "fragment:" + fragment };`,
        `globalThis.BunfigFragment = "bunfig";`,
        `globalThis.CliFragment = "cli";`,
        `console.log(<></>);`,
        ``,
      ].join("\n"),
    },
    entry: "index.jsx",
    flags: ["--jsx-fragment", "CliFragment"],
    withFlag: ok("fragment:cli\n"),
    withoutFlag: ok("fragment:bunfig\n"),
  },
  {
    name: "jsxImportSource / --jsx-import-source",
    files: {
      ...jsxImportSource("bunfig-source", "source:bunfig"),
      ...jsxImportSource("cli-source", "source:cli"),
      "bunfig.toml": `jsx = "react-jsx"\njsxImportSource = "bunfig-source"\n`,
      "index.jsx": `console.log(<div />);\n`,
    },
    entry: "index.jsx",
    flags: ["--jsx-import-source", "cli-source"],
    withFlag: ok("source:cli\n"),
    withoutFlag: ok("source:bunfig\n"),
  },
  {
    // Any `[macros]` remap table turns macros back on.
    name: "[macros] / --no-macros",
    files: {
      "bunfig.toml": `[macros]\n"some-package" = { "value" = "./macro.ts" }\n`,
      "macro.ts": `export function value() {\n  return "ran";\n}\n`,
      "index.ts": `import { value } from "./macro.ts" with { type: "macro" };\nconsole.log("macro:" + value());\n`,
    },
    entry: "index.ts",
    flags: ["--no-macros"],
    withFlag: { stdout: "", stderr: expect.stringContaining("error: Macros are disabled"), exitCode: 1 },
    // Debug builds log "[macro] call value" to stdout before the script runs.
    withoutFlag: { stdout: expect.stringMatching(/(^|\n)macro:ran\n$/), stderr: "", exitCode: 0 },
  },
];

describe.each(settings)("$name", ({ files, entry, flags, withFlag, withoutFlag }) => {
  test.concurrent("bun <flags> <file>: the flag wins", async () => {
    using dir = tempDir("bunfig-cli-early", files);
    expect(await run(String(dir), [...flags, entry])).toEqual(withFlag);
  });

  test.concurrent("bun run <flags> <file>: the flag still wins when bunfig.toml is parsed after argv", async () => {
    using dir = tempDir("bunfig-cli-late", files);
    expect(await run(String(dir), ["run", ...flags, entry])).toEqual(withFlag);
  });

  test.concurrent("bun run <file>: bunfig.toml applies when the flag is absent", async () => {
    using dir = tempDir("bunfig-only", files);
    expect(await run(String(dir), ["run", entry])).toEqual(withoutFlag);
  });
});

describe("[install] auto / --install", () => {
  // Auto-install is observable as a manifest request, so point bunfig.toml at
  // a registry stub that only records what was asked for.
  function registryStub() {
    const requests: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        requests.push(new URL(req.url).pathname);
        return new Response("not found", { status: 404 });
      },
    });
    return { requests, server, [Symbol.dispose]: () => server.stop(true) };
  }

  function project(auto: string, registryPort: number) {
    return tempDir("bunfig-install-auto", {
      "bunfig.toml": `[install]\nauto = ${auto}\nregistry = "http://localhost:${registryPort}/"\n`,
      "index.js": `import "package-that-is-not-installed";\n`,
    });
  }

  async function runProject(dir: string, args: string[]) {
    const result = await run(dir, args, { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(dir, ".bun-cache") });
    expect(result.stderr).toContain("Cannot find package 'package-that-is-not-installed'");
    expect(result.exitCode).toBe(1);
  }

  test.concurrent.each(["--no-install index.js", "run --no-install index.js"])(
    'bun %s: --no-install wins over auto = "fallback"',
    async args => {
      using registry = registryStub();
      using dir = project(`"fallback"`, registry.server.port);
      await runProject(String(dir), args.split(" "));
      expect(registry.requests).toEqual([]);
    },
  );

  test.concurrent('bun run <file>: auto = "fallback" applies when no flag is given', async () => {
    using registry = registryStub();
    using dir = project(`"fallback"`, registry.server.port);
    await runProject(String(dir), ["run", "index.js"]);
    expect(registry.requests).toEqual(["/package-that-is-not-installed"]);
  });

  test.concurrent("bun run -i <file>: -i wins over auto = false", async () => {
    using registry = registryStub();
    using dir = project("false", registry.server.port);
    await runProject(String(dir), ["run", "-i", "index.js"]);
    expect(registry.requests).toEqual(["/package-that-is-not-installed"]);
  });
});
