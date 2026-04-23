import { expect, test } from "bun:test";
import { tempDir } from "harness";

test("HTMLRewriter.transform supports Blob input", () => {
  const html = '<div class="hello">Hello</div><script src="/main.js"></script>';
  const blob = new Blob([html], { type: "text/html" });

  const tags: string[] = [];
  const result = new HTMLRewriter()
    .on("*", {
      element(element) {
        tags.push(element.tagName);
      },
    })
    .transform(blob);

  expect(result).toBeInstanceOf(Blob);
  expect(tags).toEqual(["div", "script"]);
});

test("HTMLRewriter.transform supports Blob input and modifies content", async () => {
  const html = '<div class="old">content</div>';
  const blob = new Blob([html], { type: "text/html" });

  const result = new HTMLRewriter()
    .on("div", {
      element(element) {
        element.setAttribute("class", "new");
      },
    })
    .transform(blob);

  expect(result).toBeInstanceOf(Blob);
  const text = await result.text();
  expect(text).toBe('<div class="new">content</div>');
});

test("HTMLRewriter.transform supports Bun.file() input", async () => {
  using dir = tempDir("html-rewriter-bunfile", {
    "index.html": '<h1>Hello</h1><p class="old">World</p>',
  });

  const file = Bun.file(`${dir}/index.html`);

  const result = new HTMLRewriter()
    .on("p", {
      element(element) {
        element.setAttribute("class", "new");
      },
    })
    .transform(file);

  // BunFile requires async I/O, so transform returns a Response
  expect(result).toBeInstanceOf(Response);
  const text = await result.text();
  expect(text).toBe('<h1>Hello</h1><p class="new">World</p>');
});

test("HTMLRewriter.transform Blob with element handler reading attributes", () => {
  const html = '<script src="/app.js"></script><script src="/vendor.js"></script>';
  const blob = new Blob([html]);

  const srcs: string[] = [];
  new HTMLRewriter()
    .on("script", {
      element(element) {
        const src = element.getAttribute("src");
        if (src) srcs.push(src);
      },
    })
    .transform(blob);

  expect(srcs).toEqual(["/app.js", "/vendor.js"]);
});
