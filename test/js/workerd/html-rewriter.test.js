import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { gcTick } from "harness";
import path from "path";
import fs from "fs";
var setTimeoutAsync = (fn, delay) => {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(fn());
      } catch (e) {
        reject(e);
      }
    }, delay);
  });
};

describe("HTMLRewriter", () => {
  it("HTMLRewriter: async replacement", async () => {
    await gcTick();
    const res = new HTMLRewriter()
      .on("div", {
        async element(element) {
          await setTimeoutAsync(() => {
            element.setInnerContent("<span>replace</span>", { html: true });
          }, 5);
        },
      })
      .transform(new Response("<div>example.com</div>"));
    await gcTick();
    expect(await res.text()).toBe("<div><span>replace</span></div>");
    await gcTick();
  });

  it("HTMLRewriter handles Symbol invalid type error", async () => {
    expect(() => new HTMLRewriter().transform(new Response(Symbol("ok")))).toThrow();
    expect(() => new HTMLRewriter().transform(Symbol("ok"))).toThrow();
  });

  it("HTMLRewriter: async replacement using fetch + Bun.serve", async () => {
    await gcTick();
    let content;
    let server;
    try {
      server = Bun.serve({
        port: 0,
        fetch(req) {
          return new HTMLRewriter()
            .on("div", {
              async element(element) {
                content = await fetch("https://www.example.com/").then(res => res.text());
                element.setInnerContent(content, { html: true });
              },
            })
            .transform(new Response("<div>example.com</div>"));
        },
      });

      await gcTick();
      const url = `http://localhost:${server.port}`;
      expect(await fetch(url).then(res => res.text())).toBe(`<div>${content}</div>`);
      await gcTick();
    } finally {
      server.stop();
    }
  });

  for (let input of [new Response("<div>hello</div>"), "<div>hello</div>"]) {
    it("supports element handlers with input " + input.constructor.name, async () => {
      var rewriter = new HTMLRewriter();
      rewriter.on("div", {
        element(element) {
          element.setInnerContent("<blink>it worked!</blink>", { html: true });
        },
      });
      var output = rewriter.transform(input);
      expect(typeof input === "string" ? output : await output.text()).toBe("<div><blink>it worked!</blink></div>");
    });
  }

  it("(from file) supports element handlers", async () => {
    var rewriter = new HTMLRewriter();
    rewriter.on("div", {
      element(element) {
        element.setInnerContent("<blink>it worked!</blink>", { html: true });
      },
    });
    await Bun.write("/tmp/html-rewriter.txt.js", "<div>hello</div>");
    var output = rewriter.transform(new Response(Bun.file("/tmp/html-rewriter.txt.js")));
    expect(await output.text()).toBe("<div><blink>it worked!</blink></div>");
  });

  it("supports attribute iterator", async () => {
    var rewriter = new HTMLRewriter();
    var expected = [
      ["first", ""],
      ["second", "alrihgt"],
      ["third", "123"],
      ["fourth", "5"],
      ["fifth", "helloooo"],
    ];
    rewriter.on("div", {
      element(element2) {
        for (let attr of element2.attributes) {
          const stack = expected.shift();
          expect(stack[0]).toBe(attr[0]);
          expect(stack[1]).toBe(attr[1]);
        }
      },
    });
    var input = new Response('<div first second="alrihgt" third="123" fourth=5 fifth=helloooo>hello</div>');
    var output = rewriter.transform(input);
    expect(await output.text()).toBe('<div first second="alrihgt" third="123" fourth=5 fifth=helloooo>hello</div>');
    expect(expected.length).toBe(0);
  });

  it("handles element specific mutations", async () => {
    // prepend/append
    let res = new HTMLRewriter()
      .on("p", {
        element(element) {
          element.prepend("<span>prepend</span>");
          element.prepend("<span>prepend html</span>", { html: true });
          element.append("<span>append</span>");
          element.append("<span>append html</span>", { html: true });
        },
      })
      .transform(new Response("<p>test</p>"));
    expect(await res.text()).toBe(
      [
        "<p>",
        "<span>prepend html</span>",
        "&lt;span&gt;prepend&lt;/span&gt;",
        "test",
        "&lt;span&gt;append&lt;/span&gt;",
        "<span>append html</span>",
        "</p>",
      ].join(""),
    );

    // setInnerContent
    res = new HTMLRewriter()
      .on("p", {
        element(element) {
          element.setInnerContent("<span>replace</span>");
        },
      })
      .transform(new Response("<p>test</p>"));
    expect(await res.text()).toBe("<p>&lt;span&gt;replace&lt;/span&gt;</p>");
    res = new HTMLRewriter()
      .on("p", {
        element(element) {
          element.setInnerContent("<span>replace</span>", { html: true });
        },
      })
      .transform(new Response("<p>test</p>"));
    expect(await res.text()).toBe("<p><span>replace</span></p>");

    // removeAndKeepContent
    res = new HTMLRewriter()
      .on("p", {
        element(element) {
          element.removeAndKeepContent();
        },
      })
      .transform(new Response("<p>test</p>"));
    expect(await res.text()).toBe("test");
  });

  it("handles element class properties", async () => {
    class Handler {
      constructor(content) {
        this.content = content;
      }

      // noinspection JSUnusedGlobalSymbols
      element(element) {
        element.setInnerContent(this.content);
      }
    }
    const res = new HTMLRewriter().on("p", new Handler("new")).transform(new Response("<p>test</p>"));
    expect(await res.text()).toBe("<p>new</p>");
  });

  const commentsMutationsInput = "<p><!--test--></p>";
  const commentsMutationsExpected = {
    beforeAfter: [
      "<p>",
      "&lt;span&gt;before&lt;/span&gt;",
      "<span>before html</span>",
      "<!--test-->",
      "<span>after html</span>",
      "&lt;span&gt;after&lt;/span&gt;",
      "</p>",
    ].join(""),
    replace: "<p>&lt;span&gt;replace&lt;/span&gt;</p>",
    replaceHtml: "<p><span>replace</span></p>",
    remove: "<p></p>",
  };

  const commentPropertiesMacro = async func => {
    const res = func(new HTMLRewriter(), comment => {
      expect(comment.removed).toBe(false);
      expect(comment.text).toBe("test");
      comment.text = "new";
      expect(comment.text).toBe("new");
    }).transform(new Response("<p><!--test--></p>"));
    expect(await res.text()).toBe("<p><!--new--></p>");
  };

  it("HTMLRewriter: handles comment properties", () =>
    commentPropertiesMacro((rw, comments) => {
      rw.on("p", { comments });
      return rw;
    }));

  it("selector tests", async () => {
    const checkSelector = async (selector, input, expected) => {
      const res = new HTMLRewriter()
        .on(selector, {
          element(element) {
            element.setInnerContent("new");
          },
        })
        .transform(new Response(input));
      expect(await res.text()).toBe(expected);
    };

    await checkSelector("*", "<h1>1</h1><p>2</p>", "<h1>new</h1><p>new</p>");
    await checkSelector("p", "<h1>1</h1><p>2</p>", "<h1>1</h1><p>new</p>");
    await checkSelector(
      "p:nth-child(2)",
      "<div><p>1</p><p>2</p><p>3</p></div>",
      "<div><p>1</p><p>new</p><p>3</p></div>",
    );
    await checkSelector(
      "p:first-child",
      "<div><p>1</p><p>2</p><p>3</p></div>",
      "<div><p>new</p><p>2</p><p>3</p></div>",
    );
    await checkSelector(
      "p:nth-of-type(2)",
      "<div><p>1</p><h1>2</h1><p>3</p><h1>4</h1><p>5</p></div>",
      "<div><p>1</p><h1>2</h1><p>new</p><h1>4</h1><p>5</p></div>",
    );
    await checkSelector(
      "p:first-of-type",
      "<div><h1>1</h1><p>2</p><p>3</p></div>",
      "<div><h1>1</h1><p>new</p><p>3</p></div>",
    );
    await checkSelector(
      "p:not(:first-child)",
      "<div><p>1</p><p>2</p><p>3</p></div>",
      "<div><p>1</p><p>new</p><p>new</p></div>",
    );
    await checkSelector("p.red", '<p class="red">1</p><p>2</p>', '<p class="red">new</p><p>2</p>');
    await checkSelector("h1#header", '<h1 id="header">1</h1><h1>2</h1>', '<h1 id="header">new</h1><h1>2</h1>');
    await checkSelector("p[data-test]", "<p data-test>1</p><p>2</p>", "<p data-test>new</p><p>2</p>");
    await checkSelector(
      'p[data-test="one"]',
      '<p data-test="one">1</p><p data-test="two">2</p>',
      '<p data-test="one">new</p><p data-test="two">2</p>',
    );
    await checkSelector(
      'p[data-test="one" i]',
      '<p data-test="one">1</p><p data-test="OnE">2</p><p data-test="two">3</p>',
      '<p data-test="one">new</p><p data-test="OnE">new</p><p data-test="two">3</p>',
    );
    await checkSelector(
      'p[data-test="one" s]',
      '<p data-test="one">1</p><p data-test="OnE">2</p><p data-test="two">3</p>',
      '<p data-test="one">new</p><p data-test="OnE">2</p><p data-test="two">3</p>',
    );
    await checkSelector(
      'p[data-test~="two"]',
      '<p data-test="one two three">1</p><p data-test="one two">2</p><p data-test="one">3</p>',
      '<p data-test="one two three">new</p><p data-test="one two">new</p><p data-test="one">3</p>',
    );
    await checkSelector(
      'p[data-test^="a"]',
      '<p data-test="a1">1</p><p data-test="a2">2</p><p data-test="b1">3</p>',
      '<p data-test="a1">new</p><p data-test="a2">new</p><p data-test="b1">3</p>',
    );
    await checkSelector(
      'p[data-test$="1"]',
      '<p data-test="a1">1</p><p data-test="a2">2</p><p data-test="b1">3</p>',
      '<p data-test="a1">new</p><p data-test="a2">2</p><p data-test="b1">new</p>',
    );
    await checkSelector(
      'p[data-test*="b"]',
      '<p data-test="abc">1</p><p data-test="ab">2</p><p data-test="a">3</p>',
      '<p data-test="abc">new</p><p data-test="ab">new</p><p data-test="a">3</p>',
    );
    await checkSelector(
      'p[data-test|="a"]',
      '<p data-test="a">1</p><p data-test="a-1">2</p><p data-test="a2">3</p>',
      '<p data-test="a">new</p><p data-test="a-1">new</p><p data-test="a2">3</p>',
    );
    await checkSelector(
      "div span",
      "<div><h1><span>1</span></h1><span>2</span><b>3</b></div>",
      "<div><h1><span>new</span></h1><span>new</span><b>3</b></div>",
    );
    await checkSelector(
      "div > span",
      "<div><h1><span>1</span></h1><span>2</span><b>3</b></div>",
      "<div><h1><span>1</span></h1><span>new</span><b>3</b></div>",
    );
  });

  it("supports deleting innerContent", async () => {
    expect(
      await new HTMLRewriter()
        .on("div", {
          element(elem) {
            // https://github.com/oven-sh/bun/issues/2323
            elem.setInnerContent("");
          },
        })
        .transform(new Response("<div>content</div>"))
        .text(),
    ).toEqual("<div></div>");
  });

  it("supports deleting innerHTML", async () => {
    expect(
      await new HTMLRewriter()
        .on("div", {
          element(elem) {
            // https://github.com/oven-sh/bun/issues/2323
            elem.setInnerContent("", { html: true });
          },
        })
        .transform(new Response("<div><span>content</span></div>"))
        .text(),
    ).toEqual("<div></div>");
  });

  it("it supports lastInTextNode", async () => {
    let lastInTextNode;

    await new HTMLRewriter()
      .on("p", {
        text(text) {
          lastInTextNode ??= text.lastInTextNode;
        },
      })
      .transform(new Response("<p>Lorem ipsum!</p>"))
      .text();

    expect(lastInTextNode).toBeBoolean();
  });

  it("it supports selfClosing", async () => {
    const selfClosing = {};
    await new HTMLRewriter()
      .on("*", {
        element(el) {
          selfClosing[el.tagName] = el.selfClosing;
        },
      })

      .transform(new Response("<p>Lorem ipsum!<br></p><div />"))
      .text();

    expect(selfClosing).toEqual({
      p: false,
      br: false,
      div: true,
    });
  });

  it("it supports canHaveContent", async () => {
    const canHaveContent = {};
    await new HTMLRewriter()
      .on("*", {
        element(el) {
          canHaveContent[el.tagName] = el.canHaveContent;
        },
      })
      .transform(new Response("<p>Lorem ipsum!<br></p><div /><svg><circle /></svg>"))
      .text();

    expect(canHaveContent).toEqual({
      p: true,
      br: false,
      div: true,
      svg: true,
      circle: false,
    });
  });
});

