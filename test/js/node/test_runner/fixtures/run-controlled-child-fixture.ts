// Runs run() of node:test over children that this script controls. Bun.spawn gives the runner a child whose pipes,
// exit and kill() a scenario holds, so each scenario puts the abort at one exact point of a file.
// Prints one JSON object: the result of each scenario, by name.
import { run } from "node:test";

type Stream = ReturnType<typeof run>;

const encoder = new TextEncoder();
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

// The runner takes an event of a child from a line of stdout that has this prefix.
const event = (type: string, data: object) => `\0bun:test:run\0${JSON.stringify({ type, data })}\n`;
const pass = (name: string) => event("test:pass", { name, nesting: 0, testNumber: 1, duration_ms: 0 });

function pipe() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let unread = false;
  let open = true;
  let closedByTheRunner = false;
  const stream = new ReadableStream<Uint8Array>(
    {
      start: it => void (controller = it),
      // The runner asks for a chunk, and no chunk waits.
      pull: () => void (unread = false),
      cancel: () => void ((open = false), (closedByTheRunner = true)),
    },
    { highWaterMark: 0 },
  );
  return {
    stream,
    write(text: string) {
      unread = true;
      controller.enqueue(encoder.encode(text));
    },
    end() {
      if (open) controller.close();
      open = false;
    },
    /** True when the runner took each chunk and asked for the next one. */
    isRead: async () => (await tick(), !unread),
    closedByTheRunner: () => closedByTheRunner,
  };
}

function makeChild() {
  const exit = Promise.withResolvers<number>();
  const stdout = pipe();
  const stderr = pipe();
  const child = {
    stdout,
    stderr,
    kills: 0,
    /** The child exits. Each pipe stays open, as when a process of the child holds it. */
    exit: (code: number) => exit.resolve(code),
    /** The child closes each pipe, then exits. */
    end(code: number) {
      stdout.end();
      stderr.end();
      exit.resolve(code);
    },
    /** What Bun.spawn returns. kill() does not end this child. */
    subprocess: { stdout: stdout.stream, stderr: stderr.stream, exited: exit.promise, kill: () => void child.kills++ },
  };
  return child;
}
type Child = ReturnType<typeof makeChild>;

let spawns = 0;
let lastChild: Child | undefined;
let spawnFollowsTheSignal = false;
let spawnError: Error | undefined;
let onSpawn: ((child: Child) => void) | undefined;
const nextChild = () => new Promise<Child>(resolve => (onSpawn = resolve));

Bun.spawn = ((options: { signal?: AbortSignal }) => {
  if (spawnError) {
    const error = spawnError;
    spawnError = undefined;
    throw error;
  }
  spawns++;
  spawnFollowsTheSignal ||= options.signal !== undefined;
  const child = (lastChild = makeChild());
  onSpawn?.(child);
  return child.subprocess;
}) as any;

let decodes = 0;
const decode = TextDecoder.prototype.decode;
TextDecoder.prototype.decode = function (this: TextDecoder, ...args: Parameters<typeof decode>) {
  decodes++;
  return decode.apply(this, args);
};

/** The number of "abort" listeners that the runner has on the signal. */
function countListeners(signal: AbortSignal) {
  let count = 0;
  const { addEventListener, removeEventListener } = signal;
  signal.addEventListener = function (this: AbortSignal, ...args: any) {
    count++;
    return addEventListener.apply(this, args);
  };
  signal.removeEventListener = function (this: AbortSignal, ...args: any) {
    count--;
    return removeEventListener.apply(this, args);
  };
  return () => count;
}

/** Each `details` object of an event that inherits from Object.prototype, over all scenarios. */
const detailsWithPrototype: string[] = [];

/** Records what the runner publishes, at the time that it publishes it. `isReason`: the error is `reason` itself. */
function observe(stream: Stream, reason?: unknown) {
  const types: string[] = [];
  const stderr: string[] = [];
  const errors: any[] = [];
  const failed: { name: string; failureType: unknown; isReason: boolean }[] = [];
  let summary: { success: boolean; counts: Record<string, number> } | undefined;
  let plan: number | undefined;
  let destroyedWith: string | undefined;
  let mark = 0;

  const emit = stream.emit;
  stream.emit = function (this: Stream, type: string, data: any) {
    if (type.startsWith("test:")) types.push(type);
    if (data?.details && Object.getPrototypeOf(data.details) !== null)
      detailsWithPrototype.push(`${type} ${data.name}`);
    if (type === "test:stderr") stderr.push(data.message);
    if (type === "test:plan" && data.file === undefined) plan = data.count;
    if (type === "test:summary" && data.file === undefined) summary = data;
    if (type === "test:fail") {
      const error = data.details.error;
      errors.push(error);
      failed.push({ name: data.name, failureType: error?.failureType, isReason: error === reason });
    }
    return emit.apply(this, arguments as any);
  } as any;

  const closed = new Promise<void>(resolve => stream.on("close", resolve));
  stream.on("error", error => (destroyedWith = error?.message));
  stream.resume();

  return {
    stream,
    /** Fulfills when the stream ended or was destroyed. */
    closed,
    /** As `closed`, then one more turn: the readers of the runner had the time to publish more. */
    settled: () => closed.then(tick),
    stderr,
    errors,
    plan: () => plan,
    destroyedWith: () => destroyedWith,
    /** From here on, `published()` lists the types of the events. */
    mark: () => void (mark = types.length),
    published: () => types.slice(mark),
    /** True when the run has its end now: no event of a child and no exit of a child is necessary for it. */
    endedNow: async () => (await tick(), summary !== undefined || destroyedWith !== undefined),
    outcome() {
      const { tests, passed, failed: failures, cancelled } = summary?.counts ?? {};
      return { success: summary?.success, counts: { tests, passed, failed: failures, cancelled }, failed };
    },
  };
}

