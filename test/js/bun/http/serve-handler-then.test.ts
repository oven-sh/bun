import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tls } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import { once } from "node:events";
import net from "node:net";
import vm from "node:vm";

// A promise has its own then() when `then` is a function or an accessor on the promise or on a
// class of it. When such a promise is pending, or fulfilled with something that is not a Response,
// Bun.serve reads `then` once and calls it once, with a resolve and a reject function.

/** Fulfilled at once with a placeholder, and then() delivers: an SDK's `APIPromise` (null), p-lazy (undefined). */
class PlaceholderPromise<T> extends Promise<T> {
  #inner: Promise<T>;
  constructor(placeholder: unknown, inner: Promise<T>) {
    super(resolve => resolve(placeholder as any));
    this.#inner = inner;
  }
  then(onFulfilled?: any, onRejected?: any): any {
    return this.#inner.then(onFulfilled, onRejected);
  }
}

type Work<T> = (resolve: (value: T) => void, reject: (reason: unknown) => void) => void;

/** Starts its work in then(), like `Bun.$` and a `Bun.SQL` query. The work settles the promise itself. */
class LazyPromise<T> extends Promise<T> {
  thenCalls = 0;
  #start: () => void;
  constructor(work: Work<T>) {
    let start!: () => void;
    super((resolve, reject) => {
      start = () => work(resolve, reject);
    });
    this.#start = start;
  }
  then(onFulfilled?: any, onRejected?: any): any {
    if (this.thenCalls++ === 0) this.#start();
    return super.then(onFulfilled, onRejected);
  }
  static get [Symbol.species]() {
    return Promise;
  }
}

/** Never settles itself: only then() delivers. */
class ForwardingPromise<T> extends Promise<T> {
  #work: Work<T>;
  #inner: Promise<T> | undefined;
  constructor(work: Work<T>) {
    super(() => {});
    this.#work = work;
  }
  then(onFulfilled?: any, onRejected?: any): any {
    return (this.#inner ??= new Promise(this.#work)).then(onFulfilled, onRejected);
  }
}

const OtherPromise: PromiseConstructor = vm.runInNewContext("Promise");

const later = <T>(value: () => T) => new Promise<T>(resolve => setImmediate(() => resolve(value())));

type Make = (req: Request, server: Bun.Server<undefined>) => unknown;

const kinds = {
  "fetch": (make: Make) => ({ fetch: make }),
  "a routes function": (make: Make) => ({ routes: { "/": make } }),
  "a routes method object": (make: Make) => ({ routes: { "/": { GET: make } } }),
  // The twin: an `async` function resolves its promise with the value, so the engine calls then().
  "an async fetch": (make: Make) => ({ fetch: async (req: Request, server: any) => make(req, server) }),
};
type Kind = keyof typeof kinds;
const everyKind = Object.keys(kinds) as Kind[];
const twins: Kind[] = ["fetch", "an async fetch"];

/** One request to a server whose handler returns `make()`. `errors`: what reached error(). */
async function answer(kind: Kind, make: Make, init?: RequestInit) {
  const errors: unknown[] = [];
  await using server = Bun.serve({
    port: 0,
    development: false,
    ...kinds[kind](make),
    error(error: unknown) {
      errors.push(error);
      return new Response("from error()", { status: 500 });
    },
  } as any);
  const response = await fetch(server.url, init);
  return { status: response.status, body: await response.text(), errors };
}

const ok = (body: string) => ({ status: 200, body, errors: [] });

// A test that times out does not dispose its child.
const children = new Set<Bun.Subprocess>();
afterAll(() => {
  for (const child of children) child.kill();
});

async function run(script: string) {
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  children.add(proc);
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  children.delete(proc);
  return { stdout, stderr, exitCode };
}

/** The first message of a WebSocket. Rejects if the WebSocket closes before one. */
function firstMessage(ws: WebSocket) {
  return new Promise<string>((resolve, reject) => {
    ws.onmessage = event => resolve(String(event.data));
    ws.onerror = ws.onclose = () => reject(new Error("the WebSocket closed before a message"));
  });
}

describe.each(everyKind)("%s returns a promise that holds a placeholder", kind => {
  test.concurrent.each([null, undefined, 0, {}])("(%p) and gives the Response in then()", async placeholder => {
    const settled = () => new PlaceholderPromise(placeholder, Promise.resolve(new Response("from then()")));
    expect(await answer(kind, settled)).toEqual(ok("from then()"));
    const pending = () =>
      new PlaceholderPromise(
        placeholder,
        later(() => new Response("from then(), later")),
      );
    expect(await answer(kind, pending)).toEqual(ok("from then(), later"));
  });

  test.concurrent("and rejects in then(): error()", async () => {
    const reason = new Error("rejected in then()");
    const make = () => new PlaceholderPromise<Response>(null, Promise.reject(reason));
    expect(await answer(kind, make)).toEqual({ status: 500, body: "from error()", errors: [reason] });
  });
});

describe("a promise that holds a placeholder", () => {
  // One child for the three cases. For the last one, an `async` handler gets the diagnostic for the promise:
  // with nothing to call, the promise itself is the value.
  test.concurrent("and gives no Response: the diagnostic", async () => {
    const { stdout, stderr, exitCode } = await run(`
      class GivesText extends Promise {
        constructor() { super(resolve => resolve(null)); }
        then(onFulfilled, onRejected) { return Promise.resolve("not a Response").then(onFulfilled, onRejected); }
      }
      let reads = 0;
      class NothingToCall extends Promise {
        constructor() { super(resolve => resolve(null)); }
        get then() { reads++; return undefined; }
      }
      const cases = {
        "then() gives a string, from fetch": () => new GivesText(),
        "then() gives a string, from an async fetch": async () => new GivesText(),
        "the then accessor gives nothing to call, from fetch": () => new NothingToCall(),
      };
      for (const [name, handler] of Object.entries(cases)) {
        const server = Bun.serve({ port: 0, development: false, fetch: handler });
        const response = await fetch(server.url);
        console.log(name + ":", response.status);
        await server.stop(true);
      }
      console.log("reads of the accessor:", reads);
    `);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout:
        "then() gives a string, from fetch: 204\n" +
        "then() gives a string, from an async fetch: 204\n" +
        "the then accessor gives nothing to call, from fetch: 204\n" +
        "reads of the accessor: 1\n",
      stderr:
        `error: Expected a Response object, but received '"not a Response"'\n` +
        `error: Expected a Response object, but received '"not a Response"'\n` +
        "error: Expected a Response object, but received 'null'\n",
      exitCode: 0,
    });
  });
});

