import { expect, jest, test } from "bun:test";

test("#7827", () => {
  for (let i = 0; i < 10; i++)
    (function () {
      const element = jest.fn(element => {
        element.tagName;
      });
      const rewriter = new HTMLRewriter().on("p", {
        element,
      });

      const content = "<p>Lorem ipsum!</p>";

      rewriter.transform(new Response(content));
      rewriter.transform(new Response(content));

      expect(element).toHaveBeenCalledTimes(2);
    })();

  Bun.gc(true);
});
