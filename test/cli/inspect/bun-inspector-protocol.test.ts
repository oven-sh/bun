// packages/bun-inspector-protocol ships a snapshot of the inspector protocol of the WebKit
// build bun links against (src/protocol/jsc/protocol.json, from which index.d.ts is
// generated). Nothing regenerates it when WebKit is bumped, so this test runs a short
// debugging session against this build of bun and validates every message it sends
// against the snapshot. If it fails after a WebKit upgrade, regenerate the snapshot:
//
//   bun packages/bun-inspector-protocol/scripts/generate-protocol.ts
import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { basename } from "node:path";
import protocolJson from "../../../packages/bun-inspector-protocol/src/protocol/jsc/protocol.json";
import type { Property, Protocol } from "../../../packages/bun-inspector-protocol/src/protocol/schema";

const protocol = protocolJson as Protocol;
const domains = new Map(protocol.domains.map(domain => [domain.domain, domain]));

function declaredEventParameters(method: string): readonly Property[] | undefined {
  const [domain, name] = method.split(".");
  const event = domains.get(domain)?.events?.find(event => event.name === name);
  return event && (event.parameters ?? []);
}

function declaredCommandReturns(method: string): readonly Property[] | undefined {
  const [domain, name] = method.split(".");
  const command = domains.get(domain)?.commands?.find(command => command.name === name);
  return command && (command.returns ?? []);
}

/** Appends to `problems` every way `value` disagrees with `property`, the snapshot's declaration of it. */
function check(value: unknown, property: Property, domain: string, where: string, problems: string[]): void {
  if ("$ref" in property) {
    const [refDomain, refId] = property.$ref.includes(".") ? property.$ref.split(".") : [domain, property.$ref];
    const type = domains.get(refDomain)?.types?.find(type => type.id === refId);
    // A few JavaScriptCore types reference domains that only exist for web pages (e.g. Network.RequestId).
    // Those domains are not part of the snapshot, and bun never sends values of those types.
    if (type) check(value, type, refDomain, where, problems);
    return;
  }
  switch (property.type) {
    case "string":
      if (typeof value !== "string") {
        problems.push(`${where}: expected a string, got ${JSON.stringify(value)}`);
      } else if (property.enum && !property.enum.includes(value)) {
        problems.push(`${where}: ${JSON.stringify(value)} is not one of: ${property.enum.join(", ")}`);
      }
      return;
    case "boolean":
      if (typeof value !== "boolean") problems.push(`${where}: expected a boolean, got ${JSON.stringify(value)}`);
      return;
    case "number":
    case "integer":
      if (typeof value !== "number") problems.push(`${where}: expected a number, got ${JSON.stringify(value)}`);
      return;
    case "array": {
      const { items } = property;
      if (!Array.isArray(value)) {
        problems.push(`${where}: expected an array, got ${JSON.stringify(value)}`);
      } else if (items) {
        value.forEach((item, i) => check(item, items, domain, `${where}[${i}]`, problems));
      }
      return;
    }
    case "object": {
      const { properties } = property;
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        problems.push(`${where}: expected an object, got ${JSON.stringify(value)}`);
      } else if (properties) {
        checkObject(value as Record<string, unknown>, properties, domain, where, problems);
      }
      return;
    }
  }
}

function checkObject(
  object: Record<string, unknown>,
  declared: readonly Property[],
  domain: string,
  where: string,
  problems: string[],
): void {
  for (const property of declared) {
    const name = property.name!;
    if (!(name in object)) {
      if (!property.optional) problems.push(`${where}: missing required property ${name}`);
    } else {
      check(object[name], property, domain, `${where}.${name}`, problems);
    }
  }
  const declaredNames = new Set(declared.map(property => property.name));
  for (const name of Object.keys(object)) {
    if (!declaredNames.has(name)) problems.push(`${where}: property ${name} is not in the snapshot`);
  }
}

// An ES module and a CommonJS module, so Debugger.scriptParsed is sent for both script types.
const fixtureFiles = ["entry.mjs", "dep.cjs"];

