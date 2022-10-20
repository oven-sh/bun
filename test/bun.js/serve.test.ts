import { file, gc, serve } from "bun";
import { afterEach, describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

afterEach(() => Bun.gc(true));

var port = 40001;

class TestPass extends Error {
  constructor(message) {
    super(message);
    this.name = "TestPass";
  }
}
var count = 200;

it("should work for a file", async () => {
  const fixture = resolve(import.meta.dir, "./fetch.js.txt");
  const textToExpect = readFileSync(fixture, "utf-8");

  const server = serve({
    port: port++,
    fetch(req) {
      return new Response(file(fixture));
    },
  });
  const response = await fetch(`http://${server.hostname}:${server.port}`);
  console.log(response);
  expect(await response.text()).toBe(textToExpect);
  server.stop();
});

describe("streaming", () => {
  describe("error handler", () => {
    it("throw on pull reports an error and close the connection", async () => {
      var server;
      try {
        var pass = false;
        server = serve({
          port: port++,
          development: false,
          error(e) {
            pass = true;
            return new Response("fail", { status: 500 });
          },

          fetch(req) {
            return new Response(
              new ReadableStream({
                pull(controller) {
                  throw new Error("error");
                },
              })
            );
          },
        });

        const response = await fetch(
          `http://${server.hostname}:${server.port}`
        );
        if (response.status > 0) {
          expect(response.status).toBe(500);
          expect(await response.text()).toBe("fail");
        }

        expect(pass).toBe(true);
      } catch (e) {
        throw e;
      } finally {
        server?.stop();
      }
    });

    it("throw on pull after writing should not call the error handler", async () => {
      var server;
      try {
        var pass = true;
        server = serve({
          port: port++,
          development: false,
          error(e) {
            pass = false;
            server?.stop();
            server = null;
            return new Response("fail", { status: 500 });
          },

          fetch(req) {
            return new Response(
              new ReadableStream({
                pull(controller) {
                  controller.enqueue("such fail");
                  throw new Error("error");
                },
              })
            );
          },
        });

        const response = await fetch(
          `http://${server.hostname}:${server.port}`
        );
        // connection terminated
        if (response.status > 0) {
          expect(response.status).toBe(200);
          expect(await response.text()).toBe("such fail");
        }
        expect(pass).toBe(true);
      } catch (e) {
        throw e;
      } finally {
        server?.stop();
      }
    });
  });

  it("text from JS, one chunk", async () => {
    const relative = new URL("./fetch.js.txt", import.meta.url);
    const textToExpect = readFileSync(relative, "utf-8");

    const server = serve({
      port: port++,
      fetch(req) {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(textToExpect);
              controller.close();
            },
          })
        );
      },
    });

    const response = await fetch(`http://${server.hostname}:${server.port}`);
    const text = await response.text();
    expect(text.length).toBe(textToExpect.length);
    expect(text).toBe(textToExpect);
    server.stop();
  });
  it("text from JS, two chunks", async () => {
    const fixture = resolve(import.meta.dir, "./fetch.js.txt");
    const textToExpect = readFileSync(fixture, "utf-8");

    const server = serve({
      port: port++,
      fetch(req) {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(textToExpect.substring(0, 100));
              controller.enqueue(textToExpect.substring(100));
              controller.close();
            },
          })
        );
      },
    });
    const response = await fetch(`http://${server.hostname}:${server.port}`);
    expect(await response.text()).toBe(textToExpect);
    server.stop();
  });

  it("text from JS throws on start no error handler", async () => {
    var server;
    try {
      var pass = false;
      server = serve({
        port: port++,
        development: false,
        fetch(req) {
          return new Response(
            new ReadableStream({
              start(controller) {
                throw new TestPass("Test Passed");
              },
            })
          );
        },
      });

      var response;
      try {
        response = await fetch(`http://${server.hostname}:${server.port}`);
      } catch (e) {
        if (e.name !== "ConnectionClosed") {
          throw e;
        }
      }

      if (response) {
        expect(response.status).toBe(500);
      }
    } catch (e) {
      if (!e || !(e instanceof TestPass)) {
        throw e;
      }
    } finally {
      server?.stop();
    }
    gc(true);
  });

  it("text from JS throws on start has error handler", async () => {
    var server;
    try {
      var pass = false;
      var err = { name: '', message: '' };
      server = serve({
        port: port++,
        development: false,
        error(e) {
          pass = true;
          err = e;
          return new Response("Fail", { status: 500 });
        },
        fetch(req) {
          return new Response(
            new ReadableStream({
              start(controller) {
                throw new TypeError("error");
              },
            })
          );
        },
      });

      const response = await fetch(`http://${server.hostname}:${server.port}`);
      expect(response.status).toBe(500);
      expect(await response.text()).toBe("Fail");
      expect(pass).toBe(true);
      expect(err.name).toBe("TypeError");
      expect(err.message).toBe("error");
    } catch (e) {
      throw e;
    } finally {
      server?.stop();
    }
  });

  it("text from JS, 2 chunks, with delay", async () => {
    const fixture = resolve(import.meta.dir, "./fetch.js.txt");
    const textToExpect = readFileSync(fixture, "utf-8");

    const server = serve({
      port: port++,
      fetch(req) {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(textToExpect.substring(0, 100));
              queueMicrotask(() => {
                controller.enqueue(textToExpect.substring(100));
                controller.close();
              });
            },
          })
        );
      },
    });
    const response = await fetch(`http://${server.hostname}:${server.port}`);
    expect(await response.text()).toBe(textToExpect);
    server.stop();
  });

  it("text from JS, 1 chunk via pull()", async () => {
    const fixture = resolve(import.meta.dir, "./fetch.js.txt");
    const textToExpect = readFileSync(fixture, "utf-8");

    const server = serve({
      port: port++,
      fetch(req) {
        return new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(textToExpect);
              controller.close();
            },
          })
        );
      },
    });
    const response = await fetch(`http://${server.hostname}:${server.port}`);
    const text = await response.text();
    expect(text).toBe(textToExpect);
    server.stop();
  });

  it("text from JS, 2 chunks, with delay in pull", async () => {
    const fixture = resolve(import.meta.dir, "./fetch.js.txt");
    const textToExpect = readFileSync(fixture, "utf-8");

    const server = serve({
      port: port++,
      fetch(req) {
        return new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(textToExpect.substring(0, 100));
              queueMicrotask(() => {
                controller.enqueue(textToExpect.substring(100));
                controller.close();
              });
            },
          })
        );
      },
    });
    const response = await fetch(`http://${server.hostname}:${server.port}`);
    expect(await response.text()).toBe(textToExpect);
    server.stop();
  });

  it("text from JS, 2 chunks, with async pull", async () => {
    const fixture = resolve(import.meta.dir, "./fetch.js.txt");
    const textToExpect = readFileSync(fixture, "utf-8");

    const server = serve({
      port: port++,
      fetch(req) {
        return new Response(
          new ReadableStream({
            async pull(controller) {
              controller.enqueue(textToExpect.substring(0, 100));
              await Promise.resolve();
              controller.enqueue(textToExpect.substring(100));
              await Promise.resolve();
              controller.close();
            },
          })
        );
      },
    });
    const response = await fetch(`http://${server.hostname}:${server.port}`);
    expect(await response.text()).toBe(textToExpect);
    server.stop();
  });

  it("text from JS, 10 chunks, with async pull", async () => {
    const fixture = resolve(import.meta.dir, "./fetch.js.txt");
    const textToExpect = readFileSync(fixture, "utf-8");

    const server = serve({
      port: port++,
      fetch(req) {
        return new Response(
          new ReadableStream({
            async pull(controller) {
              var remain = textToExpect;
              for (let i = 0; i < 10 && remain.length > 0; i++) {
                controller.enqueue(remain.substring(0, 100));
                remain = remain.substring(100);
                await new Promise((resolve) => queueMicrotask(resolve));
              }

              controller.enqueue(remain);
              controller.close();
            },
          })
        );
      },
    });
    const response = await fetch(`http://${server.hostname}:${server.port}`);
    expect(await response.text()).toBe(textToExpect);
    server.stop();
  });
});

