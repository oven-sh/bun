import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

async function runFixture(extraArgs: string[]) {
  using dir = tempDir("bun-serve-no-bundle-page-log", {
    "index.html": "<!doctype html><html><body><h1>Hello</h1></body></html>",
    "server.ts": `
      import page from "./index.html";

      using server = Bun.serve({
        port: 0,
        development: true,
        static: {
          "/": page,
        },
        fetch() {
          return new Response("Not found", { status: 404 });
        },
      });

      const response = await fetch(server.url);
      console.log("status", response.status);
      await response.text();
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), ...extraArgs, "run", join(String(dir), "server.ts")],
    cwd: String(dir),
    env: bunEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("status 200");
  expect(exitCode).toBe(0);

  return stderr;
}

test("--no-bundle-page-log suppresses only the bundled page log line", async () => {
  const withDefaultLogging = await runFixture([]);
  expect(withDefaultLogging).toContain("Bundled page in");

  const withFlag = await runFixture(["--no-bundle-page-log"]);
  expect(withFlag).not.toContain("Bundled page in");
});
