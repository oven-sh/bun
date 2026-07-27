import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Terminating a worker whose `transform()` is parked inside an awaited async
// element handler used to let lol-html dispatch the next matching element's
// handler while the VM's TerminationException was still pending. Assert-enabled
// builds aborted the whole process at `Interpreter::executeCallImpl`'s
// `ASSERTION FAILED: !exception()`.
//
// On release builds (no JSC asserts) the worker simply exits; this test checks
// the parent process survives and the worker closes on every build flavor.
test("terminating a worker parked in an async HTMLRewriter element handler does not abort the process", async () => {
  using dir = tempDir("html-rewriter-worker-terminate", {
    "worker.mjs": `
      postMessage("start");
      const doc = "<p>a</p>".repeat(100);
      await new HTMLRewriter()
        .on("p", {
          async element(el) {
            el.setAttribute("x", "1");
            postMessage("in-handler");
            await new Promise(() => {});
          },
        })
        .transform(new Response(doc))
        .text();
      postMessage("done");
    `,
    "main.mjs": `
      const w = new Worker(new URL("./worker.mjs", import.meta.url).href);
      const { promise: inHandler, resolve: gotHandler } = Promise.withResolvers();
      const { promise: closed, resolve: gotClose } = Promise.withResolvers();
      w.addEventListener("close", () => gotClose(), { once: true });
      w.onmessage = ev => {
        if (ev.data === "in-handler") gotHandler();
      };
      await inHandler;
      w.terminate();
      await closed;
      console.log("survived");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (exitCode !== 0) console.error(stderr);
  expect(stdout).toBe("survived\n");
  expect(exitCode).toBe(0);
});
