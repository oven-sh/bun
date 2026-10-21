import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Bun.stdin.stream() is one cached object per process. Handing it to a child
// (Bun.spawn takes fd 0, it never reads the stream) must leave that object
// readable, so process.stdin and the next Bun.stdin.stream() user still work.
async function runWithStdin(source: string): Promise<[string, string, number]> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", source],
    env: bunEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write("from parent\n");
  await proc.stdin.end();
  return await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
}

// Child commands run through bun itself so the tests do not need `cat` or `true`.
const cat = `[process.execPath, "-e", "process.stdin.pipe(process.stdout)"]`;
const noop = `[process.execPath, "-e", "0"]`;

test.concurrent("process.stdin.resume() works after Bun.spawn took Bun.stdin.stream()", async () => {
  const [stdout, stderr, exitCode] = await runWithStdin(`
    const child = Bun.spawn(${cat}, { stdout: "inherit", stdin: Bun.stdin.stream() });
    await child.exited;
    process.stdin.resume();
    console.log("resume ok");
    process.stdin.on("close", () => console.log("stdin closed"));
  `);
  expect(stderr).toBe("");
  expect(stdout).toBe("from parent\nresume ok\nstdin closed\n");
  expect(exitCode).toBe(0);
});

test.concurrent("process.stdin closes when resumed right after Bun.spawn took Bun.stdin.stream()", async () => {
  const [stdout, stderr, exitCode] = await runWithStdin(`
    import { once } from "node:events";
    const child = Bun.spawn([process.execPath, "-e", "process.stdin.resume()"], { stdin: Bun.stdin.stream() });
    process.stdin.resume();
    await once(process.stdin, "close");
    console.log("stdin closed");
    await child.exited;
    console.log("child exited");
  `);
  expect(stderr).toBe("");
  expect(stdout).toBe("stdin closed\nchild exited\n");
  expect(exitCode).toBe(0);
});

test.concurrent("Bun.stdin.stream() stays readable after spawnSync, spawn, and the stdio array form", async () => {
  const [stdout, stderr, exitCode] = await runWithStdin(`
    Bun.spawnSync(${noop}, { stdin: Bun.stdin.stream() });
    await Bun.spawn(${noop}, { stdin: Bun.stdin.stream() }).exited;
    await Bun.spawn(${noop}, { stdio: [Bun.stdin.stream(), "inherit", "inherit"] }).exited;
    const stream = Bun.stdin.stream();
    console.log(stream.locked);
    const reader = stream.getReader();
    const { value } = await reader.read();
    console.log(new TextDecoder().decode(value));
  `);
  expect(stderr).toBe("");
  expect(stdout).toBe("false\nfrom parent\n\n");
  expect(exitCode).toBe(0);
});

// A Response over the stdin Blob makes its own stream for `.body`. That one
// is not shared, so spawn spends it like any other stream.
test.concurrent("spawn spends a Response body stream over Bun.stdin, not the cached stream", async () => {
  const [stdout, stderr, exitCode] = await runWithStdin(`
    const response = new Response(Bun.stdin);
    const body = response.body;
    console.log(body === Bun.stdin.stream());
    await Bun.spawn(${noop}, { stdin: body }).exited;
    console.log(body.locked, response.bodyUsed, Bun.stdin.stream().locked);
  `);
  expect(stderr).toBe("");
  expect(stdout).toBe("false\ntrue true false\n");
  expect(exitCode).toBe(0);
});

test.concurrent("Bun.spawn still refuses a Bun.stdin.stream() that was already used", async () => {
  const [stdout, stderr, exitCode] = await runWithStdin(`
    await Bun.stdin.stream().cancel();
    try {
      Bun.spawn(${noop}, { stdin: Bun.stdin.stream() });
    } catch (e) {
      console.log(e.code, e.message);
    }
  `);
  expect(stderr).toBe("");
  expect(stdout).toBe("ERR_INVALID_STATE 'stdin' ReadableStream has already been used\n");
  expect(exitCode).toBe(0);
});
