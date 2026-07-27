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
// `.on(...)`, `el.onEndTag(...)`, and comment / text on `.onDocument(...)`).
// `doctype` and `end` fire once, so there is no "next" dispatch for the bug to
// reach.

type Cell = { name: string; body: string; register: string; extraFiles?: Record<string, string> };

const neverSettling = `await new Promise(() => {});`;
const timerAwait = `await new Promise(r => setTimeout(r, 1e6));`;
const stringBody = `"<p>a</p>".repeat(100)`;

const cells: Cell[] = [
  {
    name: "element (never-settling)",
    body: stringBody,
    register: `.on("p", { async element(el) { el.setAttribute("x", "1"); postMessage("in-handler"); ${neverSettling} } })`,
  },
  {
    name: "element (timer await)",
    body: stringBody,
    register: `.on("p", { async element(el) { el.setAttribute("x", "1"); postMessage("in-handler"); ${timerAwait} } })`,
  },
  {
    name: "text",
    body: stringBody,
    register: `.on("p", { async text(t) { if (t.text) { postMessage("in-handler"); ${neverSettling} } } })`,
  },
  {
    name: "comments",
    body: `"<p><!--c-->a</p>".repeat(100)`,
    register: `.on("p", { async comments(c) { postMessage("in-handler"); ${neverSettling} } })`,
  },
  {
    name: "onDocument comments",
    body: `"<!--c-->".repeat(100)`,
    register: `.onDocument({ async comments(c) { postMessage("in-handler"); ${neverSettling} } })`,
  },
  {
    name: "onDocument text",
    body: stringBody,
    register: `.onDocument({ async text(t) { if (t.text) { postMessage("in-handler"); ${neverSettling} } } })`,
  },
  {
    name: "onEndTag",
    body: stringBody,
    register: `.on("p", { element(el) { el.onEndTag(async () => { postMessage("in-handler"); ${neverSettling} }); } })`,
  },
  // A file-backed body buffers asynchronously (`is_async == true` in
  // `run_output_sink`), covering the error-unwind arm that rejects the body
  // promise instead of going through `create_lolhtml_error`.
  {
    name: "element (Bun.file body)",
    body: `Bun.file(new URL("./doc.html", import.meta.url))`,
    register: `.on("p", { async element(el) { el.setAttribute("x", "1"); postMessage("in-handler"); ${neverSettling} } })`,
    extraFiles: { "doc.html": Buffer.alloc(800, "<p>a</p>").toString() },
  },
];

const mainMjs = `
  const w = new Worker(new URL("./worker.mjs", import.meta.url).href);
  const { promise: inHandler, resolve: gotHandler } = Promise.withResolvers();
  const { promise: closed, resolve: gotClose } = Promise.withResolvers();
  const { promise: workerError, reject: rejectWorkerError } = Promise.withResolvers();
  w.addEventListener("error", e => rejectWorkerError(e.message ?? e), { once: true });
  w.addEventListener("close", () => gotClose(), { once: true });
  w.onmessage = ev => {
    if (ev.data === "in-handler") gotHandler();
  };
  await Promise.race([inHandler, workerError]);
  w.terminate();
  await Promise.race([closed, workerError]);
  console.log("survived");
`;

describe.concurrent("terminate() while HTMLRewriter is parked in an async handler", () => {
  test.each(cells)("$name", async ({ body, register, extraFiles }) => {
    using dir = tempDir("html-rewriter-worker-terminate", {
      ...extraFiles,
      "worker.mjs": `
        postMessage("start");
        await new HTMLRewriter()
          ${register}
          .transform(new Response(${body}))
          .text();
        postMessage("done");
      `,
      "main.mjs": mainMjs,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "survived\n", stderr: "", exitCode: 0 });
  });
});
