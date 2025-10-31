// https://github.com/oven-sh/bun/issues/17259
// HTMLRewriter doesn't support reading from a Blob
import { test, expect } from "bun:test";

test("HTMLRewriter should accept Blob input", async () => {
  const html = '<script src="/main.js"></script>';
  let foundSrc: string | null = null;

  const response = new HTMLRewriter()
    .on("script", {
      element(element) {
        foundSrc = element.getAttribute("src");
      },
    })
    .transform(new Blob([html]));

  await response.text();
  expect(foundSrc).toBe("/main.js");
});

test("HTMLRewriter should accept BunFile input", async () => {
  const html = '<script src="/test.js"></script>';
  const tmpFile = `/tmp/htmlrewriter-test-${Date.now()}.html`;
  await Bun.write(tmpFile, html);

  let foundSrc: string | null = null;

  const response = new HTMLRewriter()
    .on("script", {
      element(element) {
        foundSrc = element.getAttribute("src");
      },
    })
    .transform(Bun.file(tmpFile));

  await response.text();
  expect(foundSrc).toBe("/test.js");
});

test("HTMLRewriter should accept ArrayBuffer input", async () => {
  const html = '<div class="test">content</div>';
  const buffer = new TextEncoder().encode(html);

  let foundClass: string | null = null;

  const resultBuffer = new HTMLRewriter()
    .on("div", {
      element(element) {
        foundClass = element.getAttribute("class");
      },
    })
    .transform(buffer.buffer);

  expect(resultBuffer).toBeInstanceOf(ArrayBuffer);
  const resultText = new TextDecoder().decode(resultBuffer);
  expect(resultText).toContain('<div class="test">content</div>');
  expect(foundClass).toBe("test");
});
