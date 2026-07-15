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

test.concurrent("a reference path may point at a project directory", async () => {
  using dir = tempDir("tsconfig-refs-dir", {
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [{ path: "./app" }],
    }),
    "app/tsconfig.json": JSON.stringify({
      include: ["."],
      compilerOptions: { paths: { "#lib/*": ["./lib/*"] } },
    }),
    "app/main.ts": `import { value } from "#lib/value"; console.log(value);`,
    "app/lib/value.ts": `export const value = 42;`,
  });

  expectRan(await run(String(dir), "app/main.ts"), "42\n");
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
      references: [{ path: "./tsconfig.missing.json" }, { path: "./tsconfig.app.json" }],
    }),
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
