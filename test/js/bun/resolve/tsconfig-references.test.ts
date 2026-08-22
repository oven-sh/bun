// Solution-style tsconfig.json: a root config with "files": [] and
// "references" delegates to the referenced project whose "files"/"include"
// covers the importing file, like tsc does.
// https://github.com/oven-sh/bun/issues/34234
// https://github.com/oven-sh/bun/issues/4774

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

async function run(cwd: string, entry: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", entry],
    env: bunEnv,
    cwd,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

function expectRan(result: { stdout: string; stderr: string; exitCode: number }, stdout: string) {
  expect(result.stderr).toBe("");
  expect(result.stdout).toBe(stdout);
  expect(result.exitCode).toBe(0);
}

test.concurrent("paths come from the referenced project covering the file", async () => {
  using dir = tempDir("tsconfig-refs-basic", {
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [{ path: "./tsconfig.web.json" }, { path: "./tsconfig.server.json" }],
    }),
    "tsconfig.web.json": JSON.stringify({
      include: ["src/web"],
      compilerOptions: { paths: { "@/*": ["./src/web/*"] } },
    }),
    "tsconfig.server.json": JSON.stringify({
      include: ["src/server"],
      compilerOptions: { paths: { "@/*": ["./src/server/*"] } },
    }),
    "src/server/index.ts": `import { log } from "@/common/log"; log();`,
    "src/server/common/log.ts": `export function log() { console.log("server"); }`,
    "src/web/index.ts": `import { log } from "@/common/log"; log();`,
    "src/web/common/log.ts": `export function log() { console.log("web"); }`,
  });

  // The same "@/*" alias maps to a different directory per project.
  expectRan(await run(String(dir), "src/server/index.ts"), "server\n");
  expectRan(await run(String(dir), "src/web/index.ts"), "web\n");
});

test.concurrent("worker threads resolving under the same solution root at once", async () => {
  // main.ts sits outside the solution root, so the referenced projects are
  // first needed by the workers' own resolvers, on several threads at the same
  // time; the shared solution config must load them once and serve them all.
  using dir = tempDir("tsconfig-refs-workers", {
    "main.ts": `
      const results = await Promise.all(
        Array.from({ length: 4 }, () => {
          const { promise, resolve, reject } = Promise.withResolvers();
          const worker = new Worker(new URL("./app/src/worker.ts", import.meta.url).href);
          worker.onmessage = event => {
            worker.terminate();
            resolve(event.data);
          };
          worker.onerror = event => reject(new Error(event.message));
          return promise;
        }),
      );
      console.log(results.join(","));
    `,
    "app/tsconfig.json": JSON.stringify({
      files: [],
      references: [{ path: "./tsconfig.app.json" }],
    }),
    "app/tsconfig.app.json": JSON.stringify({
      include: ["src"],
      compilerOptions: { paths: { "@/*": ["./src/*"] } },
    }),
    "app/src/worker.ts": `import { who } from "@/who"; postMessage(who);`,
    "app/src/who.ts": `export const who = "app";`,
  });

  expectRan(await run(String(dir), "main.ts"), "app,app,app,app\n");
});

test.concurrent("a reference path may point at a project directory", async () => {
  // The referenced project's config lives away from the source tree so the
  // nearest enclosing config of main.ts is the solution root: resolution
  // succeeds only if <path>/tsconfig.json is derived from the directory.
  using dir = tempDir("tsconfig-refs-dir", {
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [{ path: "./configs/app" }],
    }),
    "configs/app/tsconfig.json": JSON.stringify({
      include: ["../../src"],
      compilerOptions: { paths: { "#lib/*": ["../../src/lib/*"] } },
    }),
    "src/main.ts": `import { value } from "#lib/value"; console.log(value);`,
    "src/lib/value.ts": `export const value = 42;`,
  });

  expectRan(await run(String(dir), "src/main.ts"), "42\n");
});

