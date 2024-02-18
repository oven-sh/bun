import { describe, test } from "bun:test";
import assert from "node:assert";
import url from "node:url";

const domainToASCII = url.domainToASCII;
const domainToUnicode = url.domainToUnicode;

// TODO: Support url.domainToASCII and url.domainToUnicode.
describe.todo("url.domainToASCII and url.domainToUnicode", () => {
  test("convert from unicode to ascii and back", () => {
    const domainWithASCII = [
      ["ıíd", "xn--d-iga7r"],
      ["يٴ", "xn--mhb8f"],
      ["www.ϧƽəʐ.com", "www.xn--cja62apfr6c.com"],
      ["новини.com", "xn--b1amarcd.com"],
      ["名がドメイン.com", "xn--v8jxj3d1dzdz08w.com"],
      ["افغانستا.icom.museum", "xn--mgbaal8b0b9b2b.icom.museum"],
      ["الجزائر.icom.fake", "xn--lgbbat1ad8j.icom.fake"],
      ["भारत.org", "xn--h2brj9c.org"],
    ];

    domainWithASCII.forEach(pair => {
      const domain = pair[0];
      const ascii = pair[1];
      const domainConvertedToASCII = domainToASCII(domain);
      assert.strictEqual(domainConvertedToASCII, ascii);
      const asciiConvertedToUnicode = domainToUnicode(ascii);
      assert.strictEqual(asciiConvertedToUnicode, domain);
    });
  });
});