// By not segfaulting, this test passes
it("#3334 regression", async () => {
  for (let i = 0; i < 10; i++) {
    const headers = new Headers({
      "content-type": "text/html",
    });
    const response = new Response("<div>content</div>", { headers });

    const result = await new HTMLRewriter()
      .on("div", {
        element(elem) {
          elem.setInnerContent("new");
        },
      })
      .transform(response)
      .text();
    expect(result).toEqual("<div>new</div>");
  }
  Bun.gc(true);
});

it("#3489", async () => {
  var el;
  await new HTMLRewriter()
    .on("p", {
      element(element) {
        el = element.getAttribute("id");
      },
    })
    .transform(new Response('<p id="Šžõäöü"></p>'))
    .text();
  expect(el).toEqual("Šžõäöü");
});

it("get attribute - ascii", async () => {
  for (let i = 0; i < 10; i++) {
    var el;
    await new HTMLRewriter()
      .on("p", {
        element(element) {
          el = element.getAttribute("id");
        },
      })
      .transform(new Response(`<p id="asciii"></p>`))
      .text();
    expect(el).toEqual("asciii");
  }
});

it("#3520", async () => {
  const pairs = [];

  await new HTMLRewriter()
    .on("p", {
      element(element) {
        for (const pair of element.attributes) {
          pairs.push(pair);
        }
      },
    })
    .transform(new Response('<p šž="Õäöü" ab="Õäöü" šž="Õäöü" šž="dc" šž="🕵🏻"></p>'))
    .text();

  expect(pairs).toEqual([
    ["šž", "Õäöü"],
    ["ab", "Õäöü"],
    ["šž", "Õäöü"],
    ["šž", "dc"],
    ["šž", "🕵🏻"],
  ]);
});