// The state of these promises is the answer: no then() is called. Each is made in the handler, so
// that it is pending when the handler returns it.
describe("a promise is read by its state", () => {
  // `made` counts the promises of a class. A call of the then() it inherits makes one more.
  const rows: Record<string, () => { value: unknown; thenCalls?: () => number }> = {
    "a subclass that inherits then()": () => {
      let made = 0;
      class Eager<T> extends Promise<T> {
        constructor(executor: ConstructorParameters<typeof Promise<T>>[0]) {
          made++;
          super(executor);
        }
      }
      return {
        value: new Eager<Response>(resolve => setImmediate(() => resolve(new Response("ok")))),
        thenCalls: () => made - 1,
      };
    },
    "a subclass of a subclass that inherits then()": () => {
      let made = 0;
      class Eager<T> extends Promise<T> {}
      class Eagerer<T> extends Eager<T> {
        constructor(executor: ConstructorParameters<typeof Promise<T>>[0]) {
          made++;
          super(executor);
        }
      }
      return {
        value: new Eagerer<Response>(resolve => setImmediate(() => resolve(new Response("ok")))),
        thenCalls: () => made - 1,
      };
    },
    // `await` of this one throws a TypeError: the then() it inherits cannot construct its result.
    "a subclass whose constructor drops the executor": () => {
      let made = 0;
      class Deferred<T> extends Promise<T> {
        resolve!: (value: T) => void;
        constructor() {
          made++;
          let resolve!: (value: T) => void;
          super(r => {
            resolve = r;
          });
          this.resolve = resolve;
        }
      }
      const deferred = new Deferred<Response>();
      setImmediate(() => deferred.resolve(new Response("ok")));
      return { value: deferred, thenCalls: () => made - 1 };
    },
    "a subclass, of this realm, of the Promise of another realm": () => {
      let made = 0;
      class Mixed<T> extends OtherPromise<T> {
        resolve!: (value: T) => void;
        constructor() {
          made++;
          let resolve!: (value: T) => void;
          super(r => {
            resolve = r;
          });
          this.resolve = resolve;
        }
      }
      const mixed = new Mixed<Response>();
      setImmediate(() => mixed.resolve(new Response("ok")));
      return { value: mixed, thenCalls: () => made - 1 };
    },
    "a subclass, of another realm, of the Promise of this realm": () => {
      const counter = { made: 0 };
      const Mixed = vm.runInNewContext(`(Base, counter) => class extends Base {
        constructor() {
          counter.made++;
          let resolve;
          super(r => { resolve = r; });
          this.resolve = resolve;
        }
      }`)(Promise, counter);
      const mixed = new Mixed();
      setImmediate(() => mixed.resolve(new Response("ok")));
      return { value: mixed, thenCalls: () => counter.made - 1 };
    },
    "a promise of another realm": () => {
      const counter = { thenCalls: 0 };
      const make = vm.runInNewContext(`(later, counter) => {
        const then = Promise.prototype.then;
        Promise.prototype.then = function (onFulfilled, onRejected) {
          counter.thenCalls++;
          return then.call(this, onFulfilled, onRejected);
        };
        return value => new Promise(resolve => later(() => resolve(value)));
      }`)(setImmediate, counter);
      return { value: make(new Response("ok")), thenCalls: () => counter.thenCalls };
    },
    // The next four have no then() that a test can count. The last test of this block counts for two of them.
    "a promise with own properties": () => ({
      value: Object.assign(
        later(() => new Response("ok")),
        { json: () => {}, text: () => {} },
      ),
    }),
    "a promise with a `then` property that is not a function": () => ({
      value: Object.assign(
        later(() => new Response("ok")),
        { then: "not a function" },
      ),
    }),
    "a subclass with a `then` field that is not a function": () => {
      class WithField<T> extends Promise<T> {
        then: any = null;
        static get [Symbol.species]() {
          return Promise;
        }
      }
      return { value: new WithField<Response>(resolve => setImmediate(() => resolve(new Response("ok")))) };
    },
    "a promise without a prototype": () => ({
      value: Object.setPrototypeOf(
        later(() => new Response("ok")),
        null,
      ),
    }),
  };
  test.concurrent.each(Object.keys(rows))("%s", async name => {
    let row!: ReturnType<(typeof rows)[string]>;
    let statusAtReturn = "";
    const result = await answer("fetch", () => {
      row = rows[name]();
      statusAtReturn = Bun.peek.status(row.value as Promise<unknown>);
      return row.value;
    });
    expect({ ...result, statusAtReturn, thenCalls: row.thenCalls?.() ?? 0 }).toEqual({
      ...ok("ok"),
      statusAtReturn: "pending",
      thenCalls: 0,
    });
  });

  test.concurrent("a subclass with its own then() that already holds a Response", async () => {
    let thenCalls = 0;
    class Counting extends Promise<Response> {
      then(onFulfilled?: any, onRejected?: any): any {
        thenCalls++;
        return super.then(onFulfilled, onRejected);
      }
    }
    expect(await answer("fetch", () => Counting.resolve(new Response("ok")))).toEqual(ok("ok"));
    expect(thenCalls).toBe(0);
  });

  // The rejection is the answer. `await` of this one gives the Response of then().
  test.concurrent("a rejected subclass whose then() gives a Response: error()", async () => {
    let thenCalls = 0;
    const reason = new Error("the state");
    class Recovering extends Promise<Response> {
      then(onFulfilled?: any, onRejected?: any): any {
        thenCalls++;
        return Promise.resolve(new Response("unused")).then(onFulfilled, onRejected);
      }
    }
    const make = () => new Recovering((_, reject) => reject(reason));
    expect(await answer("fetch", make)).toEqual({ status: 500, body: "from error()", errors: [reason] });
    expect(thenCalls).toBe(0);
  });

  // The accessor is read once. An `async` handler gets the diagnostic here: the promise is its value.
  test.concurrent("a pending promise whose `then` accessor gives nothing to call", async () => {
    let reads = 0;
    class NothingToCall extends Promise<Response> {
      // @ts-expect-error an accessor in place of the method
      get then() {
        reads++;
        return undefined;
      }
    }
    const make = () => new NothingToCall(resolve => setImmediate(() => resolve(new Response("ok"))));
    expect(await answer("fetch", make)).toEqual(ok("ok"));
    expect(reads).toBe(1);
  });

  test.concurrent("a replaced Promise.prototype.then is not called", async () => {
    const { stdout, stderr, exitCode } = await run(`
      const then = Promise.prototype.then;
      let calls = 0;
      Promise.prototype.then = function (onFulfilled, onRejected) {
        calls++;
        return then.call(this, onFulfilled, onRejected);
      };
      const pending = () => new Promise(resolve => setImmediate(() => resolve(new Response("ok"))));
      const values = {
        "a plain promise": pending,
        "a promise with own properties": () => Object.assign(pending(), { json() {}, text() {} }),
        "a promise with a then property that is not a function": () => Object.assign(pending(), { then: "not a function" }),
      };
      for (const [name, value] of Object.entries(values)) {
        const server = Bun.serve({ port: 0, fetch: value });
        const response = await fetch(server.url);
        const body = await response.text();
        console.log(name + ":", response.status, body, calls);
        await server.stop(true);
      }
    `);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout:
        "a plain promise: 200 ok 0\n" +
        "a promise with own properties: 200 ok 0\n" +
        "a promise with a then property that is not a function: 200 ok 0\n",
      stderr: "",
      exitCode: 0,
    });
  });
});

