import { afterAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";

// Several clients of one `inspector.open()` server, and the in-process `inspector.Session` beside them.

// Each of these tests starts a program and attaches clients to it, which takes a debug build seconds.
const attachTimeout = isASAN || isDebug ? 120_000 : undefined;

// A test that times out does not dispose its process, and a paused program does not see its stdin close.
const processes: Bun.Subprocess[] = [];
afterAll(() => {
  for (const proc of processes) proc.kill();
});

/** Starts `entry.mjs`, which calls `inspector.open()`. Resolves with the process and its WebSocket URL. */
async function openInspectee(cwd: string) {
  const proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    env: bunEnv,
    cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  processes.push(proc);
  let stderr = "";
  const decoder = new TextDecoder();
  for await (const chunk of proc.stderr) {
    stderr += decoder.decode(chunk, { stream: true });
    const url = stderr.match(/Debugger listening on (ws:\S+)/)?.[1];
    if (url) return { proc, url };
  }
  proc.kill();
  throw new Error(`no inspector URL:\n${stderr}`);
}

/** A DevTools-protocol client. It counts the pauses, and resumes each one unless told not to. */
async function connectDevToolsClient(url: string, { resume = true } = {}) {
  const ws = new WebSocket(url);
  const pending = new Map<number, (message: any) => void>();
  const waiters: (() => void)[] = [];
  let nextId = 1;
  let isClosed = false;
  const client = {
    paused: 0,
    logged: [] as string[],
    send(method: string, params?: object) {
      const id = nextId++;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise<any>((resolve, reject) =>
        pending.set(id, message => (message ? resolve(message) : reject(new Error(`closed before ${method}`)))),
      );
    },
    /** Resolves when `condition()` holds. It is checked again after each event. */
    async until(condition: () => boolean) {
      while (!condition()) {
        if (isClosed) throw new Error("the inspector socket closed before the event");
        await new Promise<void>(resolve => waiters.push(resolve));
      }
    },
    close() {
      const { promise, resolve } = Promise.withResolvers<void>();
      if (isClosed) resolve();
      else ws.addEventListener("close", () => resolve());
      ws.close();
      return promise;
    },
  };
  ws.onmessage = event => {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      pending.get(message.id)?.(message);
      pending.delete(message.id);
      return;
    }
    if (message.method === "Debugger.paused") {
      client.paused++;
      if (resume) ws.send(JSON.stringify({ id: nextId++, method: "Debugger.resume" }));
    } else if (message.method === "Runtime.consoleAPICalled") {
      client.logged.push(message.params.args[0].value);
    }
    for (const waiter of waiters.splice(0)) waiter();
  };
  ws.onclose = () => {
    isClosed = true;
    for (const settle of pending.values()) settle(undefined);
    pending.clear();
    for (const waiter of waiters.splice(0)) waiter();
  };
  await new Promise((resolve, reject) => ((ws.onopen = resolve), (ws.onerror = reject)));
  return client;
}

// The inspector backend has one set of agents for every client. A V8 session takes its
// breakpoints with it, and the sessions that stay notice nothing.
test.concurrent.each(["an inspector.Session", "a WebSocket client"])(
  "%s that leaves takes its breakpoints with it, and the client that stays keeps its events",
  async leaving => {
    using dir = tempDir("inspector-leaving-client", {
      "entry.mjs": `
import inspector from "node:inspector";
import { hit } from "./target.mjs";
inspector.open(0, "127.0.0.1");
globalThis.hit = hit;
globalThis.session = new inspector.Session();
session.connect();
process.stdin.resume();
`,
      "target.mjs": `export function hit() {
  return "hit";
}
`,
    });
    const { proc, url } = await openInspectee(String(dir));
    await using _ = proc;

    const staying = await connectDevToolsClient(url);
    await staying.send("Runtime.enable");
    await staying.send("Debugger.enable");

    const breakpoint = { lineNumber: 1, urlRegex: "target\\.mjs$" };
    let leave: () => Promise<unknown>;
    if (leaving === "an inspector.Session") {
      // The Session forwards Debugger commands to the debugger thread and does not wait.
      await staying.send("Runtime.evaluate", {
        expression: `session.post("Debugger.enable"); session.post("Debugger.setBreakpointByUrl", ${JSON.stringify(breakpoint)})`,
      });
      leave = () => staying.send("Runtime.evaluate", { expression: "session.disconnect()" });
    } else {
      const client = await connectDevToolsClient(url);
      await client.send("Debugger.enable");
      expect(await client.send("Debugger.setBreakpointByUrl", breakpoint)).toEqual({
        id: expect.any(Number),
        result: expect.objectContaining({ breakpointId: expect.any(String) }),
      });
      leave = () => client.close();
    }

    // Calls hit() and says whether the program paused in it. The staying client resumes it.
    const hitPauses = async () => {
      const paused = staying.paused;
      await staying.send("Runtime.evaluate", { expression: "hit()" });
      return staying.paused !== paused;
    };

    // Each client's commands reach the inspected thread on a connection of their own, in no
    // order with the commands of another client. So the breakpoint works from some call on.
    let calls = 0;
    while (!(await hitPauses())) {
      if (++calls === 1000) throw new Error("the breakpoint never paused the program");
    }

    // And it is gone from some call on, after its client left.
    await leave();
    calls = 0;
    while (await hitPauses()) {
      if (++calls === 1000) throw new Error("the breakpoint of the client that left still pauses the program");
    }

    await staying.send("Runtime.evaluate", { expression: `hit(); console.log("after")` });
    expect(staying.logged).toEqual(["after"]);
    expect(proc.exitCode).toBeNull();
    await staying.close();
  },
  attachTimeout,
);

