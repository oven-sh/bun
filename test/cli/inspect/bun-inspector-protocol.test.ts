// packages/bun-inspector-protocol ships a snapshot of the inspector protocol of the WebKit
// build bun links against (src/protocol/jsc/protocol.json, from which index.d.ts is
// generated). Nothing regenerates it when WebKit is bumped, so the last test here runs a
// short debugging session against this build of bun and validates every message it sends
// against the snapshot. If it fails after a WebKit upgrade, regenerate the snapshot:
//
//   bun packages/bun-inspector-protocol/scripts/generate-protocol.ts
//
// The tests before it check that the snapshot is self-contained: the domains it holds refer
// to types of domains that only exist for web pages (Network.RequestId), which the generator
// has to carry along for index.d.ts to type-check. Its consumers compile with skipLibCheck,
// so a reference it leaves dangling is not a compile error for them, just a property that
// silently types as anything.
import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
import { basename, join } from "node:path";
import {
  formatProtocol,
  primitiveTypes,
  selectJscDomains,
} from "../../../packages/bun-inspector-protocol/scripts/generate-protocol";
import protocolJson from "../../../packages/bun-inspector-protocol/src/protocol/jsc/protocol.json";
import type { Domain, Property, Protocol } from "../../../packages/bun-inspector-protocol/src/protocol/schema";

const protocolDir = join(import.meta.dir, "../../../packages/bun-inspector-protocol/src/protocol");
const protocol = protocolJson as Protocol;
const domains = new Map(protocol.domains.map(domain => [domain.domain, domain]));
/** The domains that are in the snapshot only because domains bun speaks refer to their types. */
const typesOnlyDomains = protocol.domains
  .filter(domain => !domain.commands && !domain.events)
  .map(domain => domain.domain);

/**
 * The snapshot's declaration of the type a `$ref` names (a bare name is a type of the referring domain),
 * or an equivalent declaration when it names a primitive; see `$ref` in schema.d.ts.
 */
function resolveRef($ref: string, domain: string): { type: Property; domain: string } | undefined {
  const [refDomain, id] = $ref.includes(".") ? $ref.split(".") : [domain, $ref];
  const type = domains.get(refDomain)?.types?.find(type => type.id === id);
  if (type) return { type, domain: refDomain };
  if (primitiveTypes.has($ref)) return { type: { type: $ref } as Property, domain };
  return undefined;
}

/** What tsc reports for a .d.ts checked on its own, i.e. what a consumer would see without skipLibCheck. */
async function typeErrors(dtsPath: string): Promise<string[]> {
  // Loading typescript takes tens of seconds in a debug build of bun, so only the test that needs it pays for it.
  const ts = (await import("typescript")).default;
  const program = ts.createProgram([dtsPath], {
    strict: true,
    noEmit: true,
    skipLibCheck: false,
    lib: ["lib.es5.d.ts"],
    types: [],
  });
  return ts.getPreEmitDiagnostics(program).map(({ file, start, messageText }) => {
    const line = file && start !== undefined ? file.getLineAndCharacterOfPosition(start).line + 1 : "?";
    return `${basename(file?.fileName ?? "")}:${line}: ${ts.flattenDiagnosticMessageText(messageText, "\n")}`;
  });
}

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
    const target = resolveRef(property.$ref, domain);
    if (target) {
      check(value, target.type, target.domain, where, problems);
    } else {
      problems.push(`${where}: ${property.$ref} is not in the snapshot`);
    }
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

