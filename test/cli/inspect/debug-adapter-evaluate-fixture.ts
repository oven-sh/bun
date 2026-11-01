// Hosts the debug adapter of the VS Code extension (packages/bun-debug-adapter-protocol) and sends it
// the requests VS Code sends, against a `bun --inspect-wait` debuggee that stays paused on its
// `debugger` statement. debug-adapter-evaluate.test.ts imports this file to host the adapter in bun,
// and runs a bundle of it to host the adapter in node, as VS Code does.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { WebSocketDebugAdapter } from "../../../packages/bun-debug-adapter-protocol/src/debugger/adapter.ts";

export type Request =
  | { command: "evaluate"; expression: string; onCallFrame?: boolean; context?: string }
  | { command: "completions"; text: string }
  | { command: "setExpression"; expression: string; value: string }
  /** Whether the process that hosts the adapter has this global. */
  | { command: "hostGlobal"; name: string };

export type Result = {
  /** Each evaluation the adapter asked the inspector for: its method and its expression. */
  sent: [method: string, expression: string][];
  /** What VS Code shows: the result, the completion labels, or the message of the error. */
  printed: string | string[];
  /** Present when the adapter sent text that starts with `{`: whether that text parses in parentheses. */
  parenthesizedParses?: boolean;
};

export async function attach(bun: string, env: NodeJS.ProcessEnv, debuggee: string) {
  const proc = spawn(bun, ["--inspect-wait=127.0.0.1:0", "-e", debuggee], { env, stdio: ["ignore", "ignore", "pipe"] });

  // Every wait races `failed`, so a debuggee that dies reports its exit and its stderr at once.
  let stderr = "";
  let fail!: (error: Error) => void;
  const failed = new Promise<never>((_, reject) => (fail = reject));
  failed.catch(() => {});
  const alive = <T>(promise: Promise<T>) => Promise.race([promise, failed]);
  proc.on("error", fail);
  // "close" comes after the end of stderr, so the message has all of it.
  proc.on("close", (code, signal) => fail(new Error(`The debuggee exited (${signal ?? code}).\n${stderr}`)));

  const inspectorUrl = new Promise<string>(resolve => {
    proc.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
      // The WebSocket URL is on its own line of the listening banner. Only read complete lines.
      const line = stderr
        .split("\n")
        .slice(0, -1)
        .find(line => line.trim().startsWith("ws://"));
      if (line) resolve(line.trim());
    });
  });

  try {
    const adapter = new WebSocketDebugAdapter(await alive(inspectorUrl));

    // The adapter leaves a request pending when its connection is gone. Listen on the adapter: a
    // listener on the inspector takes the event away from the adapter's own handler.
    let disconnected = false;
    adapter.on("Inspector.disconnected", () => {
      disconnected = true;
      proc.kill();
    });
    // An error that the debuggee threw is a result. The error of a lost connection is not.
    const printError = (error: unknown) => (disconnected ? failed : String((error as Error)?.message ?? error));

    const sent: Result["sent"] = [];
    adapter.getInspector().on("Inspector.request", ({ method, params }) => {
      const { expression } = params as { expression?: unknown };
      if (typeof expression === "string") sent.push([method, expression]);
    });
    let callFrameId = "";
    adapter.on("Debugger.paused", ({ callFrames }) => {
      callFrameId = callFrames[0].callFrameId;
    });

    if (!(await alive(adapter.start()))) throw new Error(`The adapter did not connect to the debuggee.\n${stderr}`);
    adapter.initialize({ adapterID: "bun", clientID: "vscode", supportsConfigurationDoneRequest: true });
    await alive(adapter.setExceptionBreakpoints({ filters: ["debugger"] }));
    const stopped = once(adapter, "Adapter.stopped");
    adapter.configurationDone();
    await alive(stopped);
    const { stackFrames } = await alive(adapter.stackTrace({ threadId: 0 }));
    const frameId = stackFrames[0].id;

    async function run(request: Request): Promise<Result> {
      sent.length = 0;
      switch (request.command) {
        case "evaluate": {
          const { expression, context, onCallFrame } = request;
          const printed = await alive(
            adapter
              .evaluate({ expression, context, frameId: onCallFrame ? frameId : undefined })
              .then(({ result }) => result, printError),
          );
          const result: Result = { sent: [...sent], printed };
          const text = result.sent[0]?.[1];
          if (text?.startsWith("{")) {
            // `0&&` keeps the text from running. Only a text that does not parse is thrown.
            const probe = { expression: `0&&(${text}\n)`, doNotPauseOnExceptionsAndMuteConsole: true };
            const { wasThrown } = await alive(
              onCallFrame
                ? adapter.send("Debugger.evaluateOnCallFrame", { callFrameId, ...probe })
                : adapter.send("Runtime.evaluate", probe),
            );
            result.parenthesizedParses = !wasThrown;
          }
          return result;
        }
        case "completions": {
          const { text } = request;
          const { targets } = await alive(adapter.completions({ text, column: text.length }));
          return { sent: [...sent], printed: targets.map(({ label }) => label) };
        }
        case "setExpression": {
          const { expression, value } = request;
          const printed = await alive(
            adapter.setExpression({ expression, value }).then(({ value }) => value, printError),
          );
          return { sent: [...sent], printed };
        }
        case "hostGlobal":
          return { sent: [], printed: String(request.name in globalThis) };
      }
    }

    return {
      async run(requests: Request[]): Promise<Result[]> {
        const results: Result[] = [];
        for (const request of requests) results.push(await run(request));
        return results;
      },
      /** Resolves when the debuggee is gone. */
      async close(): Promise<void> {
        adapter.close();
        proc.kill();
        await failed.catch(() => {});
      },
    };
  } catch (error) {
    proc.kill();
    throw error;
  }
}

if (import.meta.main) {
  // Hosted by node. The test writes `[bun, debuggee, requests]` to stdin as JSON and reads the results from stdout.
  (async () => {
    let input = "";
    for await (const chunk of process.stdin.setEncoding("utf8")) input += chunk;
    const [bun, debuggee, requests] = JSON.parse(input);
    const session = await attach(bun, process.env, debuggee);
    try {
      process.stdout.write(JSON.stringify(await session.run(requests)));
    } finally {
      await session.close();
    }
  })().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