it("should work for a hello world", async () => {
  const server = serve({
    port: port++,
    fetch(req) {
      return new Response(`Hello, world!`);
    },
  });
  const response = await fetch(`http://${server.hostname}:${server.port}`);
  expect(await response.text()).toBe("Hello, world!");
  server.stop();
});

it("should work for a blob", async () => {
  const fixture = resolve(import.meta.dir, "./fetch.js.txt");
  const textToExpect = readFileSync(fixture, "utf-8");

  const server = serve({
    port: port++,
    fetch(req) {
      return new Response(new Blob([textToExpect]));
    },
  });
  const response = await fetch(`http://${server.hostname}:${server.port}`);
  expect(await response.text()).toBe(textToExpect);
  server.stop();
});

it("should work for a blob stream", async () => {
  const fixture = resolve(import.meta.dir, "./fetch.js.txt");
  const textToExpect = readFileSync(fixture, "utf-8");

  const server = serve({
    port: port++,
    fetch(req) {
      return new Response(new Blob([textToExpect]).stream());
    },
  });
  const response = await fetch(`http://${server.hostname}:${server.port}`);
  expect(await response.text()).toBe(textToExpect);
  server.stop();
});

it("should work for a file stream", async () => {
  const fixture = resolve(import.meta.dir, "./fetch.js.txt");
  const textToExpect = readFileSync(fixture, "utf-8");

  const server = serve({
    port: port++,
    fetch(req) {
      return new Response(file(fixture).stream());
    },
  });
  const response = await fetch(`http://${server.hostname}:${server.port}`);
  expect(await response.text()).toBe(textToExpect);
  server.stop();
});

