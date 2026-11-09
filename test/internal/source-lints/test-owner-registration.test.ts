// `VirtualMachine::test_owner` says who gets what `bun test` code registers: the running test file, or the whole run while
// a preload is loading. With `--rerun-each` it also says that the file is loaded again after this run. What the file imports
// stays loaded, so a module whose top level registers something for the file has to be noted, and the end of the run evicts it.
//
// The places that register something for a test file ask through one of these, which note the module:
//   Rust: `module_mock::registers_for_preload(vm)`, or `module_mock::did_register_for_file(vm)` where nothing asks about preloads
//   C++:  `JSMock__registersForPreload(globalObject)`, or `Bun__TestFile__didRegister(globalObject)`
//
// A new place that reads the owner in another way is not noted, and what it registers is missing from runs 2..N of
// `--rerun-each`. So this freezes every other read. Add one here only if it registers nothing that ends with the test file.

import { file } from "bun";
import { expect, test } from "bun:test";
import path from "path";

const root = path.resolve(import.meta.dir, "..", "..", "..");

test("test runner code that registers for a test file asks module_mock::registers_for_preload()", async () => {
  const reads: string[] = [];
  for (const name of new Bun.Glob("src/runtime/test_runner/**/*.rs").scanSync({ cwd: root })) {
    const rel = name.replaceAll(path.sep, "/");
    // The accessors themselves.
    if (rel === "src/runtime/test_runner/module_mock.rs") continue;
    for (const line of (await file(path.join(root, name)).text()).split("\n")) {
      if (/\bis_in_preload\(\)|\btest_owner\b/.test(line) && !/^\s*\/\//.test(line)) reads.push(`${rel}: ${line.trim()}`);
    }
  }
  expect(reads.sort()).toEqual([
    // A Happy DOM or jsdom window counts its "error" listeners. The listener stays on the window after the file.
    "src/runtime/test_runner/environment.rs: VirtualMachine::get().is_in_preload()",
    "src/runtime/test_runner/environment.rs: pub(crate) fn is_in_preload() -> bool {",
    // An equality tester or a snapshot serializer from a module outlasts the file. This asks which module adds it.
    "src/runtime/test_runner/expect/addEqualityTesters.rs: if global.bun_vm().test_owner != TestOwner::FileThatRunsAgain {",
    // Which module `Bun.jest()` answers with, and which globals a compiled file gets.
    "src/runtime/test_runner/jest.rs: if vm.has_globals_of_vitest() || vm.is_in_preload() {",
    "src/runtime/test_runner/jest.rs: if vm.is_in_preload() || Jest::runner().is_none() {",
    // `vi.unstubAllGlobals()` and `vi.unstubAllEnvs()` ask what to forget.
    "src/runtime/test_runner/vi_utils.rs: global.bun_vm().is_in_preload()",
  ]);
});

test("C++ that registers for a test file asks JSMock__registersForPreload()", async () => {
  const calls: Record<string, number> = {};
  for (const name of new Bun.Glob("src/jsc/bindings/*.cpp").scanSync({ cwd: root })) {
    const text = await file(path.join(root, name)).text();
    const count = text.split("\n").filter(line => line.includes("JSMock__isInPreload(") && !line.startsWith("extern ")).length;
    if (count > 0) calls[path.basename(name)] = count;
  }
  expect(calls).toEqual({
    // The loader of a compiled program asks who loads a module.
    "BunCompiledModules.cpp": 3,
    // Module mocks and the eviction of modules. `mock.module()` notes its caller in `modulesThatMocked`.
    "BunPlugin.cpp": 7,
    // `mock()` and `vi.fn()`: a mock function outlasts the file. `spyOn()` calls `Bun__TestFile__didRegister()`.
    "JSMockFunction.cpp": 1,
  });
});
