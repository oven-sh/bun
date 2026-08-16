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
// What each stdio option turns into on the Subprocess. Only a caller-supplied file descriptor
// (a number or Bun.file(fd)) comes back out as a number, and even that becomes undefined when it
// is the parent's own standard stream (Bun treats that as "inherit"). A ReadableStream passed as
// stdin, including the body of a Request/Response, comes back as the stream; inputs Bun copies
// into the process itself (Blob, ArrayBufferView, Bun.file(path), an in-memory Request/Response
// body) leave the property undefined.
declare const fd: number;
declare const stdinStream: ReadableStream<Uint8Array>;
{
  const proc = Bun.spawn(["cat"], { stdin: fd, stdout: fd, stderr: fd });
  tsd.expectType(proc.stdin).is<number | undefined>();
  tsd.expectType(proc.stdout).is<number | undefined>();
  tsd.expectType(proc.stderr).is<number | undefined>();
  tsd.expectType(proc.readable).is<number | undefined>();
}
{
  const proc = Bun.spawn(["cat"], { stdin: 0, stdout: 1, stderr: 2 });
  tsd.expectType(proc.stdin).is<number | undefined>();
  tsd.expectType(proc.stdout).is<number | undefined>();
  tsd.expectType(proc.stderr).is<number | undefined>();
}
{
  const proc = Bun.spawn(["cat"], {
    stdin: Bun.file("input.txt"),
    stdout: Bun.file("output.txt"),
    stderr: Bun.file(fd),
  });
  tsd.expectType(proc.stdin).is<number | undefined>();
  tsd.expectType(proc.stdout).is<number | undefined>();
  tsd.expectType(proc.stderr).is<number | undefined>();
  tsd.expectType(proc.readable).is<number | undefined>();
}
{
  const proc = Bun.spawn(["cat"], { stdin: new Blob(["hello"]) });
  tsd.expectType(proc.stdin).is<undefined>();
}
{
  const proc = Bun.spawn(["cat"], { stdin: new Uint8Array([1, 2, 3]) });
  tsd.expectType(proc.stdin).is<undefined>();
}
{
  const proc = Bun.spawn(["cat"], { stdio: [new Uint8Array([]), new Uint8Array(64), new Uint8Array(64)] });
  tsd.expectType(proc.stdin).is<undefined>();
  tsd.expectType(proc.stdout).is<undefined>();
  tsd.expectType(proc.stderr).is<undefined>();
}
{
  const proc = Bun.spawn(["cat"], { stdin: stdinStream });
  tsd.expectType(proc.stdin).is<ReadableStream | undefined>();
}
{
  const proc = Bun.spawn(["cat"], { stdio: [new Request("1"), null, null] });
  tsd.expectType(proc.stdin).is<ReadableStream | undefined>();
}
{
  const proc = Bun.spawn(["cat"], { stdin: new Response("1") });
  tsd.expectType(proc.stdin).is<ReadableStream | undefined>();
}
{
  const proc = Bun.spawn(["cat"], {
    stdin: depromise(fetch("https://example.com/")),
    stdout: "pipe",
  });
  tsd.expectType(proc.stdin).is<ReadableStream | undefined>();
  tsd.expectType(proc.stdout).is<ReadableStream<Uint8Array<ArrayBuffer>>>();
}
{
  const proc = Bun.spawnSync(["cat"], { stdout: fd, stderr: Bun.file("errors.txt") });
  tsd.expectType(proc.stdout).is<number | undefined>();
  tsd.expectType(proc.stderr).is<number | undefined>();
}
{
  const proc = Bun.spawnSync(["cat"], { stdout: "pipe", stderr: "inherit" });
  tsd.expectType(proc.stdout).is<Buffer>();
  tsd.expectType(proc.stderr).is<undefined>();
}
{
  const proc = Bun.spawnSync(["cat"], { stdio: ["ignore", new Uint8Array(64), null] });
  tsd.expectType(proc.stdout).is<undefined>();
  tsd.expectType(proc.stderr).is<undefined>();
}

// The unions seen through a Subprocess whose stdio configuration is not known statically.
tsd.expectType<Bun.Subprocess["stdin"]>().is<FileSink | ReadableStream | number | undefined>();
tsd.expectType<Bun.Subprocess["stdin"]>().is<Bun.Spawn.WritableIO>();
tsd.expectType<Bun.Subprocess["stdout"]>().is<ReadableStream<Uint8Array<ArrayBuffer>> | number | undefined>();
tsd.expectType<Bun.Subprocess["stderr"]>().is<ReadableStream<Uint8Array<ArrayBuffer>> | number | undefined>();
tsd.expectType<SyncSubprocess["stdout"]>().is<Buffer | number | undefined>();
tsd.expectType<ReadableSubprocess["stdin"]>().is<FileSink | ReadableStream | number | undefined>();
tsd.expectType<ReadableSubprocess["stdout"]>().is<ReadableStream<Uint8Array<ArrayBuffer>>>();
tsd.expectType<WritableSubprocess["stdin"]>().is<FileSink>();
tsd.expectType<NullSubprocess["stdin"]>().is<undefined>();
tsd.expectAssignable<Bun.Subprocess>(Bun.spawn([], { stdin: stdinStream, stdout: Bun.file("out.txt"), stderr: fd }));
tsd.expectAssignable<Bun.Subprocess>(Bun.spawn([], { stdin: new Blob(["hello"]), stdout: "inherit" }));
tsd.expectAssignable<SyncSubprocess>(Bun.spawnSync([], { stdout: fd, stderr: Bun.file("errors.txt") }));

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
