import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";

async function runFeedback(args: string[], cwd: string) {
  const { promise: received, resolve } = Promise.withResolvers<FormData>();

  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      resolve(await req.formData());
      return new Response("ok");
    },
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "feedback", "--email", "test@example.com", ...args],
    cwd,
    env: {
      ...bunEnv,
      BUN_FEEDBACK_URL: server.url.href,
      BUN_INSTALL: path.join(cwd, ".bun-install"),
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // The mock server resolves `received` before it responds and the CLI waits for
  // that response, so by the time the process has exited the POST has either
  // arrived or never will — race a settled sentinel instead of hanging.
  const form = await Promise.race([received, Promise.resolve(null)]);
  if (!form) {
    throw new Error(`bun feedback exited with ${exitCode} without posting.
stdout: ${stdout}
stderr: ${stderr}`);
  }
  return { stdout, stderr, exitCode, form };
}

test("bun feedback keeps a bare word that matches a file in the cwd as message text", async () => {
  using dir = tempDir("feedback-bare-word", {
    "crash": "this file must not be attached",
  });

  const { stdout, stderr, exitCode, form } = await runFeedback(["crash", "happened", "again"], String(dir));

  expect(form.get("email")).toBe("test@example.com");
  expect(form.get("message")).toBe("crash happened again");
  expect(form.getAll("files[]")).toEqual([]);
  expect(stderr.split("\n")).not.toContain("+ crash");
  expect(stdout).toContain("Feedback sent.");
  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: expect.any(String) });
});

test("bun feedback attaches an explicit path positional and lists it on stderr", async () => {
  using dir = tempDir("feedback-path-like", {
    "details.log": "log contents",
  });

  const { stdout, stderr, exitCode, form } = await runFeedback(["./details.log", "see", "attached"], String(dir));

  expect(form.get("email")).toBe("test@example.com");
  expect(form.get("message")).toBe("see attached");
  const files = form.getAll("files[]") as File[];
  expect(files.map(file => file.name)).toEqual(["details.log"]);
  expect(await files[0].text()).toBe("log contents");
  expect(stderr.split("\n")).toContain("+ details.log");
  expect(stdout).toContain("Feedback sent.");
  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: expect.any(String) });
});
