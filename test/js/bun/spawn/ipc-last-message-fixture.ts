// A child that sends one IPC message and ends, seen from a parent that does not run its event loop before the
// child is dead. The exit is then reported from outside the poll of the loop, with the message still unread.
//
//   parent: bun ipc-last-message-fixture.ts <shape>     prints the callbacks in the order they ran
//   child:  bun ipc-last-message-fixture.ts child       sends "last" with process.send() and ends
import type { Subprocess } from "bun";
import { fork, spawnSync } from "node:child_process";
import { readFileSync, writeSync } from "node:fs";
import { createServer, type Server } from "node:net";

const delivered = ["spawn returned", "message", "exit 0 null", "disconnect"];
/** What `seen()` gives for a child that runs. A child whose exit is not reported yet has to read the same. */
const running = "exitCode null, signalCode null, killed false, resourceUsage undefined, exited pending";
type Report = { events: string[]; exited?: number; flood?: string };
/** Each parent `<shape>` and what it prints: the callbacks in order, and what `exited` gave a handler that awaited it. */
export const shapes: [title: string, shape: string, report: Report][] = [
  ["Bun.spawn: the child is bun and ends after process.send()", "send", { events: delivered }],
  [
    "Bun.spawn: the ipc handler replies with send() after an await",
    "reply",
    { events: delivered.toSpliced(2, 0, "send() returned true") },
  ],
  [
    "Bun.spawn: the child sends two messages, and one read gets both",
    "two",
    { events: delivered.toSpliced(2, 0, "message") },
  ],
  [
    "Bun.spawn: the ipc handler calls disconnect() and then send()",
    "disconnect",
    { events: delivered.toSpliced(2, 0, "send(): Subprocess.send() can only be used if an IPC channel is open.") },
  ],
  [
    "Bun.spawn: the ipc handler awaits exited, and the child ends with status 7",
    "status",
    {
      events: [
        "spawn returned",
        "message",
        running,
        "exit 7 null",
        "exitCode 7, signalCode null, killed true, resourceUsage set, exited fulfilled",
        "disconnect",
      ],
      exited: 7,
    },
  ],
  [
    "Bun.spawn: the ipc handler awaits exited, and a signal ends the child",
    "signal",
    {
      events: [
        "spawn returned",
        "message",
        running,
        "exit null SIGKILL",
        "exitCode null, signalCode SIGKILL, killed true, resourceUsage set, exited fulfilled",
        "disconnect",
      ],
      exited: 137,
    },
  ],
  ["Bun.spawn: the child is unref'd", "unref", { events: delivered }],
  [
    "Bun.spawn: the child is disposed before the loop has read the channel",
    "dispose",
    { events: [...delivered, "disposed: exitCode 0"] },
  ],
  [
    "Bun.spawn: a process that the child left behind floods the channel",
    "writer",
    { events: delivered, flood: "no more than the channel held at the exit" },
  ],
  [
    "Bun.spawn: the exit handler of another child calls disconnect() before the loop has read the channel",
    "disconnect-elsewhere",
    {
      events: [
        "spawn returned",
        `in the exit of another child: connected true, ${running}`,
        "exit 0 null",
        "disconnect",
      ],
    },
  ],
  ["Bun.spawn: the child sends a handle with its message", "handle", { events: delivered }],
  [
    "Bun.spawn: the child sends a handle and then a message, which are two reads",
    "handle-then-plain",
    { events: delivered.toSpliced(2, 0, "message") },
  ],
  ["Bun.spawn: a line that is not JSON follows the message", "bad-line", { events: delivered }],
  ["child_process.fork()", "fork", { events: ["fork returned", "message", "exit 0 null", "disconnect"] }],
];
/** The same parent for a child with a terminal of its own. The last output of the terminal arrives with the exit. */
export const terminalShape: Report = {
  events: ["spawn returned", `terminal data, ${running}`, "message", "exit 0 null", "disconnect"],
};