test("the protocol snapshot in packages/bun-inspector-protocol matches what bun sends", async () => {
  // reportError() counts as an unhandled error, so bun exits with code 1 as soon as the module
  // body finishes, whatever else is scheduled. The inspector writes its messages from the
  // debugger thread, and an inspectee that exits right after Debugger.resume can be gone before
  // the resume response and the Debugger.resumed event reach the socket. The second debugger
  // statement parks the inspectee after the first resume until the test has those messages and
  // closes the connection, which resumes it for good.
  using dir = tempDir("bun-inspector-protocol", {
    "entry.mjs": `
      import "./dep.cjs";
      console.log("hello");
      reportError(new Error("reported"));
      debugger;
      debugger;
    `,
    "dep.cjs": `module.exports = 1;`,
  });

  await using proc = spawn({
    cmd: [bunExe(), "--inspect-wait=127.0.0.1:0", "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "ignore",
    stderr: "pipe",
  });

  // stderr is drained for the lifetime of the process (reportError prints to it); the
  // inspector's WebSocket URL is on its own line of the listening banner.
  let stderr = "";
  const { promise: inspectorUrl, resolve: foundUrl, reject: noUrl } = Promise.withResolvers<URL>();
  const stderrDone = (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of proc.stderr) {
      stderr += decoder.decode(chunk, { stream: true });
      // Only complete lines: a chunk boundary mid-line would yield a truncated URL.
      const line = stderr
        .split("\n")
        .slice(0, -1)
        .find(line => line.trim().startsWith("ws://"));
      if (line) foundUrl(new URL(line.trim()));
    }
    noUrl(new Error(`No inspector URL in stderr:\n${stderr}`));
  })().catch(error => noUrl(error instanceof Error ? error : new Error(String(error))));

  const ws = new WebSocket(await inspectorUrl);
  const { promise: failed, reject: fail } = Promise.withResolvers<never>();
  // The inspectee's stderr carries the diagnosis for a dropped socket (a crash
  // report, an error it printed before dying), so wait for the pipe to drain
  // (bounded: the child may still be alive holding it open) before rejecting.
  async function failWith(what: string): Promise<void> {
    await Promise.race([Promise.allSettled([stderrDone, proc.exited]), Bun.sleep(1_000)]);
    const exit = proc.exitCode ?? proc.signalCode ?? "still running";
    fail(new Error(`${what} (inspectee exit: ${exit})\ninspectee stderr:\n${stderr}`));
  }
  ws.addEventListener("error", () => failWith("WebSocket error"));
  ws.addEventListener("close", event => failWith(`WebSocket closed (${event.code})`));
  proc.exited.then(() => failWith("inspectee exited"));
  failed.catch(() => {});

  const problems: string[] = [];
  const eventsSeen = new Set<string>();
  const scriptTypes: Record<string, unknown> = {};
  const eventWaiters = new Map<string, (params: any) => void>();
  const responseWaiters = new Map<number, (response: any) => void>();

  ws.addEventListener("message", ({ data }) => {
    const message = JSON.parse(String(data));
    if (typeof message.id === "number") {
      responseWaiters.get(message.id)!(message);
      return;
    }
    const { method, params = {} } = message;
    eventsSeen.add(method);
    const declared = declaredEventParameters(method);
    if (declared) {
      checkObject(params, declared, method.split(".")[0], method, problems);
    } else {
      problems.push(`${method}: event is not in the snapshot`);
    }
    if (method === "Debugger.scriptParsed" && fixtureFiles.includes(basename(String(params.url)))) {
      scriptTypes[basename(String(params.url))] = params.scriptType;
    }
    eventWaiters.get(method)?.(params);
  });

  let nextId = 1;
  function request(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = nextId++;
    ws.send(JSON.stringify({ id, method, params }));
    return Promise.race([new Promise(resolve => responseWaiters.set(id, resolve)), failed]);
  }
  /** Sends a command and validates its response against the snapshot. */
  async function send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const { result, error } = await request(method, params);
    const returns = declaredCommandReturns(method);
    if (!returns) {
      problems.push(`${method}: command is not in the snapshot`);
    } else if (error) {
      problems.push(`${method}: error response: ${error.message}`);
    } else {
      checkObject(result, returns, method.split(".")[0], `${method} response`, problems);
    }
    return result;
  }
  function waitForEvent(method: string): Promise<any> {
    return Promise.race([new Promise(resolve => eventWaiters.set(method, resolve)), failed]);
  }

  try {
    await Promise.race([new Promise<void>(resolve => ws.addEventListener("open", () => resolve())), failed]);

    // Enabling every domain in the snapshot checks that bun has an agent for each of them.
    const enableCommands = protocol.domains
      .filter(domain => domain.commands?.some(command => command.name === "enable"))
      .map(domain => `${domain.domain}.enable`);
    await Promise.all([
      ...enableCommands.map(method => send(method)),
      send("Debugger.setBreakpointsActive", { active: true }),
      send("Debugger.setPauseOnDebuggerStatements", { enabled: true }),
    ]);

    // Conversely, these domains are left out of the snapshot by generate-protocol.ts because bun has
    // no agent for them. Once bun answers, remove the domain from the generator's list and regenerate.
    for (const domain of ["File", "Process"]) {
      const { error } = await request(`${domain}.enable`);
      if (error?.message !== `'${domain}' domain was not found`) {
        problems.push(`${domain}: bun implements this domain, but generate-protocol.ts excludes it from the snapshot`);
      }
    }

    const paused = waitForEvent("Debugger.paused");
    await send("Inspector.initialized");
    const { callFrames } = await paused;

    await send("Runtime.evaluate", { expression: "({ a: [1, 'two', null] })", generatePreview: true });
    await send("Debugger.evaluateOnCallFrame", { callFrameId: callFrames[0].callFrameId, expression: "globalThis" });
    await send("LifecycleReporter.getModuleGraph");

    const resumed = waitForEvent("Debugger.resumed");
    const pausedAgain = waitForEvent("Debugger.paused");
    await send("Debugger.resume");
    await resumed;
    await pausedAgain;
  } finally {
    // Closing the last connection resumes the parked inspectee, which then exits.
    ws.close();
  }

  expect([...new Set(problems)]).toEqual([]);
  // JavaScriptCore's own domains plus the agents bun registers in src/jsc/bindings/BunDebugger.cpp.
  expect(protocol.domains.map(domain => domain.domain)).toEqual([
    "Audit",
    "BunFrontendDevServer",
    "Console",
    "Debugger",
    "Heap",
    "HTTPServer",
    "Inspector",
    "LifecycleReporter",
    "Runtime",
    "ScriptProfiler",
    "TestReporter",
  ]);
  expect(scriptTypes).toEqual({ "entry.mjs": "module", "dep.cjs": "program" });
  expect([...eventsSeen].sort()).toEqual(
    expect.arrayContaining([
      "Console.messageAdded",
      "Debugger.paused",
      "Debugger.resumed",
      "Debugger.scriptParsed",
      "LifecycleReporter.error",
    ]),
  );
  // The disconnect resumed the inspectee, and reportError() made its exit fatal.
  expect(await proc.exited).toBe(1);
});
