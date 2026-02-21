import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/14216
// HTMLRewriter should work with JavaScript-created ReadableStreams

test("HTMLRewriter.transform() works with a JS ReadableStream", async () => {
  const inputStream = new ReadableStream({
    start(controller) {
      controller.enqueue("<html><body>Hello world</body></html>");
      controller.close();
    },
  });

  const rw = new HTMLRewriter();
  rw.on("body", {
    element(element) {
      element.setAttribute("class", "modified");
    },
  });

  const response = rw.transform(new Response(inputStream));
  const text = await response.text();
  expect(text).toBe('<html><body class="modified">Hello world</body></html>');
});

test("HTMLRewriter.transform() works with a JS ReadableStream and onEndTag", async () => {
  const inputStream = new ReadableStream({
    start(controller) {
      controller.enqueue("<html><body>Hello world</body></html>");
      controller.close();
    },
  });

  const rw = new HTMLRewriter();
  rw.on("body", {
    element(element) {
      element.onEndTag(end => {
        end.before("<span>injected</span>", { html: true });
      });
    },
  });

  const response = rw.transform(new Response(inputStream));
  const text = await response.text();
  expect(text).toBe("<html><body>Hello world<span>injected</span></body></html>");
});

test("HTMLRewriter.transform() works with a multi-chunk JS ReadableStream", async () => {
  const inputStream = new ReadableStream({
    start(controller) {
      controller.enqueue("<html><body>");
      controller.enqueue("Hello ");
      controller.enqueue("world");
      controller.enqueue("</body></html>");
      controller.close();
    },
  });

  const rw = new HTMLRewriter();
  rw.on("body", {
    element(element) {
      element.setAttribute("class", "modified");
    },
  });

  const response = rw.transform(new Response(inputStream));
  const text = await response.text();
  expect(text).toBe('<html><body class="modified">Hello world</body></html>');
});

test("HTMLRewriter.transform() works with a binary-chunk JS ReadableStream", async () => {
  const encoder = new TextEncoder();
  const inputStream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode("<html><body>Binary</body></html>"));
      controller.close();
    },
  });

  const rw = new HTMLRewriter();
  const response = rw.transform(new Response(inputStream));
  const text = await response.text();
  expect(text).toBe("<html><body>Binary</body></html>");
});

test("HTMLRewriter.transform() works with an async pull-based JS ReadableStream", async () => {
  const inputStream = new ReadableStream({
    async pull(controller) {
      controller.enqueue("<html><body>Async</body></html>");
      controller.close();
    },
  });

  const rw = new HTMLRewriter();
  const response = rw.transform(new Response(inputStream));
  const text = await response.text();
  expect(text).toBe("<html><body>Async</body></html>");
});

test("HTMLRewriter.transform() works with an empty JS ReadableStream", async () => {
  const inputStream = new ReadableStream({
    start(controller) {
      controller.close();
    },
  });

  const rw = new HTMLRewriter();
  const response = rw.transform(new Response(inputStream));
  const text = await response.text();
  expect(text).toBe("");
});
