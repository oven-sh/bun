import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

async function run(script: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// One domain with an 'error' listener plus process-level fallbacks. Every
// route prints one line and exits with a distinct code, so a test can tell the
// domain handler (0) from 'uncaughtException' (1) and 'unhandledRejection' (2).
const prelude = `
  const domain = require("node:domain");
  const EventEmitter = require("node:events");
  const d = domain.create();
  d.on("error", e => {
    console.log("domain:" + e.message, "thrown=" + e.domainThrown, "d=" + (e.domain === d),
      "emitter=" + (e.domainEmitter ? e.domainEmitter.constructor.name : "none"),
      "active=" + String(process.domain));
    process.exit(0);
  });
  process.on("uncaughtException", e => { console.log("uncaughtException:" + e.message, "active=" + String(process.domain)); process.exit(1); });
  process.on("unhandledRejection", e => { console.log("unhandledRejection:" + e.message); process.exit(2); });
`;

const thrown = "thrown=true d=true emitter=none active=undefined";

describe.concurrent("node:domain routes errors from async callbacks created inside the domain", () => {
  test("setTimeout", async () => {
    const { stdout, exitCode } = await run(prelude + `d.run(() => setTimeout(() => { throw new Error("boom"); }, 1));`);
    expect(stdout).toBe(`domain:boom ${thrown}\n`);
    expect(exitCode).toBe(0);
  });

  test("setImmediate", async () => {
    const { stdout, exitCode } = await run(prelude + `d.run(() => setImmediate(() => { throw new Error("boom"); }));`);
    expect(stdout).toBe(`domain:boom ${thrown}\n`);
    expect(exitCode).toBe(0);
  });

  test("process.nextTick", async () => {
    const { stdout, exitCode } = await run(
      prelude + `d.run(() => process.nextTick(() => { throw new Error("boom"); }));`,
    );
    expect(stdout).toBe(`domain:boom ${thrown}\n`);
    expect(exitCode).toBe(0);
  });

  test("a timer created by a timer", async () => {
    const { stdout, exitCode } = await run(
      prelude + `d.run(() => setTimeout(() => setTimeout(() => { throw new Error("boom"); }, 1), 1));`,
    );
    expect(stdout).toBe(`domain:boom ${thrown}\n`);
    expect(exitCode).toBe(0);
  });

  test("fs callback", async () => {
    const { stdout, exitCode } = await run(
      prelude + `d.run(() => require("fs").stat(".", () => { throw new Error("boom"); }));`,
    );
    expect(stdout).toBe(`domain:boom ${thrown}\n`);
    expect(exitCode).toBe(0);
  });

  test("net socket event", async () => {
    const { stdout, exitCode } = await run(
      prelude +
        `
        const net = require("net");
        const server = net.createServer(s => s.end()).listen(0, () => {
          d.run(() => {
            const c = net.connect(server.address().port);
            c.on("connect", () => { throw new Error("boom"); });
          });
        });`,
    );
    expect(stdout).toStartWith("domain:boom ");
    expect(exitCode).toBe(0);
  });

  test("process.domain and domain.active inside the callback", async () => {
    const { stdout, exitCode } = await run(
      prelude +
        `
        console.log("before", process.domain === undefined, domain.active === null, domain._stack.length);
        d.run(() => {
          console.log("inside", process.domain === d, domain.active === d, domain._stack.length);
          setTimeout(() => {
            console.log("timer", process.domain === d, domain.active === d, domain._stack.length);
            process.exit(0);
          }, 1);
        });
        console.log("after", process.domain === undefined, domain.active === null, domain._stack.length);`,
    );
    expect(stdout).toBe("before true true 0\ninside true true 1\nafter true true 0\ntimer true true 1\n");
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("node:domain routes unhandled rejections", () => {
  test("Promise.reject inside run()", async () => {
    const { stdout, exitCode } = await run(prelude + `d.run(() => { Promise.reject(new Error("boom")); });`);
    // node hands the reason to the domain without the thrown-error decoration
    expect(stdout).toBe("domain:boom thrown=undefined d=false emitter=none active=undefined\n");
    expect(exitCode).toBe(0);
  });

  test("a throw after await", async () => {
    const { stdout, exitCode } = await run(
      prelude + `d.run(async () => { await new Promise(r => setTimeout(r, 1)); throw new Error("boom"); });`,
    );
    expect(stdout).toBe("domain:boom thrown=undefined d=false emitter=none active=undefined\n");
    expect(exitCode).toBe(0);
  });

  test("a domain without an 'error' listener leaves the rejection to the process", async () => {
    const { stdout, exitCode } = await run(
      prelude +
        `
        const quiet = domain.create();
        quiet.run(() => { Promise.reject(new Error("boom")); });`,
    );
    expect(stdout).toBe("unhandledRejection:boom\n");
    expect(exitCode).toBe(2);
  });
});

describe.concurrent("node:domain EventEmitter integration", () => {
  test("an emitter created inside the domain routes 'error' without listeners to it", async () => {
    const { stdout, exitCode } = await run(
      prelude +
        `
        d.run(() => {
          const ee = new EventEmitter();
          setTimeout(() => ee.emit("error", new Error("boom")), 1);
        });`,
    );
    expect(stdout).toBe("domain:boom thrown=false d=true emitter=EventEmitter active=undefined\n");
    expect(exitCode).toBe(0);
  });

  test("an emitter created inside the domain enters it for every emit", async () => {
    const { stdout, exitCode } = await run(
      prelude +
        `
        let ee;
        d.run(() => {
          ee = new EventEmitter();
          ee.on("x", () => { throw new Error("boom"); });
        });
        setTimeout(() => ee.emit("x"), 1);`,
    );
    expect(stdout).toBe(`domain:boom ${thrown}\n`);
    expect(exitCode).toBe(0);
  });

  test("d.add(ee) and d.remove(ee)", async () => {
    const { stdout, exitCode } = await run(
      prelude +
        `
        const ee = new EventEmitter();
        const other = new EventEmitter();
        d.add(ee);
        d.add(other);
        d.remove(other);
        console.log(ee.domain === d, other.domain, d.members.length, Object.keys(ee).includes("domain"));
        // a domain cannot be added to itself or to one of its own members
        const child = domain.create();
        d.add(child);
        d.add(d);
        child.add(d);
        console.log(d.domain, child.domain === d, d.members.length);
        setTimeout(() => ee.emit("error", new Error("boom")), 1);`,
    );
    expect(stdout).toBe(
      "true null 1 false\nnull true 2\ndomain:boom thrown=false d=true emitter=EventEmitter active=undefined\n",
    );
    expect(exitCode).toBe(0);
  });

  test("an emitter with captureRejections keeps its own emit and still enters the domain", async () => {
    const { stdout, exitCode } = await run(
      prelude +
        `
        let ee;
        d.run(() => {
          ee = new EventEmitter({ captureRejections: true });
          ee.on("x", () => { console.log("listener", process.domain === d); throw new Error("boom"); });
        });
        console.log(Object.hasOwn(ee, "emit"));
        setTimeout(() => ee.emit("x"), 1);`,
    );
    expect(stdout).toBe(`true\nlistener true\ndomain:boom ${thrown}\n`);
    expect(exitCode).toBe(0);
  });

  test("an emitter with captureRejections routes 'error' without listeners to its domain", async () => {
    const { stdout, exitCode } = await run(
      prelude +
        `
        let ee;
        d.run(() => {
          ee = new EventEmitter({ captureRejections: true });
        });
        setTimeout(() => ee.emit("error", new Error("boom")), 1);`,
    );
    expect(stdout).toBe("domain:boom thrown=false d=true emitter=EventEmitter active=undefined\n");
    expect(exitCode).toBe(0);
  });

  test("EventEmitter.usingDomains and EventEmitter.init", async () => {
    // `bun -e` preloads a builtin for every identifier named like one, so the
    // module is bound to `dom` to keep the first line before the load.
    const { stdout, exitCode } = await run(
      `
      const EventEmitter = require("node:events");
      const init = EventEmitter.init;
      console.log(EventEmitter.usingDomains, "domain" in new EventEmitter());
      const dom = process.getBuiltinModule("node:domain");
      console.log(EventEmitter.usingDomains, EventEmitter.init !== init, "domain" in new EventEmitter(), new EventEmitter().domain);
      class Sub extends EventEmitter {}
      const d = dom.create();
      const sub = d.run(() => new Sub());
      console.log(sub.domain === d, d.domain, new EventEmitter().domain, sub instanceof Sub, sub.listenerCount("x"));`,
    );
    expect(stdout).toBe("false false\ntrue true true null\ntrue null null true 0\n");
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("node:domain run, bind and intercept", () => {
  test("a synchronous throw inside run() is handled and does not return to the caller", async () => {
    const { stdout, exitCode } = await run(
      prelude +
        `
        d.run(() => { throw new Error("boom"); });
        console.log("unreachable");`,
    );
    expect(stdout).toBe(`domain:boom ${thrown}\n`);
    expect(exitCode).toBe(0);
  });

  test("run() returns the callback's result and passes arguments", async () => {
    const { stdout, exitCode } = await run(
      prelude +
        `
        const result = d.run(function (a, b) { return [this === d, a, b, process.domain === d]; }, 1, 2);
        console.log(JSON.stringify(result), process.domain);`,
    );
    expect(stdout).toBe("[true,1,2,true] undefined\n");
    expect(exitCode).toBe(0);
  });

  test("bind()", async () => {
    const { stdout, exitCode } = await run(
      prelude +
        `
        const fn = d.bind(function (a) { console.log("bound", a, this.tag, process.domain === d); throw new Error("boom"); });
        console.log(fn.domain === d);
        setTimeout(() => fn.call({ tag: "t" }, 42), 1);`,
    );
    expect(stdout).toBe(`true\nbound 42 t true\ndomain:boom ${thrown}\n`);
    expect(exitCode).toBe(0);
  });

  test("intercept() with an error argument", async () => {
    const { stdout, exitCode } = await run(
      prelude +
        `
        d.prependListener("error", e => console.log("bound=" + (e.domainBound === cb)));
        const cb = () => { throw new Error("not called"); };
        setTimeout(d.intercept(cb), 1, new Error("boom"));`,
    );
    expect(stdout).toBe("bound=true\ndomain:boom thrown=false d=true emitter=none active=undefined\n");
    expect(exitCode).toBe(0);
  });

  test("intercept() without an error argument drops the first argument", async () => {
    const { stdout, exitCode } = await run(
      prelude +
        `
        setTimeout(d.intercept((a, b) => { console.log("intercepted", a, b, process.domain === d); throw new Error("boom"); }), 1, null, 1, 2);`,
    );
    expect(stdout).toBe(`intercepted 1 2 true\ndomain:boom ${thrown}\n`);
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("node:domain without a handler and with nested domains", () => {
  test("a domain without an 'error' listener leaves the error to 'uncaughtException' with the stack cleared", async () => {
    const { stdout, exitCode } = await run(
      prelude +
        `
        const quiet = domain.create();
        quiet.run(() => setTimeout(() => { throw new Error("boom"); }, 1));`,
    );
    expect(stdout).toBe("uncaughtException:boom active=undefined\n");
    expect(exitCode).toBe(1);
  });

  test("a synchronous throw in an inner domain without a listener goes to the outer domain", async () => {
    const { stdout, exitCode } = await run(
      prelude +
        `
        const inner = domain.create();
        d.run(() => inner.run(() => { throw new Error("boom"); }));`,
    );
    expect(stdout).toBe(`domain:boom ${thrown}\n`);
    expect(exitCode).toBe(0);
  });

  test("an async throw in an inner domain without a listener is not handed to the outer domain", async () => {
    // node: the timer callback runs with only the inner domain active
    const { stdout, exitCode } = await run(
      prelude +
        `
        const inner = domain.create();
        d.run(() => inner.run(() => setTimeout(() => { throw new Error("boom"); }, 1)));`,
    );
    expect(stdout).toBe("uncaughtException:boom active=undefined\n");
    expect(exitCode).toBe(1);
  });

  test("a run() that completed in an earlier callback does not make a later async throw synchronous", async () => {
    const { stdout, exitCode } = await run(
      prelude +
        `
        const inner = domain.create();
        d.run(() => inner.run(() => setTimeout(() => {
          inner.run(() => {});
          setTimeout(() => { throw new Error("boom"); }, 1);
        }, 1)));`,
    );
    expect(stdout).toBe("uncaughtException:boom active=undefined\n");
    expect(exitCode).toBe(1);
  });

  test("an inner domain with a listener handles its own async errors", async () => {
    const { stdout, exitCode } = await run(
      prelude +
        `
        const inner = domain.create();
        inner.on("error", e => { console.log("inner:" + e.message, process.domain === d, domain._stack.length); process.exit(3); });
        d.run(() => inner.run(() => setTimeout(() => { throw new Error("boom"); }, 1)));`,
    );
    expect(stdout).toBe("inner:boom true 1\n");
    expect(exitCode).toBe(3);
  });

  test("an 'error' handler that throws hands its error to the outer domain", async () => {
    const { stdout, exitCode } = await run(
      prelude +
        `
        const inner = domain.create();
        inner.on("error", e => { throw new Error("from handler: " + e.message); });
        d.run(() => inner.run(() => { throw new Error("boom"); }));`,
    );
    expect(stdout).toBe(`domain:from handler: boom ${thrown}\n`);
    expect(exitCode).toBe(0);
  });

  test("a throw in a child domain added to its parent reaches the parent's handler once", async () => {
    const { stdout, exitCode } = await run(
      `
      const domain = require("node:domain");
      const parent = domain.create();
      const child = domain.create();
      parent.add(child);
      let calls = 0;
      parent.on("error", e => {
        calls++;
        console.log("parent:" + e.message, "emitter=" + (e.domainEmitter === child), "d=" + (e.domain === parent));
      });
      process.on("uncaughtException", e => { console.log("uncaughtException:" + e.message); process.exit(1); });
      setTimeout(() => { console.log("calls", calls); process.exit(0); }, 1);
      parent.run(() => child.run(() => { throw new Error("boom"); }));`,
    );
    expect(stdout).toBe("parent:boom emitter=true d=true\ncalls 1\n");
    expect(exitCode).toBe(0);
  });

  test("a top-level 'error' handler that throws is fatal with exit code 7", async () => {
    const { stdout, stderr, exitCode } = await run(
      `
      const domain = require("node:domain");
      const d = domain.create();
      d.on("error", () => { throw new Error("exception from domain error handler"); });
      d.run(() => process.nextTick(() => { throw new Error("You should NOT see me"); }));`,
    );
    expect(stdout).toBe("");
    expect(stderr).toContain("exception from domain error handler");
    expect(stderr).not.toContain("You should NOT see me");
    expect(exitCode).toBe(7);
  });
});

describe.concurrent("node:domain per-request error handling", () => {
  test("an http server answers 500 instead of dying when a request's timer throws", async () => {
    const { stdout, exitCode } = await run(
      `
      const domain = require("node:domain");
      const http = require("http");
      process.on("uncaughtException", e => { console.log("uncaughtException:" + e.message); process.exit(1); });
      const server = http.createServer((req, res) => {
        const d = domain.create();
        d.on("error", e => {
          res.statusCode = 500;
          res.end("handled: " + e.message);
        });
        d.run(() => setTimeout(() => { throw new Error("boom"); }, 1));
      }).listen(0, async () => {
        const res = await fetch("http://localhost:" + server.address().port);
        console.log(res.status, await res.text());
        server.close();
      });`,
    );
    expect(stdout).toBe("500 handled: boom\n");
    expect(exitCode).toBe(0);
  });
});
