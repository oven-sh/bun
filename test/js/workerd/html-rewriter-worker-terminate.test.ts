import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Terminating a worker whose `transform()` is parked inside an awaited async
// content handler used to let lol-html dispatch the next matching token's
// handler while the VM's TerminationException was still pending. Assert-enabled
// builds aborted the whole process at `Interpreter::executeCallImpl`'s
// `ASSERTION FAILED: !exception()`.
//
// On release builds (no JSC asserts) the worker simply exits; this test checks
// the parent process survives and the worker closes on every build flavor.
//
// All lol-html handler bridges funnel into the same `handler_callback`; cover
// the ones that fire more than once per document (element / comment / text on
// `.on(...)` and comment / text on `.onDocument(...)`). `doctype` and `end`
// fire once, so there is no "next" dispatch for the bug to reach.

type Cell = [name: string, doc: string, register: string];

const neverSettling = `await new Promise(() => {});`;
const timerAwait = `await new Promise(r => setTimeout(r, 1e6));`;

const cells: Cell[] = [
  [
    "element (never-settling)",
    `"<p>a</p>".repeat(100)`,
    `.on("p", { async element(el) { el.setAttribute("x", "1"); postMessage("in-handler"); ${neverSettling} } })`,
  ],
  [
    "element (timer await)",
    `"<p>a</p>".repeat(100)`,
    `.on("p", { async element(el) { el.setAttribute("x", "1"); postMessage("in-handler"); ${timerAwait} } })`,
  ],
  [
    "text",
    `"<p>a</p>".repeat(100)`,
    `.on("p", { async text(t) { if (t.text) { postMessage("in-handler"); ${neverSettling} } } })`,
  ],
  [
    "comments",
    `"<p><!--c-->a</p>".repeat(100)`,
    `.on("p", { async comments(c) { postMessage("in-handler"); ${neverSettling} } })`,
  ],
  [
    "onDocument comments",
    `"<!--c-->".repeat(100)`,
    `.onDocument({ async comments(c) { postMessage("in-handler"); ${neverSettling} } })`,
  ],
  [
    "onDocument text",
    `"<p>a</p>".repeat(100)`,
    `.onDocument({ async text(t) { if (t.text) { postMessage("in-handler"); ${neverSettling} } } })`,
  ],
];

describe.concurrent("terminate() while HTMLRewriter is parked in an async handler", () => {
  test.each(cells)("%s", async (_name, doc, register) => {
    using dir = tempDir("html-rewriter-worker-terminate", {
      "worker.mjs": `
        postMessage("start");
        const doc = ${doc};
        await new HTMLRewriter()
          ${register}
          .transform(new Response(doc))
          .text();
        postMessage("done");
      `,
      "main.mjs": `
        const w = new Worker(new URL("./worker.mjs", import.meta.url).href);
        const { promise: inHandler, resolve: gotHandler, reject: rejectHandler } = Promise.withResolvers();
        const { promise: closed, resolve: gotClose } = Promise.withResolvers();
        w.addEventListener("error", e => rejectHandler(e.message ?? e), { once: true });
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

    expect(stdout).toBe("survived\n");
    if (exitCode !== 0) {
      expect(stderr).toBe("");
    }
    expect(exitCode).toBe(0);
  });
});
