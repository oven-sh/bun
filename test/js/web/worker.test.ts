import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "path";

test("worker", done => {
  const worker = new Worker(new URL("worker-fixture.js", import.meta.url).href, {
    smol: true,
  });
  expect(worker.threadId).toBe(1);
  worker.postMessage("hello");
  worker.onerror = e => {
    done(e.error);
  };
  worker.onmessage = e => {
    try {
      expect(e.data).toEqual("initial message");
    } catch (e) {
      done(e);
    } finally {
      worker.terminate();
      done();
    }
    worker.terminate();
    done();
  };
});

test("worker-env", done => {
  const worker = new Worker(new URL("worker-fixture-env.js", import.meta.url).href, {
    env: {
      hello: "world",
      another_key: 123 as any,
    },
  });
  worker.postMessage("hello");
  worker.onerror = e => {
    done(e.error);
  };
  worker.onmessage = e => {
    try {
      expect(e.data).toEqual({
        env: {
          hello: "world",
          another_key: "123",
        },
        hello: "world",
      });
    } catch (e) {
      done(e);
    } finally {
      worker.terminate();
      done();
    }
  };
});

test("worker-env with a lot of properties", done => {
  const obj: any = {};

  for (let i = 0; i < 1000; i++) {
    obj["prop " + i] = Math.random().toString();
  }

  const worker = new Worker(new URL("worker-fixture-env.js", import.meta.url).href, {
    env: obj,
  });
  worker.postMessage("hello");
  worker.onerror = e => {
    done(e.error);
  };
  worker.onmessage = e => {
    try {
      expect(e.data).toEqual({
        env: obj,
        hello: undefined,
      });
    } catch (e) {
      done(e);
    } finally {
      worker.terminate();
      done();
    }
  };
});

test("sending 50 messages should just work", done => {
  const worker = new Worker(new URL("worker-fixture-many-messages.js", import.meta.url).href, {});

  worker.postMessage("initial message");
  worker.addEventListener("message", ({ data }) => {
    if (data.done) {
      worker.terminate();
      done();
    } else {
      worker.postMessage({ i: data.i + 1 });
    }
  });
});

test("worker by default will not close the event loop", done => {
  const x = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "many-messages-event-loop.js")],
    env: bunEnv,
    stdio: ["inherit", "pipe", "inherit"],
  });

  const timer = setTimeout(() => {
    x.kill();
    done(new Error("timeout"));
  }, 1000);

  x.exited.then(async code => {
    clearTimeout(timer);
    if (code !== 0) {
      done(new Error("exited with non-zero code"));
    } else {
      const text = await new Response(x.stdout).text();
      if (text.includes("done")) {
        console.log({ text });
        done(new Error("event loop killed early"));
      } else {
        done();
      }
    }
  });
});
