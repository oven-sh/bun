import type {
  FileSink,
  NullSubprocess,
  PipedSubprocess,
  ReadableSubprocess,
  SyncSubprocess,
  WritableSubprocess,
} from "bun";
import * as tsd from "./utilities";

Bun.spawn(["echo", "hello"]);

function depromise<T>(_promise: Promise<T>): T {
  return "asdf" as any as T;
}

{
  // Test cases for https://github.com/oven-sh/bun/issues/17274

  {
    const proc = Bun.spawn(["cat"], {
      stdin: "pipe",
    });

    proc.stdin.write("hello");
  }

  {
    const proc = Bun.spawn(["cat"], {
      stdin: "pipe",
      onExit(proc, exitCode, signalCode, error) {
        tsd.expectType(proc).is<Bun.Subprocess<"pipe", "pipe", "inherit">>();
        console.log(`Process exited: ${exitCode}`);
      },
    });

    proc.stdin.write("hello");
  }
}

{
  const proc = Bun.spawn(["echo", "hello"], {
    cwd: "./path/to/subdir", // specify a working direcory
    env: { ...process.env, FOO: "bar" }, // specify environment variables
    onExit(proc, exitCode, signalCode, error) {
      // exit handler
    },
  });

  tsd.expectType(proc.pid).is<number>();

  tsd.expectType(proc.stdout).is<ReadableStream<Uint8Array<ArrayBuffer>>>();
  tsd.expectType(proc.stderr).is<undefined>();
  tsd.expectType(proc.stdin).is<undefined>();
}

{
  const proc = Bun.spawn(["cat"], {
    stdin: depromise(fetch("https://raw.githubusercontent.com/oven-sh/bun/main/examples/hashing.js")),
  });

  const text = depromise(proc.stdout.text());
  console.log(text); // "const input = "hello world".repeat(400); ..."
}

{
  const proc = Bun.spawn(["cat"], {
    stdio: ["pipe", "pipe", "pipe", Bun.file("build.zip")],
  });

  tsd.expectType(proc.stdio[0]).is<null>();
  tsd.expectType(proc.stdio[1]).is<null>();
  tsd.expectType(proc.stdio[2]).is<null>();
  tsd.expectType(proc.stdio[3]).is<number | null | undefined>();

  tsd.expectType(proc.stdin).is<FileSink>();
  tsd.expectType(proc.stdout).is<ReadableStream<Uint8Array<ArrayBuffer>>>();
  tsd.expectType(proc.stderr).is<ReadableStream<Uint8Array<ArrayBuffer>>>();
}

{
  const proc = Bun.spawn(["cat"], {
    stdin: "pipe", // return a FileSink for writing
  });

  // enqueue string data
  proc.stdin.write("hello");

  // enqueue binary data
  const enc = new TextEncoder();
  proc.stdin.write(enc.encode(" world!"));
  enc.encodeInto(" world!", {} as any as Uint8Array);
  // Bun-specific overloads
  // these fail when lib.dom.d.ts is present
  enc.encodeInto(" world!", new Uint32Array(124));
  enc.encodeInto(" world!", {} as any as DataView);

  // send buffered data
  await proc.stdin.flush();

  // close the input stream
  await proc.stdin.end();
}

{
  const proc = Bun.spawn(["echo", "hello"]);
  const text = depromise(proc.stdout.text());
  console.log(text); // => "hello"
}

{
  const proc = Bun.spawn(["echo", "hello"], {
    onExit(proc, exitCode, signalCode, error) {
      // exit handler
    },
  });

  await proc.exited; // resolves when process exit
  proc.killed; // boolean — was the process killed?
  proc.exitCode; // null | number
  proc.signalCode; // null | "SIGABRT" | "SIGALRM" | ...
  proc.kill();
  proc.killed; // true

  proc.kill(); // specify an exit code
  proc.unref();
}