const results: Record<string, unknown> = {};

async function scenario(name: string, body: () => Promise<unknown>) {
  spawns = 0;
  lastChild = undefined;
  spawnFollowsTheSignal = false;
  results[name] = await body();
}

await scenario("the abort comes while the child runs", async () => {
  const controller = new AbortController();
  const reason = new Error("stop");
  const spawned = nextChild();
  const watch = observe(run({ files: ["a.js"], signal: controller.signal }), reason);
  const child = await spawned;
  child.stdout.write(pass("before the abort"));
  await child.stdout.isRead();

  watch.mark();
  const decodesBefore = decodes;
  controller.abort(reason);
  const endedAtAbort = await watch.endedNow();
  const publishedAfterAbort = watch.published();

  // The child runs on, and writes to each pipe.
  child.stdout.write(pass("after the abort"));
  child.stderr.write("after the abort\n");
  const readsThePipes = (await child.stdout.isRead()) && (await child.stderr.isRead());
  const closedAPipe = child.stdout.closedByTheRunner() || child.stderr.closedByTheRunner();
  child.end(0);
  await watch.settled();
  return {
    endedAtAbort,
    publishedAfterAbort,
    publishedAfterTheEnd: watch.published().slice(publishedAfterAbort.length),
    outcome: watch.outcome(),
    kills: child.kills,
    spawnFollowsTheSignal,
    decodedAfterAbort: decodes - decodesBefore,
    readsThePipes,
    closedAPipe,
  };
});

await scenario("a listener aborts in the middle of a chunk", async () => {
  const controller = new AbortController();
  const reason = new Error("stop");
  const spawned = nextChild();
  const watch = observe(run({ files: ["a.js"], signal: controller.signal }), reason);
  watch.stream.on("test:pass", data => {
    if (data.name !== "the listener aborts here") return;
    watch.mark();
    controller.abort(reason);
  });
  const child = await spawned;
  child.stdout.write(
    "a line before\n" + pass("the listener aborts here") + "a line after\n" + pass("after the abort") + "no newline",
  );

  const endedAtAbort = await watch.endedNow();
  child.end(0);
  await watch.settled();
  return { endedAtAbort, publishedAfterAbort: watch.published(), outcome: watch.outcome(), kills: child.kills };
});

await scenario("the abort comes after stdout ended, and the child never exits", async () => {
  const controller = new AbortController();
  const reason = new Error("stop");
  const spawned = nextChild();
  const watch = observe(run({ files: ["a.js"], signal: controller.signal }), reason);
  const child = await spawned;
  child.stdout.write(pass("passes"));
  child.stdout.end();
  await tick();

  watch.mark();
  controller.abort(reason);
  const endedAtAbort = await watch.endedNow();
  const publishedAfterAbort = watch.published();
  child.end(0);
  await watch.settled();
  return { endedAtAbort, publishedAfterAbort, outcome: watch.outcome(), kills: child.kills };
});

await scenario("the abort comes after the child exited, while only stderr is open", async () => {
  const controller = new AbortController();
  const reason = new Error("stop");
  const spawned = nextChild();
  const watch = observe(run({ files: ["a.js"], signal: controller.signal }), reason);
  const child = await spawned;
  child.stdout.write(pass("passes"));
  child.stdout.end();
  child.exit(0);
  await tick();

  watch.mark();
  controller.abort(reason);
  const endedAtAbort = await watch.endedNow();
  const publishedAfterAbort = watch.published();
  child.stderr.end();
  await watch.settled();
  return { endedAtAbort, publishedAfterAbort, outcome: watch.outcome(), kills: child.kills };
});

for (const source of ["stdout", "stderr"] as const) {
  for (const signal of ["with a signal", "without a signal"]) {
    await scenario(`a test:${source} listener throws, ${signal}`, async () => {
      const spawned = nextChild();
      const options = signal === "with a signal" ? { signal: new AbortController().signal } : {};
      const watch = observe(run({ files: ["a.js"], ...options }));
      watch.stream.on(`test:${source}`, () => {
        throw new Error("the listener throws");
      });
      const child = await spawned;
      child[source].write("a line\n");

      const endedAtThrow = await watch.endedNow();
      child.end(0);
      await watch.settled();
      return { endedAtThrow, destroyedWith: watch.destroyedWith(), kills: child.kills };
    });
  }
}

