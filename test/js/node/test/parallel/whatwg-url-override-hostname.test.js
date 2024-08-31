//#FILE: test-whatwg-url-override-hostname.js
//#SHA1: 22f2c5e784a47cc59c7f0b3229a68f4bbcfeff3e
//-----------------
"use strict";

test("URL with overridden hostname getter", () => {
  const url = new (class extends URL {
    get hostname() {
      return "bar.com";
    }
  })("http://foo.com/");

  expect(url.href).toBe("http://foo.com/");
  expect(url.toString()).toBe("http://foo.com/");
  expect(url.toJSON()).toBe("http://foo.com/");
  expect(url.hash).toBe("");
  expect(url.host).toBe("foo.com");
  expect(url.hostname).toBe("bar.com");
  expect(url.origin).toBe("http://foo.com");
  expect(url.password).toBe("");
  expect(url.protocol).toBe("http:");
  expect(url.username).toBe("");
  expect(url.search).toBe("");
  expect(url.searchParams.toString()).toBe("");
});

//<#END_FILE: test-whatwg-url-override-hostname.js