describe.each(everyKind)("%s returns a pending promise with its own then()", kind => {
  test.concurrent("that starts its work in then()", async () => {
    const lazy = new LazyPromise<Response>(resolve => resolve(new Response("lazy")));
    expect(await answer(kind, () => lazy)).toEqual(ok("lazy"));
    expect(lazy.thenCalls).toBe(1);
  });

  test.concurrent("that starts its work in then() and settles later", async () => {
    const lazy = new LazyPromise<Response>(resolve => setImmediate(() => resolve(new Response("lazy, later"))));
    expect(await answer(kind, () => lazy)).toEqual(ok("lazy, later"));
    expect(lazy.thenCalls).toBe(1);
  });

  test.concurrent("that never settles itself", async () => {
    const make = () => new ForwardingPromise<Response>(resolve => resolve(new Response("forwarded")));
    expect(await answer(kind, make)).toEqual(ok("forwarded"));
  });

  test.concurrent("of another realm", async () => {
    const OtherLazy = vm.runInNewContext(`(class extends Promise {
      #start;
      constructor(work) {
        let start;
        super(resolve => { start = () => work(resolve); });
        this.#start = start;
      }
      then(onFulfilled, onRejected) {
        this.#start();
        return super.then(onFulfilled, onRejected);
      }
      static get [Symbol.species]() { return Promise; }
    })`);
    const make = () => new OtherLazy((resolve: (value: Response) => void) => resolve(new Response("other realm")));
    expect(await answer(kind, make)).toEqual(ok("other realm"));
  });

  test.concurrent("that is a plain promise with a then() of its own", async () => {
    const make = () => {
      let start!: () => void;
      const promise = new Promise<Response>(resolve => {
        start = () => resolve(new Response("own then()"));
      });
      const then = promise.then;
      promise.then = function (this: Promise<Response>, onFulfilled?: any, onRejected?: any) {
        start();
        return then.call(this, onFulfilled, onRejected);
      } as any;
      return promise;
    };
    expect(await answer(kind, make)).toEqual(ok("own then()"));
  });
});