{
  const proc = Bun.spawn(["echo", "hello"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  tsd.expectType<FileSink>(proc.stdin);
  tsd.expectType<ReadableStream<Uint8Array>>(proc.stdout);
  tsd.expectType<ReadableStream<Uint8Array>>(proc.stderr);
}
{
  const proc = Bun.spawn(["echo", "hello"], {
    stdio: ["inherit", "inherit", "inherit"],
  });
  tsd.expectType<undefined>(proc.stdin);
  tsd.expectType<undefined>(proc.stdout);
  tsd.expectType<undefined>(proc.stderr);
}
{
  const proc = Bun.spawn(["echo", "hello"], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  tsd.expectType<undefined>(proc.stdin);
  tsd.expectType<undefined>(proc.stdout);
  tsd.expectType<undefined>(proc.stderr);
}
{
  const proc = Bun.spawn(["echo", "hello"], {
    stdio: [null, null, null],
  });

  tsd.expectType(proc.stdin).is<undefined>();
  tsd.expectType(proc.stdout).is<undefined>();
  tsd.expectType(proc.stderr).is<undefined>();
}
{
  const proc = Bun.spawn(["echo", "hello"], {
    stdio: [new Request("1"), null, null],
  });

  tsd.expectType<number>(proc.stdin);
}
{
  const proc = Bun.spawn(["echo", "hello"], {
    stdio: [new Response("1"), null, null],
  });
  tsd.expectType<number>(proc.stdin);
}
{
  const proc = Bun.spawn(["echo", "hello"], {
    stdio: [new Uint8Array([]), null, null],
  });
  tsd.expectType<number>(proc.stdin);
}
tsd.expectAssignable<PipedSubprocess>(Bun.spawn([], { stdio: ["pipe", "pipe", "pipe"] }));
tsd.expectAssignable<ReadableSubprocess>(Bun.spawn([], { stdio: ["ignore", "pipe", "pipe"] }));
tsd.expectAssignable<ReadableSubprocess>(Bun.spawn([], { stdio: ["pipe", "pipe", "pipe"] }));
tsd.expectAssignable<WritableSubprocess>(Bun.spawn([], { stdio: ["pipe", "pipe", "pipe"] }));
tsd.expectAssignable<WritableSubprocess>(Bun.spawn([], { stdio: ["pipe", "ignore", "inherit"] }));
tsd.expectAssignable<NullSubprocess>(Bun.spawn([], { stdio: ["ignore", "inherit", "ignore"] }));
tsd.expectAssignable<NullSubprocess>(Bun.spawn([], { stdio: [null, null, null] }));

tsd.expectAssignable<SyncSubprocess<Bun.SpawnOptions.Readable, Bun.SpawnOptions.Readable>>(Bun.spawnSync([], {}));

// Lazy option types (async only)
{
  // valid: lazy usable with async spawn
  const p1 = Bun.spawn(["echo", "hello"], {
    stdout: "pipe",
    stderr: "pipe",
    lazy: true,
  });
  tsd.expectType(p1.stdout).is<ReadableStream<Uint8Array<ArrayBuffer>>>();
}

{
  // valid: lazy false is also allowed
  const p2 = Bun.spawn(["echo", "hello"], {
    stdout: "pipe",
    stderr: "pipe",
    lazy: false,
  });
  tsd.expectType(p2.stderr).is<ReadableStream<Uint8Array<ArrayBuffer>>>();
}

{
  // invalid: lazy is not supported in spawnSync
  Bun.spawnSync(["echo", "hello"], {
    stdout: "pipe",
    stderr: "pipe",
    // @ts-expect-error lazy applies only to async spawn
    lazy: true,
  });
}

{
  // invalid: lazy is not supported in spawnSync (object overload)
  // prettier-ignore
  // @ts-expect-error lazy applies to async spawn
  Bun.spawnSync({ cmd: ["echo", "hello"], stdout: "pipe", stderr: "pipe", lazy: true,
  });
}

// IPC: Subprocess.send() takes the same (message, handle, options, callback) shapes as process.send(),
// and the ipc callback receives the handle the child sent.
import * as dgram from "node:dgram";
import * as net from "node:net";

{
  const proc = Bun.spawn(["bun", "child.ts"], {
    ipc(message, subprocess, handle) {
      tsd.expectType(subprocess).is<Bun.Subprocess<"ignore", "pipe", "inherit">>();
      tsd.expectType(handle).is<Bun.Spawn.SendHandle | undefined>();
      if (handle instanceof net.Server) tsd.expectType(handle).is<net.Server>();
      else if (handle instanceof net.Socket) tsd.expectType(handle).is<net.Socket>();
      else if (handle instanceof dgram.Socket) tsd.expectType(handle).is<dgram.Socket>();
      else tsd.expectType(handle).is<undefined>();
    },
  });

  const server = net.createServer();
  const socket = net.connect(0);
  const udp = dgram.createSocket("udp4");
  const onSent = (error: Error | null) => {};

  tsd.expectType(proc.send("message")).is<boolean>();
  tsd.expectType(proc.send({ some: "object" }, onSent)).is<boolean>();

  tsd.expectType(proc.send("server", server)).is<boolean>();
  tsd.expectType(proc.send("socket", socket)).is<boolean>();
  tsd.expectType(proc.send("udp", udp)).is<boolean>();
  tsd.expectType(proc.send("socket", socket, onSent)).is<boolean>();
  tsd.expectType(proc.send("socket", socket, { keepOpen: true })).is<boolean>();
  tsd.expectType(proc.send("socket", socket, { keepOpen: true }, onSent)).is<boolean>();
  tsd.expectType(proc.send("no handle", undefined, {}, onSent)).is<boolean>();

  const handle: Bun.Spawn.SendHandle = Math.random() > 0.5 ? server : socket;
  proc.send("either", handle);
  proc.send("either", handle, { keepOpen: false } satisfies Bun.Spawn.SendOptions);
  proc.send("either", handle, undefined, onSent);

  // Anything child_process.ChildProcess.send() accepts as a handle can be passed here too.
  const nodeHandle = null as unknown as import("node:child_process").SendHandle;
  tsd.expectAssignable<Bun.Spawn.SendHandle | undefined>(nodeHandle);

  const bunListener = Bun.listen({ hostname: "localhost", port: 0, socket: { data() {} } });

  // @ts-expect-error only net.Server, net.Socket and dgram.Socket can be sent
  proc.send("fd", { fd: 3 });
  // @ts-expect-error Bun.listen() listeners are not node:net servers and cannot be sent
  proc.send("bun listener", bunListener);
  // @ts-expect-error keepOpen is the only option
  proc.send("socket", socket, { keepAlive: true });
  // @ts-expect-error the callback receives an error or null
  proc.send("socket", socket, undefined, (sent: boolean) => {});
}
