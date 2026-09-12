import { expect, test } from "bun:test";
import { bunEnv, bunExe, nodeExe } from "harness";
import path from "path";

test("ipc with json serialization still works when bun is not the parent and the child", async () => {
  // prettier-ignore
  const child = Bun.spawn(["node", "--no-warnings", path.resolve(import.meta.dir, "fixtures", "ipc-parent-node.js"), bunExe()], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  await child.exited;
  expect(await new Response(child.stderr).text()).toEqual("");
  expect(await new Response(child.stdout).text()).toEqual(
    `p start
p end
c start
c end
c I am your father
p I am your father
`,
  );
});

test.skipIf(!nodeExe())(
  'a bun child of a node parent using serialization: "advanced" reports the mismatch',
  async () => {
    // Node's "advanced" serialization is v8's wire format, which Bun cannot decode.
    // The child must report the first such message instead of dropping the channel
    // silently.
    const parentSource = `
    const { spawn } = require("node:child_process");
    const child = spawn(process.argv[1], ["-e", 'process.on("message", msg => console.log("UNEXPECTED_IPC_MESSAGE", msg));'], {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      serialization: "advanced",
    });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8").on("data", chunk => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", chunk => (stderr += chunk));
    child.on("close", (exitCode, signalCode) => {
      console.log(JSON.stringify({ stdout, stderr, exitCode, signalCode }));
    });
    child.send({ hello: "from node" });
  `;

    await using proc = Bun.spawn({
      cmd: [nodeExe()!, "-e", parentSource, bunExe()],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    const child = JSON.parse(stdout);
    // No uncaughtException handler in the child: it exits 1 at the report.
    expect(child.stdout).toBe("");
    expect(child.stderr).toContain(
      `The parent process sent an IPC message that is not in Bun's "advanced" serialization format, so Bun closed the IPC channel. "advanced" serialization only works between two Bun processes. For IPC between Bun and Node.js, use serialization: "json".`,
    );
    expect({ exitCode: child.exitCode, signalCode: child.signalCode }).toEqual({ exitCode: 1, signalCode: null });
    expect(exitCode).toBe(0);
  },
);