const fixture_html = path.join(import.meta.dir, "../web/fetch/fixture.html");
const fixture_html_content = fs.readFileSync(fixture_html);
const fixture_html_gz = path.join(import.meta.dir, "../web/fetch/fixture.html.gz");
const fixture_html_gz_content = fs.readFileSync(fixture_html_gz);
function getStream(type, fixture) {
  const data = fixture === "gz" ? fixture_html_gz_content : fixture_html_content;
  const half = parseInt(data.length / 2, 10);

  if (type === "direct") {
    return new ReadableStream({
      type: "direct",
      async pull(controller) {
        controller.write(data.slice(0, half));
        await controller.flush();
        controller.write(data.slice(half));
        await controller.flush();
        controller.close();
      },
    });
  }

  return new ReadableStream({
    async pull(controller) {
      controller.enqueue(data.slice(0, half));
      await Bun.sleep(15);
      controller.enqueue(data.slice(half));
      await Bun.sleep(15);
      controller.close();
    },
  });
}
function createServer(tls) {
  return Bun.serve({
    port: 0,
    tls,
    async fetch(req) {
      const is_compressed = req.url.endsWith("/gzip");

      let payload;
      if (req.url.indexOf("chunked") !== -1) {
        if (req.url.indexOf("direct")) {
          payload = getStream("direct", is_compressed ? "gz" : "default");
        } else {
          payload = getStream("default", is_compressed ? "gz" : "default");
        }
      } else if (req.url.indexOf("file") !== -1) {
        payload = is_compressed ? Bun.file(fixture_html_gz) : Bun.file(fixture_html);
      } else {
        payload = is_compressed ? fixture_html_gz_content : fixture_html_content;
      }

      let headers = {
        "content-type": "text/html",
      };

      if (is_compressed) {
        headers["content-encoding"] = "gzip";
      }

      return new Response(payload, { headers });
    },
  });
}
let http_server;
let https_server;
beforeAll(() => {
  http_server = createServer();
  https_server = createServer({
    cert: "-----BEGIN CERTIFICATE-----\nMIIDXTCCAkWgAwIBAgIJAKLdQVPy90jjMA0GCSqGSIb3DQEBCwUAMEUxCzAJBgNV\nBAYTAkFVMRMwEQYDVQQIDApTb21lLVN0YXRlMSEwHwYDVQQKDBhJbnRlcm5ldCBX\naWRnaXRzIFB0eSBMdGQwHhcNMTkwMjAzMTQ0OTM1WhcNMjAwMjAzMTQ0OTM1WjBF\nMQswCQYDVQQGEwJBVTETMBEGA1UECAwKU29tZS1TdGF0ZTEhMB8GA1UECgwYSW50\nZXJuZXQgV2lkZ2l0cyBQdHkgTHRkMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIB\nCgKCAQEA7i7IIEdICTiSTVx+ma6xHxOtcbd6wGW3nkxlCkJ1UuV8NmY5ovMsGnGD\nhJJtUQ2j5ig5BcJUf3tezqCNW4tKnSOgSISfEAKvpn2BPvaFq3yx2Yjz0ruvcGKp\nDMZBXmB/AAtGyN/UFXzkrcfppmLHJTaBYGG6KnmU43gPkSDy4iw46CJFUOupc51A\nFIz7RsE7mbT1plCM8e75gfqaZSn2k+Wmy+8n1HGyYHhVISRVvPqkS7gVLSVEdTea\nUtKP1Vx/818/HDWk3oIvDVWI9CFH73elNxBkMH5zArSNIBTehdnehyAevjY4RaC/\nkK8rslO3e4EtJ9SnA4swOjCiqAIQEwIDAQABo1AwTjAdBgNVHQ4EFgQUv5rc9Smm\n9c4YnNf3hR49t4rH4yswHwYDVR0jBBgwFoAUv5rc9Smm9c4YnNf3hR49t4rH4ysw\nDAYDVR0TBAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEATcL9CAAXg0u//eYUAlQa\nL+l8yKHS1rsq1sdmx7pvsmfZ2g8ONQGfSF3TkzkI2OOnCBokeqAYuyT8awfdNUtE\nEHOihv4ZzhK2YZVuy0fHX2d4cCFeQpdxno7aN6B37qtsLIRZxkD8PU60Dfu9ea5F\nDDynnD0TUabna6a0iGn77yD8GPhjaJMOz3gMYjQFqsKL252isDVHEDbpVxIzxPmN\nw1+WK8zRNdunAcHikeoKCuAPvlZ83gDQHp07dYdbuZvHwGj0nfxBLc9qt90XsBtC\n4IYR7c/bcLMmKXYf0qoQ4OzngsnPI5M+v9QEHvYWaKVwFY4CTcSNJEwfXw+BAeO5\nOA==\n-----END CERTIFICATE-----",
    key: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDuLsggR0gJOJJN\nXH6ZrrEfE61xt3rAZbeeTGUKQnVS5Xw2Zjmi8ywacYOEkm1RDaPmKDkFwlR/e17O\noI1bi0qdI6BIhJ8QAq+mfYE+9oWrfLHZiPPSu69wYqkMxkFeYH8AC0bI39QVfOSt\nx+mmYsclNoFgYboqeZTjeA+RIPLiLDjoIkVQ66lznUAUjPtGwTuZtPWmUIzx7vmB\n+pplKfaT5abL7yfUcbJgeFUhJFW8+qRLuBUtJUR1N5pS0o/VXH/zXz8cNaTegi8N\nVYj0IUfvd6U3EGQwfnMCtI0gFN6F2d6HIB6+NjhFoL+QryuyU7d7gS0n1KcDizA6\nMKKoAhATAgMBAAECggEAd5g/3o1MK20fcP7PhsVDpHIR9faGCVNJto9vcI5cMMqP\n6xS7PgnSDFkRC6EmiLtLn8Z0k2K3YOeGfEP7lorDZVG9KoyE/doLbpK4MfBAwBG1\nj6AHpbmd5tVzQrnNmuDjBBelbDmPWVbD0EqAFI6mphXPMqD/hFJWIz1mu52Kt2s6\n++MkdqLO0ORDNhKmzu6SADQEcJ9Suhcmv8nccMmwCsIQAUrfg3qOyqU4//8QB8ZM\njosO3gMUesihVeuF5XpptFjrAliPgw9uIG0aQkhVbf/17qy0XRi8dkqXj3efxEDp\n1LSqZjBFiqJlFchbz19clwavMF/FhxHpKIhhmkkRSQKBgQD9blaWSg/2AGNhRfpX\nYq+6yKUkUD4jL7pmX1BVca6dXqILWtHl2afWeUorgv2QaK1/MJDH9Gz9Gu58hJb3\nymdeAISwPyHp8euyLIfiXSAi+ibKXkxkl1KQSweBM2oucnLsNne6Iv6QmXPpXtro\nnTMoGQDS7HVRy1on5NQLMPbUBQKBgQDwmN+um8F3CW6ZV1ZljJm7BFAgNyJ7m/5Q\nYUcOO5rFbNsHexStrx/h8jYnpdpIVlxACjh1xIyJ3lOCSAWfBWCS6KpgeO1Y484k\nEYhGjoUsKNQia8UWVt+uWnwjVSDhQjy5/pSH9xyFrUfDg8JnSlhsy0oC0C/PBjxn\nhxmADSLnNwKBgQD2A51USVMTKC9Q50BsgeU6+bmt9aNMPvHAnPf76d5q78l4IlKt\nwMs33QgOExuYirUZSgjRwknmrbUi9QckRbxwOSqVeMOwOWLm1GmYaXRf39u2CTI5\nV9gTMHJ5jnKd4gYDnaA99eiOcBhgS+9PbgKSAyuUlWwR2ciL/4uDzaVeDQKBgDym\nvRSeTRn99bSQMMZuuD5N6wkD/RxeCbEnpKrw2aZVN63eGCtkj0v9LCu4gptjseOu\n7+a4Qplqw3B/SXN5/otqPbEOKv8Shl/PT6RBv06PiFKZClkEU2T3iH27sws2EGru\nw3C3GaiVMxcVewdg1YOvh5vH8ZVlxApxIzuFlDvnAoGAN5w+gukxd5QnP/7hcLDZ\nF+vesAykJX71AuqFXB4Wh/qFY92CSm7ImexWA/L9z461+NKeJwb64Nc53z59oA10\n/3o2OcIe44kddZXQVP6KTZBd7ySVhbtOiK3/pCy+BQRsrC7d71W914DxNWadwZ+a\njtwwKjDzmPwdIXDSQarCx0U=\n-----END PRIVATE KEY-----",
    passphrase: "1234",
  });
});

