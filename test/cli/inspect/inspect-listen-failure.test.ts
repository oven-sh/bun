import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/5639
// When the inspector cannot bind its address (EADDRINUSE / EACCES), Bun used to
// print the internal debugger.ts source + stack trace twice and process.exit(1).
describe.each(["--inspect", "--inspect-wait", "--inspect-brk"])("%s", flag => {
  test("inspector listen failure warns but does not kill the app", async () => {
    using holder = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: { data() {} },
    });
    const port = holder.port;

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        `${flag}=127.0.0.1:${port}`,
        "-e",
        `console.log("user code ran"); process.stdin.resume(); process.stdin.on("end", () => console.log("user code done"));`,
      ],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // The inspector thread starts concurrently with user code; wait for either
    // the warning or process exit (the old behavior: process.exit(1)).
    let stderr = "";
    const decoder = new TextDecoder();
    const reader = (proc.stderr as ReadableStream<Uint8Array>).getReader();
    while (!stderr.includes("Failed to start inspector") && proc.exitCode === null) {
      const { done, value } = await reader.read();
      if (done) break;
      stderr += decoder.decode(value);
    }

    // Close stdin so the child can exit cleanly, then drain the rest of stderr.
    proc.stdin.end();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      stderr += decoder.decode(value);
    }
    reader.releaseLock();
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout).toContain("user code ran");
    expect(stdout).toContain("user code done");

    expect(stderr).toContain("Failed to start inspector");
    // Exactly one warning line, no internal source dump or stack trace
    expect(stderr.match(/Failed to start inspector/g)?.length).toBe(1);
    expect(stderr).not.toContain("internal:debugger");
    expect(stderr).not.toContain("Bun.serve(");

    expect(exitCode).toBe(0);
  });
});
