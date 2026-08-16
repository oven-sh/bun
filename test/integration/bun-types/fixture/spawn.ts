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

// The terminal option (async only): stdio goes through the PTY, so the stdio properties are null
// and `terminal` is always set, whatever the stdio options say.
declare const interactive: boolean;
{
  const proc = Bun.spawn(["bash"], {
    stdin: "pipe",
    terminal: {
      cols: 80,
      rows: 24,
      data(term, data) {
        tsd.expectType(term).is<Bun.Terminal>();
        tsd.expectType(data).is<Uint8Array<ArrayBuffer>>();
      },
    },
    onExit(proc) {
      tsd.expectType(proc).is<Bun.Subprocess<"pipe", "pipe", "inherit", Bun.Terminal>>();
      proc.terminal.close();
    },
    ipc(message, proc) {
      tsd.expectType(proc.stdin).is<null>();
    },
  });
  tsd.expectType(proc).is<Bun.Subprocess<"pipe", "pipe", "inherit", Bun.Terminal>>();
  tsd.expectType(proc.stdin).is<null>();
  tsd.expectType(proc.stdout).is<null>();
  tsd.expectType(proc.stderr).is<null>();
  tsd.expectType(proc.readable).is<null>();
  tsd.expectType(proc.terminal).is<Bun.Terminal>();
  tsd.expectType(proc.stdio).is<[null, null, null, ...(number | null)[]]>();
  proc.terminal.write("echo hello\n");
  // @ts-expect-error stdin is null when a terminal is attached
  proc.stdin.write("hello");
  // @ts-expect-error stdout is null when a terminal is attached
  proc.stdout.getReader();
}
{
  // an existing Terminal, and the object form
  const terminal = new Bun.Terminal({ data() {} });
  tsd.expectType(Bun.spawn(["bash"], { terminal })).is<Bun.Subprocess<"ignore", "pipe", "inherit", Bun.Terminal>>();
  tsd
    .expectType(Bun.spawn({ cmd: ["bash"], terminal }))
    .is<Bun.Subprocess<"ignore", "pipe", "inherit", Bun.Terminal>>();
  const proc = Bun.spawn({
    cmd: ["bash"],
    stdio: ["pipe", "pipe", "pipe"],
    terminal: { data(term, data) {} },
    onExit(proc) {
      tsd.expectType(proc.terminal).is<Bun.Terminal>();
    },
  });
  tsd.expectType(proc).is<Bun.Subprocess<"pipe", "pipe", "pipe", Bun.Terminal>>();
  tsd.expectType(proc.stdout).is<null>();
}
{
  // a terminal that may be absent gives the union of both shapes
  const proc = Bun.spawn(["bash"], {
    terminal: interactive ? { data(term, data) {} } : undefined,
    onExit(proc) {
      tsd.expectType(proc.terminal).is<Bun.Terminal | undefined>();
    },
  });
  tsd.expectType(proc).is<Bun.Subprocess<"ignore", "pipe", "inherit", Bun.Terminal | undefined>>();
  tsd.expectType(proc.stdin).is<undefined | null>();
  tsd.expectType(proc.stdout).is<ReadableStream<Uint8Array<ArrayBuffer>> | null>();
  tsd.expectType(proc.readable).is<ReadableStream<Uint8Array<ArrayBuffer>> | null>();
  tsd.expectType(proc.terminal).is<Bun.Terminal | undefined>();
  const objectForm = Bun.spawn({ cmd: ["bash"], terminal: interactive ? {} : undefined });
  tsd.expectType(objectForm).is<Bun.Subprocess<"ignore", "pipe", "inherit", Bun.Terminal | undefined>>();
}
{
  // without the option, terminal is undefined and the stdio types are unchanged
  const proc = Bun.spawn(["cat"], {
    stdin: "pipe",
    onExit(proc) {
      tsd.expectType(proc).is<Bun.Subprocess<"pipe", "pipe", "inherit", undefined>>();
      proc.stdin.write("bye");
    },
  });
  tsd.expectType(proc).is<Bun.Subprocess<"pipe", "pipe", "inherit">>();
  tsd.expectType(proc).is<Bun.Subprocess<"pipe", "pipe", "inherit", undefined>>();
  tsd.expectType(proc.stdin).is<FileSink>();
  tsd.expectType(proc.terminal).is<undefined>();
  tsd.expectType(Bun.spawn(["cat"])).is<Bun.Subprocess<"ignore", "pipe", "inherit", undefined>>();
  tsd
    .expectType(Bun.spawn(["cat"], { terminal: undefined }))
    .is<Bun.Subprocess<"ignore", "pipe", "inherit", undefined>>();
  tsd.expectType(Bun.spawn({ cmd: ["cat"], stdin: "pipe" })).is<Bun.Subprocess<"pipe", "pipe", "inherit", undefined>>();
  tsd
    .expectType(
      Bun.spawnSync(["cat"], {
        onExit(proc) {
          tsd.expectType(proc.terminal).is<undefined>();
        },
      }),
    )
    .is<SyncSubprocess<"pipe", "pipe">>();
  // @ts-expect-error spawnSync does not take a terminal
  Bun.spawnSync(["cat"], { terminal: {} });
}
{
  // annotated options objects: the 4th type argument says whether they carry a terminal
  const plain: Bun.SpawnOptions.SpawnOptions<"ignore", "pipe", "inherit"> = {
    onExit(proc) {
      tsd.expectType(proc.stdout).is<ReadableStream<Uint8Array<ArrayBuffer>>>();
    },
  };
  tsd.expectType(Bun.spawn(["cat"], plain)).is<Bun.Subprocess<"ignore", "pipe", "inherit", undefined>>();
  // @ts-expect-error a SpawnOptions without the 4th type argument has no terminal
  const rejected: Bun.SpawnOptions.SpawnOptions<"ignore", "pipe", "inherit"> = { terminal: {} };
  const withTerminal: Bun.SpawnOptions.SpawnOptions<"ignore", "pipe", "inherit", Bun.Terminal> = {
    terminal: { data(term, data) {} },
    onExit(proc) {
      tsd.expectType(proc.terminal).is<Bun.Terminal>();
    },
  };
  const maybe: Bun.SpawnOptions.SpawnOptions<"ignore", "pipe", "inherit", Bun.Terminal | undefined> = interactive
    ? { terminal: new Bun.Terminal({}) }
    : {};
  tsd.expectType(Bun.spawn(["cat"], maybe)).is<Bun.Subprocess<"ignore", "pipe", "inherit", Bun.Terminal | undefined>>();
  tsd.expectAssignable<typeof maybe>(plain);
  tsd.expectAssignable<typeof maybe>(withTerminal);
  // @ts-expect-error may carry a terminal
  tsd.expectAssignable<typeof plain>(maybe);
  // @ts-expect-error may carry a terminal
  tsd.expectAssignable<typeof withTerminal>(maybe);
  tsd.expectType<(typeof plain)["terminal"]>().is<undefined>();
  tsd.expectType<(typeof withTerminal)["terminal"]>().is<Bun.TerminalOptions | Bun.Terminal | undefined>();
  tsd.expectType<(typeof maybe)["terminal"]>().is<Bun.TerminalOptions | Bun.Terminal | undefined>();
}
{
  // holder types
  const withTerminal = Bun.spawn(["bash"], { terminal: {} });
  const without = Bun.spawn(["cat"], { stdin: "pipe" });
  const either = Bun.spawn(["cat"], { terminal: interactive ? {} : undefined });

  // Subprocess with no type arguments (and ReturnType<typeof Bun.spawn>) holds any of them
  tsd.expectAssignable<Bun.Subprocess>(withTerminal);
  tsd.expectAssignable<Bun.Subprocess>(without);
  tsd.expectAssignable<Bun.Subprocess>(either);
  tsd.expectAssignable<Bun.Subprocess<any, any, any>>(withTerminal);
  tsd.expectAssignable<Bun.Subprocess<any, any, any>>(without);
  tsd.expectType<ReturnType<typeof Bun.spawn>>().is<Bun.Subprocess>();
  tsd.expectType<Bun.Subprocess["terminal"]>().is<Bun.Terminal | undefined>();
  tsd.expectAssignable<Bun.Subprocess["stdin"]>(null);
  tsd.expectAssignable<Bun.Subprocess["stdout"]>(null);
  tsd.expectAssignable<Bun.Subprocess["stderr"]>(null);
  tsd.expectAssignable<Bun.Subprocess["readable"]>(null);
  function cleanUp(proc: Bun.Subprocess) {
    proc.terminal?.close();
    proc.kill();
  }
  cleanUp(withTerminal);
  cleanUp(without);
  cleanUp(either);

  // Subprocess<.., .., .., Terminal> holds exactly the processes that have one
  tsd.expectAssignable<Bun.Subprocess<any, any, any, Bun.Terminal>>(withTerminal);
  tsd.expectAssignable<Bun.Subprocess<any, any, any, Bun.Terminal>>(
    Bun.spawn(["bash"], { terminal: new Bun.Terminal({}) }),
  );
  // @ts-expect-error has no terminal
  tsd.expectAssignable<Bun.Subprocess<any, any, any, Bun.Terminal>>(without);
  // @ts-expect-error may have no terminal
  tsd.expectAssignable<Bun.Subprocess<any, any, any, Bun.Terminal>>(either);
  tsd.expectType<Bun.Subprocess<any, any, any, Bun.Terminal>["stdout"]>().is<null>();

  // giving the stdio type arguments still describes exactly those streams, and excludes terminal processes
  tsd.expectType<PipedSubprocess["stdin"]>().is<FileSink>();
  tsd.expectType<PipedSubprocess["terminal"]>().is<undefined>();
  tsd.expectType<ReadableSubprocess["stdout"]>().is<ReadableStream<Uint8Array<ArrayBuffer>>>();
  tsd.expectType<WritableSubprocess["stdin"]>().is<FileSink>();
  tsd.expectType<NullSubprocess["terminal"]>().is<undefined>();
  tsd.expectType<Bun.Subprocess<any, "pipe", any>["stdout"]>().is<ReadableStream<Uint8Array<ArrayBuffer>>>();
  tsd.expectAssignable<WritableSubprocess>(without);
  // @ts-expect-error its stdin is null, not a FileSink
  tsd.expectAssignable<WritableSubprocess>(withTerminal);
  // @ts-expect-error its stdout is null, not a stream
  tsd.expectAssignable<ReadableSubprocess>(Bun.spawn(["bash"], { stdio: ["pipe", "pipe", "pipe"], terminal: {} }));
  // @ts-expect-error may have a terminal
  tsd.expectAssignable<Bun.Subprocess<"ignore", "pipe", "inherit">>(either);
  tsd.expectAssignable<Bun.Subprocess<"ignore", "pipe", "inherit">>(Bun.spawn(["cat"]));
}
