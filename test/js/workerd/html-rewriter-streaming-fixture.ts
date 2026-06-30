// Fixture for html-rewriter.test.js. Exercises one consumer of the Response
// returned by `HTMLRewriter.transform(<streaming body>)` and prints a single
// JSON line describing what that consumer observed. On a runtime with the
// output-streaming bug the consumer never completes, so this process never
// prints and/or never exits, which the parent test observes as a failure (the
// spawned child is killed when the test ends).
//
// argv[2] = "serve"          Bun.serve returning transform(Bun.file(argv[3]))
//         | "serve-throw"    same, but the element handler throws
//         | "serve-upstream" Bun.serve returning transform(fetch(<streaming server>))
//         | "body"           transform(Bun.file(argv[3])).body.text()
// argv[3] = path to the HTML file ("serve" also uses it for a missing path)
const mode = process.argv[2];
const htmlFile = process.argv[3];

const rewrite = () =>
  new HTMLRewriter().on("title", {
    element(element) {
      if (mode === "serve-throw") {
        throw new Error("handler boom");
      }
      element.setInnerContent("rewritten");
    },
  });

if (mode === "body") {
  const transformed = rewrite().transform(new Response(Bun.file(htmlFile)));
  const result = await transformed.body!.text().then(
    text => ({ text }),
    (error: any) => ({ error: error?.code }),
  );
  console.log(JSON.stringify(result));
} else {
  let upstream: Bun.Server | undefined;
  if (mode === "serve-upstream") {
    const inputHTML = await Bun.file(htmlFile).text();
    // A ReadableStream body that yields between chunks guarantees the proxied
    // Response is still streaming when transform() runs on it.
    upstream = Bun.serve({
      port: 0,
      fetch() {
        const encoder = new TextEncoder();
        return new Response(
          new ReadableStream({
            async pull(controller) {
              controller.enqueue(encoder.encode(inputHTML.slice(0, 24)));
              await Bun.sleep(10);
              controller.enqueue(encoder.encode(inputHTML.slice(24)));
              controller.close();
            },
          }),
          { headers: { "content-type": "text/html" } },
        );
      },
    });
  }

  const server = Bun.serve({
    port: 0,
    fetch:
      mode === "serve-upstream"
        ? async () => rewrite().transform(await fetch(upstream!.url))
        : () => rewrite().transform(new Response(Bun.file(htmlFile))),
  });

  const res = await fetch(server.url);
  console.log(JSON.stringify({ status: res.status, text: await res.text() }));
  server.stop(true);
  upstream?.stop(true);
}
// No process.exit(): a clean natural exit is part of what the parent asserts.
