import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// instantiate() of a vm.SourceTextModule calls the Link() of JavaScriptCore, which reads a request that has no module
// through a pointer that is not there. So isModuleGraphLinked() looks at those requests first (#31624). Link() does
// not enter a record that is linked, and the walk must stop there too. From 1.4.0 to 1.4.3 it did not: one new
// importer cost about 170 instructions for each linked module below it, and a loader that links each module as a
// root of its own was quadratic. The stop changes no result, only time, so this lint holds it.
test("node:vm instantiate() stops its walk at a module record that is linked", () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  // Line comments go, newlines stay.
  const file = path.join(repoRoot, "src/jsc/bindings/NodeVMSourceTextModule.cpp");
  const code = readFileSync(file, "utf8").replace(/\/\/.*$/gm, "");
  // None means that the walk moved, and this lint checks nothing.
  const walks = [...code.matchAll(/^static bool isModuleGraphLinked\(/gm)];
  expect(walks.length).toBe(1);
  const body = code.slice(walks[0].index, code.indexOf("\n}\n", walks[0].index));
  // The walk takes a record, leaves a linked one alone, and only then reads the requests.
  const stop = /status\(\)\s*>=\s*(?:JSC::)?CyclicModuleRecord::Status::Linked\s*\)\s*continue;/;
  expect(body.split("worklist.takeLast()").length).toBe(2);
  expect(body.split("requestedModules()").length).toBe(2);
  const [, afterTake] = body.split("worklist.takeLast()");
  const [beforeRequests] = afterTake.split("requestedModules()");
  expect(beforeRequests).toMatch(stop);
});
