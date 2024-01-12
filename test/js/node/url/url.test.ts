import { parse } from "url";

describe("Url.prototype.parse", () => {
  it("parses URL correctly", () => {
    const url = parse("https://foo:bar@baz.qat:8000/qux/quux?foo=bar&baz=12#qat");

    expect(url.hash).toEqual("#qat");
    expect(url.host).toEqual("baz.qat:8000");
    expect(url.hostname).toEqual("baz.qat");
    expect(url.href).toEqual("https://foo:bar@baz.qat:8000/qux/quux?foo=bar&baz=12#qat");
    expect(url.pathname).toEqual("/qux/quux");
    expect(url.port).toEqual("8000");
    expect(url.protocol).toEqual("https:");
    expect(url.search).toEqual("?foo=bar&baz=12");
  });

  it("accepts empty host", () => {
    expect(() => parse("http://")).not.toThrow();
  });
});