test.concurrent("a file no referenced project covers gets no project paths", async () => {
  using dir = tempDir("tsconfig-refs-uncovered", {
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [{ path: "./tsconfig.web.json" }, { path: "./tsconfig.server.json" }],
    }),
    "tsconfig.web.json": JSON.stringify({
      include: ["src/web"],
      compilerOptions: { paths: { "@/*": ["./src/web/*"] } },
    }),
    "tsconfig.server.json": JSON.stringify({
      include: ["src/server"],
      compilerOptions: { paths: { "@/*": ["./src/server/*"] } },
    }),
    "src/web/x.ts": `export const x = "web";`,
    "src/server/x.ts": `export const x = "server";`,
    "scripts/tool.ts": `import { x } from "@/x"; console.log(x);`,
    "scripts/rel.ts": `import { y } from "./y"; console.log(y);`,
    "scripts/y.ts": `export const y = "rel";`,
  });

  // Neither project's "@/*" alias leaks into the uncovered directory.
  const tool = await run(String(dir), "scripts/tool.ts");
  expect(tool.stderr).toContain("Cannot find module '@/x'");
  expect(tool.exitCode).not.toBe(0);

  // Ordinary resolution from the uncovered directory still works.
  expectRan(await run(String(dir), "scripts/rel.ts"), "rel\n");
});

test.concurrent("solution root's own paths apply to files no referenced project covers", async () => {
  using dir = tempDir("tsconfig-refs-root-fallback", {
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [{ path: "./tsconfig.app.json" }],
      compilerOptions: { paths: { "#root/*": ["./lib/*"] } },
    }),
    "tsconfig.app.json": JSON.stringify({
      include: ["src"],
      compilerOptions: { paths: { "#app/*": ["./src/*"] } },
    }),
    "src/index.ts": `import { v } from "#app/v"; console.log(v);`,
    "src/v.ts": `export const v = "app";`,
    "scripts/tool.ts": `import { u } from "#root/u"; console.log(u);`,
    "lib/u.ts": `export const u = "root";`,
  });

  // Covered file uses the referenced project's paths; uncovered file falls
  // back to the solution config's own paths.
  expectRan(await run(String(dir), "src/index.ts"), "app\n");
  expectRan(await run(String(dir), "scripts/tool.ts"), "root\n");
});

test.concurrent("root-level file globs do not claim the whole tree (create-vue layout)", async () => {
  // tsconfig.node.json is listed first but its include entries are
  // root-level files and single-`*` globs, so they must cover only the root
  // directory; src/** belongs to tsconfig.app.json.
  using dir = tempDir("tsconfig-refs-vue", {
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [{ path: "./tsconfig.node.json" }, { path: "./tsconfig.app.json" }],
    }),
    "tsconfig.node.json": JSON.stringify({
      include: ["vite.config.*", "env.d.ts"],
      compilerOptions: { paths: { "@/*": ["./node-impl/*"] } },
    }),
    "tsconfig.app.json": JSON.stringify({
      include: ["src/**/*", "src/**/*.vue"],
      compilerOptions: { paths: { "@/*": ["./src/*"] } },
    }),
    "src/index.ts": `import { who } from "@/who"; console.log(who);`,
    "src/who.ts": `export const who = "app";`,
    "vite.config.ts": `import { who } from "@/who"; console.log(who);`,
    "node-impl/who.ts": `export const who = "node";`,
  });

  expectRan(await run(String(dir), "src/index.ts"), "app\n");
  expectRan(await run(String(dir), "vite.config.ts"), "node\n");
});

test.concurrent("solution root's own paths apply when the selected project has no matching key", async () => {
  // The pre-references workaround for #4774 puts paths on the solution root;
  // selecting a referenced project must not stop the root's paths from
  // applying when the project declares none.
  using dir = tempDir("tsconfig-refs-root-paths", {
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [{ path: "./tsconfig.app.json" }],
      compilerOptions: { paths: { "@/*": ["./src/*"] } },
    }),
    "tsconfig.app.json": JSON.stringify({
      include: ["src"],
    }),
    "src/index.ts": `import { v } from "@/v"; console.log(v);`,
    "src/v.ts": `export const v = "root-paths";`,
  });

  expectRan(await run(String(dir), "src/index.ts"), "root-paths\n");
});

