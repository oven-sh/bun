import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/39900
// A macro that awaits crypto.subtle.digest() hung forever: the digest result
// is posted to the regular event loop, which does not tick while the macro's
// promise is being waited on. The process exiting afterwards also covers the
// keep-alive the WebCrypto work queue releases from the pool thread.

const expected = Buffer.from(await crypto.subtle.digest("SHA-256", new Uint8Array(4096))).toString("base64url");

const files = {
  "macro.ts": `export async function sha() {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(4096));
  return Buffer.from(digest).toString("base64url");
}
`,
  "index.ts": `import { sha } from "./macro.ts" with { type: "macro" };
console.log(sha());
`,
};

test.concurrent(
  "macro that awaits crypto.subtle.digest resolves under bun run",
  async () => {
    using dir = tempDir("39900-run", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    // A debug build also logs "[macro] call sha" to stdout.
    expect(stdout).toContain(`${expected}\n`);
    expect(exitCode).toBe(0);
  },
);

test.concurrent(
  "macro that awaits crypto.subtle.digest resolves under Bun.build",
  async () => {
    using dir = tempDir("39900-build", {
      ...files,
      "build.ts": `const result = await Bun.build({ entrypoints: ["./index.ts"] });
if (!result.success) throw new AggregateError(result.logs);
console.log(await result.outputs[0].text());
`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toContain(expected);
    expect(exitCode).toBe(0);
  },
);
