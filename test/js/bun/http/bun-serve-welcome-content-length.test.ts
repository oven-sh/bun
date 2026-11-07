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

test("the development welcome page and text send content-length once", async () => {
  const { result } = await run(/* js */ `
    const server = Bun.serve({ port: 0, development: true, fetch() { return undefined; } });
    const out = [];
    for (const init of [{ headers: { "sec-fetch-dest": "document" } }, {}]) {
      const res = await fetch("http://localhost:" + server.port + "/", init);
      const body = await res.arrayBuffer();
      // fetch() joins a repeated header with ", ", so a duplicate reads "57, 57"
      out.push({ status: res.status, length: res.headers.get("content-length"), bytes: body.byteLength });
    }
    server.stop(true);
    console.log(JSON.stringify(out));
  `);
  for (const { status, length, bytes } of result) {
    expect(status).toBe(200);
    expect(length).toBe(String(bytes));
  }
});