test.concurrent("the covering project's baseUrl is tried before the solution root's paths", async () => {
  using dir = tempDir("tsconfig-refs-baseurl-before-root-paths", {
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [{ path: "./tsconfig.app.json" }],
      compilerOptions: { paths: { "utils/*": ["./legacy-utils/*"] } },
    }),
    "tsconfig.app.json": JSON.stringify({
      include: ["src"],
      compilerOptions: { baseUrl: "./src" },
    }),
    "src/index.ts": `import { who } from "utils/who"; console.log(who);`,
    "src/utils/who.ts": `export const who = "app-baseurl";`,
    "legacy-utils/who.ts": `export const who = "root-paths";`,
  });

  // The root's paths are a fallback for imports the covering project cannot
  // resolve at all, not a layer above that project's own baseUrl.
  expectRan(await run(String(dir), "src/index.ts"), "app-baseurl\n");
});

test.concurrent("a single-star glob include covers only its directory", async () => {
  using dir = tempDir("tsconfig-refs-nonrecursive", {
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [{ path: "./tsconfig.top.json" }, { path: "./tsconfig.deep.json" }],
    }),
    "tsconfig.top.json": JSON.stringify({
      include: ["src/*.ts"],
      compilerOptions: { paths: { "@/*": ["./top-impl/*"] } },
    }),
    "tsconfig.deep.json": JSON.stringify({
      include: ["src/**/*.ts"],
      compilerOptions: { paths: { "@/*": ["./deep-impl/*"] } },
    }),
    "src/index.ts": `import { who } from "@/who"; console.log(who);`,
    "src/nested/index.ts": `import { who } from "@/who"; console.log(who);`,
    "top-impl/who.ts": `export const who = "top";`,
    "deep-impl/who.ts": `export const who = "deep";`,
  });

  // src/*.ts matches files directly in src/ only; src/nested/ falls to the
  // recursive reference.
  expectRan(await run(String(dir), "src/index.ts"), "top\n");
  expectRan(await run(String(dir), "src/nested/index.ts"), "deep\n");
});

test.concurrent("a wildcard before the last segment covers the directories below it", async () => {
  using dir = tempDir("tsconfig-refs-mid-wildcard", {
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [{ path: "./tsconfig.packages.json" }, { path: "./tsconfig.apps.json" }],
    }),
    // tsc reads a directory-like last segment as packages/*/src/**/*.
    "tsconfig.packages.json": JSON.stringify({
      include: ["packages/*/src"],
      compilerOptions: { paths: { "@/*": ["./packages-impl/*"] } },
    }),
    "tsconfig.apps.json": JSON.stringify({
      include: ["apps/*/main.ts"],
      compilerOptions: { paths: { "@/*": ["./apps-impl/*"] } },
    }),
    "packages/core/src/util/index.ts": `import { who } from "@/who"; console.log(who);`,
    "apps/web/main.ts": `import { who } from "@/who"; console.log(who);`,
    "packages-impl/who.ts": `export const who = "packages";`,
    "apps-impl/who.ts": `export const who = "apps";`,
  });

  expectRan(await run(String(dir), "packages/core/src/util/index.ts"), "packages\n");
  expectRan(await run(String(dir), "apps/web/main.ts"), "apps\n");
});

test.concurrent("include with ${configDir} selects the project", async () => {
  using dir = tempDir("tsconfig-refs-configdir", {
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [{ path: "./tsconfig.app.json" }],
    }),
    "tsconfig.app.json": JSON.stringify({
      include: ["${configDir}/src"],
      compilerOptions: { paths: { "@/*": ["${configDir}/src/*"] } },
    }),
    "src/index.ts": `import { v } from "@/v"; console.log(v);`,
    "src/v.ts": `export const v = "configdir";`,
  });

  expectRan(await run(String(dir), "src/index.ts"), "configdir\n");
});

