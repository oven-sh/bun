import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// The servers here fail on purpose and Bun reports each failure on stderr, so each case runs in a
// subprocess that prints what the client saw as JSON.
async function run(script: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, NODE_ENV: undefined },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout, stderr).not.toBe("");
  return { result: JSON.parse(stdout), stderr };
}

for (const development of [true, false]) {
  test(`a pending error() promise that resolves to a non-Response renders the error, as a settled one does (development: ${development})`, async () => {
    const { result } = await run(/* js */ `
      const serve = error => Bun.serve({ port: 0, development: ${development}, fetch() { throw new Error("boom"); }, error });
      const pending = serve(() => new Promise(resolve => setTimeout(() => resolve(undefined), 5)));
      const settled = serve(async () => undefined);
      const out = {};
      for (const [name, server] of Object.entries({ pending, settled })) {
        const res = await fetch("http://localhost:" + server.port + "/p");
        out[name] = { status: res.status, welcome: (await res.text()).includes("Welcome to Bun!") };
        server.stop(true);
      }
      console.log(JSON.stringify(out));
    `);
    expect(result.settled).toEqual({ status: 500, welcome: false });
    expect(result.pending).toEqual(result.settled);
  });
}

