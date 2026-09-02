import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Every option here is declared as `string` or `boolean` in bake.d.ts. A value
// of another type must throw ERR_INVALID_ARG_TYPE from Bun.serve, before any
// dev server starts.
test("Bun.serve({ app }) rejects wrong-typed framework options", async () => {
  using dir = tempDir("bake-app-options", {
    "fixture.ts": `
      const fsr = { root: "routes", style: "nextjs-pages", serverEntryPoint: "./server.ts" };
      const framework = { fileSystemRouterTypes: [fsr] };
      const cases = {
        "root": { framework, root: 123 },
        "fileSystemRouterTypes[].root": { framework: { fileSystemRouterTypes: [{ ...fsr, root: 123 }] } },
        "fileSystemRouterTypes[].ignoreUnderscores": {
          framework: { fileSystemRouterTypes: [{ ...fsr, ignoreUnderscores: "yes" }] },
        },
        "fileSystemRouterTypes[].layouts": { framework: { fileSystemRouterTypes: [{ ...fsr, layouts: 1 }] } },
        "serverComponents.serverRuntimeImportSource": {
          framework: { ...framework, serverComponents: { separateSSRGraph: false, serverRuntimeImportSource: 5 } },
        },
        "plugins[].name": { framework, plugins: [{ name: 42, setup() {} }] },
        "plugins[].setup": { framework, plugins: [{ name: "p", setup: "nope" }] },
      };
      for (const [name, app] of Object.entries(cases)) {
        let result;
        try {
          Bun.serve({ port: 0, development: true, app, fetch: () => new Response() }).stop(true);
          result = "no error";
        } catch (e) {
          result = e.code + ": " + e.message;
        }
        console.log(name + " -> " + result);
      }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toMatchInlineSnapshot(`
    "root -> ERR_INVALID_ARG_TYPE: The "root" property must be of type string, got number
    fileSystemRouterTypes[].root -> ERR_INVALID_ARG_TYPE: The "root" property must be of type string, got number
    fileSystemRouterTypes[].ignoreUnderscores -> ERR_INVALID_ARG_TYPE: The "ignoreUnderscores" property must be of type boolean, got string
    fileSystemRouterTypes[].layouts -> ERR_INVALID_ARG_TYPE: The "layouts" property must be of type boolean, got number
    serverComponents.serverRuntimeImportSource -> ERR_INVALID_ARG_TYPE: The "serverRuntimeImportSource" property must be of type string, got number
    plugins[].name -> ERR_INVALID_ARG_TYPE: The "name" property must be of type string, got number
    plugins[].setup -> ERR_INVALID_ARG_TYPE: setup must be a function
    "
  `);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

// A framework specifier (`reactFastRefresh.importSource`, an entry point, the
// server components runtime) can resolve to a disabled module: a stubbed
// Node.js builtin, or anything the package.json "browser" field maps to
// `false`. The resolve succeeds, but the result has no path. Such a specifier
// must be reported like a missing module, not crash the process.
const disabledSpecifierCases = [
  {
    name: "reactFastRefresh.importSource is a Node.js builtin",
    packageJson: `{ "name": "app" }`,
    framework: `{ fileSystemRouterTypes: [fsr], reactFastRefresh: { importSource: "node:fs" } }`,
    error: `error: Cannot use "node:fs" for framework (react refresh runtime): it resolves to a builtin module`,
  },
  {
    name: "clientEntryPoint is a Node.js builtin",
    packageJson: `{ "name": "app" }`,
    framework: `{ fileSystemRouterTypes: [{ ...fsr, clientEntryPoint: "fs" }] }`,
    error: `error: Cannot use "fs" for framework (client side entrypoint): it resolves to a builtin module`,
  },
  {
    name: "serverComponents.serverRuntimeImportSource is a Node.js builtin",
    packageJson: `{ "name": "app" }`,
    framework: `{ fileSystemRouterTypes: [fsr], serverComponents: { separateSSRGraph: false, serverRuntimeImportSource: "node:fs" } }`,
    error: `error: Cannot use "node:fs" for framework (server components runtime): it resolves to a builtin module`,
  },
  {
    name: "reactFastRefresh.importSource is disabled by the browser field",
    packageJson: `{ "name": "app", "browser": { "react-refresh": false } }`,
    framework: `{ fileSystemRouterTypes: [fsr], reactFastRefresh: { importSource: "react-refresh" } }`,
    error: `error: Cannot use "react-refresh" for framework (react refresh runtime): it is disabled due to "browser" field in package.json`,
  },
];

const frameworkFiles = {
  "server.ts": `export default function render() { return new Response("ok"); }`,
  "routes/index.ts": `export default () => null;`,
};

for (const c of disabledSpecifierCases) {
  test.concurrent(`Bun.serve({ app }) reports a disabled ${c.name}`, async () => {
    using dir = tempDir("bake-app-disabled", {
      ...frameworkFiles,
      "package.json": c.packageJson,
      "fixture.ts": `
        const fsr = { root: "routes", style: "nextjs-pages", serverEntryPoint: "./server.ts" };
        try {
          Bun.serve({ port: 0, development: true, app: { framework: ${c.framework} }, fetch: () => new Response() }).stop(true);
          console.log("no error");
        } catch (e) {
          console.log(e.name + ": " + e.message);
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr.trim()).toBe(c.error);
    expect(stdout).toBe("AggregateError: Framework is missing required files!\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent(`bun build --app reports a disabled ${c.name}`, async () => {
    using dir = tempDir("bake-build-app-disabled", {
      ...frameworkFiles,
      "package.json": c.packageJson,
      "bun.app.ts": `
        const fsr = { root: "routes", style: "nextjs-pages", serverEntryPoint: "./server.ts" };
        export default { app: { framework: ${c.framework} } };
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--app", "./bun.app.ts"],
      env: {
        ...bunEnv,
        // The config loader of `bun build --app` has unchecked exception scopes
        // (`bakeModuleLoaderResolve`, `BakeGetDefaultExportFromModule`) that
        // abort a debug build under validation before the framework resolves.
        BUN_JSC_validateExceptionChecks: undefined,
        BUN_JSC_dumpSimulatedThrows: undefined,
      },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain(`\n${c.error}\nerror: Failed to resolve all imports required by the framework\n`);
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });
}