it("fetch should work with headers", async () => {
  const fixture = resolve(import.meta.dir, "./fetch.js.txt");

  const server = serve({
    port: port++,
    fetch(req) {
      if (req.headers.get("X-Foo") !== "bar") {
        return new Response("X-Foo header not set", { status: 500 });
      }
      return new Response(file(fixture), {
        headers: { "X-Both-Ways": "1" },
      });
    },
  });
  const response = await fetch(`http://${server.hostname}:${server.port}`, {
    headers: {
      "X-Foo": "bar",
    },
  });

  expect(response.status).toBe(200);
  expect(response.headers.get("X-Both-Ways")).toBe("1");
  server.stop();
});

it(`should work for a file ${count} times serial`, async () => {
  const fixture = resolve(import.meta.dir, "./fetch.js.txt");
  const textToExpect = readFileSync(fixture, "utf-8");
  var ran = 0;
  const server = serve({
    port: port++,
    async fetch(req) {
      return new Response(file(fixture));
    },
  });

  for (let i = 0; i < count; i++) {
    const response = await fetch(`http://${server.hostname}:${server.port}`);
    expect(await response.text()).toBe(textToExpect);
  }

  server.stop();
});

it(`should work for ArrayBuffer ${count} times serial`, async () => {
  const textToExpect = "hello";
  var ran = 0;
  const server = serve({
    port: port++,
    fetch(req) {
      return new Response(new TextEncoder().encode(textToExpect));
    },
  });

  for (let i = 0; i < count; i++) {
    const response = await fetch(`http://${server.hostname}:${server.port}`);
    expect(await response.text()).toBe(textToExpect);
  }

  server.stop();
});

describe("parallell", () => {
  it(`should work for text ${count} times in batches of 5`, async () => {
    const textToExpect = "hello";
    var ran = 0;
    const server = serve({
      port: port++,
      fetch(req) {
        return new Response(textToExpect);
      },
    });

    for (let i = 0; i < count; ) {
      let responses = await Promise.all([
        fetch(`http://${server.hostname}:${server.port}`),
        fetch(`http://${server.hostname}:${server.port}`),
        fetch(`http://${server.hostname}:${server.port}`),
        fetch(`http://${server.hostname}:${server.port}`),
        fetch(`http://${server.hostname}:${server.port}`),
      ]);

      for (let response of responses) {
        expect(await response.text()).toBe(textToExpect);
      }
      i += responses.length;
    }

    server.stop();
  });
  it(`should work for Uint8Array ${count} times in batches of 5`, async () => {
    const textToExpect = "hello";
    var ran = 0;
    const server = serve({
      port: port++,
      fetch(req) {
        return new Response(new TextEncoder().encode(textToExpect));
      },
    });

    for (let i = 0; i < count; ) {
      let responses = await Promise.all([
        fetch(`http://${server.hostname}:${server.port}`),
        fetch(`http://${server.hostname}:${server.port}`),
        fetch(`http://${server.hostname}:${server.port}`),
        fetch(`http://${server.hostname}:${server.port}`),
        fetch(`http://${server.hostname}:${server.port}`),
      ]);

      for (let response of responses) {
        expect(await response.text()).toBe(textToExpect);
      }
      i += responses.length;
    }

    server.stop();
  });
});

it("should support reloading", async () => {
  const first = (req) => new Response("first");
  const second = (req) => new Response("second");

  const server = serve({
    port: port++,
    fetch: first,
  });

  const response = await fetch(`http://${server.hostname}:${server.port}`);
  expect(await response.text()).toBe("first");
  server.reload({ fetch: second });
  const response2 = await fetch(`http://${server.hostname}:${server.port}`);
  expect(await response2.text()).toBe("second");
  server.stop();
});