test("every type the snapshot refers to is in the snapshot", () => {
  const dangling: string[] = [];
  function visit(property: Property, domain: string, where: string): void {
    if ("$ref" in property) {
      if (!resolveRef(property.$ref, domain)) dangling.push(`${where}: ${property.$ref}`);
    } else if (property.type === "array") {
      if (property.items) visit(property.items, domain, `${where}[]`);
    } else if (property.type === "object") {
      for (const member of property.properties ?? []) visit(member, domain, `${where}.${member.name}`);
    }
  }
  for (const { domain, types = [], commands = [], events = [] } of protocol.domains) {
    for (const type of types) visit(type, domain, `${domain}.${type.id}`);
    for (const { name, parameters = [], returns = [] } of commands) {
      for (const parameter of parameters) visit(parameter, domain, `${domain}.${name} parameter ${parameter.name}`);
      for (const returned of returns) visit(returned, domain, `${domain}.${name} returns ${returned.name}`);
    }
    for (const { name, parameters = [] } of events) {
      for (const parameter of parameters) visit(parameter, domain, `${domain}.${name} parameter ${parameter.name}`);
    }
  }
  expect(dangling).toEqual([]);
});

const ref = ($ref: string, name?: string): Property => ({ name, type: undefined, $ref });
// A miniature CombinedDomains.json, in which Debugger is the only domain declared for JavaScript debuggables
// that bun has an agent for.
const debuggerDomain: Domain = {
  domain: "Debugger",
  debuggableTypes: ["javascript", "web-page"],
  types: [{ id: "Location", type: "object", properties: [ref("Page.Frame", "frame"), ref("Process.Id", "pid")] }],
  commands: [
    { name: "searchInContent", returns: [{ name: "result", type: "array", items: ref("GenericTypes.SearchMatch") }] },
  ],
  events: [{ name: "paused", parameters: [ref("Page.PauseReason", "reason")] }],
};
const combinedDomains: Domain[] = [
  debuggerDomain,
  // Declares no debuggableTypes, so it applies to every debuggable and is kept whole.
  {
    domain: "GenericTypes",
    types: [
      { id: "SearchMatch", type: "string" },
      { id: "Unreferenced", type: "string" },
    ],
  },
  {
    domain: "Page",
    debuggableTypes: ["web-page"],
    types: [
      // Referred to by Debugger. Refers on to a primitive, to itself (the walk has to notice that to
      // terminate) and, by bare name, to RequestIds, which refers on to a third domain.
      {
        id: "Frame",
        type: "object",
        properties: [ref("boolean", "isMainFrame"), ref("Frame", "parent"), ref("RequestIds", "requests")],
      },
      { id: "RequestIds", type: "array", items: ref("Network.RequestId") },
      { id: "PauseReason", type: "string", enum: ["breakpoint", "exception"] },
      { id: "Unreferenced", type: "string" },
    ],
    commands: [{ name: "navigate" }],
    events: [{ name: "loaded" }],
  },
  {
    domain: "Network",
    debuggableTypes: ["web-page"],
    types: [
      { id: "RequestId", type: "string" },
      { id: "Unreferenced", type: "string" },
    ],
  },
  // Nothing refers to it.
  { domain: "DOM", debuggableTypes: ["web-page"], types: [{ id: "NodeId", type: "integer" }] },
  // Declared for JavaScript, but bun has no agent for it, so only what Debugger refers to is kept.
  {
    domain: "Process",
    debuggableTypes: ["javascript"],
    types: [{ id: "Id", type: "integer" }],
    commands: [{ name: "enable" }],
  },
];

test("generate-protocol.ts carries along the types that the JavaScript domains refer to in other domains", () => {
  const selected = selectJscDomains(combinedDomains, new Set(["Process"]));
  expect(selected.map(domain => ({ ...domain, types: domain.types?.map(type => type.id) }))).toEqual([
    { ...debuggerDomain, types: ["Location"] },
    { domain: "GenericTypes", types: ["SearchMatch", "Unreferenced"] },
    { domain: "Network", description: expect.any(String), debuggableTypes: ["web-page"], types: ["RequestId"] },
    {
      domain: "Page",
      description: expect.any(String),
      debuggableTypes: ["web-page"],
      types: ["Frame", "RequestIds", "PauseReason"],
    },
    { domain: "Process", description: expect.any(String), debuggableTypes: ["javascript"], types: ["Id"] },
  ]);
});