const transports = {
  "HTTP/1.1": { serve: {}, fetch: {} },
  "HTTP/1.1 with TLS": { serve: { tls }, fetch: { tls: { rejectUnauthorized: false } } },
  "HTTP/2": { serve: { tls, http2: true }, fetch: { protocol: "http2", tls: { rejectUnauthorized: false } } },
  "HTTP/3": { serve: { tls, http3: true }, fetch: { protocol: "http3", tls: { rejectUnauthorized: false } } },
};

describe.each(Object.keys(transports) as (keyof typeof transports)[])("over %s", transport => {
  test.concurrent.each([false, true])(
    "a pending promise with its own then() answers (development: %p)",
    async development => {
      await using server = Bun.serve({
        port: 0,
        development,
        ...transports[transport].serve,
        fetch: () => new LazyPromise<Response>(resolve => resolve(new Response("lazy"))),
      } as any);
      const response = await fetch(server.url, transports[transport].fetch as RequestInit);
      expect({ status: response.status, body: await response.text() }).toEqual({ status: 200, body: "lazy" });
    },
  );
});

// Each answer is the one that an `async` handler gives.
describe.each(twins)("then() of a pending promise that %s returns", kind => {
  test.concurrent("is read once and called once, with two functions", async () => {
    const log: string[] = [];
    class Spy extends Promise<Response> {
      // @ts-expect-error an accessor in place of the method
      get then() {
        log.push("get then");
        return (...args: unknown[]) => {
          log.push(`then(${args.map(arg => typeof arg).join(", ")})`);
          (args[0] as (value: Response) => void)(new Response("spied"));
        };
      }
    }
    expect(await answer(kind, () => new Spy(() => {}))).toEqual(ok("spied"));
    expect(log).toEqual(["get then", "then(function, function)"]);
  });

  test.concurrent("is found through a Proxy in the prototype chain", async () => {
    let reads = 0;
    const prototype = new Proxy(Promise.prototype, {
      get(target, key, receiver) {
        if (key === "then") reads++;
        return Reflect.get(target, key, receiver);
      },
    });
    const make = () =>
      Object.setPrototypeOf(
        later(() => new Response("through the Proxy")),
        prototype,
      );
    expect(await answer(kind, make)).toEqual(ok("through the Proxy"));
    expect(reads).toBe(1);
  });

  test.concurrent("rejects: error()", async () => {
    const reason = new Error("rejected in then()");
    const lazy = new LazyPromise<Response>((_, reject) => reject(reason));
    expect(await answer(kind, () => lazy)).toEqual({ status: 500, body: "from error()", errors: [reason] });
    expect(lazy.thenCalls).toBe(1);
  });

  // The promises of the next four tests settle themselves too. Without `async`, Bun 1.4.3 answers from that state.
  test.concurrent("throws: error()", async () => {
    const thrown = new Error("thrown by then()");
    class Throws extends Promise<Response> {
      then(): any {
        throw thrown;
      }
    }
    const make = () => new Throws(resolve => setImmediate(() => resolve(new Response("unused"))));
    expect(await answer(kind, make)).toEqual({ status: 500, body: "from error()", errors: [thrown] });
  });

  test.concurrent("is an accessor that throws: error()", async () => {
    const thrown = new Error("thrown by the accessor");
    class Throws extends Promise<Response> {
      // @ts-expect-error an accessor in place of the method
      get then(): any {
        throw thrown;
      }
    }
    const make = () => new Throws(resolve => setImmediate(() => resolve(new Response("unused"))));
    expect(await answer(kind, make)).toEqual({ status: 500, body: "from error()", errors: [thrown] });
  });

  test.concurrent("cannot construct its result: error()", async () => {
    class DeferredWithThen<T> extends Promise<T> {
      resolve!: (value: T) => void;
      constructor() {
        let resolve!: (value: T) => void;
        super(r => {
          resolve = r;
        });
        this.resolve = resolve;
      }
      then(onFulfilled?: any, onRejected?: any): any {
        return super.then(onFulfilled, onRejected);
      }
    }
    const make = () => {
      const deferred = new DeferredWithThen<Response>();
      setImmediate(() => deferred.resolve(new Response("unused")));
      return deferred;
    };
    expect(await answer(kind, make)).toEqual({
      status: 500,
      body: "from error()",
      errors: [expect.any(TypeError)],
    });
  });

  test.concurrent("reports another value than the state: that value", async () => {
    class Mapping extends Promise<Response> {
      then(onFulfilled?: any, onRejected?: any): any {
        return super.then(() => new Response("from then()")).then(onFulfilled, onRejected);
      }
      static get [Symbol.species]() {
        return Promise;
      }
    }
    const make = () => new Mapping(resolve => setImmediate(() => resolve(new Response("from the state"))));
    expect(await answer(kind, make)).toEqual(ok("from then()"));
  });

  test.concurrent.each(["settles itself", "holds a placeholder"])(
    "never calls back, of a promise that %s: the request waits",
    async shape => {
      const { promise: pendingAfterTheDispatch, resolve: report } = Promise.withResolvers<number>();
      class Silent extends Promise<Response> {
        then(): any {
          // An immediate that is queued inside the dispatch of the request runs after it.
          setImmediate(() => report(server.pendingRequests));
        }
      }
      const make = () =>
        shape === "settles itself"
          ? new Silent(resolve => setImmediate(() => resolve(new Response("from the state"))))
          : new Silent(resolve => resolve(null as any));
      await using server = Bun.serve({ port: 0, development: false, idleTimeout: 0, ...kinds[kind](make) } as any);
      const controller = new AbortController();
      const response = fetch(server.url, { signal: controller.signal }).then(
        response => response.status,
        error => error.name,
      );
      expect(await pendingAfterTheDispatch).toBe(1);
      controller.abort();
      expect(await response).toBe("AbortError");
    },
  );

  // A difference between the twins. The engine queues the call of then() inside an `async` handler.
  // Bun.serve queues it after the handler returned, where the store of the handler is gone.
  test.concurrent("has the AsyncLocalStorage store of the handler only when the handler is `async`", async () => {
    const storage = new AsyncLocalStorage<string>();
    const seen: unknown[] = [];
    class ReadsStore extends Promise<Response> {
      then(onFulfilled?: any, onRejected?: any): any {
        seen.push(storage.getStore());
        return super.then(onFulfilled, onRejected);
      }
      static get [Symbol.species]() {
        return Promise;
      }
    }
    const make = () => new ReadsStore(resolve => setImmediate(() => resolve(new Response("ok"))));
    const entersTheStore = () => {
      storage.enterWith("that the handler entered");
      return make();
    };
    expect(await answer(kind, entersTheStore)).toEqual(ok("ok"));
    // Bun.serve runs the handler with the store that was current when the server was made.
    expect(await storage.run("of the server", () => answer(kind, make))).toEqual(ok("ok"));
    expect(seen).toEqual(kind === "fetch" ? [undefined, undefined] : ["that the handler entered", "of the server"]);
  });
});

