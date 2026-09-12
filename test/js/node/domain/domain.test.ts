import { afterEach, describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import domain from "node:domain";
import { EventEmitter } from "node:events";
import http from "node:http";

describe("node:domain", () => {
  afterEach(() => {
    // A failed assertion between enter() and exit() must not poison later tests.
    while (domain._stack.length) {
      domain._stack[domain._stack.length - 1].exit();
    }
  });

  it("exports the Domain class", () => {
    expect(typeof domain.Domain).toBe("function");
    const d = domain.create();
    expect(d).toBeInstanceOf(domain.Domain);
    expect(d).toBeInstanceOf(EventEmitter);
    expect(domain.createDomain()).toBeInstanceOf(domain.Domain);
    expect(d.members).toEqual([]);
  });

  it("Domain is constructible with new", () => {
    const d = new domain.Domain();
    expect(d).toBeInstanceOf(domain.Domain);
    expect(d).toBeInstanceOf(EventEmitter);
    expect(d.members).toEqual([]);
    let processInRun: unknown;
    d.run(() => {
      processInRun = process.domain;
    });
    expect(processInRun).toBe(d);

    class Sub extends domain.Domain {
      extra() {
        return 1;
      }
    }
    const sub = new Sub();
    expect(sub).toBeInstanceOf(domain.Domain);
    expect(sub.extra()).toBe(1);
    expect(sub.members).toEqual([]);
  });

  it("run sets the active domain and process.domain", () => {
    const d = domain.create();
    let activeInRun: unknown, processInRun: unknown, thisInRun: unknown;
    d.run(function (this: unknown) {
      activeInRun = domain.active;
      processInRun = process.domain;
      thisInRun = this;
    });
    expect(activeInRun).toBe(d);
    expect(processInRun).toBe(d);
    expect(thisInRun).toBe(d);
    expect(process.domain).toBeUndefined();
  });

  it("run routes a thrown error to the domain's error event", () => {
    const d = domain.create();
    const err = new Error("boom");
    let seen: any;
    d.on("error", (e: any) => {
      seen = e;
    });
    d.run(() => {
      throw err;
    });
    expect(seen).toBe(err);
    expect(seen.domain).toBe(d);
    expect(seen.domainThrown).toBe(false);
    // Node sets no domainEmitter for run()-thrown errors.
    expect(seen.domainEmitter).toBeUndefined();
  });

  it("add and remove track members and route emitter errors", () => {
    const d = domain.create();
    const ee = new EventEmitter();
    d.add(ee);
    expect(d.members).toEqual([ee]);
    expect(ee.domain).toBe(d);

    const err = new Error("emitted");
    let seen: any;
    d.on("error", (e: any) => {
      seen = e;
    });
    ee.emit("error", err);
    expect(seen).toBe(err);
    expect(seen.domainEmitter).toBe(ee);

    d.remove(ee);
    expect(d.members).toEqual([]);
    expect(ee.domain).toBe(null);
  });

  it("bind enters the domain, keeps this and args, and returns the result", () => {
    const d = domain.create();
    let activeInBind: unknown;
    const receiver = {};
    const bound = d.bind(function (this: unknown, a: number, b: number) {
      activeInBind = domain.active;
      expect(this).toBe(receiver);
      return a + b;
    });
    expect(bound.call(receiver, 1, 2)).toBe(3);
    expect(activeInBind).toBe(d);
    expect(process.domain).toBeUndefined();

    let seen: any;
    d.on("error", (e: any) => {
      seen = e;
    });
    const err = new Error("bound");
    d.bind(() => {
      throw err;
    })();
    expect(seen).toBe(err);
  });

  it("intercept routes a leading error argument and forwards the rest", () => {
    const d = domain.create();
    let seen: any;
    d.on("error", (e: any) => {
      seen = e;
    });
    let activeInIntercept: unknown;
    const inner = function (data: number) {
      activeInIntercept = domain.active;
      return data * 2;
    };
    const fn = d.intercept(inner);
    expect(fn(null, 21)).toBe(42);
    expect(activeInIntercept).toBe(d);
    expect(process.domain).toBeUndefined();

    // Like node, a truthy non-Error first argument is dropped, not routed.
    expect(fn("not-an-error", 21)).toBe(42);
    expect(seen).toBeUndefined();

    const err = new Error("intercepted");
    fn(err);
    expect(seen).toBe(err);
    expect(seen.domainBound).toBe(inner);
    expect(seen.domainThrown).toBe(false);
  });

  it("enter and exit maintain the domain stack", () => {
    const a = domain.create();
    const b = domain.create();
    expect(a.enter()).toBe(a);
    expect(process.domain).toBe(a);
    expect(domain._stack).toEqual([a]);
    b.enter();
    expect(process.domain).toBe(b);
    expect(domain.active).toBe(b);
    expect(domain._stack).toEqual([a, b]);
    // Exiting an outer domain unwinds everything above it too.
    a.exit();
    expect(domain._stack).toEqual([]);
    expect(process.domain).toBeUndefined();
    // exit() on a domain that is not in the stack is a no-op.
    expect(b.exit()).toBe(b);
    expect(domain._stack).toEqual([]);
  });

  it("dispose detaches members", () => {
    const d = domain.create();
    const ee = new EventEmitter();
    d.add(ee);
    expect(d.dispose()).toBe(d);
    expect(d.members).toEqual([]);
    expect(ee.domain).toBe(null);
    expect(ee.listenerCount("error")).toBe(0);
  });

  it("falsy emitter errors become ERR_UNHANDLED_ERROR, truthy ones pass through", () => {
    // Matches node: test-event-emitter-no-error-provided-to-error-event.js.
    for (const arg of [false, null, undefined, 0, ""]) {
      const d = domain.create();
      const ee = new EventEmitter();
      d.add(ee);
      let seen: any;
      d.on("error", (e: any) => {
        seen = e;
      });
      ee.emit("error", arg);
      expect(seen).toBeInstanceOf(Error);
      expect(seen.code).toBe("ERR_UNHANDLED_ERROR");
    }
    for (const arg of [42, "fortytwo", true]) {
      const d = domain.create();
      const ee = new EventEmitter();
      d.add(ee);
      let seen: unknown;
      d.on("error", (e: unknown) => {
        seen = e;
      });
      ee.emit("error", arg);
      expect(seen).toBe(arg);
    }
  });

  it("add defines emitter.domain as non-enumerable like node", () => {
    const d = domain.create();
    const ee = new EventEmitter();
    d.add(ee);
    expect(Object.getOwnPropertyDescriptor(ee, "domain")).toEqual({
      value: d,
      writable: true,
      enumerable: false,
      configurable: true,
    });

    let seen: any;
    d.on("error", (e: any) => {
      seen = e;
    });
    ee.emit("error", new Error("emitted"));
    // Neither the members list nor err.domainEmitter leads back into the domain,
    // so none of these is cyclic.
    expect(Object.keys(ee)).not.toContain("domain");
    expect(JSON.parse(JSON.stringify(ee))).not.toHaveProperty("domain");
    expect(JSON.parse(JSON.stringify(d)).members).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(seen))).toEqual({
      domainEmitter: JSON.parse(JSON.stringify(ee)),
      domainThrown: false,
    });
  });

  it("add is idempotent and moves an emitter between domains", () => {
    const a = domain.create();
    const b = domain.create();
    const received: string[] = [];
    a.on("error", (e: Error) => received.push(`a:${e.message}`));
    b.on("error", (e: Error) => received.push(`b:${e.message}`));

    const ee = new EventEmitter();
    a.add(ee);
    a.add(ee);
    expect(a.members).toEqual([ee]);
    ee.emit("error", new Error("once"));
    expect(received).toEqual(["a:once"]);

    b.add(ee);
    expect(a.members).toEqual([]);
    expect(b.members).toEqual([ee]);
    expect(ee.domain).toBe(b);
    ee.emit("error", new Error("moved"));
    expect(received).toEqual(["a:once", "b:moved"]);
  });

  it("http client responses do not accumulate in domain.members", async () => {
    await using server = Bun.serve({
      port: 0,
      fetch: () => new Response("ok"),
    });
    const d = domain.create();
    d.on("error", () => {});
    let lastRes: any;
    for (let i = 0; i < 5; i++) {
      await new Promise<void>((resolve, reject) => {
        d.run(() => {
          http
            .get(`http://localhost:${server.port}/`, res => {
              lastRes = res;
              res.resume();
              res.on("close", resolve);
            })
            .on("error", reject);
        });
      });
    }
    expect(d.members).toEqual([]);

    // Error routing stays for the response's whole lifetime, like node.
    expect(lastRes.domain).toBe(d);
    const late = new Error("late");
    let seenLate: unknown;
    d.on("error", (e: unknown) => {
      seenLate = e;
    });
    lastRes.emit("error", late);
    expect(seenLate).toBe(late);
  });

  it("process.domain is null after requiring node:domain", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `require("node:domain");
         console.log(JSON.stringify([typeof process.domain, process.domain === null]));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(["object", true]);
    expect(exitCode).toBe(0);
  });
});