// The two tests above check the same thing at the protocol.json level; this one is what the consumers of the
// package would see, but type-checking takes tens of seconds in a debug build of bun.
test.skipIf(isDebug)("the generated index.d.ts type-checks without skipLibCheck", async () => {
  expect(await typeErrors(join(protocolDir, "jsc/index.d.ts"))).toEqual([]);

  const version = { major: 1, minor: 0 };
  using dir = tempDir("bun-inspector-protocol-generated", {
    "selected.d.ts": formatProtocol({
      name: "JSC",
      version,
      domains: selectJscDomains(combinedDomains, new Set(["Process"])),
    }),
    // The JavaScript domains on their own, which is what the generator used to emit.
    "debugger-only.d.ts": formatProtocol({ name: "JSC", version, domains: [debuggerDomain] }),
  });
  expect(await typeErrors(join(String(dir), "selected.d.ts"))).toEqual([]);
  expect(
    (await typeErrors(join(String(dir), "debugger-only.d.ts"))).map(error => error.replace(/^.*?:\d+: /, "")).sort(),
  ).toEqual([
    "Cannot find namespace 'GenericTypes'.",
    "Cannot find namespace 'Page'.",
    "Cannot find namespace 'Page'.",
    "Cannot find namespace 'Process'.",
  ]);
});

// An ES module and a CommonJS module, so Debugger.scriptParsed is sent for both script types.
const fixtureFiles = ["entry.mjs", "dep.cjs"];

test("the protocol snapshot in packages/bun-inspector-protocol matches what bun sends", async () => {
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

    // Conversely, bun has no agent for these domains: generate-protocol.ts leaves File and Process out
    // of the snapshot for that reason, and holds only the types of the others. Once bun answers one of
    // them, its commands belong in the snapshot: update the generator's list and regenerate.
    for (const domain of ["File", "Process", ...typesOnlyDomains]) {
      const { error } = await request(`${domain}.enable`);
      if (error?.message !== `'${domain}' domain was not found`) {
        problems.push(`${domain}: bun implements this domain, but the snapshot has none of its commands`);
      }
    }

    const paused = waitForEvent("Debugger.paused");
    await send("Inspector.initialized");
    const { callFrames } = await paused;

    await send("Runtime.evaluate", { expression: "({ a: [1, 'two', null] })", generatePreview: true });
    await send("Debugger.evaluateOnCallFrame", { callFrameId: callFrames[0].callFrameId, expression: "globalThis" });
    await send("LifecycleReporter.getModuleGraph");

    // The reported error makes bun exit (with code 1) as soon as the module finishes evaluating, and
    // that exit races the delivery of whatever the inspector sent last. So the fixture's second
    // debugger statement stops it again right after it resumes: everything sent in between is
    // delivered while it sits in that pause, and the session ends (ws.close below) while it is paused.
    const resumed = waitForEvent("Debugger.resumed");
    const pausedAgain = waitForEvent("Debugger.paused");
    await send("Debugger.resume");
    await resumed;
    await pausedAgain;
  } finally {
    ws.close();
  }

  expect([...new Set(problems)]).toEqual([]);
  // JavaScriptCore's own domains, the agents bun registers in src/jsc/bindings/BunDebugger.cpp, and the
  // domains those refer to the types of.
  expect(protocol.domains.map(domain => domain.domain)).toEqual([
    "Audit",
    "BunFrontendDevServer",
    "Console",
    "Debugger",
    "GenericTypes",
    "Heap",
    "HTTPServer",
    "Inspector",
    "LifecycleReporter",
    "Network",
    "Runtime",
    "ScriptProfiler",
    "TestReporter",
  ]);
  expect(typesOnlyDomains).toEqual(["GenericTypes", "Network"]);
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
});