// One child for both kinds of handler. Each case prints one line.
describe("then() of a pending promise, from fetch and from an async fetch", () => {
  test.concurrent("does not pass a rejection on: the rejection is unhandled", async () => {
    const { stdout, stderr, exitCode } = await run(`
      class DropsReject extends Promise {
        then(onFulfilled) { return super.then(onFulfilled); }
      }
      const make = () => new DropsReject((resolve, reject) => setImmediate(() => reject(new Error("not passed on"))));
      for (const [kind, handler] of Object.entries({ "fetch": make, "an async fetch": async () => make() })) {
        const reported = Promise.withResolvers();
        const onUnhandled = reason => reported.resolve("unhandledRejection: " + reason.message);
        process.on("unhandledRejection", onUnhandled);
        let errorCalls = 0;
        const server = Bun.serve({
          port: 0,
          development: false,
          idleTimeout: 0,
          fetch: handler,
          error() { errorCalls++; return new Response("from error()", { status: 500 }); },
        });
        const controller = new AbortController();
        const response = fetch(server.url, { signal: controller.signal }).then(response => "answered " + response.status, error => error.name);
        const first = await Promise.race([reported.promise, response]);
        controller.abort();
        console.log(kind + ": " + first + ", error() calls: " + errorCalls + ", client: " + (await response));
        process.off("unhandledRejection", onUnhandled);
        await server.stop(true);
      }
    `);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout:
        "fetch: unhandledRejection: not passed on, error() calls: 0, client: AbortError\n" +
        "an async fetch: unhandledRejection: not passed on, error() calls: 0, client: AbortError\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // Each line: what the WebSocket client got, then what the rejection reached. The promises settle themselves
  // too: a server that reads the state answers the handshake with that, and the client closes.
  test.concurrent("upgrades the request and then rejects: the rejection is unhandled", async () => {
    const { stdout, stderr, exitCode } = await run(`
      const cases = {
        "then() upgrades and rejects": (req, server) =>
          new (class extends Promise {
            then(onFulfilled, onRejected) {
              server.upgrade(req);
              onRejected(new Error("rejected after the upgrade"));
            }
          })(resolve => setImmediate(() => resolve(new Response("from the state")))),
        "the accessor upgrades, then() rejects": (req, server) =>
          new (class extends Promise {
            get then() {
              server.upgrade(req);
              return (onFulfilled, onRejected) => onRejected(new Error("rejected after the upgrade"));
            }
          })(resolve => setImmediate(() => resolve(new Response("from the state")))),
        "the accessor upgrades and gives nothing to call, the promise rejects": (req, server) =>
          new (class extends Promise {
            get then() {
              server.upgrade(req);
              return undefined;
            }
          })((resolve, reject) => setImmediate(() => reject(new Error("rejected after the upgrade")))),
      };
      for (const [name, make] of Object.entries(cases)) {
        for (const [kind, handler] of Object.entries({ "fetch": make, "an async fetch": async (req, server) => make(req, server) })) {
          const reported = Promise.withResolvers();
          const onUnhandled = reason => reported.resolve("unhandledRejection");
          process.on("unhandledRejection", onUnhandled);
          const server = Bun.serve({
            port: 0,
            development: false,
            fetch: handler,
            error(error) { reported.resolve("error()"); return new Response("from error()", { status: 500 }); },
            websocket: { open(ws) { ws.send("open"); }, message() {} },
          });
          const ws = new WebSocket(server.url.href.replace("http", "ws"));
          const got = await new Promise(resolve => {
            ws.onmessage = event => resolve(event.data);
            ws.onerror = ws.onclose = () => resolve("closed");
          });
          console.log(name + ", from " + kind + ": " + got + ", " + (got === "open" ? await reported.promise : "nothing reported"));
          process.off("unhandledRejection", onUnhandled);
          ws.close();
          await server.stop(true);
        }
      }
    `);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout:
        "then() upgrades and rejects, from fetch: open, unhandledRejection\n" +
        "then() upgrades and rejects, from an async fetch: open, unhandledRejection\n" +
        "the accessor upgrades, then() rejects, from fetch: open, unhandledRejection\n" +
        "the accessor upgrades, then() rejects, from an async fetch: open, unhandledRejection\n" +
        "the accessor upgrades and gives nothing to call, the promise rejects, from fetch: open, unhandledRejection\n" +
        "the accessor upgrades and gives nothing to call, the promise rejects, from an async fetch: open, unhandledRejection\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // These two start their work in then(). Returned without `await` by mistake, the work now runs. The
  // diagnostic shows its result: the output of the command, the row of the query.
  test.concurrent.each([
    ["Bun.$", "Bun.$`echo ran`.quiet()", /stdout: <Buffer 72 61 6e 0a>/g],
    ["a Bun.SQL query", 'new Bun.SQL("sqlite://:memory:")`select 41 + 1 as answer`', /answer: 42/g],
  ])("of %s returned by mistake runs the work: the diagnostic", async (_, work, result) => {
    const { stdout, stderr, exitCode } = await run(`
      const work = () => ${work};
      for (const [kind, handler] of Object.entries({ "fetch": work, "an async fetch": async () => work() })) {
        const server = Bun.serve({ port: 0, development: false, fetch: handler });
        const response = await fetch(server.url);
        console.log(kind + ":", response.status);
        await server.stop(true);
      }
    `);
    expect(stderr.match(/error: Expected a Response object, but received '/g)).toHaveLength(2);
    expect(stderr.match(result)).toHaveLength(2);
    expect({ stdout, exitCode }).toEqual({ stdout: "fetch: 204\nan async fetch: 204\n", exitCode: 0 });
  });
});

describe("a pending promise with its own then()", () => {
  test.concurrent.each(["fetch", "a routes method object"] as const)("answers a HEAD request to %s", async kind => {
    const make = () => new LazyPromise<Response>(resolve => resolve(new Response("lazy")));
    await using server = Bun.serve({ port: 0, ...kinds[kind](make) } as any);
    const response = await fetch(server.url, { method: "HEAD" });
    expect({
      status: response.status,
      length: response.headers.get("content-length"),
      body: await response.text(),
    }).toEqual({ status: 200, length: "4", body: "" });
  });

  test.concurrent("answers two requests that arrive in one write", async () => {
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: req => new LazyPromise<Response>(resolve => resolve(new Response(new URL(req.url).pathname))),
    });
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    let reply = "";
    const get = (path: string) => `GET ${path} HTTP/1.1\r\nHost: x\r\n\r\n`;
    const socket = net.connect(server.port!, "127.0.0.1", () => socket.write(get("/first") + get("/second")));
    socket.on("data", chunk => {
      reply += chunk.toString("latin1");
      if (reply.endsWith("/second")) socket.destroy();
    });
    socket.on("error", reject);
    socket.on("close", () => resolve(reply));
    const bodies = (await promise)
      .split(/HTTP\/1\.1 /)
      .map(part => part.slice(0, 6) + part.slice(part.indexOf("\r\n\r\n") + 4));
    expect(bodies).toEqual(["", "200 OK/first", "200 OK/second"]);
  });

  test.concurrent("is not asked after server.upgrade()", async () => {
    const lazy = new LazyPromise<Response>(resolve => resolve(new Response("unused")));
    let opened = false;
    await using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        server.upgrade(req);
        return lazy;
      },
      websocket: {
        open(ws) {
          opened = true;
          ws.close();
        },
        message() {},
      },
    });
    const ws = new WebSocket(server.url.href.replace("http", "ws"));
    await once(ws, "close");
    expect({ opened, thenCalls: lazy.thenCalls }).toEqual({ opened: true, thenCalls: 0 });
  });

  test.concurrent("can upgrade the request in then()", async () => {
    await using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        return new LazyPromise<Response>(resolve => {
          server.upgrade(req);
          resolve(new Response("unused"));
        });
      },
      websocket: {
        open(ws) {
          ws.send("upgraded in then()");
        },
        message() {},
      },
    });
    const ws = new WebSocket(server.url.href.replace("http", "ws"));
    expect(await firstMessage(ws)).toBe("upgraded in then()");
    ws.close();
  });

  test.concurrent.each(["then()", "the `then` accessor"])("can stop the server in %s", async where => {
    let stoppedBy = "";
    await using server = Bun.serve({
      port: 0,
      idleTimeout: 0,
      fetch(): any {
        const stop = () => {
          stoppedBy = where;
          server.stop(true);
        };
        if (where === "then()") {
          return new LazyPromise<Response>(resolve => {
            stop();
            resolve(new Response("unused"));
          });
        }
        class Stops extends Promise<Response> {
          // @ts-expect-error an accessor in place of the method
          get then() {
            stop();
            return undefined;
          }
        }
        return new Stops(() => {});
      },
    });
    expect(
      await fetch(server.url).then(
        response => response.status,
        () => "closed",
      ),
    ).toBe("closed");
    expect(stoppedBy).toBe(where);
    expect(server.pendingRequests).toBe(0);
  });

  test.concurrent("releases a client that leaves before then() reports", async () => {
    const { promise: started, resolve: onStart } = Promise.withResolvers<void>();
    await using server = Bun.serve({
      port: 0,
      idleTimeout: 0,
      fetch: () => new LazyPromise<Response>(() => onStart()),
    });
    const controller = new AbortController();
    const response = fetch(server.url, { signal: controller.signal });
    await started;
    controller.abort();
    expect(await response.catch(error => error.name)).toBe("AbortError");
    // Resolves only once no request is pending.
    await server.stop();
  });

  test.concurrent("is answered after a full GC in then() and before then() reports", async () => {
    const collectThenAnswer = (body: string) => (resolve: (value: Response) => void) => {
      Bun.gc(true);
      setImmediate(() => {
        Bun.gc(true);
        resolve(new Response(body));
      });
    };
    expect(await answer("fetch", () => new LazyPromise<Response>(collectThenAnswer("lazy")))).toEqual(ok("lazy"));
    expect(await answer("fetch", () => new ForwardingPromise<Response>(collectThenAnswer("forwarded")))).toEqual(
      ok("forwarded"),
    );
  });
});