// The error of the listener is the result, as without the abort.
for (const [name, source, afterExit] of [
  ["a test:stdout listener aborts, then throws", "stdout", false],
  ["a test:stderr listener aborts, then throws", "stderr", false],
  ["a test:stderr listener aborts, then throws, after the child exited", "stderr", true],
] as const) {
  await scenario(name, async () => {
    const controller = new AbortController();
    const spawned = nextChild();
    const watch = observe(run({ files: ["a.js"], signal: controller.signal }));
    watch.stream.on(`test:${source}`, () => {
      controller.abort();
      throw new Error("the listener throws");
    });
    const child = await spawned;
    if (afterExit) {
      child.stdout.write(pass("passes"));
      child.stdout.end();
      child.exit(0);
      await tick();
    }
    child[source].write("a line\n");

    const endedAtThrow = await watch.endedNow();
    child.end(0);
    await watch.settled();
    return { endedAtThrow, destroyedWith: watch.destroyedWith(), kills: child.kills };
  });
}

await scenario("the child of the first file does not start", async () => {
  const cause = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
  spawnError = cause;
  const spawned = nextChild();
  const watch = observe(run({ files: ["a.js", "b.js"] }));
  // Without a child of "b.js", the run ended at "a.js".
  const child = await Promise.race([spawned, watch.closed]);
  if (!child) return { destroyedWith: watch.destroyedWith() };
  child.stdout.write(pass("passes"));
  child.end(0);
  await watch.settled();
  const error = watch.errors[0];
  return {
    outcome: watch.outcome(),
    error: { code: error?.code, message: error?.message, causeIsTheSpawnError: error?.cause === cause },
    spawns,
  };
});

for (const signal of ["with a signal", "without a signal"]) {
  await scenario(`the child writes to stderr and exits with code 1, ${signal}`, async () => {
    const spawned = nextChild();
    const options = signal === "with a signal" ? { signal: new AbortController().signal } : {};
    const watch = observe(run({ files: ["a.js"], ...options }));
    const child = await spawned;
    for (const chunk of ["first li", "ne\n\nthird line\r\nlast line, ", "with no newline"]) {
      child.stderr.write(chunk);
      await child.stderr.isRead();
    }
    child.end(1);
    await watch.settled();
    return { published: watch.stderr, outcome: watch.outcome(), message: watch.errors[0]?.message, kills: child.kills };
  });
}

await scenario("the abort comes after the file ended", async () => {
  const controller = new AbortController();
  const reason = new Error("stop");
  const listeners = countListeners(controller.signal);
  let spawned = nextChild();
  const watch = observe(run({ files: ["a.js", "b.js"], signal: controller.signal }), reason);
  const first = await spawned;
  spawned = nextChild();
  first.stdout.write(pass("passes"));
  first.end(0);
  const second = await spawned;
  const whileTheSecondFileRuns = listeners();

  controller.abort(reason);
  const endedAtAbort = await watch.endedNow();
  second.end(0);
  await watch.settled();
  return {
    endedAtAbort,
    outcome: watch.outcome(),
    killsOfTheFirstChild: first.kills,
    killsOfTheSecondChild: second.kills,
    abortListeners: { whileTheSecondFileRuns, afterTheRun: listeners() },
  };
});

await scenario("the signal is aborted before run(), with three files", async () => {
  const reason = new Error("stop");
  const watch = observe(run({ files: ["a.js", "b.js", "c.js"], signal: AbortSignal.abort(reason) }), reason);
  await watch.settled();
  return { outcome: watch.outcome(), plan: watch.plan(), spawns };
});

await scenario("a test:dequeue listener aborts", async () => {
  const controller = new AbortController();
  const reason = new Error("stop");
  const watch = observe(run({ files: ["a.js"], signal: controller.signal }), reason);
  watch.stream.once("test:dequeue", () => controller.abort(reason));
  const endedAtAbort = await watch.endedNow();
  lastChild?.end(0);
  await watch.settled();
  return { endedAtAbort, outcome: watch.outcome(), spawns };
});

for (const [name, reason] of [
  ["the reason is a string", "stop"],
  ["the reason is a frozen object", Object.freeze(new Error("stop"))],
] as const) {
  await scenario(name, async () => {
    const watch = observe(run({ files: ["a.js"], signal: AbortSignal.abort(reason) }), reason);
    await watch.settled();
    const error = watch.errors[0];
    return {
      outcome: watch.outcome(),
      error: { name: error?.name, message: error?.message, causeIsTheReason: error?.cause === reason },
    };
  });
}

results["details objects that inherit from Object.prototype"] = detailsWithPrototype;

console.log(JSON.stringify(results, null, 2));
