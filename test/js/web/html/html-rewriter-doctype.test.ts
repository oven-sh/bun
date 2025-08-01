import { describe, expect, test } from "bun:test";

describe("HTMLRewriter DOCTYPE handler", () => {
  test("remove and removed property work on DOCTYPE", () => {
    const html = "<!DOCTYPE html><html><head></head><body>Hello</body></html>";
    let sawDoctype = false;
    let wasRemoved = false;

    const rewriter = new HTMLRewriter().onDocument({
      doctype(doctype) {
        sawDoctype = true;
        doctype.remove();
        wasRemoved = doctype.removed;
      },
    });

    const result = rewriter.transform(html);

    expect(sawDoctype).toBe(true);
    expect(wasRemoved).toBe(true);
    expect(result).not.toContain("<!DOCTYPE");
    expect(result).toContain("<html>");
  });
});
