import { expect, test } from "bun:test";
import inspector from "node:inspector";

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout (${ms}ms): ${label}`)), ms);
    promise.then(
      v => {
        clearTimeout(t);
        resolve(v);
      },
      e => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

test("inspector.Session: promise post + callback post", async () => {
  const session = new inspector.Session();
  session.connect();

  const res = await withTimeout(session.post("Runtime.evaluate", { expression: "1 + 1" }), 30_000, "Runtime.evaluate");
  expect(res).toMatchObject({
    result: { type: "number", value: 2 },
  });

  const cbRes = await withTimeout(
    new Promise<any>((resolve, reject) => {
      session.post("Runtime.evaluate", { expression: "2 + 3" }, (err: Error | null, result?: any) => {
        if (err) reject(err);
        else resolve(result);
      });
    }),
    30_000,
    "Runtime.evaluate (callback)",
  );

  expect(cbRes).toMatchObject({
    result: { type: "number", value: 5 },
  });

  session.disconnect();
  expect(() => session.post("Runtime.evaluate", { expression: "1" })).toThrow();
});

test("inspector.Session: notifications + domain event name", async () => {
  const session = new inspector.Session();
  session.connect();

  await withTimeout(session.post("Console.enable"), 30_000, "Console.enable");
  await withTimeout(session.post("Runtime.enable"), 30_000, "Runtime.enable");

  const notification = withTimeout(
    new Promise<any>(resolve => session.once("inspectorNotification", resolve)),
    30_000,
    "inspectorNotification",
  );

  const consoleEvent = withTimeout(
    new Promise<any>(resolve => session.once("Console.messageAdded", resolve)),
    30_000,
    "Console.messageAdded",
  );

  await withTimeout(session.post("Runtime.evaluate", { expression: "console.log('hello from session')" }), 30_000, "evaluate console.log");

  const notif = await notification;
  expect(notif).toBeObject();
  expect(typeof notif.method).toBe("string");

  const ev = await consoleEvent;
  expect(ev).toBeObject();

  session.disconnect();
});

test("inspector.Session: two sessions concurrent evaluate", async () => {
  const a = new inspector.Session();
  const b = new inspector.Session();

  a.connect();
  b.connect();

  try {
    const [ra, rb] = await withTimeout(
      Promise.all([a.post("Runtime.evaluate", { expression: "10 + 1" }), b.post("Runtime.evaluate", { expression: "20 + 2" })]),
      30_000,
      "concurrent evaluate",
    );

    expect(ra).toMatchObject({ result: { type: "number", value: 11 } });
    expect(rb).toMatchObject({ result: { type: "number", value: 22 } });
  } finally {
    a.disconnect();
    b.disconnect();
  }
});

test("inspector.Session: two sessions stress routing (promise+callback) + events not dropped", async () => {
  const a = new inspector.Session();
  const b = new inspector.Session();

  a.connect();
  b.connect();

  try {
    // Enable domains on both sessions to ensure events are emitted to both frontends.
    await withTimeout(
      Promise.all([a.post("Runtime.enable"), b.post("Runtime.enable"), a.post("Console.enable"), b.post("Console.enable")]),
      30_000,
      "enable Runtime/Console on both sessions",
    );

    // Set up listeners *before* triggering the console.log.
    const aConsoleEvent = withTimeout(
      new Promise<any>(resolve => a.once("Console.messageAdded", resolve)),
      30_000,
      "a Console.messageAdded",
    );
    const bConsoleEvent = withTimeout(
      new Promise<any>(resolve => b.once("Console.messageAdded", resolve)),
      30_000,
      "b Console.messageAdded",
    );

    // Trigger exactly one console event.
    await withTimeout(
      a.post("Runtime.evaluate", { expression: "console.log('hello from concurrent sessions')" }),
      30_000,
      "evaluate console.log (event trigger)",
    );

    // Both sessions should receive the broadcast event (events must not be dropped by native routing).
    const [ae, be] = await withTimeout(Promise.all([aConsoleEvent, bConsoleEvent]), 30_000, "both sessions receive Console.messageAdded");
    expect(ae).toBeObject();
    expect(be).toBeObject();

    // Stress: concurrent evaluate calls on both sessions, mixing promise + callback styles.
    // Keep the count moderate to avoid flakiness on slow CI, but high enough to catch routing bugs.
    const N = 50;
    const tasks: Promise<void>[] = [];

    for (let i = 0; i < N; i++) {
      const exprA = `${1000 + i} + 1`; // => 1001+i
      const expectedA = 1001 + i;

      const exprB = `${2000 + i} + 2`; // => 2002+i
      const expectedB = 2002 + i;

      // Promise style
      if (i % 5 !== 0) {
        tasks.push(
          a.post("Runtime.evaluate", { expression: exprA }).then((res: any) => {
            expect(res).toMatchObject({ result: { type: "number", value: expectedA } });
          }),
        );

        tasks.push(
          b.post("Runtime.evaluate", { expression: exprB }).then((res: any) => {
            expect(res).toMatchObject({ result: { type: "number", value: expectedB } });
          }),
        );
        continue;
      }

      // Callback style every 5th iteration
      tasks.push(
        new Promise<void>((resolve, reject) => {
          a.post("Runtime.evaluate", { expression: exprA }, (err: Error | null, result?: any) => {
            if (err) return reject(err);
            try {
              expect(result).toMatchObject({ result: { type: "number", value: expectedA } });
              resolve();
            } catch (e) {
              reject(e);
            }
          });
        }),
      );

      tasks.push(
        new Promise<void>((resolve, reject) => {
          b.post("Runtime.evaluate", { expression: exprB }, (err: Error | null, result?: any) => {
            if (err) return reject(err);
            try {
              expect(result).toMatchObject({ result: { type: "number", value: expectedB } });
              resolve();
            } catch (e) {
              reject(e);
            }
          });
        }),
      );
    }

    await withTimeout(Promise.all(tasks), 60_000, "stress concurrent evaluate (promise+callback)");
  } finally {
    a.disconnect();
    b.disconnect();
  }
});

// Real-world use case: Debugger domain (used by debuggers, breakpoint tools)
test("inspector.Session: Debugger.getScriptSource", async () => {
  const session = new inspector.Session();
  session.connect();

  try {
    await withTimeout(session.post("Debugger.enable"), 30_000, "Debugger.enable");

    // Wait for scriptParsed events
    const scriptParsed = withTimeout(
      new Promise<{ scriptId: string; url: string }>(resolve => {
        session.once("Debugger.scriptParsed", resolve);
      }),
      30_000,
      "Debugger.scriptParsed",
    );

    // Evaluate some code to trigger scriptParsed
    await withTimeout(
      session.post("Runtime.evaluate", {
        expression: "(function debuggerTestFn() { return 42; })()",
      }),
      30_000,
      "Runtime.evaluate",
    );

    const script = await scriptParsed;
    expect(script).toBeObject();
    expect(typeof script.scriptId).toBe("string");

    // Get the script source
    const sourceResult = await withTimeout(
      session.post("Debugger.getScriptSource", { scriptId: script.scriptId }),
      30_000,
      "Debugger.getScriptSource",
    );

    expect(sourceResult).toBeObject();
    expect(typeof sourceResult.scriptSource).toBe("string");

    await withTimeout(session.post("Debugger.disable"), 30_000, "Debugger.disable");
  } finally {
    session.disconnect();
  }
});
