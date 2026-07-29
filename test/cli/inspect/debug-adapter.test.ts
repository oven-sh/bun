import { describe, expect, test } from "bun:test";
import { bunExe } from "harness";
import { WebSocketDebugAdapter } from "../../../packages/bun-debug-adapter-protocol/src/debugger/adapter.ts";
import type { DAP } from "../../../packages/bun-debug-adapter-protocol/src/protocol/index.d.ts";

// https://github.com/oven-sh/bun/issues/15706
describe("launch console", () => {
  test("integratedTerminal sends runInTerminal reverse request", async () => {
    const adapter = new WebSocketDebugAdapter();

    const reverseRequests: DAP.Request[] = [];
    const spawnRequests: unknown[] = [];
    adapter.on("Adapter.reverseRequest", (request, reply) => {
      reverseRequests.push(request);
      reply({
        type: "response",
        seq: 0,
        request_seq: request.seq,
        command: request.command,
        success: true,
        body: { shellProcessId: 1 },
      });
    });
    adapter.on("Process.requested", request => spawnRequests.push(request));

    adapter.initialize({
      adapterID: "bun",
      supportsRunInTerminalRequest: true,
    });

    try {
      await adapter.launch({
        runtime: bunExe(),
        program: "script.ts",
        cwd: process.cwd(),
        console: "integratedTerminal",
        env: { MY_VAR: "1" },
      } as DAP.LaunchRequest);

      expect(reverseRequests.length).toBe(1);
      const [request] = reverseRequests;
      expect(request.command).toBe("runInTerminal");
      const args = request.arguments as DAP.RunInTerminalRequest;
      expect(args.kind).toBe("integrated");
      expect(args.args).toEqual([bunExe(), "script.ts"]);
      expect(args.cwd).toBe(process.cwd());
      const env = args.env as Record<string, string>;
      expect(env.MY_VAR).toBe("1");
      expect(env.BUN_INSPECT).toStartWith("ws");
      expect(env.BUN_INSPECT_NOTIFY).toBeString();
      // A real terminal is a TTY; FORCE_COLOR is only injected for the internal console.
      expect(env.FORCE_COLOR).toBeUndefined();
      // runInTerminal env is additive; the adapter's own process.env must not leak into it.
      expect(Object.keys(env).sort()).toEqual([
        "BUN_DEBUG_QUIET_LOGS",
        "BUN_INSPECT",
        "BUN_INSPECT_NOTIFY",
        "BUN_QUIET_DEBUG_LOGS",
        "MY_VAR",
      ]);

      // No child_process.spawn when launching in a terminal.
      expect(spawnRequests.length).toBe(0);
    } finally {
      adapter.close();
    }
  });

  test("externalTerminal sends runInTerminal with kind external", async () => {
    const adapter = new WebSocketDebugAdapter();

    let kind: string | undefined;
    adapter.on("Adapter.reverseRequest", (request, reply) => {
      kind = (request.arguments as DAP.RunInTerminalRequest).kind;
      reply({
        type: "response",
        seq: 0,
        request_seq: request.seq,
        command: request.command,
        success: true,
      });
    });

    adapter.initialize({ adapterID: "bun", supportsRunInTerminalRequest: true });

    try {
      await adapter.launch({
        runtime: bunExe(),
        program: "script.ts",
        cwd: process.cwd(),
        console: "externalTerminal",
      } as DAP.LaunchRequest);

      expect(kind).toBe("external");
    } finally {
      adapter.close();
    }
  });

  test("falls back to spawn when client lacks runInTerminal support", async () => {
    const adapter = new WebSocketDebugAdapter();

    const reverseRequests: DAP.Request[] = [];
    const spawnRequests: unknown[] = [];
    adapter.on("Adapter.reverseRequest", (request, reply) => {
      reverseRequests.push(request);
      reply({ type: "response", seq: 0, request_seq: 0, command: request.command, success: true });
    });
    adapter.on("Process.requested", request => spawnRequests.push(request));

    adapter.initialize({
      adapterID: "bun",
      supportsRunInTerminalRequest: false,
    });

    try {
      await adapter.launch({
        runtime: bunExe(),
        runtimeArgs: ["-e", "0"],
        cwd: process.cwd(),
        console: "integratedTerminal",
        __skipValidation: true,
      } as DAP.LaunchRequest);

      expect(reverseRequests.length).toBe(0);
      expect(spawnRequests.length).toBe(1);
    } finally {
      adapter.close();
    }
  });

  test("default internalConsole still spawns", async () => {
    const adapter = new WebSocketDebugAdapter();

    const reverseRequests: DAP.Request[] = [];
    const spawnRequests: unknown[] = [];
    adapter.on("Adapter.reverseRequest", (request, reply) => {
      reverseRequests.push(request);
      reply({ type: "response", seq: 0, request_seq: 0, command: request.command, success: true });
    });
    adapter.on("Process.requested", request => spawnRequests.push(request));

    adapter.initialize({
      adapterID: "bun",
      supportsRunInTerminalRequest: true,
    });

    try {
      await adapter.launch({
        runtime: bunExe(),
        runtimeArgs: ["-e", "0"],
        cwd: process.cwd(),
        __skipValidation: true,
      } as DAP.LaunchRequest);

      expect(reverseRequests.length).toBe(0);
      expect(spawnRequests.length).toBe(1);
    } finally {
      adapter.close();
    }
  });

  test.each([
    [false, 1],
    [true, 0],
  ])(
    "terminal launch with watchMode=%p emits terminated on inspector disconnect %p time(s)",
    async (watchMode, expectedTerminated) => {
      const adapter = new WebSocketDebugAdapter();

      adapter.on("Adapter.reverseRequest", (request, reply) => {
        reply({ type: "response", seq: 0, request_seq: 0, command: request.command, success: true });
      });

      adapter.initialize({ adapterID: "bun", supportsRunInTerminalRequest: true });

      try {
        await adapter.launch({
          runtime: bunExe(),
          program: "script.ts",
          cwd: process.cwd(),
          console: "integratedTerminal",
          watchMode,
        } as DAP.LaunchRequest);

        let terminated = 0;
        adapter.on("Adapter.terminated", () => void terminated++);
        // Simulate a watch-mode restart: the inspector socket drops while the
        // terminal process stays alive. resetInternal() clears `options`, so a
        // second disconnect must still be suppressed in watch mode.
        await adapter["Inspector.disconnected"]();
        if (watchMode) await adapter["Inspector.disconnected"]();

        expect(terminated).toBe(expectedTerminated);
      } finally {
        adapter.close();
      }
    },
  );
});
