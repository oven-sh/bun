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

test.concurrent("process.stdin.resume() works after Bun.spawn took Bun.stdin.stream()", async () => {
  const [stdout, stderr, exitCode] = await runWithStdin(`
    const child = Bun.spawn(["cat"], { stdout: "inherit", stdin: Bun.stdin.stream() });
    await child.exited;
    process.stdin.resume();
    console.log("resume ok");
    process.stdin.on("close", () => console.log("stdin closed"));
  `);
  expect(stderr).toBe("");
  expect(stdout).toBe("from parent\nresume ok\nstdin closed\n");
  expect(exitCode).toBe(0);
});

test.concurrent("Bun.stdin.stream() stays readable after spawnSync, spawn, and the stdio array form", async () => {
  const [stdout, stderr, exitCode] = await runWithStdin(`
    Bun.spawnSync(["true"], { stdin: Bun.stdin.stream() });
    await Bun.spawn(["true"], { stdin: Bun.stdin.stream() }).exited;
    await Bun.spawn(["true"], { stdio: [Bun.stdin.stream(), "inherit", "inherit"] }).exited;
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

test.concurrent("process.stdin works after Bun.spawn took a Response over Bun.stdin.stream()", async () => {
  const [stdout, stderr, exitCode] = await runWithStdin(`
    const child = Bun.spawn(["cat"], { stdout: "inherit", stdin: new Response(Bun.stdin.stream()) });
    await child.exited;
    process.stdin.resume();
    console.log("resume ok");
  `);
  expect(stderr).toBe("");
  expect(stdout).toBe("from parent\nresume ok\n");
  expect(exitCode).toBe(0);
});

// bytes() lifts the fd out as a Blob. text() reads through the stream itself.
for (const method of ["bytes", "text"]) {
  test.concurrent(`process.stdin works after Response.${method}() over Bun.stdin.stream()`, async () => {
    const [stdout, stderr, exitCode] = await runWithStdin(`
      const response = new Response(Bun.stdin.stream());
      console.log(JSON.stringify(Buffer.from(await response.${method}()).toString()), response.bodyUsed);
      process.stdin.resume();
      process.stdin.on("end", () => console.log("stdin end"));
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe('"from parent\\n" true\nstdin end\n');
    expect(exitCode).toBe(0);
  });
}