// Most children are not bun, so that they cost little: each writes one JSON message to the channel and ends.
const say = `echo '"last"' >&$NODE_CHANNEL_FD`;
export const quickChild = ["sh", "-c", say];
// A process that the child leaves behind holds the channel open until the parent is gone, so no EOF comes with the exit.
const holder = `(while kill -0 $PPID 2>/dev/null; do sleep 0.05; done) >/dev/null 2>&1 &`;
export const quickChildWithHolder = ["sh", "-c", `${holder} ${say}`];
const bunChildWithHolder = (mode: string) => [
  "sh",
  "-c",
  `${holder} exec "$0" "$1" ${mode} $NODE_CHANNEL_FD`,
  process.execPath,
  import.meta.path,
];
const children: Record<string, string[]> = {
  send: [process.execPath, import.meta.path, "child"],
  two: ["sh", "-c", `printf '"last"\\n"last"\\n' >&$NODE_CHANNEL_FD`],
  status: ["sh", "-c", `${say}; exit 7`],
  signal: ["sh", "-c", `${say}; kill -KILL $$`],
  // What it leaves behind writes until the channel is closed. Long lines, so that what piles up is few messages.
  // node keeps such a channel open until that process is gone too. bun closes it with the exit of the child.
  writer: [
    "sh",
    "-c",
    `${say}; (while echo '"${Buffer.alloc(1024, "x")}"'; do :; done) >&$NODE_CHANNEL_FD 2>/dev/null &`,
  ],
  // With the holder, nothing but the count of what the channel held at the exit ends the wait of these three.
  handle: bunChildWithHolder("child-handle"),
  "handle-then-plain": bunChildWithHolder("child-handle-then-plain"),
  "bad-line": ["sh", "-c", `${holder} printf '"last"\\n{not json\\n"after"\\n' >&$NODE_CHANNEL_FD`],
  terminal: ["sh", "-c", `printf term-last; ${say}`],
};

/**
 * The environment of the child, without what makes this process watch its children another way, and without what
 * makes a bun child end the process that it leaves behind.
 */
export function childEnv() {
  const env = { ...process.env };
  delete env.LD_PRELOAD;
  delete env.DYLD_INSERT_LIBRARIES;
  delete env.FAIL_EPOLL_CTL;
  delete env.BUN_FEATURE_FLAG_FORCE_WAITER_THREAD;
  delete env.BUN_FEATURE_FLAG_NO_ORPHANS;
  return env;
}

/**
 * Returns with the exit of `pid` known to this process and the event loop not yet run: the waiter thread has reaped
 * the child, or the spawn call did, held up by the preloaded shim until the child was dead. On the default route
 * the child is still a zombie here, and that route is not what these cases are about. If the waiter thread stops
 * reaping its children itself, the check at the end has to change with it.
 */
export function offTheLoopUntilTheExitIsPosted(pid: number) {
  if (process.env.BUN_FEATURE_FLAG_FORCE_WAITER_THREAD) {
    for (;;) {
      let stat: string;
      try {
        stat = readFileSync(`/proc/${pid}/stat`, "latin1");
      } catch {
        break;
      }
      // "<pid> (<comm>) <state> ...", and the thread count is the 18th field from the state.
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      if (fields[0] === "Z" && fields[17] === "1") break;
      Bun.sleepSync(1);
    }
    // The thread handles its children in spawn order.
    spawnSync("true");
  }
  try {
    process.kill(pid, 0);
  } catch {
    return;
  }
  throw new Error(`child ${pid} is not reaped yet: its exit would come through the poll of the loop`);
}

/** What the getters of a child say of its exit. */
function seen(subprocess: Subprocess) {
  return [
    `exitCode ${subprocess.exitCode}`,
    `signalCode ${subprocess.signalCode}`,
    `killed ${subprocess.killed}`,
    `resourceUsage ${subprocess.resourceUsage() === undefined ? "undefined" : "set"}`,
    `exited ${Bun.peek.status(subprocess.exited)}`,
  ].join(", ");
}