// The backend sends each response to every client. Two clients that send their commands at the
// same moment must not take each other's answers.
test.concurrent(
  "two DevTools clients each get the answers to their own commands",
  async () => {
    using dir = tempDir("inspector-two-clients", {
      "entry.mjs": `
import inspector from "node:inspector";
inspector.open(0, "127.0.0.1");
process.stdin.resume();
`,
    });
    const { proc, url } = await openInspectee(String(dir));
    await using _ = proc;
    const one = await connectDevToolsClient(url);
    const two = await connectDevToolsClient(url);

    const answers: unknown[] = [];
    for (let round = 0; round < 20; round++) {
      const [first, second] = await Promise.all([
        one.send("Runtime.evaluate", { expression: "'one'" }),
        two.send("Runtime.evaluate", { expression: "'two'" }),
      ]);
      answers.push([first.result?.result?.value, second.result?.result?.value]);
    }
    expect(answers).toEqual(Array.from({ length: 20 }, () => ["one", "two"]));

    await one.close();
    await two.close();
  },
  attachTimeout,
);

// A pause waits for a client that can resume it. The in-process Session cannot: its thread is
// the one that is paused. Node does not wait for it either.
test.concurrent(
  "a pause waits for a DevTools client, and never for the inspector.Session alone",
  async () => {
    using dir = tempDir("inspector-session-pause", {
      "entry.mjs": `
import inspector from "node:inspector";
inspector.open(0, "127.0.0.1");
const session = new inspector.Session();
session.connect();
session.post("Debugger.enable");
// Each line on stdin is a step: it runs a debugger statement and then says so.
process.stdin.on("data", data => {
  for (const step of String(data).trim().split("\\n")) {
    debugger;
    console.log("done " + step);
  }
});
`,
    });
    const { proc, url } = await openInspectee(String(dir));
    await using _ = proc;

    // The steps that the program has run through.
    const done: string[] = [];
    const waiters: (() => void)[] = [];
    (async () => {
      const decoder = new TextDecoder();
      let rest = "";
      for await (const chunk of proc.stdout) {
        const lines = (rest + decoder.decode(chunk, { stream: true })).split("\n");
        rest = lines.pop()!;
        for (const line of lines) done.push(line.slice("done ".length));
        for (const waiter of waiters.splice(0)) waiter();
      }
      for (const waiter of waiters.splice(0)) waiter();
    })();
    /** Tells the program to run a step. Resolves when the program has run through its debugger statement. */
    const step = (name: string) => {
      proc.stdin.write(name + "\n");
      proc.stdin.flush();
      return (async () => {
        while (!done.includes(name)) {
          if (proc.exitCode !== null) throw new Error(`the program exited before step ${name}`);
          await new Promise<void>(resolve => waiters.push(resolve));
        }
      })();
    };

    // The Session's Debugger.enable goes through the debugger thread, in no order with stdin. So the
    // statement pauses the program from some step on. A client holds that pause, as in Node, also
    // when the client did not turn the debugger on itself.
    const visitor = await connectDevToolsClient(url, { resume: false });
    await visitor.send("Runtime.enable");
    for (let i = 0; visitor.paused === 0; i++) {
      const finished = step("warm-up " + i);
      await Promise.race([finished, visitor.until(() => visitor.paused === 1)]);
      if (visitor.paused === 0) continue;
      // The answer to the resume says that the program waited for it.
      expect(await visitor.send("Debugger.resume")).toEqual({ id: expect.any(Number), result: {} });
      await finished;
    }
    await visitor.close();

    // With a debugger client attached the statement pauses the program, and the client resumes it.
    const first = await connectDevToolsClient(url);
    await first.send("Debugger.enable");
    await step("with a debugger client");
    expect(first.paused).toBe(1);

    // The client leaves while the program runs. Only the Session is left: nothing holds the program.
    await first.close();
    await step("with the Session alone");

    // The debugger went off with the client that had it on: the Session keeps nothing on by itself.
    // So a client that does not turn the debugger on holds no pause now.
    const later = await connectDevToolsClient(url, { resume: false });
    await later.send("Runtime.enable");
    await step("with a client that is no debugger");
    expect(later.paused).toBe(0);
    await later.close();

    // A client that attaches later gets a debugger that works. It leaves during the pause.
    const second = await connectDevToolsClient(url, { resume: false });
    await second.send("Debugger.enable");
    const finished = step("with a debugger client that leaves");
    await second.until(() => second.paused === 1);
    expect(done).not.toContain("with a debugger client that leaves");
    await second.close();
    await finished;

    await step("at the end");
    expect(proc.exitCode).toBeNull();
  },
  attachTimeout,
);
