import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { getEventListeners, once } from "node:events";
import { Worker } from "node:worker_threads";

// MessagePort is a NodeEventTarget in node: .on/.addListener/.once share the
// same listener list as addEventListener, so listenerCount/eventNames/
// removeAllListeners/getEventListeners see both, cross-remove works, and
// emit() returns a boolean while passing the raw argument by identity.
describe("MessagePort NodeEventTarget", () => {
  test("surface exists without importing node:worker_threads", async () => {
    // Only this row needs a fresh process so nothing in this file can
    // retroactively install the surface by importing worker_threads.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        if (require.cache["node:worker_threads"]) throw new Error("worker_threads preloaded");
        const { port1 } = new MessageChannel();
        const names = ["on","off","once","emit","addListener","removeListener","listenerCount","eventNames","removeAllListeners","setMaxListeners","getMaxListeners"];
        for (const n of names) {
          if (typeof port1[n] !== "function") throw new Error("missing " + n + ": " + typeof port1[n]);
        }
        port1.close();
        process.stdout.write("OK");
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("OK");
    expect(exitCode).toBe(0);
  });

  test("same fn via .on + addEventListener is one listener, invoked once", async () => {
    const { port1, port2 } = new MessageChannel();
    try {
      let n = 0;
      const fn = () => n++;
      port1.on("message", fn);
      port1.addEventListener("message", fn);
      port2.postMessage("x");
      await once(port1, "message");
      expect(n).toBe(1);
    } finally {
      port1.close();
    }
  });

  test("listenerCount counts both .on and addEventListener listeners", () => {
    const { port1 } = new MessageChannel();
    try {
      port1.on("message", () => {});
      port1.addEventListener("message", () => {});
      expect(port1.listenerCount("message")).toBe(2);
    } finally {
      port1.close();
    }
  });

  test("eventNames reports types registered via addEventListener", () => {
    const { port1 } = new MessageChannel();
    try {
      port1.addEventListener("foo", () => {});
      expect(port1.eventNames()).toEqual(["foo"]);
    } finally {
      port1.close();
    }
  });

  test("removeEventListener removes a listener added via .on", () => {
    const { port1 } = new MessageChannel();
    try {
      const fn = () => {};
      port1.on("message", fn);
      port1.removeEventListener("message", fn);
      expect(port1.listenerCount("message")).toBe(0);
    } finally {
      port1.close();
    }
  });

  test("removeAllListeners clears addEventListener listeners too", async () => {
    const { port1, port2 } = new MessageChannel();
    try {
      let n = 0;
      port1.addEventListener("message", () => n++);
      port1.on("message", () => n++);
      port1.removeAllListeners("message");
      port1.start();
      port2.postMessage("x");
      await new Promise<void>(r => setImmediate(() => r()));
      expect(n).toBe(0);
    } finally {
      port1.close();
    }
  });

  test("emit passes the argument by identity to .on listeners", () => {
    const { port1 } = new MessageChannel();
    try {
      const payload = { a: 1 };
      let got;
      port1.on("message", v => (got = v));
      port1.emit("message", payload);
      expect(got).toBe(payload);
    } finally {
      port1.close();
    }
  });

  test("emit returns a boolean (true when listeners, false otherwise)", () => {
    const { port1 } = new MessageChannel();
    try {
      expect(port1.emit("nope", 1)).toBe(false);
      port1.on("hit", () => {});
      expect(port1.emit("hit", 1)).toBe(true);
    } finally {
      port1.close();
    }
  });

  test("emit with a primitive payload does not throw", () => {
    const { port1 } = new MessageChannel();
    try {
      let got;
      port1.on("message", v => (got = v));
      port1.emit("message", 1);
      expect(got).toBe(1);
    } finally {
      port1.close();
    }
  });

  test("emit('error', err) passes the error by identity", () => {
    const { port1 } = new MessageChannel();
    try {
      const err = new Error("boom");
      let got;
      port1.on("error", e => (got = e));
      port1.emit("error", err);
      expect(got).toBe(err);
    } finally {
      port1.close();
    }
  });

  test(".once dedupes against .on for the same fn", () => {
    const { port1 } = new MessageChannel();
    try {
      const fn = () => {};
      port1.on("foo", fn);
      port1.once("foo", fn);
      expect(port1.listenerCount("foo")).toBe(1);
    } finally {
      port1.close();
    }
  });

  test("events.getEventListeners returns the user fn, not a wrapper", () => {
    const { port1 } = new MessageChannel();
    try {
      const fn = () => {};
      port1.on("message", fn);
      const list = getEventListeners(port1, "message");
      expect(list.length).toBe(1);
      expect(list[0]).toBe(fn);
    } finally {
      port1.close();
    }
  });

  test("addEventListener listeners still receive an Event; .on listeners get the payload", async () => {
    const { port1, port2 } = new MessageChannel();
    try {
      let a, b;
      port1.on("message", v => (a = v));
      port1.addEventListener("message", ev => (b = ev));
      port2.postMessage(42);
      await once(port1, "message");
      expect(a).toBe(42);
      expect(b).toBeInstanceOf(MessageEvent);
      expect((b as MessageEvent).data).toBe(42);
    } finally {
      port1.close();
    }
  });

  test("emit with an addEventListener listener delivers an Event with matching data/detail", () => {
    const { port1 } = new MessageChannel();
    try {
      let msg, custom;
      port1.addEventListener("message", ev => (msg = (ev as MessageEvent).data));
      port1.addEventListener("foo", ev => (custom = (ev as CustomEvent).detail));
      port1.emit("message", 7);
      port1.emit("foo", 8);
      expect(msg).toBe(7);
      expect(custom).toBe(8);
    } finally {
      port1.close();
    }
  });

  test(".off removes a listener added via addEventListener", () => {
    const { port1 } = new MessageChannel();
    try {
      const fn = () => {};
      port1.addEventListener("message", fn);
      port1.off("message", fn);
      expect(port1.listenerCount("message")).toBe(0);
    } finally {
      port1.close();
    }
  });

  test("removeAllListeners('message') re-buffers instead of dropping", async () => {
    const { port1, port2 } = new MessageChannel();
    try {
      port1.on("message", () => {
        throw new Error("should not fire");
      });
      port1.removeAllListeners("message");
      port2.postMessage("x");
      await new Promise<void>(r => setImmediate(() => r()));
      const got = await once(port1, "message");
      expect(got[0]).toBe("x");
    } finally {
      port1.close();
    }
  });

  test("parentPort.listenerCount / eventNames / removeAllListeners work in a worker", async () => {
    await using w = new Worker(
      "const { parentPort } = require('node:worker_threads');" +
        "const fn = () => {};" +
        "parentPort.on('message', fn);" +
        "const lc = parentPort.listenerCount('message');" +
        "const en = parentPort.eventNames().includes('message');" +
        "parentPort.removeAllListeners('message');" +
        "const after = parentPort.listenerCount('message');" +
        "const ml = parentPort.getMaxListeners();" +
        "parentPort.postMessage([lc, en, after, ml]);",
      { eval: true },
    );
    const [got] = await once(w, "message");
    expect(got).toEqual([1, true, 0, 10]);
  });
});
