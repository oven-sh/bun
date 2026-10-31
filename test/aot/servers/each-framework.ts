// What ./<framework>.test.ts asks of the servers that are written on one framework.
//
// ./app has the same servers written many times, each the way a user of that framework would write it:
//   <name>.ts            the routes of ./answers.ts
//   api-<name>.ts        a small API behind three middlewares, with the API routes of ./answers.ts
//   features/<name>      many features of the framework: hooks, schemas, cookies, redirects, streams, every kind of body
// ./app/all/<framework>.ts starts those of one framework in one process. It is built once with `bun build --compile --aot`, so the
// framework and the modules of Bun below it are compiled once for all of them.
//
//   every request        the executable answers with the status, headers and body that plain Bun answers with
//   every route          and they are what ./answers.ts says
//   a few thousand       requests later each route still answers the same, and a new array still has contiguous storage
//   other engines        the same with the RegExp JIT off, with the GC running continuously, and with a GC every few allocations
//                        that overwrites dead cells
//   other build options  the same with --trim and --disallow-code-generation-from-strings, for the frameworks that ask for it: it is a second build
//
// Each test file works in a copy of ./app, where it installs the packages of ./app/bun.lock.
import { afterAll, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canTrim } from "../../bundler/compile-trim-features";
import { run } from "../harness/run";
import { beforeAll, describe, test } from "../supported";
import { apiRoutes, invalidOrderBody, invalidOrders, routes, type Route } from "./answers";
import { edgeCaseRequests, featureRequests, type RequestSpec } from "./requests";
import { copyApp } from "./run-servers";

const dir = tempDir("aot-servers", {});
const app = join(String(dir), "app");
const timeout = 600_000;

/** AOT_SERVERS_FLAGS="--aot-heat=everything-is-hot": more flags for every build. What a server answers does not depend on them. */
const moreFlags = (process.env.AOT_SERVERS_FLAGS ?? "").split(" ").filter(Boolean);
/** AOT_SERVERS_ENVIRONMENT="A=1 B=2": more variables for every run of an executable. */
const moreEnvironment = Object.fromEntries(
  (process.env.AOT_SERVERS_ENVIRONMENT ?? "")
    .split(" ")
    .filter(Boolean)
    .map(pair => pair.split("=")),
);

type Kind = "routes" | "api" | "features";
type Server = { kind: Kind; file: string };
type Answers = Record<string, unknown>;

/** The servers that ./app/all/<framework>.ts imports, in the order in which they start. */
function serversOf(framework: string): Server[] {
  const text = readFileSync(join(import.meta.dir, "app", "all", `${framework}.ts`), "utf8");
  return Array.from(text.matchAll(/^await import\("\.\.\/(.+)"\);$/gm), ([, file]) => ({
    kind: file.startsWith("features/") ? "features" : file.startsWith("api-") ? "api" : "routes",
    file,
  }));
}

/** By origin: what has become of the process that listens there. */
const stateOfServer = new Map<string, () => Promise<string>>();
/** fetch(). Where the request fails the error also says whether the server still runs, how it ended, and what it printed last. */
async function fetchFrom(origin: string, path: string, init: RequestInit = {}) {
  try {
    return await fetch(origin + path, init);
  } catch (error) {
    throw new Error(`${init.method ?? "GET"} ${path}: ${error}\n${await stateOfServer.get(origin)?.()}`, {
      cause: error,
    });
  }
}

