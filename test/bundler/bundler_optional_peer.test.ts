import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

// When a package declares an optional peer dependency via `peerDependenciesMeta`
// and that peer is not installed, `require()` / `import()` / `require.resolve()`
// calls that reference it from inside the package should not fail the build.
// Instead the call is replaced with a runtime throw, matching how Node behaves
// (throws MODULE_NOT_FOUND, which the package's own try/catch helper handles).
//
// https://github.com/oven-sh/bun/issues/4803

describe("bundler", () => {
  // The NestJS pattern: optionalRequire("x", () => require("x")). The require
  // call is inside an arrow function (not lexically inside try/catch), so the
  // bundler cannot infer that it is guarded from syntax alone.
  itBundled("optional-peer/MissingOptionalPeerInArrowCallback", {
    files: {
      "/entry.js": /* js */ `
        const lib = require("lib");
        console.log(lib.value);
      `,
      "/node_modules/lib/package.json": /* json */ `
        {
          "name": "lib",
          "peerDependencies": { "missing-peer": "*" },
          "peerDependenciesMeta": { "missing-peer": { "optional": true } }
        }
      `,
      "/node_modules/lib/index.js": /* js */ `
        function optionalRequire(name, fn) {
          try { return fn ? fn() : require(name); } catch { return "fallback"; }
        }
        exports.value = optionalRequire("missing-peer", () => require("missing-peer"));
      `,
    },
    target: "bun",
    run: { stdout: "fallback" },
  });

  // Bare `require()` outside any try/catch. The build must still succeed and
  // the throw must happen at runtime only when the call is reached.
  itBundled("optional-peer/MissingOptionalPeerBareRequire", {
    files: {
      "/entry.js": /* js */ `
        const lib = require("lib");
        console.log("used=" + lib.used);
        let threw = false;
        try { lib.load(); } catch (e) { threw = e instanceof Error; }
        console.log("threw=" + threw);
      `,
      "/node_modules/lib/package.json": /* json */ `
        {
          "name": "lib",
          "peerDependenciesMeta": { "missing-peer": { "optional": true } }
        }
      `,
      "/node_modules/lib/index.js": /* js */ `
        exports.used = false;
        exports.load = function () {
          exports.used = true;
          return require("missing-peer");
        };
      `,
    },
    target: "bun",
    run: { stdout: "used=false\nthrew=true" },
    onAfterBundle(api) {
      api.expectFile("out.js").toContain("Cannot require module ");
    },
  });

  itBundled("optional-peer/MissingOptionalPeerScopedSubpath", {
    files: {
      "/entry.js": /* js */ `
        const lib = require("lib");
        let threw = false;
        try { lib.load(); } catch (e) { threw = e instanceof Error; }
        console.log("threw=" + threw);
      `,
      "/node_modules/lib/package.json": /* json */ `
        {
          "name": "lib",
          "peerDependencies": { "@scope/missing": "*" },
          "peerDependenciesMeta": { "@scope/missing": { "optional": true } }
        }
      `,
      "/node_modules/lib/index.js": /* js */ `
        exports.load = function () {
          return require("@scope/missing/deep/path");
        };
      `,
    },
    target: "bun",
    run: { stdout: "threw=true" },
  });

  itBundled("optional-peer/MissingOptionalPeerRequireResolve", {
    files: {
      "/entry.js": /* js */ `
        const lib = require("lib");
        let threw = false;
        try { lib.where(); } catch { threw = true; }
        console.log("threw=" + threw);
      `,
      "/node_modules/lib/package.json": /* json */ `
        {
          "name": "lib",
          "peerDependenciesMeta": { "missing-peer": { "optional": true } }
        }
      `,
      "/node_modules/lib/index.js": /* js */ `
        exports.where = function () {
          return require.resolve("missing-peer");
        };
      `,
    },
    target: "bun",
    run: { stdout: "threw=true" },
  });

  // Dynamic `import()` of a missing optional peer is left as an external call
  // in the output; it rejects at runtime rather than being lowered to a throw
  // shim (same output as `--external missing-peer`).
  itBundled("optional-peer/MissingOptionalPeerDynamicImport", {
    files: {
      "/entry.js": /* js */ `
        import lib from "lib";
        const result = await lib().then(() => "ok", () => "rejected");
        console.log(result);
      `,
      "/node_modules/lib/package.json": /* json */ `
        {
          "name": "lib",
          "peerDependenciesMeta": { "missing-peer": { "optional": true } }
        }
      `,
      "/node_modules/lib/index.js": /* js */ `
        module.exports = function () {
          return import("missing-peer");
        };
      `,
    },
    target: "bun",
    run: { stdout: "rejected" },
    onAfterBundle(api) {
      api.expectFile("out.js").toContain(`import("missing-peer")`);
    },
  });

  // The same onResolve-plugin fallback path (plugin returns undefined, bundler
  // falls through to the resolver) should behave identically.
  itBundled("optional-peer/MissingOptionalPeerThroughPluginFallback", {
    files: {
      "/entry.js": /* js */ `
        const lib = require("lib");
        let threw = false;
        try { lib.load(); } catch (e) { threw = e instanceof Error; }
        console.log("threw=" + threw);
      `,
      "/node_modules/lib/package.json": /* json */ `
        {
          "name": "lib",
          "peerDependenciesMeta": { "missing-peer": { "optional": true } }
        }
      `,
      "/node_modules/lib/index.js": /* js */ `
        exports.load = function () {
          return require("missing-peer");
        };
      `,
    },
    target: "bun",
    plugins(builder) {
      builder.onResolve({ filter: /^missing-peer$/ }, () => undefined);
    },
    run: { stdout: "threw=true" },
    onAfterBundle(api) {
      api.expectFile("out.js").toContain("Cannot require module ");
    },
  });

  // `peerDependenciesMeta` in the app's own package.json applies to its own
  // files the same way it would inside node_modules.
  itBundled("optional-peer/AppRootOptionalPeer", {
    files: {
      "/entry.js": /* js */ `
        exports.load = function () { return require("missing-peer"); };
        let threw = false;
        try { exports.load(); } catch (e) { threw = e instanceof Error; }
        console.log("threw=" + threw);
      `,
      "/package.json": /* json */ `
        {
          "name": "app",
          "peerDependenciesMeta": { "missing-peer": { "optional": true } }
        }
      `,
    },
    target: "bun",
    run: { stdout: "threw=true" },
    onAfterBundle(api) {
      api.expectFile("out.js").toContain("Cannot require module ");
    },
  });

  // A peer that is installed resolves normally; being listed as optional does
  // not shadow the real module.
  itBundled("optional-peer/InstalledOptionalPeerResolves", {
    files: {
      "/entry.js": /* js */ `
        const lib = require("lib");
        console.log(lib.value);
      `,
      "/node_modules/lib/package.json": /* json */ `
        {
          "name": "lib",
          "peerDependenciesMeta": { "present-peer": { "optional": true } }
        }
      `,
      "/node_modules/lib/index.js": /* js */ `
        exports.value = require("present-peer");
      `,
      "/node_modules/present-peer/package.json": /* json */ `
        { "name": "present-peer" }
      `,
      "/node_modules/present-peer/index.js": /* js */ `
        module.exports = "present";
      `,
    },
    target: "bun",
    run: { stdout: "present" },
    onAfterBundle(api) {
      api.expectFile("out.js").not.toContain("Cannot require module ");
    },
  });

  // Optional-peer handling only looks at the nearest enclosing package.json.
  // A require from the app (not from inside the package) still errors.
  itBundled("optional-peer/OnlyAppliesInsideOwningPackage", {
    files: {
      "/entry.js": /* js */ `
        require("missing-peer");
      `,
      "/node_modules/lib/package.json": /* json */ `
        {
          "name": "lib",
          "peerDependenciesMeta": { "missing-peer": { "optional": true } }
        }
      `,
    },
    target: "bun",
    bundleErrors: {
      "/entry.js": [`Could not resolve: "missing-peer". Maybe you need to "bun install"?`],
    },
  });

  // `peerDependenciesMeta` without `"optional": true` (or with a non-true value)
  // does not suppress the error.
  itBundled("optional-peer/NonOptionalMetaStillErrors", {
    files: {
      "/entry.js": /* js */ `
        require("lib");
      `,
      "/node_modules/lib/package.json": /* json */ `
        {
          "name": "lib",
          "peerDependenciesMeta": {
            "missing-peer": { "optional": false },
            "other-peer": {}
          }
        }
      `,
      "/node_modules/lib/index.js": /* js */ `
        require("missing-peer");
      `,
    },
    target: "bun",
    bundleErrors: {
      "/node_modules/lib/index.js": [`Could not resolve: "missing-peer". Maybe you need to "bun install"?`],
    },
  });

  // Static ESM `import` statements cannot defer their error to runtime (the
  // binding is hoisted), so they keep erroring at build time.
  itBundled("optional-peer/ESMImportStillErrors", {
    files: {
      "/entry.js": /* js */ `
        import "lib";
      `,
      "/node_modules/lib/package.json": /* json */ `
        {
          "name": "lib",
          "type": "module",
          "peerDependenciesMeta": { "missing-peer": { "optional": true } }
        }
      `,
      "/node_modules/lib/index.js": /* js */ `
        import peer from "missing-peer";
        export default peer;
      `,
    },
    target: "bun",
    bundleErrors: {
      "/node_modules/lib/index.js": [`Could not resolve: "missing-peer". Maybe you need to "bun install"?`],
    },
  });
});
