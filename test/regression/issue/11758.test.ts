import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/11758
// HTMLRewriter should be able to transform Responses created from ReadableStreams

test("HTMLRewriter transforms Response from ReadableStream", async () => {
  const rewriter = new HTMLRewriter();
  rewriter.on("b", {
    element(element) {
      element.before("<h1>", { html: true });
      element.after("</h1>", { html: true });
      element.removeAndKeepContent();
    },
  });

  const response = rewriter.transform(
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("<b>hello world</b>"));
          controller.close();
        },
      }),
      { headers: { "content-type": "text/html" } },
    ),
  );

  const text = await response.text();
  expect(text).toBe("<h1>hello world</h1>");
});

test("HTMLRewriter transforms Response from ReadableStream with multiple chunks", async () => {
  const rewriter = new HTMLRewriter();
  rewriter.on("p", {
    element(element) {
      element.setAttribute("class", "modified");
    },
  });

  const response = rewriter.transform(
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("<p>chunk one</p>"));
          controller.enqueue(new TextEncoder().encode("<p>chunk two</p>"));
          controller.close();
        },
      }),
      { headers: { "content-type": "text/html" } },
    ),
  );

  const text = await response.text();
  expect(text).toBe('<p class="modified">chunk one</p><p class="modified">chunk two</p>');
});

test("HTMLRewriter transforms Response from async ReadableStream", async () => {
  const rewriter = new HTMLRewriter();
  rewriter.on("span", {
    element(element) {
      element.setInnerContent("replaced");
    },
  });

  const response = rewriter.transform(
    new Response(
      new ReadableStream({
        async start(controller) {
          controller.enqueue(new TextEncoder().encode("<div><span>original</span></div>"));
          controller.close();
        },
      }),
      { headers: { "content-type": "text/html" } },
    ),
  );

  const text = await response.text();
  expect(text).toBe("<div><span>replaced</span></div>");
});

test("HTMLRewriter transforms Response from ReadableStream with pull", async () => {
  const rewriter = new HTMLRewriter();
  rewriter.on("em", {
    element(element) {
      element.tagName = "strong";
    },
  });

  let pullCount = 0;
  const response = rewriter.transform(
    new Response(
      new ReadableStream({
        pull(controller) {
          if (pullCount === 0) {
            controller.enqueue(new TextEncoder().encode("<em>emphasis</em>"));
            pullCount++;
          } else {
            controller.close();
          }
        },
      }),
      { headers: { "content-type": "text/html" } },
    ),
  );

  const text = await response.text();
  expect(text).toBe("<strong>emphasis</strong>");
});

test("HTMLRewriter handles empty ReadableStream", async () => {
  const rewriter = new HTMLRewriter();
  rewriter.on("b", {
    element(element) {
      element.remove();
    },
  });

  const response = rewriter.transform(
    new Response(
      new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
      { headers: { "content-type": "text/html" } },
    ),
  );

  const text = await response.text();
  expect(text).toBe("");
});