// then() and the `then` accessor can run the event loop: Bun.build() waits for an async plugin setup().
// The client leaves in that time, and a second client arrives. The request is then dropped as after a
// handler that did the same: nothing is written, and `abort` fires when the dispatch is over.
// Not on Windows: a nested run of the event loop frees the closed socket there (#40021).
describe.skipIf(isWindows)("a client that leaves while the event loop runs inside", () => {
  // Not concurrent: the event loop of this process runs inside the dispatch of the request.
  test.each([
    "then()",
    "the `then` accessor",
    "a `then` accessor that gives nothing to call",
    "the `then` accessor of what error() returned",
  ])("%s is not answered", async where => {
    const events: string[] = [];
    const secondClientArrived = Promise.withResolvers<void>();
    const afterTheDispatch = Promise.withResolvers<void>();
    let first!: net.Socket;
    let second: net.Socket | undefined;
    function leaveAndRunTheEventLoop() {
      first.destroy();
      second = net.connect(server.port!, "127.0.0.1", () => second!.write("GET /second HTTP/1.1\r\nHost: x\r\n\r\n"));
      second.on("error", () => {});
      second.on("data", chunk => events.push(`the second client got ${chunk.length} bytes`));
      try {
        const setup = async () => await secondClientArrived.promise;
        Bun.build({ entrypoints: [], plugins: [{ name: "wait", setup }] }).catch(() => {});
      } catch {}
      // An immediate that is queued inside the dispatch of the request runs after it.
      setImmediate(() => afterTheDispatch.resolve());
    }
    const answer = () => new Response("for a client that left");
    const give = (onFulfilled: (value: Response) => void) => onFulfilled(answer());
    class InThen extends Promise<Response> {
      then(onFulfilled: any): any {
        leaveAndRunTheEventLoop();
        give(onFulfilled);
      }
    }
    class InAccessor extends Promise<Response> {
      // @ts-expect-error an accessor in place of the method
      get then() {
        leaveAndRunTheEventLoop();
        return where.includes("nothing to call") ? undefined : give;
      }
    }
    const make = () => new (where === "then()" ? InThen : InAccessor)(resolve => setImmediate(() => resolve(answer())));
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      idleTimeout: 0,
      development: false,
      fetch(req): any {
        if (new URL(req.url).pathname === "/second") {
          secondClientArrived.resolve();
          return new Promise(() => {});
        }
        req.signal.addEventListener("abort", () => events.push("abort"));
        if (where.includes("error()")) throw new Error("to error()");
        return make();
      },
      error: (): any => make(),
    });
    first = net.connect(server.port!, "127.0.0.1", () => first.write("GET /first HTTP/1.1\r\nHost: x\r\n\r\n"));
    first.on("error", () => {});
    first.on("data", chunk => {
      events.push(`the first client got ${chunk.length} bytes`);
      afterTheDispatch.resolve();
    });
    await afterTheDispatch.promise;
    second?.destroy();
    expect(events).toEqual(["abort"]);
  });
});