test.concurrent("an excluded directory is not covered by the project", async () => {
  using dir = tempDir("tsconfig-refs-exclude", {
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [{ path: "./tsconfig.a.json" }, { path: "./tsconfig.b.json" }],
    }),
    "tsconfig.a.json": JSON.stringify({
      include: ["src"],
      exclude: ["src/legacy"],
      compilerOptions: { paths: { "@/*": ["./a-impl/*"] } },
    }),
    "tsconfig.b.json": JSON.stringify({
      include: ["src/legacy"],
      compilerOptions: { paths: { "@/*": ["./b-impl/*"] } },
    }),
    "src/index.ts": `import { who } from "@/who"; console.log(who);`,
    "src/legacy/index.ts": `import { who } from "@/who"; console.log(who);`,
    "a-impl/who.ts": `export const who = "a";`,
    "b-impl/who.ts": `export const who = "b";`,
  });

  expectRan(await run(String(dir), "src/index.ts"), "a\n");
  expectRan(await run(String(dir), "src/legacy/index.ts"), "b\n");
});

test.concurrent("exclude is inherited through extends unless the extending config sets its own", async () => {
  using dir = tempDir("tsconfig-refs-exclude-extends", {
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [{ path: "./tsconfig.inherits.json" }, { path: "./tsconfig.overrides.json" }],
    }),
    "tsconfig.base.json": JSON.stringify({
      exclude: ["src/generated"],
    }),
    "tsconfig.inherits.json": JSON.stringify({
      extends: "./tsconfig.base.json",
      include: ["src"],
      compilerOptions: { paths: { "@/*": ["./inherits-impl/*"] } },
    }),
    "tsconfig.overrides.json": JSON.stringify({
      extends: "./tsconfig.base.json",
      include: ["src"],
      exclude: [],
      compilerOptions: { paths: { "@/*": ["./overrides-impl/*"] } },
    }),
    "src/index.ts": `import { who } from "@/who"; console.log(who);`,
    "src/generated/index.ts": `import { who } from "@/who"; console.log(who);`,
    "inherits-impl/who.ts": `export const who = "inherits";`,
    "overrides-impl/who.ts": `export const who = "overrides";`,
  });

  // Both projects cover src/, so the first reference wins there. src/generated/
  // is excluded by the inherited exclude but not by the empty one replacing it.
  expectRan(await run(String(dir), "src/index.ts"), "inherits\n");
  expectRan(await run(String(dir), "src/generated/index.ts"), "overrides\n");
});

test.concurrent("a tsconfig extending itself still resolves the directory", async () => {
  // On older versions a cyclic extends chain failed the whole directory
  // load; now the walk stops at the bound and merges what it has.
  using dir = tempDir("tsconfig-extends-self", {
    "tsconfig.json": JSON.stringify({
      extends: "./tsconfig.json",
      compilerOptions: { paths: { "@/*": ["./src/*"] } },
    }),
    "index.ts": `import { v } from "@/v"; console.log(v);`,
    "src/v.ts": `export const v = "cycle";`,
  });

  expectRan(await run(String(dir), "index.ts"), "cycle\n");
});

test.concurrent("same directory covered by two references: first reference wins", async () => {
  // Coverage is tracked per directory, not per glob, so extension-filtered
  // includes over the same directory collapse to that directory and the
  // first reference in order wins (tsc would assign main.ts to the node
  // project). This pins the documented approximation.
  using dir = tempDir("tsconfig-refs-order", {
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [{ path: "./tsconfig.web.json" }, { path: "./tsconfig.node.json" }],
    }),
    "tsconfig.web.json": JSON.stringify({
      include: ["src/**/*.web.ts"],
      compilerOptions: { paths: { "@/*": ["./src/webimpl/*"] } },
    }),
    "tsconfig.node.json": JSON.stringify({
      include: ["src/**/*.ts"],
      compilerOptions: { paths: { "@/*": ["./src/nodeimpl/*"] } },
    }),
    "src/main.ts": `import { who } from "@/who"; console.log(who);`,
    "src/webimpl/who.ts": `export const who = "web";`,
    "src/nodeimpl/who.ts": `export const who = "node";`,
  });

  expectRan(await run(String(dir), "src/main.ts"), "web\n");
});

