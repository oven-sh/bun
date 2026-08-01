import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/12372
// Dynamic import() through a tsconfig `paths` alias must find files that were
// created after the process started. The resolver caches directory listings;
// the retry-on-miss path has to bust the cache for the *remapped* directory,
// not the literal `<source_dir>/@/files` join.
test("tsconfig paths alias resolves files created at runtime", async () => {
  using dir = tempDir("issue-12372", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } },
    }),
    "app.ts": `
      import { mkdir, rm } from "node:fs/promises";
      await rm("files/", { recursive: true, force: true });
      await mkdir("files/", { recursive: true });
      for (let i = 1; i <= 3; i++) {
        const file = \`file-\${i}.ts\`;
        await Bun.write("files/" + file, \`console.log("calling from \${file}")\`);
        await import(\`@/files/\${file}\`);
      }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "app.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stderr).not.toContain("Cannot find module");
  expect(stdout.replaceAll("\r\n", "\n")).toBe(
    "calling from file-1.ts\ncalling from file-2.ts\ncalling from file-3.ts\n",
  );
  expect(exitCode).toBe(0);
});

test("tsconfig paths alias resolves files created at runtime (require)", async () => {
  using dir = tempDir("issue-12372-cjs", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "~/*": ["./gen/*"] } },
    }),
    "app.ts": `
      import { mkdirSync, rmSync, writeFileSync } from "node:fs";
      rmSync("gen/", { recursive: true, force: true });
      mkdirSync("gen/", { recursive: true });
      for (let i = 1; i <= 3; i++) {
        const file = \`mod-\${i}.ts\`;
        writeFileSync("gen/" + file, \`module.exports = "from \${file}"\`);
        console.log(require(\`~/\${file}\`));
      }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "app.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stderr).not.toContain("Cannot find module");
  expect(stdout.replaceAll("\r\n", "\n")).toBe(
    "from mod-1.ts\nfrom mod-2.ts\nfrom mod-3.ts\n",
  );
  expect(exitCode).toBe(0);
});
