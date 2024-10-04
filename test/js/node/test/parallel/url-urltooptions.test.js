//#FILE: test-url-urltooptions.js
//#SHA1: 0ba1cb976ec5888306f7c820a39afcb93b882d03
//-----------------
"use strict";

const { URL } = require("url");
const { urlToHttpOptions } = require("url");

describe("urlToHttpOptions", () => {
  test("converts URL object to HTTP options", () => {
    const urlObj = new URL("http://user:pass@foo.bar.com:21/aaa/zzz?l=24#test");
    const opts = urlToHttpOptions(urlObj);

    expect(opts).not.toBeInstanceOf(URL);
    expect(opts.protocol).toBe("http:");
    expect(opts.auth).toBe("user:pass");
    expect(opts.hostname).toBe("foo.bar.com");
    expect(opts.port).toBe(21);
    expect(opts.path).toBe("/aaa/zzz?l=24");
    expect(opts.pathname).toBe("/aaa/zzz");
    expect(opts.search).toBe("?l=24");
    expect(opts.hash).toBe("#test");
  });

  test("handles IPv6 hostname correctly", () => {
    const { hostname } = urlToHttpOptions(new URL("http://[::1]:21"));
    expect(hostname).toBe("::1");
  });

  test("handles copied URL object with missing data properties", () => {
    const urlObj = new URL("http://user:pass@foo.bar.com:21/aaa/zzz?l=24#test");
    const copiedUrlObj = { ...urlObj };
    const copiedOpts = urlToHttpOptions(copiedUrlObj);

    expect(copiedOpts).not.toBeInstanceOf(URL);
    expect(copiedOpts.protocol).toBeUndefined();
    expect(copiedOpts.auth).toBeUndefined();
    expect(copiedOpts.hostname).toBeUndefined();
    expect(copiedOpts.port).toBeNaN();
    expect(copiedOpts.path).toBe("");
    expect(copiedOpts.pathname).toBeUndefined();
    expect(copiedOpts.search).toBeUndefined();
    expect(copiedOpts.hash).toBeUndefined();
    expect(copiedOpts.href).toBeUndefined();
  });
});

//<#END_FILE: test-url-urltooptions.js