test.concurrent("referenced config with extends and no include covers its own directory", async () => {
  // The referenced config declares no "files"/"include", so it covers its
  // own directory subtree; after the extends merge that must stay the
  // outermost config's directory, not the base's. The non-standard file
  // name keeps it from being picked up as the nearest enclosing config.
  using dir = tempDir("tsconfig-refs-default-coverage", {
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [{ path: "./app/tsconfig.app.json" }],
    }),
    "app/tsconfig.app.json": JSON.stringify({
      extends: "../base/tsconfig.base.json",
    }),
    "base/tsconfig.base.json": JSON.stringify({
      compilerOptions: { paths: { "#shared/*": ["./shared/*"] } },
    }),
    "app/main.ts": `import { v } from "#shared/v"; console.log(v);`,
    "base/shared/v.ts": `export const v = "inherited";`,
  });

  expectRan(await run(String(dir), "app/main.ts"), "inherited\n");
});

test.concurrent("references are not inherited through extends", async () => {
  using dir = tempDir("tsconfig-refs-no-inherit", {
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [{ path: "./tsconfig.app.json" }],
    }),
    "tsconfig.app.json": JSON.stringify({
      extends: "./tsconfig.base.json",
      include: ["src"],
      compilerOptions: { paths: { "#app/*": ["./src/*"] } },
    }),
    // "references" is the one top-level key excluded from extends
    // inheritance, so this entry must never be followed via the app config.
    "tsconfig.base.json": JSON.stringify({
      references: [{ path: "./tsconfig.extra.json" }],
    }),
    "tsconfig.extra.json": JSON.stringify({
      include: ["extra"],
      compilerOptions: { paths: { "#x/*": ["./extra/impl/*"] } },
    }),
    "src/index.ts": `import { v } from "#app/v"; console.log(v);`,
    "src/v.ts": `export const v = "app";`,
    "extra/main.ts": `import { m } from "#x/m"; console.log(m);`,
    "extra/impl/m.ts": `export const m = "leaked";`,
  });

  expectRan(await run(String(dir), "src/index.ts"), "app\n");

  // If base's references leaked through extends, tsconfig.extra.json would
  // load transitively and "#x/m" would resolve.
  const leaked = await run(String(dir), "extra/main.ts");
  expect(leaked.stderr).toContain("Cannot find module '#x/m'");
  expect(leaked.exitCode).not.toBe(0);
});

test.concurrent("transitive reference loading stops at the 64-config cap", async () => {
  const files: Record<string, string> = {
    "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "./tsconfig.c1.json" }] }),
    "p64/index.ts": `import { v } from "#p64/v"; console.log(v);`,
    "p64/v.ts": `export const v = "64";`,
    "p65/index.ts": `import { v } from "#p65/v"; console.log(v);`,
    "p65/v.ts": `export const v = "65";`,
  };
  for (let i = 1; i <= 65; i++) {
    files[`tsconfig.c${i}.json`] = JSON.stringify({
      ...(i < 65 ? { references: [{ path: `./tsconfig.c${i + 1}.json` }] } : {}),
      include: [`p${i}`],
      compilerOptions: { paths: { [`#p${i}/*`]: [`./p${i}/*`] } },
    });
  }
  using dir = tempDir("tsconfig-refs-cap", files);

  // The 64th config is the last one within the load budget.
  expectRan(await run(String(dir), "p64/index.ts"), "64\n");

  // The 65th is past the cap, so its paths never apply.
  const past = await run(String(dir), "p65/index.ts");
  expect(past.stderr).toContain("Cannot find module '#p65/v'");
  expect(past.exitCode).not.toBe(0);
});