function parent(shape: string) {
  const events: string[] = [];
  let exited: number | undefined;
  let flood = 0;
  process.on("exit", () => {
    const report: Report = { events, exited };
    // Each line of the flood is 1 KB, and the channel holds less than 1 MB at a time.
    if (shape === "writer") report.flood = flood <= 1024 ? "no more than the channel held at the exit" : `${flood} KB`;
    console.log(JSON.stringify(report));
  });

  if (shape === "fork") {
    const forked = fork(import.meta.path, ["child"], { env: childEnv() });
    forked.on("message", () => events.push("message"));
    forked.on("exit", (code, signal) => events.push(`exit ${code} ${signal}`));
    forked.on("disconnect", () => events.push("disconnect"));
    events.push("fork returned");
    offTheLoopUntilTheExitIsPosted(forked.pid!);
    return;
  }

  const showsState = shape === "status" || shape === "signal";
  const spawned = Bun.spawn({
    cmd: children[shape] ?? quickChild,
    serialization: shape === "send" ? "advanced" : "json",
    env: childEnv(),
    ...(shape === "terminal"
      ? { terminal: { data: () => void events.push(`terminal data, ${seen(spawned)}`) } }
      : { stdio: ["ignore", "inherit", "inherit"] }),
    async ipc(message, subprocess, handle) {
      if (message !== "last") {
        flood++;
        // The writer stays ahead of a reader that takes this long: the channel is then never empty after a read.
        for (const until = performance.now() + 0.2; performance.now() < until;);
        return;
      }
      events.push("message");
      (handle as Server | undefined)?.close();
      if (shape === "reply") {
        // The rest of this handler runs once the handlers of the read have returned.
        await Promise.resolve();
        events.push(`send() returned ${subprocess.send("reply")}`);
      }
      if (shape === "disconnect") {
        subprocess.disconnect();
        try {
          subprocess.send("reply");
        } catch (error) {
          events.push(`send(): ${(error as Error).message}`);
        }
      }
      if (showsState) {
        events.push(seen(subprocess));
        exited = await subprocess.exited;
      }
    },
    onExit(subprocess, exitCode, signalCode) {
      events.push(`exit ${exitCode} ${signalCode}`);
      if (showsState) events.push(seen(subprocess));
    },
    onDisconnect() {
      events.push("disconnect");
    },
  });
  events.push("spawn returned");
  if (shape === "unref") spawned.unref();
  offTheLoopUntilTheExitIsPosted(spawned.pid);
  // The child is gone, and to JS it still runs: the disposal waits for its exit like that of any child that runs.
  if (shape === "dispose") {
    void (async () => {
      await spawned[Symbol.asyncDispose]();
      events.push(`disposed: exitCode ${spawned.exitCode}`);
    })();
  }
  // The next turn of the loop gets the exit, and this runs before that turn reads the channel.
  if (shape === "end-before-the-read") setImmediate(() => process.exit(0));

  if (shape === "disconnect-elsewhere") {
    const other = Bun.spawn({
      cmd: ["true"],
      stdio: ["ignore", "ignore", "ignore"],
      onExit() {
        events.push(`in the exit of another child: connected ${spawned.connected}, ${seen(spawned)}`);
        spawned.disconnect();
      },
    });
    offTheLoopUntilTheExitIsPosted(other.pid);
  }
}

function child(mode: string) {
  if (mode === "child") return void process.send!("last");
  const server = createServer(() => {});
  server.listen(0, "127.0.0.1", () => {
    process.send!("last", server);
    // Straight to the channel: process.send() holds a second message back until the parent has acked the handle.
    if (mode === "child-handle-then-plain") writeSync(Number(process.argv[3]), '"last"\n');
    process.exit(0);
  });
}

if (import.meta.main) {
  if (process.argv[2].startsWith("child")) child(process.argv[2]);
  // From a timer, because the leak check at the end of this one ignores what was allocated while a module was evaluated.
  else if (process.argv[2] === "end-before-the-read") setTimeout(parent, 0, process.argv[2]);
  else parent(process.argv[2]);
}
