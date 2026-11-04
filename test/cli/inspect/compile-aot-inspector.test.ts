import { spawn, type Subprocess } from "bun";
import { afterAll, expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDir } from "harness";
import { join } from "node:path";
import { beforeAll, describe, test } from "../../aot/supported";
import { SocketFramer } from "./socket-framer";

setDefaultTimeout(60_000);

const files = {
  "app.ts": `
class Account {
  tags: string[] = ["a", "b"];
  constructor(public owner: string, public balance: number, public parent: Account | null) {}
  deposit(n: number): void {
    this.balance += n;
  }
}
interface Options {
  host: string;
  port: number;
}
const account = new Account("ann", 10, new Account("root", 1, null));
const options: Options = { host: "h", port: 1 };
const shared = globalThis as unknown as Record<string, unknown>;
shared.account = account;
shared.options = options;
shared.list = [account, account.parent];
console.log("ready", account, options);
setInterval(() => {}, 1000);
`,
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      strict: true,
      module: "esnext",
      moduleResolution: "bundler",
      target: "esnext",
      types: [],
      lib: ["esnext", "dom"],
    },
  }),
};

class Session {
  stdout = "";
  stderr = "";
  readonly events: { method: string; params: any }[] = [];
  private nextId = 1;
  private readonly waiting = new Map<number, (message: any) => void>();
  private readonly woken: Array<() => void> = [];
  private sendText!: (text: string) => void;
  private proc!: Subprocess<"ignore", "pipe", "pipe">;

  async start(exe: string, cwd: string) {
    const { promise: connected, resolve } = Promise.withResolvers<void>();
    const session = this;
    const listener = Bun.listen<{ framer: SocketFramer }>({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(socket) {
          socket.data = { framer: new SocketFramer(text => session.onMessage(text)) };
          session.sendText = text => socket.data.framer.send(socket, text);
          listener.stop();
          resolve();
        },
        data(socket, bytes) {
          socket.data.framer.onData(socket, bytes);
        },
      },
    });
    this.proc = spawn({
      cmd: [exe],
      cwd,
      env: { ...bunEnv, BUN_INSPECT: `tcp://127.0.0.1:${listener.port}?wait=1` },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const pump = async (stream: ReadableStream<Uint8Array>, sink: "stdout" | "stderr") => {
      const decoder = new TextDecoder();
      for await (const chunk of stream) {
        this[sink] += decoder.decode(chunk, { stream: true });
        this.wake();
      }
    };
    pump(this.proc.stdout, "stdout");
    pump(this.proc.stderr, "stderr");
    await connected;
  }

  private wake() {
    this.woken.splice(0).forEach(wake => wake());
  }

  private onMessage(text: string) {
    const message = JSON.parse(text);
    if (typeof message.id === "number") {
      this.waiting.get(message.id)?.(message);
      this.waiting.delete(message.id);
      return;
    }
    this.events.push(message);
    this.wake();
  }

  async until<T>(look: () => T | undefined): Promise<T> {
    for (;;) {
      const found = look();
      if (found !== undefined) return found;
      await new Promise<void>(resolve => this.woken.push(resolve));
    }
  }

  async send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = this.nextId++;
    const response = new Promise<any>(resolve => this.waiting.set(id, resolve));
    this.sendText(JSON.stringify({ id, method, params }));
    const message = await response;
    if (message.error) throw new Error(`${method}: ${JSON.stringify(message.error)}`);
    return message.result;
  }

  async close() {
    this.proc.kill();
    await this.proc.exited;
  }
}

