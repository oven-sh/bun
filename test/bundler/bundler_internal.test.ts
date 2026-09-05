import { describe, test } from "bun:test";
import { itBundled } from "./expectBundled";

// `internal` is the inverse of `external`: never externalize these modules,
// even when `packages: "external"` or a positive `--external` would mark them
// external. Backed by the `--internal` CLI flag / `Bun.build({ internal })`.
describe("bundler", () => {
  // The core use case: `packages: "external"` externalizes every package,
  // `internal` keeps the listed ones bundled.
  itBundled("internal/OverridesPackagesExternal", {
    entryPoints: ["/entry.js"],
    files: {
      "/entry.js": /* js */ `
        import { a } from "foo";
        console.log(a);
      `,
      "/node_modules/foo/index.js": /* js */ `
        export const a = "Hello World";
      `,
      "/node_modules/foo/package.json": /* json */ `
        {
          "name": "foo",
          "version": "1.0.0",
          "main": "index.js"
        }
      `,
    },
    packages: "external",
    internal: ["foo"],
    onAfterBundle(api) {
      // "foo" is bundled — its code must appear in the output instead of a
      // runtime `import ... from "foo"`.
      api.expectFile("/out.js").toContain("Hello World");
      api.expectFile("/out.js").not.toContain(`from "foo"`);
    },
  });

  // `internal` takes precedence over a positive `external` entry.
  itBundled("internal/OverridesExternal", {
    entryPoints: ["/entry.js"],
    files: {
      "/entry.js": /* js */ `
        import { a } from "foo";
        console.log(a);
      `,
      "/node_modules/foo/index.js": /* js */ `
        export const a = "Hello World";
      `,
      "/node_modules/foo/package.json": /* json */ `
        {
          "name": "foo",
          "version": "1.0.0",
          "main": "index.js"
        }
      `,
    },
    external: ["foo"],
    internal: ["foo"],
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("Hello World");
      api.expectFile("/out.js").not.toContain(`from "foo"`);
    },
  });

  // Subpaths of an internal package are bundled too (same subpath-walking
  // semantics as the positive `node_modules` externals).
  itBundled("internal/Subpath", {
    entryPoints: ["/entry.js"],
    files: {
      "/entry.js": /* js */ `
        import { a } from "foo/sub";
        console.log(a);
      `,
      "/node_modules/foo/sub.js": /* js */ `
        export const a = "Hello Subpath";
      `,
      "/node_modules/foo/package.json": /* json */ `
        {
          "name": "foo",
          "version": "1.0.0"
        }
      `,
    },
    packages: "external",
    internal: ["foo"],
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("Hello Subpath");
    },
  });

  // Wildcards are supported.
  itBundled("internal/Wildcard", {
    entryPoints: ["/entry.js"],
    files: {
      "/entry.js": /* js */ `
        import { a } from "@scope/pkg";
        console.log(a);
      `,
      "/node_modules/@scope/pkg/index.js": /* js */ `
        export const a = "Hello Scope";
      `,
      "/node_modules/@scope/pkg/package.json": /* json */ `
        {
          "name": "@scope/pkg",
          "version": "1.0.0",
          "main": "index.js"
        }
      `,
    },
    packages: "external",
    internal: ["@scope/*"],
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("Hello Scope");
    },
  });

  // Absolute filesystem specifiers: `internal` wins over a positive
  // `external` entry for the same absolute path (normalized against cwd,
  // like the positive `--external` path is).
  itBundled("internal/AbsolutePathOverridesExternal", {
    backend: "cli",
    entryPoints: ["/entry.js"],
    files: {
      "/entry.js": /* js */ `
        import { a } from "{{root}}/foo.js";
        console.log(a);
      `,
      "/foo.js": /* js */ `
        export const a = "Hello Absolute";
      `,
    },
    external: ["{{root}}/foo.js"],
    internal: ["{{root}}/foo.js"],
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("Hello Absolute");
    },
  });

  // Relative filesystem specifiers: `internal` wins over a positive
  // `external` entry for the same relative path (both are normalized against
  // cwd before comparison, so the exclusion matches the resolved abs path).
  itBundled("internal/RelativePathOverridesExternal", {
    backend: "cli",
    entryPoints: ["/entry.js"],
    files: {
      "/entry.js": /* js */ `
        import { a } from "./foo.js";
        console.log(a);
      `,
      "/foo.js": /* js */ `
        export const a = "Hello Relative";
      `,
    },
    external: ["./foo.js"],
    internal: ["./foo.js"],
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("Hello Relative");
    },
  });

  // Sanity control: without `internal`, a positive `external` entry for the
  // same absolute path leaves the import as-is.
  itBundled("internal/AbsolutePathControlExternal", {
    backend: "cli",
    entryPoints: ["/entry.js"],
    files: {
      "/entry.js": /* js */ `
        import { a } from "{{root}}/foo.js";
        console.log(a);
      `,
      "/foo.js": /* js */ `
        export const a = "Hello Absolute";
      `,
    },
    external: ["{{root}}/foo.js"],
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("Hello Absolute");
    },
  });

  // Sanity control: without `internal`, a positive `external` entry for the
  // same relative path leaves the import as-is.
  itBundled("internal/RelativePathControlExternal", {
    backend: "cli",
    entryPoints: ["/entry.js"],
    files: {
      "/entry.js": /* js */ `
        import { a } from "./foo.js";
        console.log(a);
      `,
      "/foo.js": /* js */ `
        export const a = "Hello Relative";
      `,
    },
    external: ["./foo.js"],
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("Hello Relative");
    },
  });

  // Filesystem exclusions match at path-component boundaries: `internal:
  // ["/project/foo"]` must NOT match a sibling like `/project/foobar` — a
  // positive `external` for the sibling still externalizes it.
  itBundled("internal/ExactPathNotSibling", {
    backend: "cli",
    entryPoints: ["/entry.js"],
    files: {
      "/entry.js": /* js */ `
        import { a } from "{{root}}/foobar.js";
        console.log(a);
      `,
      "/foobar.js": /* js */ `
        export const a = "Hello Sibling";
      `,
    },
    external: ["{{root}}/foobar.js"],
    internal: ["{{root}}/foo"],
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("Hello Sibling");
    },
  });

  // Sanity control: `internal: ["/project/foo"]` DOES cover a descendant
  // like `/project/foo/bar.js` (path-component boundary), so the positive
  // `external` for that exact descendant is overridden.
  itBundled("internal/ExactPathCoversDescendant", {
    backend: "cli",
    entryPoints: ["/entry.js"],
    files: {
      "/entry.js": /* js */ `
        import { a } from "{{root}}/foo/bar.js";
        console.log(a);
      `,
      "/foo/bar.js": /* js */ `
        export const a = "Hello Descendant";
      `,
    },
    external: ["{{root}}/foo/bar.js"],
    internal: ["{{root}}/foo"],
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("Hello Descendant");
    },
  });

  // A literal `--external` value starting with `!` (valid filesystem path
  // character on POSIX and Windows) must stay a positive external — it must
  // NOT be misread as an internal exclusion (regression for the previous
  // `!`-prefixed shared encoding between external and internal entries).
  itBundled("internal/LiteralBangExternalIsNotInternal", {
    backend: "cli",
    entryPoints: ["/entry.js"],
    files: {
      "/entry.js": /* js */ `
        import { a } from "!foo";
        console.log(a);
      `,
      "/node_modules/!foo/index.js": /* js */ `
        export const a = "Hello Bang";
      `,
      "/node_modules/!foo/package.json": /* json */ `
        {
          "name": "!foo",
          "version": "1.0.0",
          "main": "index.js"
        }
      `,
    },
    packages: "bundle",
    external: ["!foo"],
    onAfterBundle(api) {
      // The literal `external` entry keeps "!foo" external.
      api.expectFile("/out.js").not.toContain("Hello Bang");
      api.expectFile("/out.js").toContain(`from "!foo"`);
    },
  });

  // `internal` is read from the `[bundle]` table in bunfig.toml (CLI
  // regression: it must NOT be read from the config root).
  itBundled("internal/BunfigBundleTable", {
    backend: "cli",
    entryPoints: ["/entry.js"],
    files: {
      "/bunfig.toml": /* toml */ `
        [bundle]
        internal = ["foo"]
      `,
      "/entry.js": /* js */ `
        import { a } from "foo";
        console.log(a);
      `,
      "/node_modules/foo/index.js": /* js */ `
        export const a = "Hello World";
      `,
      "/node_modules/foo/package.json": /* json */ `
        {
          "name": "foo",
          "version": "1.0.0",
          "main": "index.js"
        }
      `,
    },
    packages: "external",
    onAfterBundle(api) {
      // "foo" is bundled — its code must appear in the output instead of a
      // runtime `import ... from "foo"`.
      api.expectFile("/out.js").toContain("Hello World");
      api.expectFile("/out.js").not.toContain(`from "foo"`);
    },
  });

  // Sanity control: without `internal`, `packages: "external"` leaves the
  // import as-is — proving the tests above exercise the new behavior.
  itBundled("internal/ControlExternal", {
    entryPoints: ["/entry.js"],
    files: {
      "/entry.js": /* js */ `
        import { a } from "foo";
        console.log(a);
      `,
      "/node_modules/foo/index.js": /* js */ `
        export const a = "Hello World";
      `,
      "/node_modules/foo/package.json": /* json */ `
        {
          "name": "foo",
          "version": "1.0.0",
          "main": "index.js"
        }
      `,
    },
    packages: "external",
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("Hello World");
      api.expectFile("/out.js").toContain(`from "foo"`);
    },
  });
});
