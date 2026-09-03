import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { once } from "events";
import fs from "fs";
import {
  bunEnv,
  bunExe,
  gcTick,
  isASAN,
  isDebug,
  isWindows,
  tempDir,
  tempDirWithFiles,
  tls,
  tmpdirSync,
} from "harness";
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

  // Inputs that go through the JS stream pump with data already queued are
  // drained synchronously inside `transform()`, so the handler throws (and the
  // pipe fails, detaching its input) while `assign_to_stream` is still on the
  // stack. The pump controller must already be installed as the pipe's input
  // source at that point: previously the pipe detached an empty placeholder
  // and the process segfaulted. Detaching the real controller is also what
  // cancels the input, as it does when the throwing chunk arrives later.
  // Spawned so a regression shows up as a failed assertion instead of taking
  // the test runner down.
  it("error inside element handler rejects the body when the input is drained inside transform()", async () => {
    const fixture = /* js */ `
      const html = "<a href=/x>abc</a>";
      const bytes = () => new TextEncoder().encode(html);
      let upstreamCancels = 0;
      const inputs = {
        "Response(string) whose .body was read": () => {
          const res = new Response(html);
          void res.body;
          return res;
        },
        "Response(Blob) whose .body was read": () => {
          const res = new Response(new Blob([html]));
          void res.body;
          return res;
        },
        "ReadableStream with a string queued in start()": () =>
          new Response(new ReadableStream({ start(c) { c.enqueue(html); c.close(); } })),
        "ReadableStream with bytes queued in start()": () =>
          new Response(new ReadableStream({ start(c) { c.enqueue(bytes()); c.close(); } })),
        "bytes ReadableStream with a chunk queued in start()": () =>
          new Response(new ReadableStream({ type: "bytes", start(c) { c.enqueue(bytes()); c.close(); } })),
        "direct ReadableStream writing synchronously from pull()": () =>
          new Response(new ReadableStream({ type: "direct", pull(c) { c.write(html); c.close(); } })),
        "still-open ReadableStream with a chunk queued in start()": () =>
          new Response(new ReadableStream({ start(c) { c.enqueue(html); }, cancel() { upstreamCancels++; } })),
      };
      for (const [name, input] of Object.entries(inputs)) {
        const out = new HTMLRewriter()
          .on("a", {
            element() {
              throw new Error("handler threw");
            },
          })
          .transform(input());
        const outcome = await out.text().then(
          text => "resolved with " + JSON.stringify(text),
          err => "rejected with " + err.message,
        );
        // Sweep the pump controller too: it must have been detached from the
        // failed pipe rather than left pointing at it.
        Bun.gc(true);
        console.log(name + ": " + outcome);
      }
      console.log("still-open input cancelled " + upstreamCancels + " time(s)");
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe(
      [
        "Response(string) whose .body was read: rejected with handler threw",
        "Response(Blob) whose .body was read: rejected with handler threw",
        "ReadableStream with a string queued in start(): rejected with handler threw",
        "ReadableStream with bytes queued in start(): rejected with handler threw",
        "bytes ReadableStream with a chunk queued in start(): rejected with handler threw",
        "direct ReadableStream writing synchronously from pull(): rejected with handler threw",
        "still-open ReadableStream with a chunk queued in start(): rejected with handler threw",
        "still-open input cancelled 1 time(s)",
        "",
      ].join("\n"),
    );
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  // A direct stream's pull() receives the pump controller itself, so user code
  // can hand it to an API that roots its argument with gcProtect (another
  // rewriter's .on() does). The pipe never protects the controller, so when a
  // failing rewrite detaches it, the detach must not gcUnprotect it either:
  // that cancelled the other holder's root and the next GC collected the
  // controller out from under it. The unreferenced run shows the controller
  // is otherwise collectable, so "alive" below really is the holder's root.
  it("detaching the pump controller of a failed rewrite keeps a gcProtect held elsewhere on it", async () => {
    const fixture = /* js */ `
      const holder = new HTMLRewriter();
      async function failedRewrite(handToHolder) {
        let ref;
        const input = new Response(
          new ReadableStream({
            type: "direct",
            pull(controller) {
              ref = new WeakRef(controller);
              if (handToHolder) holder.on("*", controller);
              // The element handler below throws inside this write, so the pipe
              // fails and detaches the controller while it is still attached.
              controller.write("<p>x</p>");
            },
          }),
        );
        const out = new HTMLRewriter()
          .on("p", {
            element() {
              throw new Error("handler threw");
            },
          })
          .transform(input);
        const outcome = await out.text().then(
          () => "resolved",
          err => "rejected with " + err.message,
        );
        return { ref, outcome };
      }
      for (const handToHolder of [false, true]) {
        const { ref, outcome } = await failedRewrite(handToHolder);
        for (let i = 0; i < 3; i++) {
          await new Promise(resolve => setImmediate(resolve));
          Bun.gc(true);
        }
        const liveness = ref.deref() === undefined ? "collected" : "alive";
        console.log((handToHolder ? "handed to holder.on()" : "unreferenced") + ": " + outcome + ", controller " + liveness);
      }
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe(
      [
        "unreferenced: rejected with handler threw, controller collected",
        "handed to holder.on(): rejected with handler threw, controller alive",
        "",
      ].join("\n"),
    );
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
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

    // `new Response(new ReadableStream({...}))` — the JS-source input path
    // (#11758/#14216): the rewrite must pump the JS stream through the sink
    // and an async handler can suspend mid-stream.
    it("a JS ReadableStream input with an async handler", async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue(encoder.encode("<html><body>"));
          await setImmediatePromise();
          controller.enqueue(encoder.encode("<p>old</p>"));
          await setImmediatePromise();
          controller.enqueue(encoder.encode("</body></html>"));
          controller.close();
        },
      });
      const res = new HTMLRewriter()
        .on("p", {
          async element(element) {
            await setImmediatePromise();
            element.setInnerContent("new");
          },
        })
        .transform(new Response(stream));
      expect(await res.text()).toBe("<html><body><p>new</p></body></html>");
    });

    // `rsisAbrupt` calls `controller.close(error)` synchronously before
    // rejecting the pump promise. The pipe must defer its terminal step to the
    // reject reaction so the real error reaches the output body instead of
    // resolving with truncated HTML.
    it.each(["default", "pull"])(
      "a JS ReadableStream (%s) input that errors mid-stream rejects the body",
      async kind => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream(
          kind === "pull"
            ? {
                pulls: 0,
                pull(controller) {
                  if (this.pulls++ === 0) return controller.enqueue(encoder.encode("<p>partial"));
                  controller.error(new Error("upstream boom"));
                },
              }
            : {
                async start(controller) {
                  controller.enqueue(encoder.encode("<p>partial"));
                  await setImmediatePromise();
                  controller.error(new Error("upstream boom"));
                },
              },
        );
        const res = new HTMLRewriter().on("p", { element() {} }).transform(new Response(stream));
        await expect(res.text()).rejects.toThrow("upstream boom");
      },
    );

    // The input is already errored when transform() runs: the pump's first
    // read throws, so `controller.close(error)` and the pump rejection both
    // happen inside transform(), before any reject reaction is attached. The
    // close must carry the error to the pipe, or the body resolves to "".
    // `error()` with no reason errors the stream with `undefined`; that must
    // not read as a clean close either.
    it.each([
      ["an Error", new Error("upstream boom")],
      ["undefined", undefined],
    ])("a JS ReadableStream input that is already errored (%s) rejects the body", async (_, reason) => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode("<p>partial"));
          controller.error(reason);
        },
      });
      const res = new HTMLRewriter().on("p", { element() {} }).transform(new Response(stream));
      const settled = await res.text().then(
        text => ({ resolved: text }),
        err => ({ rejected: err }),
      );
      expect(settled).toEqual({ rejected: reason });
    });

    // A `type: 'direct'` pull() ends the input through the sink controller's
    // own `close(error?)`. The argument is optional: a falsy one is the same
    // clean close as `close()` and the body resolves with the rewritten HTML.
    // Only a truthy error fails the rewrite.
    it.each([
      ["close()", c => c.close(), { resolved: "<p>hello</p>" }],
      ["close(undefined)", c => c.close(undefined), { resolved: "<p>hello</p>" }],
      ["close(null)", c => c.close(null), { resolved: "<p>hello</p>" }],
      ["close(false)", c => c.close(false), { resolved: "<p>hello</p>" }],
      ['close("")', c => c.close(""), { resolved: "<p>hello</p>" }],
      ["close(error)", c => c.close(new Error("source boom")), { rejected: "source boom" }],
    ])("a direct ReadableStream input whose pull() ends with %s", async (_, close, expected) => {
      const stream = new ReadableStream({
        type: "direct",
        pull(controller) {
          controller.write("<p>hello</p>");
          close(controller);
        },
      });
      const res = new HTMLRewriter().on("p", { element() {} }).transform(new Response(stream));
      const settled = await res.text().then(
        text => ({ resolved: text }),
        err => ({ rejected: err instanceof Error ? err.message : err }),
      );
      expect(settled).toEqual(expected);
    });

    // A `type: 'direct'` source whose `pull()` throws synchronously leaves the
    // JS controller's `m_sinkPtr` set after `readDirectStream` returns with an
    // exception; `end_from_stream` must null it (via `JSSink::detach`) before
    // the pipe can be freed so the controller's destructor doesn't dispatch
    // into freed memory.
    it("a direct ReadableStream whose pull() throws synchronously rejects the body", async () => {
      for (let i = 0; i < 4; i++) {
        const stream = new ReadableStream({
          type: "direct",
          pull() {
            throw new Error("pull threw");
          },
        });
        const res = new HTMLRewriter().on("p", { element() {} }).transform(new Response(stream));
        await expect(res.text()).rejects.toThrow("pull threw");
        Bun.gc(true);
      }
    });

    // `fail()` must settle the `WritablePending` slot so a direct `pull()`
    // parked on `await controller.flush(true)` resumes, letting the pump
    // promise settle and release the input `+1` (`cancel_from_output`
    // already did this; `fail()` didn't).
    it("a direct ReadableStream parked on flush(true) is released when the handler rejects", async () => {
      let afterFlush = 0;
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        type: "direct",
        async pull(controller) {
          controller.write(encoder.encode("<p>x</p>"));
          await controller.flush(true);
          afterFlush++;
          controller.close();
        },
      });
      const res = new HTMLRewriter()
        .on("p", {
          async element() {
            await setImmediatePromise();
            throw new Error("handler rejected");
          },
        })
        .transform(new Response(stream));
      await expect(res.text()).rejects.toThrow("handler rejected");
      await setImmediatePromise();
      expect(afterFlush).toBe(1);
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
      ["process.nextTick", r => process.nextTick(r)],
      ["queueMicrotask", r => queueMicrotask(r)],
    ]) {
      it(`transform(string) stays synchronous for a handler awaiting ${label}`, () => {
        const out = new HTMLRewriter()
          .on("div", {
            async element(element) {
              await new Promise(schedule);
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

      // `Value::tee` realises the pending body as a ByteStream via
      // on_start_streaming/on_readable_stream_available, then tees it; the
      // rewrite keeps feeding that ByteStream, so both branches drain.
      it(".clone() delivers the transformed bytes to both branches", async () => {
        const res = suspending();
        const clone = res.clone();
        const [cloneText, originalText] = await Promise.all([clone.text(), res.text()]);
        expect(cloneText).toBe("<p>new</p>");
        expect(originalText).toBe("<p>new</p>");
      });

      it("Bun.write(file, res)", async () => {
        using dir = tempDir("hr-pending-body", {});
        const out = path.join(String(dir), "out.html");
        await Bun.write(out, suspending());
        expect(await Bun.file(out).text()).toBe("<p>new</p>");
      });
    });

    // Same as above, but the rewriter has already produced output (the `<a>`)
    // by the time the handler suspends. Nothing is consuming the body yet, so
    // those bytes sit in the rewriter's own buffer; the stream that `.body` or
    // `.clone()` creates afterwards has to be seeded with them, or the output
    // would start at `<p>`. Both consumers are attached before the handler
    // resumes.
    describe("output produced before the rewrite suspended reaches a stream created later", () => {
      const expected = "<a>first</a><p>new</p>";
      const suspending = () =>
        new HTMLRewriter()
          .on("p", {
            async element(element) {
              await setImmediatePromise();
              element.setInnerContent("new");
            },
          })
          .transform(new Response("<a>first</a><p>old</p>"));

      it(".body", async () => {
        expect(await suspending().body.text()).toBe(expected);
      });

      it(".clone() seeds both branches", async () => {
        const res = suspending();
        const clone = res.clone();
        expect(await Promise.all([res.text(), clone.text()])).toEqual([expected, expected]);
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

    // Same shape through the two async error() arms: the original streaming
    // Response is still protected when its producer fails before the first
    // byte, and each arm must release it before installing the replacement.
    it.concurrent.each(["settled", "awaiting"])(
      "Bun.serve routes a rejecting async handler to an async error() hook (%s)",
      async kind => {
        const seen = Promise.withResolvers();
        await using server = Bun.serve({
          port: 0,
          async error(e) {
            seen.resolve(e.message);
            if (kind === "awaiting") await setImmediatePromise();
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
      },
    );

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
        const handlerDone = Promise.withResolvers();
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
                  handlerDone.resolve();
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
          await handlerDone.promise;
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
        error => ({ rejected: true, name: error?.name, message: String(error?.message) }),
      );
    }
    const rejectedWithConnectionError = {
      rejected: true,
      name: "TypeError",
      message: expect.stringMatching(connectionError),
    };
    const rejectedWithBodyAlreadyUsed = {
      rejected: true,
      name: "TypeError",
      message: "Body already used",
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
        // The failed read consumed the body; a second read must reject as
        // already-used, not resolve as an empty "successful" document.
        expect(await settle(transformed.text())).toEqual(rejectedWithBodyAlreadyUsed);
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

    it(".body on the transformed response is unusable after a failed read", async () => {
      await withPartialBodyServer(async (url, release) => {
        const res = await fetch(url);
        const transformed = rewriter().transform(res);
        const text = settle(transformed.text());
        release();
        // Barrier: once this has rejected, the body has been consumed.
        expect(await text).toEqual(rejectedWithConnectionError);
        // `.body` must surface the consumed state, not close cleanly as an
        // empty "successful" document. The pending-reader-before-failure case
        // is covered by the test below.
        expect(() => transformed.body.getReader()).toThrow(
          expect.objectContaining({ name: "TypeError", code: "ERR_INVALID_STATE" }),
        );
      });
    });

    it("a read already pending on .body when the upstream fails rejects", async () => {
      await withPartialBodyServer(async (url, release) => {
        const res = await fetch(url);
        const transformed = rewriter().transform(res);
        // Start reading BEFORE the upstream fails. This is the one shape
        // (readable attached, no pending promise) where the error must reach
        // the attached stream; discarding it would strand a read forever.
        // Streaming may deliver the partial rewritten output before the
        // upstream error arrives — drain any such chunks; the error must then
        // reach this reader (not close cleanly, not hang).
        const reader = transformed.body.getReader();
        release();
        let result;
        do {
          result = await settle(reader.read());
        } while (!result.rejected && !result.value.done);
        expect(result).toEqual(rejectedWithConnectionError);
      });
    });

    it(".clone() after a failed read throws", async () => {
      await withPartialBodyServer(async (url, release) => {
        const res = await fetch(url);
        const transformed = rewriter().transform(res);
        const text = settle(transformed.text());
        release();
        // Barrier: the body has now been consumed by the failed read.
        expect(await text).toEqual(rejectedWithConnectionError);
        // A disturbed body is not clonable; it must not read back as a
        // complete (and empty) document.
        expect(() => transformed.clone()).toThrow("Body is disturbed or locked");
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
        // Drain via a clone so `res` itself stays undisturbed while we wait
        // for the upstream failure to land.
        const barrier = res.clone().arrayBuffer();
        release();
        await expect(barrier).rejects.toThrow(connectionError);
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
        const barrier = res.clone().arrayBuffer();
        controller.abort();
        await expect(barrier).rejects.toThrow(/abort/i);
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

// An async handler suspends mid-input; once resumed it emits more output than
// RewriterPipe's high-water mark (16 KiB) into the already-realised ByteStream
// and parks on output backpressure with `input_ended` set. Wiring a native sink
// afterwards must re-signal the rewriter once the buffered bytes are in the
// sink so `end_rewrite` runs.
describe("output ByteStream backpressured when a native sink is wired", () => {
  const prefix = "<p>" + Buffer.alloc(100, "A").toString() + "</p>";
  const suffix = "<q>" + Buffer.alloc(30_000, "B").toString() + "</q>";
  const html = prefix + "<x></x>" + suffix;
  const out = prefix + "<x>!</x>" + suffix;

  // Return a ReadableStream whose ByteStream buffer already holds the full
  // rewritten output while the rewriter itself is still parked on
  // `output_backpressured()` with `input_ended = true`.
  async function makeParked() {
    const gate = Promise.withResolvers();
    const res = new HTMLRewriter()
      .on("x", {
        element: e => {
          e.setInnerContent("!");
          return gate.promise;
        },
      })
      .transform(new Response(html));
    const body = res.body;
    gate.resolve();
    // Let the handler-promise reaction run so `resume_rewrite` emits `suffix`
    // into the ByteStream buffer.
    await 0;
    return { body, res };
  }

  it("completes when wired to a second HTMLRewriter", async () => {
    const { body } = await makeParked();
    const text = await new HTMLRewriter().transform(new Response(body)).text();
    expect(text).toBe(out);
  });

  it("completes when wired to a second HTMLRewriter via the Response", async () => {
    const { res } = await makeParked();
    const text = await new HTMLRewriter().transform(res).text();
    expect(text).toBe(out);
  });

  it("delivers bytes in order", async () => {
    const { body } = await makeParked();
    let seen = "";
    await new HTMLRewriter()
      .onDocument({ text: t => void (seen += t.text) })
      .transform(new Response(body))
      .text();
    expect(seen).toBe(prefix.slice(3, -4) + "!" + suffix.slice(3, -4));
  });

  it("completes when returned from Bun.serve", async () => {
    await using server = Bun.serve({
      port: 0,
      fetch: async () => {
        const { body } = await makeParked();
        return new Response(body);
      },
    });
    const text = await (await fetch(server.url)).text();
    expect(text).toBe(out);
  });

  it("completes when the Response is returned from Bun.serve", async () => {
    await using server = Bun.serve({
      port: 0,
      fetch: async () => (await makeParked()).res,
    });
    const text = await (await fetch(server.url)).text();
    expect(text).toBe(out);
  });

  it("completes when read via .arrayBuffer()", async () => {
    const { body } = await makeParked();
    const buf = await new Response(body).arrayBuffer();
    expect(Buffer.from(buf).toString()).toBe(out);
  });

  it("completes when read via .text()", async () => {
    const { body } = await makeParked();
    expect(await new Response(body).text()).toBe(out);
  });

  it("completes when used as Bun.spawn stdin", async () => {
    const { body } = await makeParked();
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "process.stdout.write(await Bun.stdin.text())"],
      env: bunEnv,
      stdin: body,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe(out);
    expect(exitCode).toBe(0);
  });

  // Streaming input, `input_ended=false`: the handler itself emits the >16 KiB
  // output chunk, and the direct-stream's `pull()` is parked on `flush(true)`
  // with more bytes to write. `signal_drained()` must wake the rewriter into
  // `drain_pending_input()`'s upstream-`src.ready()` + `pending.run()` tail
  // so the direct stream's second `c.write()` is delivered.
  const streamed = prefix + "<x>" + suffix.slice(3, -4) + "</x>" + suffix;
  async function makeParkedStreaming() {
    const gate = Promise.withResolvers();
    const input = new ReadableStream({
      type: "direct",
      async pull(c) {
        c.write("<x></x>");
        await c.flush(true);
        c.write(suffix);
        c.close();
      },
    });
    const res = new HTMLRewriter()
      .on("x", {
        element: e => {
          e.before(prefix, { html: true });
          e.setInnerContent(suffix.slice(3, -4));
          return gate.promise;
        },
      })
      .transform(new Response(input));
    const body = res.body;
    gate.resolve();
    await 0;
    return { body };
  }

  it("completes with a streaming input (second HTMLRewriter)", async () => {
    const { body } = await makeParkedStreaming();
    const text = await new HTMLRewriter().transform(new Response(body)).text();
    expect(text).toBe(streamed);
  });

  it("completes with a streaming input (Bun.serve)", async () => {
    await using server = Bun.serve({
      port: 0,
      fetch: async () => new Response((await makeParkedStreaming()).body),
    });
    const text = await (await fetch(server.url)).text();
    expect(text).toBe(streamed);
  });

  it("completes with a streaming input (.text())", async () => {
    const { body } = await makeParkedStreaming();
    expect(await new Response(body).text()).toBe(streamed);
  });

  it("completes when read with a JS reader", async () => {
    const { body } = await makeParked();
    const reader = body.getReader();
    const chunks = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    expect(Buffer.concat(chunks).toString()).toBe(out);
  });
});

// A streamed input (file, fetch body, ReadableStream) is paced by the output's
// reader: `transform()` itself feeds at most one upstream chunk, a reader that
// falls behind holds the input, and with no reader at all the rewrite still
// runs to completion from the event loop, one chunk per turn.
describe("streamed input pacing", () => {
  const text = Buffer.alloc(1000, "a").toString();
  const piece = `<p>${text}</p>`;
  const count = 2500; // ~2.4 MB of input: many upstream chunks
  const input = Buffer.alloc(piece.length * count, piece).toString();
  const rewritten = Buffer.alloc((piece.length + 6) * count, `<p x="1">${text}</p>`).toString();
  // A second document made of different bytes, for the tests below that read
  // it while another document is being parsed: if that read lands in the
  // other document's buffer, these bytes show up in its output.
  const otherText = Buffer.alloc(1000, "b").toString();
  const otherPiece = `<p>${otherText}</p>`;
  const otherRewritten = Buffer.alloc((otherPiece.length + 6) * count, `<p x="1">${otherText}</p>`).toString();
  const dir = tempDirWithFiles("hr-pacing", {
    "in.html": input,
    "other.html": Buffer.alloc(otherPiece.length * count, otherPiece).toString(),
  });
  const file = path.join(dir, "in.html");
  const otherFile = path.join(dir, "other.html");

  function transformInput(body = Bun.file(file)) {
    let seen = 0;
    const res = new HTMLRewriter()
      .on("p", {
        element(e) {
          seen++;
          e.setAttribute("x", "1");
        },
      })
      .transform(new Response(body));
    return { res, seen: () => seen };
  }

  async function readAll(body) {
    const reader = body.getReader();
    const chunks = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString();
  }

  it("transform() feeds at most one upstream chunk before returning", async () => {
    const { res, seen } = transformInput();
    expect(seen()).toBeLessThan(count);
    expect(await res.text()).toBe(rewritten);
    expect(seen()).toBe(count);
  });

  // Each consumer that can attach to the still-pending body drives the held
  // input to the end and gets every byte.
  const consumers = {
    ".text()": res => res.text(),
    ".arrayBuffer()": async res => Buffer.from(await res.arrayBuffer()).toString(),
    ".blob()": async res => (await res.blob()).text(),
    ".bytes()": async res => Buffer.from(await res.bytes()).toString(),
    ".body touched, then .text()": res => (res.body, res.text()),
    "JS reader": res => readAll(res.body),
    "for await": async res => {
      const chunks = [];
      for await (const chunk of res.body) chunks.push(chunk);
      return Buffer.concat(chunks).toString();
    },
    "textStream()": async res => {
      let out = "";
      for await (const s of res.textStream()) out += s;
      return out;
    },
    "new Response(res.body).text()": res => new Response(res.body).text(),
    "second HTMLRewriter": res => new HTMLRewriter().transform(res).text(),
    ".clone()": async res => {
      const clone = res.clone();
      const [a, b] = await Promise.all([clone.text(), res.text()]);
      expect(a).toBe(b);
      return b;
    },
    "Bun.write(file, res)": async res => {
      const out = path.join(dir, `out-${Math.random().toString(36).slice(2)}.html`);
      await Bun.write(out, res);
      return Bun.file(out).text();
    },
    "returned from Bun.serve": async res => {
      await using server = Bun.serve({ port: 0, fetch: () => res });
      return await (await fetch(server.url)).text();
    },
    "res.body returned from Bun.serve": async res => {
      await using server = Bun.serve({ port: 0, fetch: () => new Response(res.body) });
      return await (await fetch(server.url)).text();
    },
    "Bun.spawn stdin": async res => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
        env: bunEnv,
        stdin: res,
        stdout: "pipe",
      });
      return await proc.stdout.text();
    },
  };
  it.each(Object.keys(consumers))("held file input completes via %s", async name => {
    const { res, seen } = transformInput();
    expect(await consumers[name](res)).toBe(rewritten);
    expect(seen()).toBe(count);
  });

  it("held fetch() input completes via a JS reader", async () => {
    await using server = Bun.serve({ port: 0, fetch: () => new Response(Bun.file(file)) });
    const { res, seen } = transformInput((await fetch(server.url)).body);
    expect(await readAll(res.body)).toBe(rewritten);
    expect(seen()).toBe(count);
  });

  // Progress is driven by the reader's pulls: one read yields one chunk and
  // leaves the rest of the document unread until the next.
  it("a locked reader paces the input by its reads", async () => {
    const { res, seen } = transformInput();
    const reader = res.body.getReader();
    const first = await reader.read();
    const held = seen();
    expect(held).toBeLessThan(count);
    // Locked but not reading: give the loop real work to turn on and check the input did not advance meanwhile.
    // (Windows reads are completions: the one already in flight when the sink pushed back still lands, nothing after it.)
    expect((await Bun.file(otherFile).bytes()).length).toBe(otherPiece.length * count);
    expect(seen() - held).toBeLessThanOrEqual(isWindows ? (256 * 1024) / piece.length : 0);
    const second = await reader.read();
    expect(seen()).toBeGreaterThan(held);
    expect(seen()).toBeLessThan(count);
    reader.releaseLock();
    const rest = await readAll(res.body);
    expect(Buffer.concat([first.value, second.value]).toString() + rest).toBe(rewritten);
    expect(seen()).toBe(count);
  });

  // With nothing reading the output the rewrite is a side effect the caller is
  // waiting on: it must still run every handler, finish, and let the process
  // exit — for a file (paced from the event loop) and for a fetch() body
  // (whose connection must not be parked forever).
  it.each(["file", "fetch", "fetch, .body touched"])("an unread transform over a %s runs to completion", async kind => {
    await using server = Bun.serve({ port: 0, fetch: () => new Response(Bun.file(file)) });
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `let n = 0, ended = false;
         const input = ${kind === "file"} ? Bun.file(process.argv[1]) : (await fetch(process.argv[2])).body;
         const res = new HTMLRewriter().on("p", { element() { n++; } }).onDocument({ end() { ended = true; } }).transform(new Response(input));
         if (${kind === "fetch, .body touched"}) res.body;
         const fed = n;
         process.on("exit", () => console.log(JSON.stringify({ heldAtReturn: fed < ${count}, n, ended })));`,
        file,
        server.url.href,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(JSON.parse(stdout)).toEqual({ heldAtReturn: true, n: count, ended: true });
    expect(exitCode).toBe(0);
  });

  // The whole document arrives in the first read: it finishes with that read
  // however large its output — inside `transform()` where regular-file reads
  // are synchronous (POSIX), on the read's completion otherwise — so the body
  // is already materialized for consumers that need that (Content-Length,
  // static routes) without anything reading it.
  it("a document that arrives in one chunk finishes with that chunk", async () => {
    const small = path.join(dir, "small.html");
    await Bun.write(small, Buffer.alloc(12 * 4000, "<p>hello</p>").toString());
    let ended = false;
    const res = new HTMLRewriter()
      .on("p", { element: e => void e.setAttribute("x", "1") })
      .onDocument({ end: () => void (ended = true) })
      .transform(new Response(Bun.file(small)));
    if (!isWindows) expect(ended).toBe(true);
    while (!ended) await setImmediatePromise();
    await using server = Bun.serve({ port: 0, fetch: () => res });
    const served = await fetch(server.url);
    expect(served.headers.get("content-length")).toBe(String(18 * 4000));
    expect(await served.text()).toBe(Buffer.alloc(18 * 4000, '<p x="1">hello</p>').toString());
  });

  it(".blob() keeps the response's content type", async () => {
    const res = new HTMLRewriter().transform(
      new Response(Bun.file(file), { headers: { "content-type": "text/html" } }),
    );
    expect((await res.blob()).type).toBe("text/html;charset=utf-8");
  });

  // The outer document is being parsed out of the read buffer when the handler
  // starts a second file read; the two must not share it.
  it("a handler may consume another held transform", async () => {
    const other = transformInput().res;
    let inner;
    const outer = new HTMLRewriter()
      .on("p", {
        element(e) {
          e.setAttribute("x", "1");
          inner ??= other.text();
        },
      })
      .transform(new Response(Bun.file(file)));
    expect(await outer.text()).toBe(rewritten);
    expect(await inner).toBe(rewritten);
  });

  // Starting a transform inside the handler and reading it are two reads
  // nested in the outer one, which still has its document in the read buffer:
  // the second nested read must be kept out of it just like the first.
  it("a handler may transform and read another file", async () => {
    let inner;
    const outer = new HTMLRewriter()
      .on("p", {
        element(e) {
          e.setAttribute("x", "1");
          inner ??= transformInput(Bun.file(otherFile)).res.text();
        },
      })
      .transform(new Response(Bun.file(file)));
    expect(await outer.text()).toBe(rewritten);
    expect(await inner).toBe(otherRewritten);
  });

  // Same, with the outer document arriving on a pipe (the child's stdin): a
  // pipe is read by a different loop than a regular file, out of the same
  // buffer.
  it("a handler may transform and read another file while its document arrives on stdin", async () => {
    const pieces = 64;
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const attr = { element: e => void e.setAttribute("x", "1") };
         let inner;
         const outer = new HTMLRewriter()
           .on("p", {
             element(e) {
               attr.element(e);
               inner ??= new HTMLRewriter().on("p", attr).transform(new Response(Bun.file(process.argv[1]))).text();
             },
           })
           .transform(new Response(Bun.stdin));
         const out = await outer.text();
         const innerText = await inner;
         const expectedInner = await new HTMLRewriter().on("p", attr).transform(new Response(await Bun.file(process.argv[1]).bytes())).text();
         console.log(JSON.stringify({ out, innerMatches: innerText === expectedInner, innerLength: innerText.length }));`,
        otherFile,
      ],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    proc.stdin.write(Buffer.alloc(piece.length * pieces, piece));
    proc.stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      out: Buffer.alloc((piece.length + 6) * pieces, `<p x="1">${text}</p>`).toString(),
      innerMatches: true,
      innerLength: otherRewritten.length,
    });
    expect(exitCode).toBe(0);
  });

  // Same hazard with the other user of that read buffer: readFileSync reads
  // the file into it before deciding whether it needs to stat. Covers both a
  // regular-file input and a pipe (stdin of a child).
  describe("a handler may call readFileSync", () => {
    const otherContent = Buffer.alloc(4096, "Z").toString();
    const otherTxt = path.join(dir, "other.txt");
    beforeAll(() => fs.writeFileSync(otherTxt, otherContent));

    it("while the input is a file", async () => {
      let intactInnerReads = 0;
      const res = new HTMLRewriter()
        .on("p", {
          element(e) {
            e.setAttribute("x", "1");
            if (fs.readFileSync(otherTxt, "utf8") === otherContent) intactInnerReads++;
          },
        })
        .transform(new Response(Bun.file(file)));
      expect(await res.text()).toBe(rewritten);
      expect(intactInnerReads).toBe(count);
    });

    it("while the input is a pipe", async () => {
      const pieces = 64;
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `import { readFileSync } from "fs";
           const otherContent = Buffer.alloc(4096, "Z").toString();
           const res = new HTMLRewriter()
             .on("p", {
               element(e) {
                 e.setAttribute("x", "1");
                 if (readFileSync(process.argv[1], "utf8") !== otherContent) throw new Error("inner read corrupted");
               },
             })
             .transform(new Response(Bun.stdin));
           process.stdout.write(await res.text());`,
          otherTxt,
        ],
        env: bunEnv,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      proc.stdin.write(Buffer.alloc(piece.length * pieces, piece));
      proc.stdin.end();
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toBe(Buffer.alloc((piece.length + 6) * pieces, `<p x="1">${text}</p>`).toString());
      expect(exitCode).toBe(0);
    });
  });

  // Regular-file reads are synchronous on POSIX, so reading ahead of the
  // consumer would show up as `transform()` itself reading (and buffering the
  // rewrite of) the entire file. Sparse files keep these cheap.
  describe.skipIf(isWindows)("large sparse file", () => {
    // 5 GiB: a body size that does not fit lol_html's `u32::MAX` memory limit.
    it.concurrent.each([256 * 1024 * 1024, 5 * 1024 * 1024 * 1024])(
      "of %d bytes: transform() does not read ahead",
      async size => {
        using dir = tempDir("hr-sparse", { "in.html": "" });
        const file = path.join(String(dir), "in.html");
        fs.truncateSync(file, size);
        await using proc = Bun.spawn({
          cmd: [
            bunExe(),
            "-e",
            `const before = process.memoryUsage.rss();
             const res = new HTMLRewriter().on("a", { element() {} }).transform(new Response(Bun.file(process.argv[1])));
             const delta = process.memoryUsage.rss() - before;
             await res.body.cancel();
             console.log(Math.round(delta / 1024 / 1024));`,
            file,
          ],
          env: bunEnv,
          stdout: "pipe",
          stderr: "inherit",
        });
        const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
        // RSS growth across transform(), in MB: one upstream chunk and its
        // rewrite, where reading ahead cost more than the file size.
        expect(parseInt(stdout)).toBeLessThan(isDebug || isASAN ? 96 : 48);
        expect(exitCode).toBe(0);
      },
    );
  });
});

const payloads = [
  {
    name: "direct",
    data: getStream("direct", "none"),
    test: it,
  },
  {
    name: "default",
    data: getStream("default", "none"),
    test: it,
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

it("transform(DataView) returns an ArrayBuffer", () => {
  // Sentinel bytes before and after the HTML so a reader that ignores
  // byteOffset/byteLength and feeds the whole buffer would fail the match.
  const html = new TextEncoder().encode("<p>x</p>");
  const buf = new ArrayBuffer(4 + html.length + 4);
  new Uint8Array(buf).fill("<".charCodeAt(0));
  new Uint8Array(buf, 4, html.length).set(html);
  const out = new HTMLRewriter()
    .on("p", { element: e => e.setInnerContent("y") })
    .transform(new DataView(buf, 4, html.length));
  expect(out).toBeInstanceOf(ArrayBuffer);
  expect(new TextDecoder().decode(out)).toBe("<p>y</p>");
});

it("a handler that returns (not throws) an Error rejects with that Error", async () => {
  const err = new Error("returned, not thrown");
  const res = new HTMLRewriter().on("p", { element: () => err }).transform(new Response("<p>x</p>"));
  await expect(res.text()).rejects.toThrow("returned, not thrown");
});

it.each([
  ["direct ReadableStream", () => getStream("direct", "none")],
  ["default ReadableStream", () => getStream("default", "none")],
  ["blob", () => new Blob([fixture_html_content])],
])("transform() marks the input body used (%s)", async (_, data) => {
  const res = new Response(data());
  const rw = new HTMLRewriter().on("h1", { element() {} });
  await rw.transform(res).text();
  expect(res.bodyUsed).toBe(true);
  expect(() => rw.transform(res)).toThrow("Response body already used");
  await expect(res.text()).rejects.toThrow("Body already used");
});

// `on()` stores one (selector, handlers) record per call; `transform()` turns
// the records collected so far into a fresh lol-html rewriter each time.
describe("on() registrations", () => {
  it("each selector runs the handlers it was registered with, also after a rejected on()", () => {
    const rw = new HTMLRewriter();
    const count = 24;
    for (let i = 0; i < count; i++) {
      if (i === count / 2) {
        // Neither of these may leave a half-registered record behind, or the
        // registrations after them would pair up with the wrong handlers.
        expect(() => rw.on("p[", { element() {} })).toThrow(expect.objectContaining({ name: "HTMLRewriterError" }));
        expect(() => rw.on(`p[data-i="${i}"]`, { element: "not a function" })).toThrow("element must be a function");
      }
      if (i % 2 === 0) {
        rw.on(`p[data-i="${i}"]`, { element: el => el.setInnerContent(`element ${i}`) });
      } else {
        rw.on(`p[data-i="${i}"]`, {
          text(chunk) {
            if (chunk.text) chunk.replace(`text ${i}`);
          },
        });
      }
    }

    const indices = Array.from({ length: count }, (_, i) => count - 1 - i);
    const input = indices.map(i => `<p data-i="${i}">x</p>`).join("");
    const expected = indices.map(i => `<p data-i="${i}">${i % 2 === 0 ? "element" : "text"} ${i}</p>`).join("");
    expect(rw.transform(input)).toBe(expected);
    expect(rw.transform(input)).toBe(expected);
  });

  it("on() from inside a handler applies to the next transform, not the running one", () => {
    const rw = new HTMLRewriter();
    let grown = false;
    rw.on("div", {
      element(el) {
        el.setInnerContent("div");
        if (!grown) {
          grown = true;
          // Many more records than were registered before this transform
          // started, so the registry has to grow while lol-html is still
          // calling the handlers registered above and below.
          for (let i = 0; i < 64; i++) {
            rw.on("span", { element: span => span.setAttribute("n", String(i)) });
          }
        }
      },
    });
    rw.on("span", { element: el => el.setInnerContent("span") });

    const input = "<div>1</div><span>2</span><div>3</div><span>4</span>";
    expect(rw.transform(input)).toBe("<div>div</div><span>span</span><div>div</div><span>span</span>");
    expect(rw.transform(input)).toBe('<div>div</div><span n="63">span</span><div>div</div><span n="63">span</span>');
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

// `transform(await fetch(url)).text()` never stores the output Response, and
// the upstream ByteStream dispatches in via a SinkHandle raw pointer between
// event-loop turns, so the input source's `sinkOwner` slot is what keeps the
// Transform cell (and so the pipe) alive across a GC between chunks; without
// it the pipe is freed mid-rewrite and the body promise is stranded forever.
describe("GC pressure mid-rewrite", () => {
  it("a native-input rewrite survives GC when nothing references the output Response", async () => {
    const sawFirst = Promise.withResolvers();
    const gcDone = Promise.withResolvers();
    await using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          new ReadableStream({
            async start(c) {
              c.enqueue(new TextEncoder().encode("<p>one</p>"));
              // Hold the second chunk until the test has GC'd, so the
              // collection window between chunks is deterministic.
              await gcDone.promise;
              c.enqueue(new TextEncoder().encode("<p>two</p>"));
              c.close();
            },
          }),
        );
      },
    });

    const rewritten = new HTMLRewriter()
      .on("p", {
        element(el) {
          el.setInnerContent("x");
          sawFirst.resolve();
        },
      })
      .transform(await fetch(`http://localhost:${server.port}/`))
      .text();

    await sawFirst.promise;
    Bun.gc(true);
    await Bun.sleep(0);
    Bun.gc(true);
    gcDone.resolve();

    expect(await rewritten).toBe("<p>x</p><p>x</p>");
  });

  // Cancel while suspended, then let the never-settling handler promise be
  // collected: the pipe is freed via plain drop (done is already true, so no
  // abandon task runs), which must release the parked wrapper. A JS-retained
  // Element is then detached, not left pointing into the freed rewriter.
  it("a wrapper stashed across a cancelled suspension is detached, not dangling", async () => {
    let stash = null;
    let out = new HTMLRewriter()
      .on("p", {
        element(el) {
          stash = el;
          return new Promise(() => {});
        },
      })
      .transform(new Response("<p>x</p>"));
    let reader = out.body.getReader();
    let first = reader.read();
    await reader.cancel();
    await first.catch(() => {});
    out = null;
    reader = null;
    first = null;

    // The handler promise and the Transform cell are unreachable now; collect
    // until the wrapper is detached (its tagName getter reads through the
    // unit Cell, undefined once detached).
    for (let i = 0; i < 100 && stash.tagName !== undefined; i++) {
      Bun.gc(true);
      await Bun.sleep(1);
    }
    expect(stash.tagName).toBeUndefined();
  });

  // A handler running inside the input ByteStream's write into the pipe
  // cancels the output reader and drops the last references to the transform.
  // The ByteStream follows the pipe's `Done` answer with `end()` on the same
  // sink snapshot, so the pipe must outlive the write call even when a GC in
  // the handler swept its Transform cell.
  it("cancelling the output from a handler mid-chunk does not free the pipe under its caller", async () => {
    const fixture = /* js */ `
      const CHUNKS = 6;
      const CANCEL_AT = 4;
      let gates;
      // Chunk N+1 is only sent once the handler saw element N, so every element
      // after the first reaches the rewriter from the fetch body's ByteStream.
      const server = Bun.serve({
        port: 0,
        fetch() {
          return new Response(
            new ReadableStream({
              async start(controller) {
                try {
                  for (let i = 0; i < CHUNKS; i++) {
                    controller.enqueue(new TextEncoder().encode("<p n=" + i + "></p>"));
                    await gates[i].promise;
                  }
                  controller.close();
                } catch {}
              },
            }),
            { headers: { "Content-Type": "text/html" } },
          );
        },
      });
      for (let iter = 0; iter < 3; iter++) {
        gates = Array.from({ length: CHUNKS }, () => Promise.withResolvers());
        const cancelled = Promise.withResolvers();
        let seen = 0;
        let reader;
        let out = new HTMLRewriter()
          .on("p", {
            element(el) {
              const n = Number(el.getAttribute("n"));
              seen++;
              if (n === CANCEL_AT) {
                reader.cancel("bye").catch(() => {});
                reader = out = null;
                globalThis.junk = Array.from({ length: 2000 }, () => "x".repeat(4096));
                Bun.gc(true);
                Bun.gc(true);
                cancelled.resolve();
              }
              el.setAttribute("seen", "1");
              gates[n].resolve();
            },
          })
          .transform(await fetch(server.url));
        reader = out.body.getReader();
        out = null;
        const drain = (async () => {
          try {
            while (reader) {
              const { done } = await reader.read();
              if (done) break;
            }
          } catch {}
        })();
        await cancelled.promise;
        await drain;
        Bun.gc(true);
        for (const g of gates) g.resolve();
        console.log("iteration", iter, "saw", seen);
      }
      console.log("done");
      server.stop(true);
      process.exit(0);
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toBe("iteration 0 saw 5\niteration 1 saw 5\niteration 2 saw 5\ndone\n");
    expect(exitCode).toBe(0);
  });

  // Chained transform where the intermediate Response is a temporary: while
  // the second pipe's handler is suspended, the first pipe is parked on the
  // shared ByteStream's backpressure with its producer backref installed.
  // GC in that window must not collect the first pipe; only the stream's GC
  // edges keep it alive.
  it("a chained transform survives GC when nothing references the intermediate Response", async () => {
    const rw1 = new HTMLRewriter().on("p", {
      async element(el) {
        await setImmediatePromise();
        el.setAttribute("one", "");
      },
    });
    const rw2 = new HTMLRewriter().on("p", {
      async element(el) {
        for (let i = 0; i < 8; i++) {
          Bun.gc(true);
          await Bun.sleep(1);
        }
        el.setAttribute("two", "");
      },
    });
    // A separate frame so the intermediate Response temporary is off the
    // stack before the GC loop in rw2's handler runs.
    const start = () => rw2.transform(rw1.transform(new Response("<p>x</p>"))).text();
    expect(await start()).toBe('<p one="" two="">x</p>');
  });

  // Content ops coerce their first argument to a string, then coerce the
  // second (the `{ html }` options getter / the attribute value), which runs
  // user JS. A GC in that window must not free the first argument's bytes
  // before lol-html copies them into the output.
  it("content op string arguments survive a GC triggered while coercing a later argument", async () => {
    const fixture = /* js */ `
      const N = 20000;
      // A fresh, non-atom string each call (slice+concat resolves to a new StringImpl on toString()).
      const mk = (ch, n) => {
        const s = ch.repeat(n);
        return s.slice(0, 1) + s.slice(1);
      };
      const churn = () => {
        Bun.gc(true);
        for (let i = 0; i < 50; i++) mk("SECRET", 20000);
        Bun.gc(true);
      };
      // toString() hands back a temporary string nothing else references.
      const content = ch => ({ toString: () => mk(ch, N) + "END" });
      const opts = {
        get html() {
          churn();
          return false;
        },
      };
      const out = new HTMLRewriter()
        .on("p", {
          element(el) {
            el.setInnerContent(content("I"), opts);
            el.before(content("B"), opts);
            el.setAttribute({ toString: () => mk("n", N) }, { toString: () => (churn(), "v") });
            el.onEndTag(end => {
              end.after(content("E"), opts);
            });
          },
        })
        .onDocument({
          comments(c) {
            c.replace(content("C"), opts);
          },
          text(t) {
            if (t.text === "txt") t.after(content("T"), opts);
          },
          end(end) {
            end.append(content("D"), opts);
          },
        })
        .transform("<p>x</p><div>txt</div><!-- c -->");
      const fragments = {
        "element.before": mk("B", N) + "END<p ",
        "element.setAttribute": "<p " + mk("n", N) + '="v">',
        "element.setInnerContent": '="v">' + mk("I", N) + "END</p>",
        "endTag.after": "</p>" + mk("E", N) + "END<div>",
        "text.after": "<div>txt" + mk("T", N) + "END</div>",
        "comment.replace": "</div>" + mk("C", N) + "END",
        "documentEnd.append": "END" + mk("D", N) + "END",
      };
      const result = {};
      for (const [op, fragment] of Object.entries(fragments)) result[op] = out.includes(fragment);
      result.exact =
        out ===
        mk("B", N) + "END<p " + mk("n", N) + '="v">' + mk("I", N) + "END</p>" + mk("E", N) + "END" +
        "<div>txt" + mk("T", N) + "END</div>" + mk("C", N) + "END" + mk("D", N) + "END";
      console.log(JSON.stringify(result));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      // Malloc=1 routes JSC string allocations through the system allocator so ASan builds see the free
      // (bmalloc's SystemHeap is unavailable on Windows).
      env: isWindows ? bunEnv : { ...bunEnv, Malloc: "1", ASAN_OPTIONS: "detect_leaks=0" },
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(JSON.parse(stdout.trim() || "{}")).toEqual({
      "element.before": true,
      "element.setAttribute": true,
      "element.setInnerContent": true,
      "endTag.after": true,
      "text.after": true,
      "comment.replace": true,
      "documentEnd.append": true,
      exact: true,
    });
    expect(exitCode).toBe(0);
  });

  // The transform's input is a fetch() body wired straight into the pipe. Once the caller
  // keeps only the promise for the output, the pipe is reachable from nothing in JS; what
  // keeps it alive is the input stream's source, which the fetch holds while it delivers.
  // The body arrives across many turns, with collections in between: every chunk must
  // still reach the handlers.
  it("a transform over a fetch body survives GC once only its output promise is held", async () => {
    const fixture = /* js */ `
      const CHUNKS = 20;
      let release;
      const gate = new Promise(resolve => (release = resolve));
      const server = Bun.serve({
        port: 0,
        fetch: () =>
          new Response(
            new ReadableStream({
              async start(controller) {
                controller.enqueue("<html><body>");
                await gate;
                for (let i = 0; i < CHUNKS; i++) {
                  controller.enqueue("<p>" + Buffer.alloc(1000, "x").toString() + "</p>");
                  await Bun.sleep(1);
                }
                controller.close();
              },
            }),
            { headers: { "content-type": "text/html" } },
          ),
      });
      async function start() {
        const res = await fetch(server.url);
        return new HTMLRewriter().on("p", { element(el) { el.setAttribute("seen", ""); } }).transform(res).text();
      }
      const text = start();
      for (let i = 0; i < 5; i++) { Bun.gc(true); await Bun.sleep(1); }
      release();
      for (let i = 0; i < 30; i++) { Bun.gc(true); await Bun.sleep(2); }
      const html = await text;
      console.log(JSON.stringify({ seen: html.split('<p seen="">').length - 1, ended: html.endsWith("</p>") }));
      server.stop(true);
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: JSON.stringify({ seen: 20, ended: true }),
      stderr: "",
      exitCode: 0,
    });
  });
});