async function inspected(flags: string[]) {
  const dir = String(tempDir("compile-aot-inspector", files));
  await using build = spawn({
    cmd: [bunExe(), "build", "--compile", ...flags, "app.ts", "--outfile", "app"],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([build.stderr.text(), build.exited]);
  expect(stderr).not.toContain("error");
  expect(exitCode).toBe(0);
  const session = new Session();
  await session.start(join(dir, "app"), dir);
  for (const domain of ["Inspector", "Runtime", "Console"]) await session.send(domain + ".enable");
  await session.send("Inspector.initialized");
  await session.until(() => (session.stdout.includes("ready") ? true : undefined));
  return session;
}

const isWarningAboutCompiledCode = (event: { method: string; params: any }) =>
  event.method === "Console.messageAdded" &&
  event.params.message.level === "warning" &&
  event.params.message.text.includes("compiled ahead of time");

test("a debugger attached to an executable built without --aot gets no notice and sees the script", async () => {
  const session = await inspected([]);
  try {
    await session.send("Debugger.enable");
    await session.until(() =>
      session.events.find(event => event.method === "Debugger.scriptParsed" && event.params.url.endsWith("/app")),
    );
    await session.send("Runtime.evaluate", { expression: "1" });
    expect(session.events.filter(isWarningAboutCompiledCode)).toEqual([]);
  } finally {
    await session.close();
  }
});

describe("the inspector on an executable built with --aot --compile-inspector", () => {
  let session: Session;

  beforeAll(
    async () => {
      session = await inspected(["--aot", "--compile-inspector"]);
    },
    isASAN ? 180_000 : 60_000,
  );
  afterAll(() => session.close());

  test("a debugger is notified that it cannot pause in compiled code", async () => {
    await session.send("Debugger.enable");
    const warnings = session.events.filter(isWarningAboutCompiledCode);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].params.message.text).toContain(
      "Breakpoints, stepping, pausing and `debugger` statements have no effect in compiled code",
    );
    expect(warnings[0].params.message.text).toContain("To debug the program, run it from source with bun run.");
  });

  test("the preview of an object of a compiled class lists its fields", async () => {
    const { result } = await session.send("Runtime.evaluate", { expression: "account", generatePreview: true });
    expect(result.className).toBe("Account");
    expect(result.preview.properties).toBeArray();
    expect(result.preview.properties.map((property: any) => [property.name, property.value])).toEqual([
      ["owner", "ann"],
      ["balance", "10"],
      ["parent", "Account"],
      ["tags", undefined],
    ]);
  });

  test("the preview of an object of an interface lists its fields", async () => {
    const { result } = await session.send("Runtime.evaluate", { expression: "options", generatePreview: true });
    expect(result.preview.properties).toEqual([
      { name: "host", type: "string", value: "h" },
      { name: "port", type: "number", value: "1" },
    ]);
  });

  test("Runtime.getProperties opens an object of a compiled class", async () => {
    const { result } = await session.send("Runtime.evaluate", { expression: "account" });
    const { properties } = await session.send("Runtime.getProperties", {
      objectId: result.objectId,
      ownProperties: true,
    });
    expect(properties).toBeArray();
    const byName = Object.fromEntries(properties.map((property: any) => [property.name, property.value]));
    expect(byName.owner).toEqual({ type: "string", value: "ann" });
    expect(byName.balance).toMatchObject({ type: "number", value: 10 });
    expect(byName.parent).toMatchObject({ type: "object", className: "Account" });
    expect(byName.tags).toMatchObject({ type: "object", subtype: "array", size: 2 });
  });

  test("an array of compiled objects is previewed as an array", async () => {
    const { result } = await session.send("Runtime.evaluate", { expression: "list", generatePreview: true });
    expect(result.subtype).toBe("array");
    expect(result.preview.properties.map((property: any) => property.value)).toEqual(["Account", "Account"]);
  });

  test("an array without a prototype is returned by value as an array", async () => {
    const expression = "(() => { const array = [1, 2]; Object.setPrototypeOf(array, null); return array; })()";
    const { result } = await session.send("Runtime.evaluate", { expression, returnByValue: true });
    expect(result.value).toEqual([1, 2]);
  });

  test("console.log of compiled objects reaches the console with previews", async () => {
    const { message } = await session.until(
      () =>
        session.events.find(event => event.method === "Console.messageAdded" && event.params.message.text === "ready")
          ?.params,
    );
    const names = message.parameters
      .slice(1)
      .map((parameter: any) => parameter.preview.properties.map((property: any) => property.name));
    expect(names).toEqual([
      ["owner", "balance", "parent", "tags"],
      ["host", "port"],
    ]);
  });
});