// error() runs inside the dispatch when the handler throws, and later when the handler's promise rejects.
const failures = {
  "a handler that throws": () => {
    throw new Error("from the handler");
  },
  "a handler whose promise rejects later": () =>
    new Promise((_, reject) => setImmediate(() => reject(new Error("from the handler")))),
};
const errorKinds = {
  "error()": (make: () => unknown) => make,
  // The twin, as for the handler.
  "an async error()": (make: () => unknown) => async () => make(),
};

describe.each(Object.keys(failures) as (keyof typeof failures)[])("after %s", failure => {
  async function answerOfError(kind: keyof typeof errorKinds, make: () => unknown) {
    await using server = Bun.serve({
      port: 0,
      development: false,
      fetch: failures[failure] as any,
      error: errorKinds[kind](make) as any,
    });
    const response = await fetch(server.url);
    return { status: response.status, body: await response.text() };
  }

  describe.each(Object.keys(errorKinds) as (keyof typeof errorKinds)[])("%s returns a pending promise", kind => {
    test.concurrent("that starts its work in then()", async () => {
      const lazy = new LazyPromise<Response>(resolve => resolve(new Response("lazy", { status: 500 })));
      expect(await answerOfError(kind, () => lazy)).toEqual({ status: 500, body: "lazy" });
      expect(lazy.thenCalls).toBe(1);
    });

    test.concurrent("that starts its work in then() and settles later", async () => {
      const lazy = new LazyPromise<Response>(resolve =>
        setImmediate(() => resolve(new Response("lazy, later", { status: 500 }))),
      );
      expect(await answerOfError(kind, () => lazy)).toEqual({ status: 500, body: "lazy, later" });
      expect(lazy.thenCalls).toBe(1);
    });

    test.concurrent("that never settles itself", async () => {
      const make = () =>
        new ForwardingPromise<Response>(resolve => resolve(new Response("forwarded", { status: 500 })));
      expect(await answerOfError(kind, make)).toEqual({ status: 500, body: "forwarded" });
    });
  });

  // The state of the next three is the answer, as for the handler.
  test.concurrent("error() returns a pending subclass that inherits then()", async () => {
    let made = 0;
    class Eager<T> extends Promise<T> {
      constructor(executor: ConstructorParameters<typeof Promise<T>>[0]) {
        made++;
        super(executor);
      }
    }
    const make = () => new Eager<Response>(resolve => setImmediate(() => resolve(new Response("ok", { status: 500 }))));
    expect(await answerOfError("error()", make)).toEqual({ status: 500, body: "ok" });
    expect(made).toBe(1);
  });

  test.concurrent("error() returns a subclass with its own then() that already holds a Response", async () => {
    let thenCalls = 0;
    class Counting extends Promise<Response> {
      then(onFulfilled?: any, onRejected?: any): any {
        thenCalls++;
        return super.then(onFulfilled, onRejected);
      }
    }
    const make = () => Counting.resolve(new Response("from the state", { status: 500 }));
    expect(await answerOfError("error()", make)).toEqual({ status: 500, body: "from the state" });
    expect(thenCalls).toBe(0);
  });

  test.concurrent("error() returns a pending promise whose `then` accessor gives nothing to call", async () => {
    let reads = 0;
    class NothingToCall extends Promise<Response> {
      // @ts-expect-error an accessor in place of the method
      get then() {
        reads++;
        return undefined;
      }
    }
    const make = () =>
      new NothingToCall(resolve => setImmediate(() => resolve(new Response("from the state", { status: 500 }))));
    expect(await answerOfError("error()", make)).toEqual({ status: 500, body: "from the state" });
    expect(reads).toBe(1);
  });

  // The accessor ends the request. What its then() reports after that has no request to go to.
  test.concurrent("error() returns a pending promise whose `then` accessor stops the server", async () => {
    await using server = Bun.serve({
      port: 0,
      development: false,
      idleTimeout: 0,
      fetch: failures[failure] as any,
      error(): any {
        class Stops extends Promise<Response> {
          // @ts-expect-error an accessor in place of the method
          get then() {
            server.stop(true);
            return (onFulfilled: (value: Response) => void) => onFulfilled(new Response("unused"));
          }
        }
        return new Stops(() => {});
      },
    });
    expect(
      await fetch(server.url).then(
        response => response.status,
        () => "closed",
      ),
    ).toBe("closed");
    expect(server.pendingRequests).toBe(0);
  });

  test.concurrent("error() returns a pending promise whose `then` accessor upgrades the request", async () => {
    let request!: Request;
    await using server = Bun.serve({
      port: 0,
      development: false,
      fetch(req) {
        request = req;
        return (failures[failure] as any)();
      },
      error(): any {
        class Upgrades extends Promise<Response> {
          // @ts-expect-error an accessor in place of the method
          get then() {
            server.upgrade(request);
            return (onFulfilled: (value: Response) => void) => onFulfilled(new Response("unused"));
          }
        }
        return new Upgrades(() => {});
      },
      websocket: {
        open(ws) {
          ws.send("upgraded in the accessor");
        },
        message() {},
      },
    });
    const ws = new WebSocket(server.url.href.replace("http", "ws"));
    expect(await firstMessage(ws)).toBe("upgraded in the accessor");
    ws.close();
  });
});

