import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { once } from "events";
import fs from "fs";
import { bunEnv, bunExe, gcTick, tempDir, tls, tmpdirSync } from "harness";
import { createServer as createTcpServer } from "net";
import path, { join } from "path";
import { setImmediate as setImmediatePromise } from "timers/promises";
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
  it("error handling", () => {
    expect(() => new HTMLRewriter().transform(Symbol("ok"))).toThrow();
  });

  // Which channel a handler error takes is decided by the overload, not by
  // whether the input body happened to be buffered: every `Response` input
  // rejects its output body.
  it("error inside element handler rejects the body", async () => {
    const res = new HTMLRewriter()
      .on("div", {
        element(element) {
          throw new Error("test");
        },
      })
      .transform(new Response("<div>hello</div>"));
    await expect(res.text()).rejects.toThrow("test");
  });

  it("error inside element handler (string)", () => {
    expect(() =>
      new HTMLRewriter()
        .on("div", {
          element(element) {
            throw new Error("test");
          },
        })
        .transform("<div>hello</div>"),
    ).toThrow("test");
  });

  it("async error without a real await inside element handler rejects the body", async () => {
    const res = new HTMLRewriter()
      .on("div", {
        async element(element) {
          throw new Error("test");
        },
      })
      .transform(new Response("<div>hello</div>"));
    await expect(res.text()).rejects.toThrow("test");
  });

  // A handler that only settles once the event loop turns (setImmediate /
  // setTimeout / I/O) suspends the rewrite: `transform()` returns the
  // Response immediately and the failure surfaces on its body, exactly like
  // Cloudflare's HTMLRewriter. It can no longer throw synchronously, because
  // HTMLRewriter no longer nests the event loop inside `transform()`.
  it("fast async error inside element handler rejects the body", async () => {
    const res = new HTMLRewriter()
      .on("div", {
        async element(element) {
          await setImmediatePromise();
          throw new Error("test");
        },
      })
      .transform(new Response("<div>hello</div>"));
    expect(res).toBeInstanceOf(Response);
    await expect(res.text()).rejects.toThrow("test");
  });

  it("slow async error inside element handler rejects the body", async () => {
    const res = new HTMLRewriter()
      .on("div", {
        async element(element) {
          await Bun.sleep(1);
          throw new Error("test");
        },
      })
      .transform(new Response("<div>hello</div>"));
    expect(res).toBeInstanceOf(Response);
    await expect(res.text()).rejects.toThrow("test");
  });

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

  // Async content handlers suspend the lol-html rewrite until their promise
  // settles, instead of spinning a nested event loop inside `transform()`.
  // The rewritable unit is moved onto the heap for the duration of the
  // `await`, so post-`await` mutations still land on the element that gets
  // serialized, and handlers stay strictly one-at-a-time.
  describe("async handlers suspend the rewrite", () => {
    it("runs async element handlers strictly in document order", async () => {
      const count = 8;
      const order = [];
      const html = Array.from({ length: count }, (_, i) => `<i id="${i}"></i>`).join("");
      const res = new HTMLRewriter()
        .on("i", {
          async element(element) {
            const id = element.getAttribute("id");
            await setImmediatePromise();
            order.push(id);
            element.setInnerContent(id);
          },
        })
        .transform(new Response(html));
      expect(await res.text()).toBe(Array.from({ length: count }, (_, i) => `<i id="${i}">${i}</i>`).join(""));
      // Each handler must finish (including its awaited half) before the
      // parser reaches the next element.
      expect(order).toEqual(Array.from({ length: count }, (_, i) => String(i)));
    });

    it("mutations made before and after the await both land", async () => {
      const res = new HTMLRewriter()
        .on("div", {
          async element(element) {
            element.setAttribute("before", "1");
            await setImmediatePromise();
            element.setAttribute("after", "2");
            element.setAttribute("id", "x");
          },
        })
        .transform(new Response('<div id="a">inner</div>'));
      expect(await res.text()).toBe('<div id="x" before="1" after="2">inner</div>');
    });

    it("an attribute iterator from before the await keeps working", async () => {
      // The suspension deep-copies the element (and its attribute buffer) onto
      // the heap. The iterator reads attributes back through the element on
      // every next(), so it follows the copy and resumes at the same index
      // instead of silently reporting done.
      let partial, rest, fresh;
      const res = new HTMLRewriter()
        .on("div", {
          async element(element) {
            const it = element.attributes;
            partial = it.next().value;
            await setImmediatePromise();
            rest = [...it];
            fresh = [...element.attributes];
            element.setAttribute("c", "3");
          },
        })
        .transform(new Response('<div a="1" b="2">x</div>'));
      expect(await res.text()).toBe('<div a="1" b="2" c="3">x</div>');
      expect(partial).toEqual(["a", "1"]);
      // Resumes mid-iteration against the parked copy.
      expect(rest).toEqual([["b", "2"]]);
      expect(fresh).toEqual([
        ["a", "1"],
        ["b", "2"],
      ]);
    });

    it("a for..of over attributes with an await in the body visits all of them", async () => {
      const seen = [];
      const res = new HTMLRewriter()
        .on("div", {
          async element(element) {
            for (const [name, value] of element.attributes) {
              await setImmediatePromise();
              seen.push(`${name}=${value}`);
            }
          },
        })
        .transform(new Response('<div a="1" b="2" c="3">x</div>'));
      expect(await res.text()).toBe('<div a="1" b="2" c="3">x</div>');
      expect(seen).toEqual(["a=1", "b=2", "c=3"]);
    });

    it("runs the next handler for the same element after the previous one's await", async () => {
      const order = [];
      const res = new HTMLRewriter()
        .on("div", {
          async element(element) {
            await setImmediatePromise();
            order.push("a");
            element.setAttribute("a", "");
          },
        })
        .on("div", {
          async element(element) {
            await setImmediatePromise();
            order.push("b");
            element.setAttribute("b", "");
          },
        })
        .transform(new Response("<div></div>"));
      expect(await res.text()).toBe('<div a="" b=""></div>');
      expect(order).toEqual(["a", "b"]);
    });

    it("element removed after the await suppresses its content", async () => {
      const res = new HTMLRewriter()
        .on("div", {
          async element(element) {
            await setImmediatePromise();
            element.remove();
          },
        })
        .transform(new Response("a<div>gone<span>too</span></div>b"));
      expect(await res.text()).toBe("ab");
    });

    it("async text handler", async () => {
      const res = new HTMLRewriter()
        .on("div", {
          async text(chunk) {
            if (chunk.lastInTextNode) return;
            const original = chunk.text;
            await setImmediatePromise();
            chunk.replace(original.toUpperCase());
          },
        })
        .transform(new Response("<div>hello</div>world"));
      expect(await res.text()).toBe("<div>HELLO</div>world");
    });

    // The canonical "append once the text node ends" idiom, suspended on the
    // lastInTextNode chunk itself and mutated after the resume.
    it("async text handler suspending on lastInTextNode and mutating it", async () => {
      const res = new HTMLRewriter()
        .on("div", {
          async text(chunk) {
            if (!chunk.lastInTextNode) return;
            await setImmediatePromise();
            chunk.after("|", { html: false });
          },
        })
        .transform(new Response("<div>hello</div>"));
      expect(await res.text()).toBe("<div>hello|</div>");
    });

    // The `is_async` arm of `on_rewriting_error`: a handler throwing while the
    // input is still streaming must surface the real error, not lol-html's
    // generic "The rewriter has been stopped."
    it("a throwing handler on a streaming input surfaces the real error", async () => {
      const encoder = new TextEncoder();
      // The body must still be incomplete when `transform()` runs, or the
      // rewrite finishes inline and the handler throws synchronously instead
      // (also correct, but a different code path). Hold the tail back until
      // `transform()` has returned rather than racing the loopback.
      const transformCalled = Promise.withResolvers();
      await using server = Bun.serve({
        port: 0,
        fetch: () =>
          new Response(
            new ReadableStream({
              async start(controller) {
                controller.enqueue(encoder.encode("<div>"));
                await transformCalled.promise;
                controller.enqueue(encoder.encode("x</div>"));
                controller.close();
              },
            }),
          ),
      });
      const upstream = await fetch(`http://localhost:${server.port}/`);
      const res = new HTMLRewriter()
        .on("div", {
          element() {
            throw new Error("boom");
          },
        })
        .transform(upstream);
      transformCalled.resolve();
      await expect(res.text()).rejects.toThrow("boom");
    });

    // Two rewriters chained, both suspending: `init()`'s own comment names
    // "another transform()" as a supported consumer of a pending body.
    it("chained suspending transforms", async () => {
      const first = new HTMLRewriter()
        .on("p", {
          async element(element) {
            await setImmediatePromise();
            element.setAttribute("one", "");
          },
        })
        .transform(new Response("<p>x</p>"));
      const second = new HTMLRewriter()
        .on("p", {
          async element(element) {
            await setImmediatePromise();
            element.setAttribute("two", "");
          },
        })
        .transform(first);
      expect(await second.text()).toBe('<p one="" two="">x</p>');
    });

    it("a rejection in the first of two chained transforms rejects the last body", async () => {
      const first = new HTMLRewriter()
        .on("p", {
          async element() {
            await setImmediatePromise();
            throw new Error("inner boom");
          },
        })
        .transform(new Response("<p>x</p>"));
      const second = new HTMLRewriter().on("p", { element() {} }).transform(first);
      await expect(second.text()).rejects.toThrow("inner boom");
    });

    // The resume path's own `handler_callback` sees a Fulfilled promise only
    // when a microtask-only handler follows a real-await one.
    it("a microtask-only handler after a suspending one", async () => {
      const order = [];
      const res = new HTMLRewriter()
        .on("p", {
          async element(element) {
            await setImmediatePromise();
            order.push("slow");
            element.setAttribute("slow", "");
          },
        })
        .on("p", {
          async element(element) {
            await Promise.resolve();
            order.push("fast");
            element.setAttribute("fast", "");
          },
        })
        .transform(new Response("<p>x</p>"));
      expect(await res.text()).toBe('<p slow="" fast="">x</p>');
      expect(order).toEqual(["slow", "fast"]);
    });

    it("async comments, doctype, and document end handlers", async () => {
      const res = new HTMLRewriter()
        .onDocument({
          async doctype(doctype) {
            await setImmediatePromise();
            doctype.remove();
          },
          async comments(comment) {
            const text = comment.text;
            await setImmediatePromise();
            comment.text = `${text}${text}`;
          },
          async end(end) {
            await setImmediatePromise();
            end.append("<tail>", { html: true });
          },
        })
        .transform(new Response("<!DOCTYPE html><p><!--x--></p>"));
      expect(await res.text()).toBe("<p><!--xx--></p><tail>");
    });

    it("async onEndTag handler", async () => {
      const res = new HTMLRewriter()
        .on("div", {
          element(element) {
            element.onEndTag(async endTag => {
              await setImmediatePromise();
              endTag.before("!");
            });
          },
        })
        .transform(new Response("<div>x</div>y"));
      expect(await res.text()).toBe("<div>x!</div>y");
    });

    it("the element survives a GC during the await", async () => {
      const res = new HTMLRewriter()
        .on("div", {
          async element(element) {
            element.setAttribute("pre", "1");
            await gcTick();
            await setImmediatePromise();
            await gcTick();
            element.setAttribute("post", "2");
            element.setInnerContent("<b>ok</b>", { html: true });
          },
        })
        .transform(new Response("<div>old</div>"));
      // One more collection while the transform is suspended and `transform()`
      // has already returned.
      await gcTick();
      expect(await res.text()).toBe('<div pre="1" post="2"><b>ok</b></div>');
    });

    it("a nested transform inside a suspended handler", async () => {
      const res = new HTMLRewriter()
        .on("div", {
          async element(element) {
            const inner = await new HTMLRewriter()
              .on("b", {
                async element(b) {
                  await setImmediatePromise();
                  b.setInnerContent("inner");
                },
              })
              .transform(new Response("<b>x</b>"))
              .text();
            element.setInnerContent(inner, { html: true });
          },
        })
        .transform(new Response("<div>outer</div>"));
      expect(await res.text()).toBe("<div><b>inner</b></div>");
    });

    it("transform(string) throws if a handler needs the event loop to settle", () => {
      expect(() =>
        new HTMLRewriter()
          .on("div", {
            async element(element) {
              await setImmediatePromise();
            },
          })
          .transform("<div></div>"),
      ).toThrow(
        "HTMLRewriter.transform() cannot synchronously return a string because a content " +
          "handler returned a Promise that did not resolve within a microtask. Pass a " +
          "Response instead and await its body",
      );
    });

    it("transform(string) stays synchronous for microtask-only async handlers", () => {
      const out = new HTMLRewriter()
        .on("div", {
          async element(element) {
            await Promise.resolve();
            await null;
            element.setInnerContent("sync enough");
          },
        })
        .transform("<div>old</div>");
      expect(out).toBe("<div>sync enough</div>");
    });

    // The suspend decision runs one microtask checkpoint, which drains
    // process.nextTick before the promise jobs (Node ordering), so a handler
    // that completes via nextTick is still "synchronous enough".
    for (const [label, schedule] of [
      ["process.nextTick", "process.nextTick(r)"],
      ["queueMicrotask", "queueMicrotask(r)"],
    ]) {
      it(`transform(string) stays synchronous for a handler awaiting ${label}`, () => {
        const out = new HTMLRewriter()
          .on("div", {
            async element(element) {
              await new Promise(r => eval(schedule));
              element.setInnerContent("ok");
            },
          })
          .transform("<div>old</div>");
        expect(out).toBe("<div>ok</div>");
      });
    }

    // transform(string) must fail atomically: the throw means the whole
    // rewrite failed, so no later handler may run against the orphaned output
    // and no post-throw rejection may be swallowed.
    it("transform(string) throwing runs no later handlers", async () => {
      let later = 0;
      expect(() =>
        new HTMLRewriter()
          .on("a", {
            async element() {
              await setImmediatePromise();
            },
          })
          .on("b", {
            element() {
              later++;
            },
          })
          .transform("<a></a><b></b>"),
      ).toThrow("cannot synchronously return a string");
      // Give the orphaned rewrite every chance to resume and run `b`.
      await setImmediatePromise();
      await setImmediatePromise();
      expect(later).toBe(0);
    });

    // A suspended transform hands back a Response whose body is still pending.
    // Every consumer of that body has to get the bytes once the rewrite
    // finishes, not just `.text()`.
    describe("consumers of a still-pending output body", () => {
      const suspending = () =>
        new HTMLRewriter()
          .on("p", {
            async element(element) {
              await setImmediatePromise();
              element.setInnerContent("new");
            },
          })
          .transform(new Response("<p>old</p>"));

      it(".text()", async () => {
        expect(await suspending().text()).toBe("<p>new</p>");
      });

      it(".blob()", async () => {
        expect(await (await suspending().blob()).text()).toBe("<p>new</p>");
      });

      it(".arrayBuffer()", async () => {
        const buf = await suspending().arrayBuffer();
        expect(new TextDecoder().decode(buf)).toBe("<p>new</p>");
      });

      it(".body reader drains the bytes", async () => {
        const reader = suspending().body.getReader();
        const chunks = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        expect(new TextDecoder().decode(Buffer.concat(chunks))).toBe("<p>new</p>");
      });

      it("new Response(res.body).text()", async () => {
        expect(await new Response(suspending().body).text()).toBe("<p>new</p>");
      });

      // `Value::tee` builds a ByteStream, tees it, and leaves both branches on
      // a `PendingValue` nothing settles, so a clone of a still-pending body
      // never completes. Pre-existing in `tee`, but a suspended transform is
      // what makes a pending output body the common case. Pinned as a hang so
      // the day `tee` is fixed, this test fails and gets promoted.
      it(".clone() does not work yet: both branches hang", async () => {
        const res = suspending();
        const clone = res.clone();
        const raced = await Promise.race([
          clone.text().then(() => "resolved"),
          res.text().then(() => "original resolved"),
          new Promise(r => setTimeout(() => r("hung"), 250)),
        ]);
        expect(raced).toBe("hung");
      });

      it("Bun.write(file, res)", async () => {
        using dir = tempDir("hr-pending-body", {});
        const out = path.join(String(dir), "out.html");
        await Bun.write(out, suspending());
        expect(await Bun.file(out).text()).toBe("<p>new</p>");
      });
    });

    it("transform(ArrayBuffer) throws the ArrayBuffer wording", () => {
      expect(() =>
        new HTMLRewriter()
          .on("div", {
            async element() {
              await setImmediatePromise();
            },
          })
          .transform(new TextEncoder().encode("<div></div>")),
      ).toThrow("cannot synchronously return an ArrayBuffer");
    });

    // A rejection from a Promise a handler creates but neither returns nor
    // awaits is the user's to handle. Main's nested event loop hijacked it into
    // `transform()`'s synchronous throw (swallowing unrelated rejections with
    // exit 0); now it reaches the process-global unhandledRejection path.
    //
    // Fixture note: it has to be a real-await handler on a Response. A sync
    // handler on a string input behaves the same pre- and post-PR, so that
    // shape pins nothing.
    it("a detached rejection inside a handler reaches unhandledRejection", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const r = new HTMLRewriter()
             .on("p", { async element(e) {
               (async () => { throw new Error("detached"); })();
               await Bun.sleep(5);
               e.setInnerContent("ok");
             } })
             .transform(new Response("<p>x</p>"));
           console.log("BODY:" + (await r.text()));`,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      // The rewrite itself succeeds; the detached rejection is reported and
      // takes the process down, rather than being captured by transform().
      expect({ stdout: stdout.trim(), reported: stderr.includes("detached"), exitCode }).toEqual({
        stdout: "BODY:<p>ok</p>",
        reported: true,
        exitCode: 1,
      });
    });

    // The headline production shape: returning a suspended transform straight
    // out of a Bun.serve handler, with a live client waiting.
    it("Bun.serve delivers a suspended transform to a live client", async () => {
      await using server = Bun.serve({
        port: 0,
        fetch: () =>
          new HTMLRewriter()
            .on("p", {
              async element(element) {
                await setImmediatePromise();
                element.setInnerContent("served");
              },
            })
            .transform(new Response("<p>x</p>")),
      });
      const res = await fetch(`http://localhost:${server.port}/`);
      expect(await res.text()).toBe("<p>served</p>");
      expect(res.status).toBe(200);
    });

    it("Bun.serve routes a rejecting async handler to the error() hook", async () => {
      const seen = Promise.withResolvers();
      await using server = Bun.serve({
        port: 0,
        error(e) {
          seen.resolve(e.message);
          return new Response("handled", { status: 500 });
        },
        fetch: () =>
          new HTMLRewriter()
            .on("p", {
              async element() {
                await setImmediatePromise();
                throw new Error("handler blew up");
              },
            })
            .transform(new Response("<p>x</p>")),
      });
      const res = await fetch(`http://localhost:${server.port}/`);
      expect(await seen.promise).toBe("handler blew up");
      expect({ body: await res.text(), status: res.status }).toEqual({ body: "handled", status: 500 });

      // The server keeps serving afterwards.
      const after = await fetch(`http://localhost:${server.port}/`);
      expect(after.status).toBe(500);
    });

    // The response body is still a pending/locked value when the client goes
    // away; the rewrite must still be allowed to finish (or fail) afterwards
    // without corrupting the RequestContext it was registered against, and the
    // server must keep working.
    it.concurrent.each(["resolves", "rejects"])(
      "client aborts while the handler is suspended, then the handler %s",
      async settle => {
        const suspended = Promise.withResolvers();
        const serverSawAbort = Promise.withResolvers();
        const gate = Promise.withResolvers();
        let handlerFinished = 0;

        await using server = Bun.serve({
          port: 0,
          async fetch(req) {
            if (new URL(req.url).pathname === "/after") return new Response("still alive");
            req.signal.addEventListener("abort", () => serverSawAbort.resolve());
            return new HTMLRewriter()
              .on("p", {
                async element(element) {
                  suspended.resolve();
                  await gate.promise;
                  element.setInnerContent("too late");
                  handlerFinished++;
                },
              })
              .transform(new Response("<p>original</p>"));
          },
        });

        const controller = new AbortController();
        const clientResult = fetch(`http://localhost:${server.port}/`, {
          signal: controller.signal,
        }).then(
          r => r.text(),
          e => e,
        );

        // Only abort once the handler has actually suspended the rewrite,
        // and only resume it once the server has observed the abort.
        await suspended.promise;
        controller.abort();
        const abortError = await clientResult;
        expect(abortError).toBeInstanceOf(DOMException);
        expect(abortError.name).toBe("AbortError");
        await serverSawAbort.promise;

        if (settle === "resolves") {
          gate.resolve();
        } else {
          gate.reject(new Error("handler failed after the client left"));
        }

        // The aborted request is gone; the server must still answer.
        const after = await fetch(`http://localhost:${server.port}/after`);
        expect(await after.text()).toBe("still alive");
        expect(handlerFinished).toBe(settle === "resolves" ? 1 : 0);
      },
    );
  });

  it("HTMLRewriter handles Symbol invalid type error", async () => {
    expect(() => new HTMLRewriter().transform(new Response(Symbol("ok")))).toThrow();
    expect(() => new HTMLRewriter().transform(Symbol("ok"))).toThrow();
  });

  describe("transform rejects when the upstream body fails", () => {
    // Sends response headers plus a partial HTML body, then resets the
    // connection once the test calls `release()`. The transformed body must
    // reject instead of resolving with a truncated document.
    const fullBody = "<div id=a><p>hello <b>world</b></p></div>";
    // Ties the rejection to the connection failure so an unrelated rejection
    // ("Body already used", an internal rewriter error) can't keep this green.
    // The exact RST message varies by platform, so match loosely.
    const connectionError = /socket|connection|ECONNRESET/i;

    async function withPartialBodyServer(fn) {
      let release;
      const released = new Promise(r => (release = r));
      const server = createTcpServer(socket => {
        socket.on("error", () => {});
        socket.write(
          "HTTP/1.1 200 OK\r\n" +
            "Content-Type: text/html\r\n" +
            `Content-Length: ${fullBody.length}\r\n` +
            "\r\n" +
            fullBody.slice(0, 30),
        );
        released.then(() => socket.resetAndDestroy());
      });
      server.listen(0);
      await once(server, "listening");
      try {
        await fn(`http://127.0.0.1:${server.address().port}/`, release);
      } finally {
        release();
        await new Promise(r => server.close(r));
      }
    }

    function rewriter() {
      return new HTMLRewriter().on("p", {
        element(e) {
          e.setAttribute("seen", "1");
        },
      });
    }

    // Reports either settlement so a failing test shows the truncated
    // document that was wrongly produced instead of just "did not reject".
    function settle(promise) {
      return promise.then(
        value => ({ rejected: false, value }),
        error => ({ rejected: true, message: String(error?.message) }),
      );
    }
    const rejectedWithConnectionError = {
      rejected: true,
      message: expect.stringMatching(connectionError),
    };

    it("control: .text() on the untransformed response rejects", async () => {
      await withPartialBodyServer(async (url, release) => {
        const res = await fetch(url);
        const text = res.text();
        release();
        await expect(text).rejects.toThrow(connectionError);
      });
    });

    it(".text() on the transformed response rejects", async () => {
      await withPartialBodyServer(async (url, release) => {
        const res = await fetch(url);
        const transformed = rewriter().transform(res);
        const text = settle(transformed.text());
        release();
        // Must reject with the upstream connection error, and must never
        // resolve with the truncated document.
        expect(await text).toEqual(rejectedWithConnectionError);
        // The body is now in its error state. A second read must report the
        // same failure, not resolve as an empty "successful" document.
        expect(await settle(transformed.text())).toEqual(rejectedWithConnectionError);
      });
    });

    it(".arrayBuffer() on the transformed response rejects", async () => {
      await withPartialBodyServer(async (url, release) => {
        const res = await fetch(url);
        const buf = rewriter().transform(res).arrayBuffer();
        release();
        await expect(buf).rejects.toThrow(connectionError);
      });
    });

    it(".body on the transformed response is an errored stream", async () => {
      await withPartialBodyServer(async (url, release) => {
        const res = await fetch(url);
        const transformed = rewriter().transform(res);
        const text = settle(transformed.text());
        release();
        // Barrier: once this has rejected, the body is in its error state.
        expect(await text).toEqual(rejectedWithConnectionError);
        // Reading `.body` must reject with the same upstream error instead of
        // closing cleanly as an empty "successful" document.
        expect(await settle(transformed.body.getReader().read())).toEqual(rejectedWithConnectionError);
      });
    });

    it("a read already pending on .body when the upstream fails rejects", async () => {
      await withPartialBodyServer(async (url, release) => {
        const res = await fetch(url);
        const transformed = rewriter().transform(res);
        // Start the read BEFORE the upstream fails. This is the one shape
        // (readable attached, no pending promise) where the error must reach
        // the attached stream; discarding it would strand this read forever.
        const read = settle(transformed.body.getReader().read());
        release();
        expect(await read).toEqual(rejectedWithConnectionError);
      });
    });

    it(".clone() of a failed transformed body is also failed", async () => {
      await withPartialBodyServer(async (url, release) => {
        const res = await fetch(url);
        const transformed = rewriter().transform(res);
        const text = settle(transformed.text());
        release();
        // Barrier: the body is now in its error state.
        expect(await text).toEqual(rejectedWithConnectionError);
        // Cloning a failed body must produce a failed body, not an empty one
        // that reads back as a complete (and empty) document.
        expect(await settle(transformed.clone().text())).toEqual(rejectedWithConnectionError);
      });
    });

    it("does not invoke onDocument end for a document that never completed", async () => {
      // Sanity: end() fires exactly once on a complete document.
      {
        let endCalls = 0;
        new HTMLRewriter()
          .onDocument({
            end() {
              endCalls++;
            },
          })
          .transform(fullBody);
        expect(endCalls).toBe(1);
      }

      await withPartialBodyServer(async (url, release) => {
        let endCalls = 0;
        const rw = rewriter().onDocument({
          end() {
            endCalls++;
          },
        });
        const res = await fetch(url);
        const text = rw.transform(res).text();
        release();
        await expect(text).rejects.toThrow(connectionError);
        expect(endCalls).toBe(0);
      });
    });

    it("transform() of a body that already failed throws the upstream error", async () => {
      // Same failure class, synchronous path: once the body is already in its
      // error state, transform() must throw the upstream connection error,
      // not an unrelated (and usually empty) HTMLRewriter internal error.
      await withPartialBodyServer(async (url, release) => {
        const res = await fetch(url);
        const text = res.text();
        release();
        // Awaiting the rejection is the barrier: the body is now Value::Error.
        await expect(text).rejects.toThrow(connectionError);
        expect(() => rewriter().transform(res)).toThrow(connectionError);
      });
    });

    it("transform() of an aborted body throws the abort reason", async () => {
      // An abort reason is a DOMException, not a JSC ErrorInstance. transform()
      // must still throw it rather than returning it in place of the Response.
      await withPartialBodyServer(async url => {
        const controller = new AbortController();
        const res = await fetch(url, { signal: controller.signal });
        // The body is mid-stream (the server is stalled until release()).
        const text = res.text();
        controller.abort();
        await expect(text).rejects.toThrow(/abort/i);
        let thrown;
        try {
          rewriter().transform(res);
        } catch (e) {
          thrown = e;
        }
        expect({ name: thrown?.name, threw: thrown !== undefined }).toEqual({
          name: "AbortError",
          threw: true,
        });
      });
    });
  });

  it("HTMLRewriter: async replacement using fetch + Bun.serve", async () => {
    await gcTick();
    let content;
    {
      using contentServer = Bun.serve({
        port: 0,
        fetch(req) {
          return new Response("<h1>Hello from content server</h1>", {
            headers: { "Content-Type": "text/html" },
          });
        },
      });

      using server = Bun.serve({
        port: 0,
        fetch(req) {
          return new HTMLRewriter()
            .on("div", {
              async element(element) {
                content = await fetch(`http://localhost:${contentServer.port}/`).then(res => res.text());
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
    const filePath = join(tmpdirSync(), "html-rewriter.txt.js");
    await Bun.write(filePath, "<div>hello</div>");
    var output = rewriter.transform(new Response(Bun.file(filePath)));
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

  it("attribute iterator is detached after handler returns", async () => {
    // The lol-html attribute iterator borrows from the element's attribute
    // buffer, which is freed when the handler returns. Previously we leaked
    // the raw iterator pointer to JS, so calling .next() after the transform
    // read freed memory. Now the iterator is detached and reports done.
    let leaked;
    let partiallyConsumed;
    const inside = [];
    await new HTMLRewriter()
      .on("div", {
        element(el) {
          // A fresh iterator leaked without being touched.
          leaked = el.attributes;
          // A second iterator fully consumed inside the handler must still work.
          for (const pair of el.attributes) inside.push(pair);
          // A third iterator partially consumed then leaked.
          partiallyConsumed = el.attributes;
          partiallyConsumed.next();
        },
      })
      .transform(new Response('<div a="1" b="2" c="3"></div>'))
      .text();

    expect(inside).toEqual([
      ["a", "1"],
      ["b", "2"],
      ["c", "3"],
    ]);

    expect(leaked.next()).toEqual({ done: true, value: undefined });
    expect(partiallyConsumed.next()).toEqual({ done: true, value: undefined });
    // for..of over a detached iterator should simply not iterate.
    expect([...leaked]).toEqual([]);
  });

  it("attribute iterator is detached when attributes are mutated", async () => {
    // setAttribute pushes onto the backing Vec<Attribute> (possible realloc);
    // removeAttribute shifts elements. Either invalidates a live slice::Iter.
    let afterSet, afterRemove;
    let fresh = [];
    await new HTMLRewriter()
      .on("div", {
        element(el) {
          const it1 = el.attributes;
          el.setAttribute("x", "9");
          afterSet = it1.next();

          const it2 = el.attributes;
          el.removeAttribute("a");
          afterRemove = it2.next();

          // An iterator obtained after the mutations still sees the final state.
          fresh = [...el.attributes];
        },
      })
      .transform(new Response('<div a="1" b="2" c="3"></div>'))
      .text();

    expect(afterSet).toEqual({ done: true, value: undefined });
    expect(afterRemove).toEqual({ done: true, value: undefined });
    expect(fresh).toEqual([
      ["b", "2"],
      ["c", "3"],
      ["x", "9"],
    ]);
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

  const commentMutationsMacro = async func => {
    // before/after
    let res = func(new HTMLRewriter(), comment => {
      comment.before("<span>before</span>");
      comment.before("<span>before html</span>", { html: true });
      comment.after("<span>after</span>");
      comment.after("<span>after html</span>", { html: true });
    }).transform(new Response(commentsMutationsInput));
    expect(await res.text()).toBe(commentsMutationsExpected.beforeAfter);

    // replace
    res = func(new HTMLRewriter(), comment => {
      comment.replace("<span>replace</span>");
    }).transform(new Response(commentsMutationsInput));
    expect(await res.text()).toBe(commentsMutationsExpected.replace);
    res = func(new HTMLRewriter(), comment => {
      comment.replace("<span>replace</span>", { html: true });
    }).transform(new Response(commentsMutationsInput));
    expect(await res.text()).toBe(commentsMutationsExpected.replaceHtml);

    // remove
    res = func(new HTMLRewriter(), comment => {
      expect(comment.removed).toBe(false);
      comment.remove();
      expect(comment.removed).toBe(true);
    }).transform(new Response(commentsMutationsInput));
    expect(await res.text()).toBe(commentsMutationsExpected.remove);
  };

  it("HTMLRewriter: handles comment mutations", () =>
    commentMutationsMacro((rw, comments) => {
      rw.on("p", { comments });
      return rw;
    }));

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
    ...tls,
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

// lol-html reports an absent attribute with a NULL pointer and a
// present-but-empty one with an empty string; they are not the same thing.
describe("getAttribute distinguishes empty from absent", () => {
  it("returns '' for present-but-empty and boolean attributes", async () => {
    let got;
    await new HTMLRewriter()
      .on("div", {
        element(el) {
          got = {
            explicitEmpty: el.getAttribute("a"),
            boolean: el.getAttribute("b"),
            valued: el.getAttribute("c"),
            absent: el.getAttribute("zzz"),
            hasExplicitEmpty: el.hasAttribute("a"),
            hasBoolean: el.hasAttribute("b"),
            hasAbsent: el.hasAttribute("zzz"),
          };
        },
      })
      .transform(new Response('<div a="" b c="v">t</div>'))
      .text();
    expect(got).toEqual({
      explicitEmpty: "",
      boolean: "",
      valued: "v",
      absent: null,
      hasExplicitEmpty: true,
      hasBoolean: true,
      hasAbsent: false,
    });
  });

  it("agrees with the attributes iterator", async () => {
    let got;
    await new HTMLRewriter()
      .on("div", {
        element(el) {
          got = { iter: [...el.attributes], get: el.getAttribute("a") };
        },
      })
      .transform(new Response('<div a="">t</div>'))
      .text();
    expect(got).toEqual({ iter: [["a", ""]], get: "" });
  });

  it("round-trips an attribute set to the empty string", async () => {
    let got;
    await new HTMLRewriter()
      .on("div", {
        element(el) {
          el.setAttribute("x", "");
          got = { value: el.getAttribute("x"), has: el.hasAttribute("x") };
        },
      })
      .transform(new Response("<div>t</div>"))
      .text();
    expect(got).toEqual({ value: "", has: true });
  });

  it("removeAttribute works on a present-but-empty attribute", async () => {
    let got;
    await new HTMLRewriter()
      .on("div", {
        element(el) {
          el.removeAttribute("a");
          got = { value: el.getAttribute("a"), has: el.hasAttribute("a") };
        },
      })
      .transform(new Response('<div a="">t</div>'))
      .text();
    expect(got).toEqual({ value: null, has: false });
  });
});

describe("doctype publicId/systemId distinguish empty from absent", () => {
  function readDoctype(html) {
    let got;
    new HTMLRewriter()
      .onDocument({
        doctype(d) {
          got = { name: d.name, publicId: d.publicId, systemId: d.systemId };
        },
      })
      .transform(html);
    return got;
  }

  it("present but empty", () => {
    expect(readDoctype('<!DOCTYPE html PUBLIC "" ""><div></div>')).toEqual({
      name: "html",
      publicId: "",
      systemId: "",
    });
  });

  it("absent", () => {
    expect(readDoctype("<!DOCTYPE html><div></div>")).toEqual({
      name: "html",
      publicId: null,
      systemId: null,
    });
  });

  it("present with values", () => {
    expect(
      readDoctype(
        '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN" "http://www.w3.org/TR/html4/strict.dtd"><div></div>',
      ),
    ).toEqual({
      name: "html",
      publicId: "-//W3C//DTD HTML 4.01//EN",
      systemId: "http://www.w3.org/TR/html4/strict.dtd",
    });
  });
});

describe("invalid arguments throw instead of returning an error value", () => {
  it("setAttribute with a forbidden character in the name rejects the body", async () => {
    const res = new HTMLRewriter()
      .on("div", {
        element(el) {
          el.setAttribute("a b", "1");
        },
      })
      .transform(new Response("<div>t</div>"));
    await expect(res.text()).rejects.toThrow("character is forbidden in the attribute name");
  });

  it("setAttribute with an empty name rejects the body", async () => {
    const res = new HTMLRewriter()
      .on("div", {
        element(el) {
          el.setAttribute("", "1");
        },
      })
      .transform(new Response("<div>t</div>"));
    await expect(res.text()).rejects.toThrow("Attribute name can't be empty.");
  });

  it("setAttribute failure leaves the element unchanged", async () => {
    let after;
    const out = await new HTMLRewriter()
      .on("div", {
        element(el) {
          try {
            el.setAttribute("a b", "1");
          } catch {}
          after = [...el.attributes];
        },
      })
      .transform(new Response('<div x="1">t</div>'))
      .text();
    expect(after).toEqual([["x", "1"]]);
    expect(out).toBe('<div x="1">t</div>');
  });

  it("setAttribute with an invalid name throws on string input too", () => {
    expect(() =>
      new HTMLRewriter()
        .on("div", {
          element(el) {
            el.setAttribute("a b", "1");
          },
        })
        .transform("<div>t</div>"),
    ).toThrow("character is forbidden in the attribute name");
  });

  it("onEndTag with a non-function rejects the body with a TypeError", async () => {
    const res = new HTMLRewriter()
      .on("div", {
        element(el) {
          el.onEndTag("nope");
        },
      })
      .transform(new Response("<div>t</div>"));
    const err = await res.text().then(
      () => null,
      e => e,
    );
    expect(err).toBeInstanceOf(TypeError);
    expect(err.message).toBe("Expected a function");
  });
});

describe("tagName, endTag.name, and comment.text setters", () => {
  it("element.tagName renames the start and end tag", () => {
    const out = new HTMLRewriter()
      .on("p", {
        element(el) {
          el.tagName = "section";
        },
      })
      .transform("<p>hi</p>");
    expect(out).toBe("<section>hi</section>");
  });

  it("endTag.name renames only the closing tag", () => {
    const out = new HTMLRewriter()
      .on("p", {
        element(el) {
          el.onEndTag(end => {
            end.name = "div";
          });
        },
      })
      .transform("<p>hi</p>");
    expect(out).toBe("<p>hi</div>");
  });

  it("the assigned value is coerced with ToString, which may re-enter the wrapper", () => {
    const out = new HTMLRewriter()
      .on("p", {
        comments(comment) {
          comment.text = {
            toString() {
              comment.before("A");
              return "B";
            },
          };
        },
      })
      .transform("<p><!--x--></p>");
    expect(out).toBe("<p>A<!--B--></p>");
  });

  it("setters on a detached wrapper are a no-op and never coerce the value", () => {
    let savedElement;
    let savedEndTag;
    let savedComment;
    const out = new HTMLRewriter()
      .on("p", {
        element(el) {
          savedElement = el;
          el.onEndTag(end => {
            savedEndTag = end;
          });
        },
        comments(c) {
          savedComment = c;
        },
      })
      .transform("<p><!--x--></p>");
    expect(out).toBe("<p><!--x--></p>");

    // Every handler has returned, so every wrapper is detached; each setter
    // must return before running the assigned value's toString.
    const coerced = [];
    const probe = tag => ({
      toString() {
        coerced.push(tag);
        return "never";
      },
    });
    savedElement.tagName = probe("element.tagName");
    savedEndTag.name = probe("endTag.name");
    savedComment.text = probe("comment.text");
    expect(coerced).toEqual([]);
    expect(savedElement.tagName).toBeUndefined();
    expect(savedEndTag.name).toBeUndefined();
    expect(savedComment.text).toBeNull();
  });
});
