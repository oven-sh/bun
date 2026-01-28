import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

test("#12042 curl verbose fetch logs form-urlencoded body", async () => {
  using dir = tempDir("issue-12042", {
    "form.ts": `
const server = Bun.serve({
  port: 0,
  fetch() {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  },
});

const params = new URLSearchParams();
params.set("grant_type", "client_credentials");
params.set("client_id", "abc");
params.set("client_secret", "xyz");

await fetch(String(server.url), {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: params,
});

await server.stop();
    `,
  });

  const dirPath = String(dir);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "form.ts"],
    env: { ...bunEnv, BUN_CONFIG_VERBOSE_FETCH: "curl" },
    cwd: dirPath,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);

  const output = stdout + stderr;
  const normalized = normalizeBunSnapshot(output, dirPath);

  expect(normalized).toContain('--data-raw "grant_type=client_credentials&client_id=abc&client_secret=xyz');
});
