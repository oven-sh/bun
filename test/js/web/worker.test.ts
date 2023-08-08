import { expect, test } from "bun:test";

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
      });
    } catch (e) {
      done(e);
    } finally {
      worker.terminate();
      done();
    }
  };
});
