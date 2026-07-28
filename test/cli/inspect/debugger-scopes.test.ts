// https://github.com/oven-sh/bun/issues/5958
//
// When paused inside an ES module's top level (`module code`), the scope chain
// should include the module's own let/const/var/function bindings. Previously
// JSModuleEnvironment only enumerated import entries and omitted its own
// symbol-table bindings, so the Inspector reported the module scope as
// `empty: true` and `Runtime.getDisplayableProperties` returned no locals.
// That meant VS Code's Variables pane was blank when stopped on a top-level
// `debugger;` statement.

import { describe, expect, test } from "bun:test";
import { isASAN, isDebug, tempDir } from "harness";
import { enableAndWaitForDebuggerPause, spawnInspectorWS } from "./inspector-ws-helper";

type Scope = {
  type: string;
  empty?: boolean;
  object: { objectId: string };
};

type InspectResult = {
  functionName: string;
  scopeChain: Scope[];
  scopeProperties: string[][];
};

async function inspectAtDebugger(files: Record<string, string>, entry: string): Promise<InspectResult> {
  using dir = tempDir("debugger-scopes", files);

  await using session = await spawnInspectorWS({ args: [entry], cwd: String(dir), urlPath: "/scopes" });
  const { send, proc } = session;

  const paused = await enableAndWaitForDebuggerPause(session);
  expect(paused.reason).toBe("DebuggerStatement");
  const frame = paused.callFrames[0];
  const scopeChain: Scope[] = frame.scopeChain;

  const scopeProperties: string[][] = [];
  for (const scope of scopeChain) {
    // The global scope is very large and irrelevant here.
    if (scope.type === "global") {
      scopeProperties.push(["<global>"]);
      continue;
    }
    const { properties } = await send("Runtime.getDisplayableProperties", {
      objectId: scope.object.objectId,
    });
    scopeProperties.push((properties as Array<{ name: string }>).map(p => p.name).sort());
  }

  await send("Debugger.resume");

  // The debuggee keeps its event loop alive while the inspector connection is
  // open, so close before awaiting exit.
  session.close();

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toContain("reached-end");
  expect(exitCode).toBe(0);

  return {
    functionName: frame.functionName,
    scopeChain,
    scopeProperties,
  };
}

// The WebSocket inspector transport is unreliable under the CI release-ASAN
// build (test/expectations.txt quarantines cli/inspect/inspect.test.ts there
// for the same reason): the debuggee drops the socket with code 1006 shortly
// after accept. Skip on that lane only. The local `bun bd` debug build also
// has ASAN enabled but does not exhibit this, so keep running there (isDebug)
// so the fail-before / pass-after proof is observable.
describe.skipIf(isASAN && !isDebug).concurrent("Debugger.paused module scope chain", () => {
  test("ESM top-level let/const/var/function appear in the module scope", async () => {
    const { functionName, scopeChain, scopeProperties } = await inspectAtDebugger(
      {
        "index.mjs": `
let a = 3;
const b = 4;
var c = 5;
function d() {}
debugger;
console.log("reached-end", a, b, c, d);
export {};
`,
      },
      "index.mjs",
    );

    expect(functionName).toBe("module code");

    // The first entry in the scope chain is the module environment. It must not
    // be reported as empty, and enumerating it must yield the module's own
    // bindings. Without the fix this scope arrives as { empty: true } with zero
    // properties.
    expect(scopeChain[0].type).toBe("closure");
    expect(scopeChain[0].empty).not.toBe(true);
    expect(scopeProperties[0]).toEqual(["a", "b", "c", "d"]);
  });

  test("ESM with named import shows both the import and local bindings", async () => {
    const { functionName, scopeChain, scopeProperties } = await inspectAtDebugger(
      {
        "dep.mjs": `export const imported = 42;\n`,
        "index.mjs": `
import { imported } from "./dep.mjs";
let localLet = 1;
const localConst = 2;
debugger;
console.log("reached-end", imported, localLet, localConst);
`,
      },
      "index.mjs",
    );

    expect(functionName).toBe("module code");
    expect(scopeChain[0].type).toBe("closure");
    expect(scopeChain[0].empty).not.toBe(true);
    // Previously only "imported" was listed; local bindings were missing.
    expect(scopeProperties[0]).toEqual(["imported", "localConst", "localLet"]);
  });

  test("CommonJS module wrapper scope chain still lists top-level bindings", async () => {
    const { functionName, scopeChain, scopeProperties } = await inspectAtDebugger(
      {
        "index.cjs": `
"use strict";
let a = 3;
var c = 5;
debugger;
console.log("reached-end", a, c, module.id);
`,
      },
      "index.cjs",
    );

    // CJS is executed inside Bun's (function (exports, require, module, ...) { ... })
    // wrapper, so the top frame is the anonymous wrapper function rather than
    // "module code".
    expect(functionName).not.toBe("module code");

    // The wrapper's lexical scope carries `a`; its var scope carries `c` and
    // the wrapper parameters.
    expect(scopeChain[0].type).toBe("closure");
    expect(scopeProperties[0]).toEqual(["a"]);

    expect(scopeChain[1].type).toBe("closure");
    expect(scopeProperties[1]).toEqual(
      expect.arrayContaining(["__dirname", "__filename", "c", "exports", "module", "require"]),
    );
  });
});
