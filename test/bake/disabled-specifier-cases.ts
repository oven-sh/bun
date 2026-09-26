// Shared by app-options.test.ts (Bun.serve({ app })) and
// build-app-options.test.ts (bun build --app).
//
// A framework specifier (`reactFastRefresh.importSource`, an entry point, the
// server components runtime) can resolve to a disabled module: a stubbed
// Node.js builtin, or anything the package.json "browser" field maps to
// `false`. The resolve succeeds, but the result has no path. Such a specifier
// must be reported like a missing module, not crash the process.
export const disabledSpecifierCases = [
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

// `fsr` in each case above is declared by the fixture that embeds the framework.
export const frameworkFiles = {
  "server.ts": `export default function render() { return new Response("ok"); }`,
  "routes/index.ts": `export default () => null;`,
};
