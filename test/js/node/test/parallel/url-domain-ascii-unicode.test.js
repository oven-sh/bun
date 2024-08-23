//#FILE: test-url-domain-ascii-unicode.js
//#SHA1: 717d40eef6d2d8f5adccf01fe09dc43f8b776e13
//-----------------
"use strict";

const url = require("url");

const domainToASCII = url.domainToASCII;
const domainToUnicode = url.domainToUnicode;

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

describe("URL domain ASCII and Unicode conversion", () => {
  // Skip the entire test suite if Intl is not available
  beforeAll(() => {
    if (typeof Intl === "undefined") {
      throw new Error("missing Intl");
    }
  });

  test.each(domainWithASCII)("converts %s <-> %s", (domain, ascii) => {
    const domainConvertedToASCII = domainToASCII(domain);
    expect(domainConvertedToASCII).toBe(ascii);

    const asciiConvertedToUnicode = domainToUnicode(ascii);
    expect(asciiConvertedToUnicode).toBe(domain);
  });
});

//<#END_FILE: test-url-domain-ascii-unicode.js
