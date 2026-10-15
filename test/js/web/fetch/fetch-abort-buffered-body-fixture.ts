// Aborting a fetch whose request body stream is still uploading must also
// settle the response side. The failure callback used to return right after
// cancelling the request-body sink, so a buffered body promise
// (arrayBuffer/text/json) never rejected and awaiting it hung forever.
// Prints one line per consumer; a "timed out" line means the promise zombied.

using server = Bun.serve({
  port: 0,
  fetch() {
    return new Response(
      new ReadableStream({
        pull(c) {
          c.enqueue(new Uint8Array(1024));
          // keep the response body open until the client aborts
          return new Promise(() => {});
        },
      }),
    );
  },
});

async function run(method: "arrayBuffer" | "text"): Promise<string> {
  const controller = new AbortController();
  const res = await fetch(server.url, {
    method: "POST",
    signal: controller.signal,
    body: new ReadableStream({
      pull(c) {
        c.enqueue(new Uint8Array(64));
        // keep the upload stream open so the sink is active at abort time
        return new Promise(() => {});
      },
    }),
  });
  if (res.status !== 200) return method + " bad status " + res.status;

  const pendingBody = res[method]();
  controller.abort();
  // Bounded sentinel only to convert the buggy "pending forever" state into a
  // clean failure; the fixed path rejects immediately.
  return Promise.race([
    pendingBody.then(
      () => method + " resolved",
      (err: any) => method + " rejected " + err?.name,
    ),
    Bun.sleep(2500).then(() => method + " timed out"),
  ]);
}

const results = await Promise.all([run("arrayBuffer"), run("text")]);
for (const line of results.sort()) console.log(line);
process.exit(results.every(r => r.includes("rejected AbortError")) ? 0 : 1);