describe("error() returns a promise with its own then()", () => {
  // One child for the three cases: each prints an error. In the first one the promise is settled, so error()
  // still has the error of the handler to report. (An `async` error() gives the Response of then() there.)
  test.concurrent("that gives no Response: the default page, for the error of the handler or of then()", async () => {
    const { stdout, stderr, exitCode } = await run(`
      let thenCalls = 0;
      const cases = {
        "holds a placeholder": () =>
          new (class extends Promise {
            then(onFulfilled, onRejected) { thenCalls++; return Promise.resolve(new Response("unused")).then(onFulfilled, onRejected); }
          })(resolve => resolve(null)),
        "is pending, then() rejects": () =>
          new (class extends Promise {
            then(onFulfilled, onRejected) { thenCalls++; return Promise.reject(new Error("rejected in then()")).then(onFulfilled, onRejected); }
          })(() => {}),
        "is pending, the then accessor throws": () =>
          new (class extends Promise {
            get then() { thenCalls++; throw new Error("thrown by the accessor"); }
          })(() => {}),
      };
      for (const [name, make] of Object.entries(cases)) {
        let errorCalls = 0;
        thenCalls = 0;
        const server = Bun.serve({
          port: 0,
          development: false,
          fetch() { throw new Error("thrown by fetch, " + name); },
          error() { errorCalls++; return make(); },
        });
        const response = await fetch(server.url);
        console.log(name + ":", response.status, await response.text(), "| error() calls:", errorCalls, "| then:", thenCalls);
        await server.stop(true);
      }
    `);
    expect(stderr.match(/error: .*/g)).toEqual([
      "error: thrown by fetch, holds a placeholder",
      "error: rejected in then()",
      "error: thrown by the accessor",
    ]);
    expect({ stdout, exitCode }).toEqual({
      stdout:
        "holds a placeholder: 500 Something went wrong! | error() calls: 1 | then: 0\n" +
        "is pending, then() rejects: 500 Something went wrong! | error() calls: 1 | then: 1\n" +
        "is pending, the then accessor throws: 500 Something went wrong! | error() calls: 1 | then: 1\n",
      exitCode: 1,
    });
  });
});
