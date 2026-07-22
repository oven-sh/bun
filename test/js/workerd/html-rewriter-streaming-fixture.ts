// Runs one consumer of `HTMLRewriter.transform(<streaming body>)` and prints
// what it observed as one JSON line; on a buggy runtime it never completes.
// argv[2]: "serve" | "serve-throw" | "serve-upstream" | "body". argv[3]: HTML path.
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
  // Holds the upstream's second chunk until transform() has run, so the
  // proxied Response is provably still streaming at that point.
  const releaseRest = Promise.withResolvers<void>();
  if (mode === "serve-upstream") {
    const inputHTML = await Bun.file(htmlFile).text();
    upstream = Bun.serve({
      port: 0,
      fetch() {
        const encoder = new TextEncoder();
        return new Response(
          new ReadableStream({
            async pull(controller) {
              controller.enqueue(encoder.encode(inputHTML.slice(0, 24)));
              await releaseRest.promise;
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
        ? async () => {
            const transformed = rewrite().transform(await fetch(upstream!.url));
            releaseRest.resolve();
            return transformed;
          }
        : () => rewrite().transform(new Response(Bun.file(htmlFile))),
  });

  const res = await fetch(server.url);
  console.log(JSON.stringify({ status: res.status, text: await res.text() }));
  server.stop(true);
  upstream?.stop(true);
}
// No process.exit(): a clean natural exit is part of what the parent asserts.