test.concurrent("referenced project using 'files' instead of 'include'", async () => {
  using dir = tempDir("tsconfig-refs-files", {
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [{ path: "./tsconfig.app.json" }],
    }),
    "tsconfig.app.json": JSON.stringify({
      files: ["src/main.ts"],
      compilerOptions: { paths: { "~/*": ["./src/*"] } },
    }),
    "src/main.ts": `import { greet } from "~/greet"; console.log(greet());`,
    "src/greet.ts": `export function greet() { return "hi"; }`,
  });

  expectRan(await run(String(dir), "src/main.ts"), "hi\n");
});

test.concurrent("an include entry naming a non-TypeScript file covers only its directory", async () => {
  using dir = tempDir("tsconfig-refs-include-file", {
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [{ path: "./tsconfig.app.json" }],
    }),
    "tsconfig.app.json": JSON.stringify({
      include: ["src/App.vue"],
      compilerOptions: { paths: { "~/*": ["./src/*"] } },
    }),
    "src/App.vue": "<template />",
    "src/main.ts": `import { greet } from "~/greet"; console.log(greet());`,
    "src/greet.ts": `export function greet() { return "vue"; }`,
    "src/nested/main.ts": `import { greet } from "~/greet"; console.log(greet());`,
  });

  // Any extension makes the entry a file entry (tsc's rule), so it claims src/
  // like a "files" entry would, and like one it does not claim subdirectories.
  expectRan(await run(String(dir), "src/main.ts"), "vue\n");
  const nested = await run(String(dir), "src/nested/main.ts");
  expect(nested.stderr).toContain("Cannot find module '~/greet'");
  expect(nested.exitCode).not.toBe(0);
});

test.concurrent("referenced project combined with extends", async () => {
  using dir = tempDir("tsconfig-refs-extends", {
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [{ path: "./tsconfig.app.json" }],
    }),
    "tsconfig.base.json": JSON.stringify({
      compilerOptions: { paths: { "@app/*": ["./src/*"] } },
    }),
    "tsconfig.app.json": JSON.stringify({
      extends: "./tsconfig.base.json",
      include: ["src"],
    }),
    "src/index.ts": `import { n } from "@app/n"; console.log(n);`,
    "src/n.ts": `export const n = 7;`,
  });

  expectRan(await run(String(dir), "src/index.ts"), "7\n");
});

test.concurrent("root config covering the file wins over references", async () => {
  using dir = tempDir("tsconfig-refs-root-wins", {
    "tsconfig.json": JSON.stringify({
      include: ["src"],
      references: [{ path: "./tsconfig.other.json" }],
      compilerOptions: { paths: { "@/*": ["./src/root/*"] } },
    }),
    "tsconfig.other.json": JSON.stringify({
      include: ["src"],
      compilerOptions: { paths: { "@/*": ["./src/other/*"] } },
    }),
    "src/index.ts": `import { who } from "@/who"; console.log(who);`,
    "src/root/who.ts": `export const who = "root";`,
    "src/other/who.ts": `export const who = "other";`,
  });

  expectRan(await run(String(dir), "src/index.ts"), "root\n");
});

test.concurrent("transitive references are followed", async () => {
  using dir = tempDir("tsconfig-refs-transitive", {
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [{ path: "./tsconfig.mid.json" }],
    }),
    "tsconfig.mid.json": JSON.stringify({
      files: [],
      references: [{ path: "./tsconfig.leaf.json" }],
    }),
    "tsconfig.leaf.json": JSON.stringify({
      include: ["src"],
      compilerOptions: { paths: { "@leaf/*": ["./src/*"] } },
    }),
    "src/index.ts": `import { n } from "@leaf/n"; console.log(n);`,
    "src/n.ts": `export const n = 3;`,
  });

  expectRan(await run(String(dir), "src/index.ts"), "3\n");
});

