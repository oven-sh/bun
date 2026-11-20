// Spawned by shell-blocking-pipe.test.ts.
//
// A heap snapshot asks every ParsedShellScript and ShellInterpreter in the heap
// for its memoryCost(). Neither object is reachable from JS, so a snapshot is
// the only way a test gets those hooks called. A snapshot walks the whole heap,
// and the heap of a `bun test` process is several times the size of this one
// (under a debug + ASAN build, one snapshot of it outlasts the default test
// timeout), so the snapshots are taken here, in a process of their own.
import { $, generateHeapSnapshot } from "bun";

// Large enough that a memoryCost() which counts the script is clearly
// distinguishable from one which does not.
const script = Buffer.alloc(1024 * 1024, "bun!").toString();

// Bytes reported by every cell named `className`: its instances plus its
// prototype, which reports a few bytes of its own. Each cell's entry in
// `nodes` starts with id, size, index into nodeClassNames.
function reportedSize(className: string): number {
  const { nodes, nodeClassNames, type } = generateHeapSnapshot();
  const nodeStride = type === "GCDebugging" ? 7 : 4;
  const classNameIndex = nodeClassNames.indexOf(className);
  let size = 0;
  for (let i = 0; i < nodes.length; i += nodeStride) {
    if (nodes[i + 2] === classNameIndex) size += nodes[i + 1];
  }
  return size;
}

// Bun.which("cat") is the system cat, not the shell's builtin: with a child
// process in the pipeline the command cannot finish until the event loop runs.
const promise = $`${{ raw: "echo " + script + " | " + Bun.which("cat") }}`.quiet();

// Nothing has run yet: the ParsedShellScript owns the parsed script.
const parsedScriptBeforeRun = reportedSize("ParsedShellScript");

// then() is what starts the command. The parsed script now belongs to the
// interpreter, which is still running when the snapshot is taken because we
// have not yielded to the event loop yet.
const running = promise.then(output => output.text());
const interpreterWhileRunning = reportedSize("ShellInterpreter");

const stdout = await running;

// Finishing releases the parsed script, whether or not the interpreter
// itself has been collected yet.
const interpreterAfterExit = reportedSize("ShellInterpreter");

console.log(
  JSON.stringify({
    scriptLength: script.length,
    parsedScriptBeforeRun,
    interpreterWhileRunning,
    interpreterAfterExit,
    stdoutMatches: stdout === script + "\n",
  }),
);