/** Starts the servers on free ports and waits until each has printed `listening <port>`. */
async function start(cmd: string[], count: number, env: Record<string, string | undefined>) {
  // stderr is piped because Express logs every error that it answers with 400.
  const proc = Bun.spawn({
    cmd,
    cwd: app,
    env: { ...env, PORT: "0", NODE_ENV: "production" },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  let errors = "";
  const readErrors = (async () => {
    for await (const chunk of proc.stderr.pipeThrough(new TextDecoderStream())) errors += chunk;
  })();
  let output = "";
  let told = Promise.withResolvers<void>();
  const read = (async () => {
    for await (const chunk of proc.stdout.pipeThrough(new TextDecoderStream())) {
      output += chunk;
      told.resolve();
      told = Promise.withResolvers();
    }
  })();
  const ports = () => Array.from(output.matchAll(/^listening (\d+)$/gm), ([, port]) => port);
  while (ports().length < count) {
    const next = told.promise;
    if ((await Promise.race([next, read.then(() => "ended")])) === "ended" && ports().length < count)
      throw new Error(
        `${cmd.join(" ")} exited with code ${await proc.exited} before listening:\n${output}${(await readErrors, errors)}`,
      );
  }
  const origins = ports().map(port => `http://127.0.0.1:${port}`);
  for (const origin of origins)
    stateOfServer.set(origin, async () => {
      // A process that is ending closes its connections first.
      const hasEnded = await Promise.race([Promise.all([proc.exited, readErrors]).then(() => true), Bun.sleep(2000)]);
      return [
        hasEnded
          ? `the server ended with ${proc.signalCode ?? `exit code ${proc.exitCode}`}`
          : "the server is still running",
        ...errors.split("\n").filter(Boolean).slice(-20),
      ].join("\n  ");
    });
  return {
    origins,
    /** Ends the input of the process, at which ./app/all/array-kind.ts has it exit. */
    async end() {
      proc.stdin.end();
      const exitCode = await proc.exited;
      await read;
      return { exitCode, signal: proc.signalCode, newArrays: /^new arrays: (\w+)$/m.exec(output)?.[1] };
    },
    async [Symbol.asyncDispose]() {
      proc.kill("SIGKILL");
      await proc.exited;
    },
  };
}

const withoutTimes = (text: string, origin: string) =>
  text.replaceAll(origin, "<origin>").replace(/\b\d{13}\b/g, "<time>");

async function send(origin: string, route: Route, body = route.request) {
  const response = await fetchFrom(origin, route.path, {
    redirect: "manual",
    method: route.method,
    body,
    headers: { ...route.headers, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
  });
  return {
    status: response.status,
    type: response.headers.get("Content-Type")?.split(";")[0]!.trim().toLowerCase(),
    added: ["x-request-id", "x-content-type-options", "cache-control"].map(name => response.headers.get(name)),
    body: await response.text(),
  };
}

async function sendWhole(
  origin: string,
  method: string,
  path: string,
  headers?: Record<string, string>,
  body?: string,
) {
  const response = await fetchFrom(origin, path, { method, headers, body, redirect: "manual" });
  return {
    status: response.status,
    headers: [...response.headers]
      .filter(([header]) => header !== "date")
      .map(([header, value]) => [header, value.replace(/Expires=[^;]+/, "Expires=<time>")])
      .sort(),
    body: withoutTimes(await response.text(), origin),
  };
}

/** The status line and the header lines of a response. fetch() hides their order and case. */
async function sendRaw(origin: string, [method, path, headers, body]: RequestSpec) {
  const { hostname, port } = new URL(origin);
  const lines = [`${method} ${path} HTTP/1.1`, `Host: ${hostname}:${port}`, "Connection: close"];
  for (const [header, value] of Object.entries(headers ?? {})) lines.push(`${header}: ${value}`);
  if (body !== undefined) lines.push(`Content-Length: ${Buffer.byteLength(body)}`);
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  let received = "";
  await Bun.connect({
    hostname,
    port: Number(port),
    socket: {
      open: socket => void socket.write(lines.join("\r\n") + "\r\n\r\n" + (body ?? "")),
      data: (socket, chunk) => void (received += chunk.toString("latin1")),
      close: () => resolve(received),
      error: (socket, error) => reject(error),
    },
  });
  return (await promise)
    .split("\r\n\r\n")[0]
    .split("\r\n")
    .filter(line => !/^date:/i.test(line))
    .map(line => line.replace(/Expires=[^;]+/, "Expires=<time>").replaceAll(origin, "<origin>"));
}

/** Connects two clients to the WebSocket endpoint of ./app/features/bun.ts and returns the messages that each received. */
async function runWebSocketSession(origin: string) {
  const messages: Record<string, string[]> = { ada: [], bob: [] };
  let told = Promise.withResolvers<void>();
  const add = (name: string, message: string) => {
    messages[name].push(message);
    told.resolve();
    told = Promise.withResolvers();
  };
  const waitForMessages = async (count: number) => {
    while (messages.ada.length + messages.bob.length < count) await told.promise;
  };
  const connect = (name: string) => {
    const socket = new WebSocket(`${origin.replace("http", "ws")}/socket?name=${name}`);
    socket.binaryType = "arraybuffer";
    socket.onmessage = event =>
      add(name, typeof event.data === "string" ? event.data : `bytes ${new Uint8Array(event.data)}`);
    socket.onclose = event => add(name, `closed: ${event.code} ${event.reason}`);
    return socket;
  };
  const ada = connect("ada");
  await waitForMessages(1);
  const bob = connect("bob");
  await waitForMessages(2);
  ada.send("quiet");
  await waitForMessages(3);
  ada.send(new Uint8Array([1, 2, 3]));
  await waitForMessages(4);
  ada.send("all:good morning");
  await waitForMessages(5);
  bob.send("x".repeat(100_000));
  await waitForMessages(6);
  bob.send("bye");
  await waitForMessages(8);
  ada.close(1000, "done");
  await waitForMessages(9);
  return messages;
}

/** Aborts a request to the endless event stream of ./app/features/bun.ts. Returns what the client read and what the server counted. */
async function abortEventStream(origin: string) {
  const controller = new AbortController();
  const response = await fetchFrom(origin, "/events", { signal: controller.signal });
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let text = "";
  while (!text.includes("id: 5\n")) text += (await reader.read()).value;
  controller.abort();
  let counters = {};
  while (!Bun.deepEquals(counters, { aborted: 1, cancelled: 1 })) {
    await Bun.sleep(1);
    counters = await (await fetchFrom(origin, "/left")).json();
  }
  return { type: response.headers.get("Content-Type"), first: text.slice(0, text.indexOf("id: 5\n")), counters };
}

const create = apiRoutes.find(route => route.name === "create")!;
const otherApiRequests: Route[] = [
  { ...create, name: "text that is not JSON", request: '{"title":' },
  {
    ...create,
    name: "a priority out of range",
    request: JSON.stringify({ title: "a", priority: 9, assigneeId: 5, tags: [] }),
  },
  {
    ...create,
    name: "an unknown assignee",
    request: JSON.stringify({ title: "a", priority: 1, assigneeId: 500, tags: [] }),
  },
  { ...create, name: "an unknown project", path: "/api/projects/77/tasks" },
  { ...create, name: "an unknown token", headers: { ...create.headers, authorization: "Bearer nobody" } },
  { ...create, name: "no request id", headers: { authorization: create.headers!.authorization! } },
  { ...apiRoutes[1]!, name: "an id that is not a number", path: "/api/projects/three/tasks/317" },
  { ...apiRoutes[1]!, name: "an unknown task", path: "/api/projects/3/tasks/999" },
  { ...apiRoutes[1]!, name: "an unknown path under /api", path: "/api/nothing" },
];

/** Every request to one server, always in the same order: a server may keep state. */
async function ask(origin: string, { kind, file }: Server): Promise<Answers> {
  const answers: Answers = {};
  if (kind === "routes") {
    for (const route of routes) answers[route.name] = await send(origin, route);
    answers["an unknown path"] = (await fetchFrom(origin, "/nothing")).status;
    for (const route of routes.filter(route => route.method === "POST")) {
      for (const [description, request] of Object.entries(invalidOrders))
        answers[`${route.name}: ${description}`] = await send(origin, route, request);
      answers[`${route.name}: a valid order behind them`] = await send(origin, route);
    }
    for (const [method, path, init] of edgeCaseRequests)
      answers[`${method} ${path} ${JSON.stringify(init?.headers ?? {})} ${String(init?.body ?? "").length}`] =
        await sendWhole(origin, method, path, init?.headers, init?.body);
  } else if (kind === "api") {
    for (const route of [...apiRoutes, ...otherApiRequests]) answers[route.name] = await send(origin, route);
  } else {
    const specs = featureRequests[file.slice("features/".length)];
    // Twice: the second request meets what the first has filled.
    for (const pass of ["first", "second"])
      for (const [method, path, headers, body] of specs)
        answers[`${pass} ${method} ${path} ${JSON.stringify(headers ?? {})} ${body ?? ""}`] = await sendWhole(
          origin,
          method,
          path,
          headers,
          body,
        );
    for (const spec of specs)
      answers[`raw ${spec[0]} ${spec[1]} ${JSON.stringify(spec[2] ?? {})} ${(spec[3] ?? "").length}`] = await sendRaw(
        origin,
        spec,
      );
    if (file === "features/bun.ts") {
      answers["a WebSocket session"] = await runWebSocketSession(origin);
      answers["an aborted event stream"] = await abortEventStream(origin);
    }
  }
  return answers;
}

const askAll = async (origins: string[], servers: Server[]) =>
  Object.fromEntries(
    await Promise.all(servers.map(async (server, index) => [server.file, await ask(origins[index], server)] as const)),
  );

const routesOf = ({ kind }: Server) => (kind === "routes" ? routes : kind === "api" ? apiRoutes : []);

/** Sends the request of each route `times` times on each of sixteen connections. */
async function askAgainAndAgain(origins: string[], servers: Server[], times: number) {
  for (const [index, server] of servers.entries()) {
    for (const route of routesOf(server)) {
      let mismatch: unknown;
      await Promise.all(
        Array.from({ length: 16 }, async () => {
          for (let n = 0; n < times && !mismatch; n++) {
            const { status, body } = await send(origins[index], route);
            if (status !== (route.status ?? 200) || body !== route.expectedBody) mismatch = { status, body };
          }
        }),
      );
      expect({ server: server.file, route: route.name, mismatch }).toEqual({
        server: server.file,
        route: route.name,
        mismatch: undefined,
      });
    }
  }
}

export function testFramework(
  framework: string,
  { generatesHandlersFromStrings = false, alsoWithOtherBuildOptions = false } = {},
) {
  const servers = serversOf(framework);
  const entry = `./all/${framework}.ts`;
  // The bundler inlines process.env.NODE_ENV and defaults it to "development", which would make Express put stack traces into its answers.
  const flags = ["--define", 'process.env.NODE_ENV="production"', "--target=bun"];
  afterAll(() => dir[Symbol.dispose]());

  const executableNamed = (name: string) => join(String(dir), name + (isWindows ? ".exe" : ""));
  async function build(name: string, more: string[], env = bunEnv) {
    const executable = executableNamed(name);
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", ...moreFlags, ...more, ...flags, entry, "--outfile", executable],
      app,
      env,
    );
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({
      stderr: expect.not.stringMatching(/^error\b/m),
      exitCode: 0,
    });
    return executable;
  }
  const startCompiled = (executable: string, env: Record<string, string> = {}) =>
    start([executable], servers.length, {
      ...bunEnv,
      BUN_JSC_crashIfInterpreterIsUsed: "1",
      ...moreEnvironment,
      ...env,
    });

  describe(framework, () => {
    let executable: string;
    let expected: Record<string, Answers>;
    const options = [
      ...(canTrim ? ["--trim"] : []),
      ...(generatesHandlersFromStrings ? [] : ["--disallow-code-generation-from-strings"]),
    ];
    // What --trim removes is decided behind the compiler. Where it is the only other option, one build compiles the servers and writes both executables.
    const oneBuildWritesBoth = alsoWithOtherBuildOptions && options.join() === "--trim";

    beforeAll(async () => {
      await copyApp(app);
      const building = oneBuildWritesBoth
        ? build("variant", options, { ...bunEnv, BUN_DEBUG_TEST_UNTRIMMED_OUTFILE: executableNamed("compiled") }).then(
            () => executableNamed("compiled"),
          )
        : build("compiled", []);
      await using plain = await start([bunExe(), entry], servers.length, bunEnv);
      expected = await askAll(plain.origins, servers);
      executable = await building;
    }, timeout);

    test(
      "answers as plain Bun does, also after a few thousand requests",
      async () => {
        await using compiled = await startCompiled(executable);
        expect(await askAll(compiled.origins, servers)).toEqual(expected);
        await askAgainAndAgain(compiled.origins, servers, 200);
        // ES5-style inheritance between functions (util.inherits, transpiled classes) must not switch every array of the realm to slow storage.
        expect(await compiled.end()).toEqual({ exitCode: 0, signal: null, newArrays: "ArrayWithContiguous" });
      },
      timeout,
    );

    test("plain Bun answers every route with what is written down", () => {
      for (const server of servers) {
        for (const route of routesOf(server))
          expect({ server: server.file, route: route.name, ...(expected[server.file][route.name] as object) }).toEqual({
            server: server.file,
            route: route.name,
            status: route.status ?? 200,
            type: route.type === "-" ? expect.any(String) : route.type,
            added: server.kind === "api" ? ["r-1", "nosniff", "no-store"] : expect.any(Array),
            body: route.expectedBody,
          });
        if (server.file === "features/bun.ts")
          expect(expected[server.file]["a WebSocket session"]).toMatchObject({
            ada: expect.arrayContaining(["bob left: 4001 said bye"]),
          });
        if (server.kind !== "routes") continue;
        expect(expected[server.file]["an unknown path"]).toBe(404);
        for (const route of routes.filter(route => route.method === "POST")) {
          expect(expected[server.file][`${route.name}: a quantity of zero`]).toMatchObject({ body: invalidOrderBody });
          expect(expected[server.file][`${route.name}: a valid order behind them`]).toMatchObject({
            status: 200,
            body: route.expectedBody,
          });
        }
        for (const route of ["post", "hand"])
          for (const description of Object.keys(invalidOrders))
            expect({ route, description, answer: expected[server.file][`${route}: ${description}`] }).toEqual({
              route,
              description,
              answer: expect.objectContaining({ status: 400 }),
            });
      }
    });

    // Express, Koa and Hono match paths with regular expressions that are made at run time, so both RegExp engines must agree.
    test.each([
      ["with the RegExp JIT off", { BUN_JSC_useRegExpJIT: "0" }, 0],
      ["with the GC running continuously", { BUN_JSC_collectContinuously: "1" }, 25],
      [
        "with a GC every few allocations that overwrites dead cells",
        { BUN_JSC_useZombieMode: "1", BUN_JSC_sweepSynchronously: "1", BUN_JSC_slowPathAllocsBetweenGCs: "50" },
        25,
      ],
    ])(
      "answers the same %s",
      async (_, env, times) => {
        await using compiled = await startCompiled(executable, env);
        expect(await askAll(compiled.origins, servers)).toEqual(expected);
        await askAgainAndAgain(compiled.origins, servers, times);
        expect(await compiled.end()).toMatchObject({ exitCode: 0, signal: null });
      },
      timeout,
    );

    test.skipIf(options.length === 0 || !alsoWithOtherBuildOptions)(
      `answers the same when built with ${options.join(" ")}`,
      async () => {
        const variant = oneBuildWritesBoth ? executableNamed("variant") : await build("variant", options);
        await using compiled = await start([variant], servers.length, bunEnv);
        expect(await askAll(compiled.origins, servers)).toEqual(expected);
        expect(await compiled.end()).toMatchObject({ exitCode: 0, signal: null });
      },
      timeout,
    );
  });
}
