import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// `bun test --isolate` runs the first file in the global the process starts with. `TestCommand::exec` and the frames
// it starts the run from stay on the stack until the last file ends, and the GC scans them. At opt-level 0 a read of
// `vm.global()` or `EventLoop::global_ref()` (both `#[inline(always)]`) leaves copies of the global in the frame that
// made it, so one read there before the first file keeps that file's global alive for the whole run. Only a debug
// build shows it (isolation.test.ts, "a process does not keep the global of the first file it ran"), and no lane of
// CI builds one.
//
//   vm.global().vm().enable_control_flow_profiler()   → vm.jsc_vm().enable_control_flow_profiler()
//
// This reads the text of five functions. It does not see a read in a function they call, whose copies stay in stack
// that these frames are then built over.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const source = (file: string) =>
  readFileSync(path.join(root, file), "utf8").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, comment =>
    comment.replace(/[^\n]/g, " "),
  );

function body(text: string, signature: string): string {
  const start = text.indexOf(signature);
  if (start < 0) throw new Error(`no "${signature}"`);
  let depth = 0;
  for (let i = text.indexOf("{", start); i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error(`"${signature}" is not closed`);
}

function before(text: string, call: string): string {
  const end = text.indexOf(call);
  if (end < 0) throw new Error(`no "${call}"`);
  return text.slice(0, end);
}

const reads = (text: string) => text.match(/^.*\.global(?:_ref)?\b(?!_).*$/gm)?.map(line => line.trim()) ?? [];

test("bun test reads no global before the first test file in a frame that outlives it", () => {
  const testCommand = source("src/runtime/cli/test_command.rs");
  const runner = source("src/runtime/cli/test/parallel/runner.rs");
  const exec = before(body(testCommand, "pub(crate) fn exec("), "Self::run_all_tests(");
  // The worker is handed over from `exec` too: a body cut short would pass for nothing.
  expect(exec).toContain("ParallelRunner::run_as_worker(");
  expect({
    exec: reads(exec),
    run_all_tests: reads(before(body(testCommand, "pub(crate) fn run_all_tests("), "TestCommand::run(")),
    run_as_worker: reads(before(body(runner, "pub(crate) fn run_as_worker("), "wloop.begin(")),
    "WorkerLoop::begin": reads(
      before(body(runner, "fn begin(&mut self, vm: &mut VirtualMachine)"), "TestCommand::run("),
    ),
    note_first_loads_of_earlier_process: reads(body(runner, "fn note_first_loads_of_earlier_process(")),
  }).toEqual({
    exec: [],
    run_all_tests: [],
    run_as_worker: [],
    "WorkerLoop::begin": [],
    note_first_loads_of_earlier_process: [],
  });
});