afterAll(() => {
  http_server?.stop(true);
  https_server?.stop(true);
});

const request_types = ["/", "/gzip", "/chunked/gzip", "/chunked", "/file", "/file/gzip"];
["http", "https"].forEach(protocol => {
  request_types.forEach(path => {
    it(`works with ${protocol} fetch using ${path}`, async () => {
      const server = protocol === "http" ? http_server : https_server;
      const server_origin = server.url.origin;
      const res = await fetch(`${server_origin}${path}`, { tls: { rejectUnauthorized: false } });
      let calls = 0;
      const rw = new HTMLRewriter();
      rw.on("h1", {
        text() {
          calls++;
        },
      });

      const transformed = rw.transform(res);
      if (transformed instanceof Error) throw transformed;
      const body = await transformed.text();
      let trimmed = body?.trim();
      expect(body).toBe(fixture_html_content.toString("utf8"));
      expect(trimmed).toEndWith("</html>");
      expect(trimmed).toStartWith("<!DOCTYPE html>");
      expect(calls).toBeGreaterThan(0);
    });
  });
});

const payloads = [
  {
    name: "direct",
    data: getStream("direct", "none"),
    test: it.todo,
  },
  {
    name: "default",
    data: getStream("default", "none"),
    test: it.todo,
  },
  {
    name: "file",
    data: Bun.file(fixture_html),
    test: it,
  },
  {
    name: "blob",
    data: new Blob([fixture_html_content]),
    test: it,
  },
  {
    name: "buffer",
    data: fixture_html_content,
    test: it,
  },
  {
    name: "string",
    data: fixture_html_content.toString("utf8"),
    test: it,
  },
];

payloads.forEach(type => {
  type.test(`works with payload of type ${type.name}`, async () => {
    let calls = 0;
    const rw = new HTMLRewriter();
    rw.on("h1", {
      text() {
        calls++;
      },
    });
    const transformed = rw.transform(new Response(type.data));
    if (transformed instanceof Error) throw transformed;
    const body = await transformed.text();
    let trimmed = body?.trim();
    expect(body).toBe(fixture_html_content.toString("utf8"));
    expect(trimmed).toEndWith("</html>");
    expect(trimmed).toStartWith("<!DOCTYPE html>");
    expect(calls).toBeGreaterThan(0);
  });
});