test.concurrent("reference cycles do not hang", async () => {
  using dir = tempDir("tsconfig-refs-cycle", {
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [{ path: "./tsconfig.a.json" }],
    }),
    "tsconfig.a.json": JSON.stringify({
      include: ["a"],
      references: [{ path: "./tsconfig.b.json" }],
      compilerOptions: { paths: { "@/*": ["./a/*"] } },
    }),
    "tsconfig.b.json": JSON.stringify({
      include: ["b"],
      references: [{ path: "./tsconfig.a.json" }, { path: "./tsconfig.json" }],
      compilerOptions: { paths: { "@/*": ["./b/*"] } },
    }),
    "a/index.ts": `import { who } from "@/who"; console.log(who);`,
    "a/who.ts": `export const who = "a";`,
    "b/index.ts": `import { who } from "@/who"; console.log(who);`,
    "b/who.ts": `export const who = "b";`,
  });

  expectRan(await run(String(dir), "a/index.ts"), "a\n");

  expectRan(await run(String(dir), "b/index.ts"), "b\n");
});

test.concurrent("a missing referenced config is skipped and stays out of error logs", async () => {
  using dir = tempDir("tsconfig-refs-missing", {
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [
        { path: "./tsconfig.missing.json" },
        { path: "./tsconfig.broken.json" },
        { path: "./tsconfig.app.json" },
      ],
    }),
    // Syntax errors in a referenced config are skipped without polluting the
    // resolver log either.
    "tsconfig.broken.json": `{ "include": [invalid`,
    // The broken "extends" exercises the quiet chain walk for referenced
    // projects; the config still contributes its own paths.
    "tsconfig.app.json": JSON.stringify({
      extends: "./tsconfig.missing-base.json",
      include: ["src"],
      compilerOptions: { paths: { "@/*": ["./src/*"] } },
    }),
    "src/index.ts": `import { n } from "@/n"; console.log(n);`,
    "src/n.ts": `export const n = 5;`,
    // A failed reference load must not add log messages: a worker startup
    // failure would surface as AggregateError instead of the single
    // BuildMessage (seen with bun's own repo tsconfig, which references a
    // directory without a tsconfig.json).
    "worker.ts": `
      const worker = new Worker("blob:i dont exist!");
      worker.addEventListener("error", e => {
        console.log(e.message);
        process.exit(0);
      });
    `,
  });

  expectRan(await run(String(dir), "src/index.ts"), "5\n");
  expectRan(
    await run(String(dir), "worker.ts"),
    'BuildMessage: ModuleNotFound resolving "blob:i dont exist!" (entry point)\n',
  );
});

test.concurrent("baseUrl from the referenced project is used", async () => {
  using dir = tempDir("tsconfig-refs-baseurl", {
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [{ path: "./tsconfig.app.json" }],
    }),
    "tsconfig.app.json": JSON.stringify({
      include: ["src"],
      compilerOptions: { baseUrl: "./src" },
    }),
    "src/index.ts": `import { n } from "util/n"; console.log(n);`,
    "src/util/n.ts": `export const n = 9;`,
  });

  expectRan(await run(String(dir), "src/index.ts"), "9\n");
});

test.concurrent("bun build resolves through solution-style references", async () => {
  using dir = tempDir("tsconfig-refs-build", {
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [{ path: "./tsconfig.server.json" }],
    }),
    "tsconfig.server.json": JSON.stringify({
      include: ["src/server"],
      compilerOptions: { paths: { "@/*": ["./src/server/*"] } },
    }),
    "src/server/index.ts": `import { log } from "@/log"; log();`,
    "src/server/log.ts": `export function log() { console.log("built"); }`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "src/server/index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("Could not resolve");
  expect(stdout).toContain("built");
  expect(exitCode).toBe(0);
});
