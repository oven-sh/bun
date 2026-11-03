// `with` and `async with`, from JavaScript: with(), asyncWith() of bun:python. Tasks made of promises.
import python, { asyncWith, kwargs, with as with_ } from "bun:python";
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { isASAN, isDebug } from "harness";
import asyncio from "python:asyncio";
import { TypeError as PyTypeError, TimeoutError, ValueError, dict, exec } from "python:builtins";
import contextlib from "python:contextlib";
import decimal from "python:decimal";
import threading from "python:threading";

// These builds take seconds to start Python, and longer to import asyncio.
if (isDebug || isASAN) setDefaultTimeout(120_000);

const globals = dict([["__name__", "fixture"]]);
exec(
  `
import contextlib, sys

log = []

class Manager:
    def __init__(self, name, swallows=False, fails=None):
        self.name, self.swallows, self.fails = name, swallows, fails
    def __enter__(self):
        if self.fails == "enter":
            raise KeyError(self.name)
        log.append(f"enter {self.name}")
        return self.name
    def __exit__(self, type, value, traceback):
        log.append(f"exit {self.name} {type and type.__name__} {sys.exception() is value}")
        if self.fails == "exit":
            raise KeyError(self.name)
        return self.swallows

class AsyncManager:
    def __init__(self, name, swallows=False):
        self.name, self.swallows = name, swallows
    async def __aenter__(self):
        log.append(f"enter {self.name}")
        return self.name
    async def __aexit__(self, type, value, traceback):
        log.append(f"exit {self.name} {type and type.__name__}")
        return self.swallows

@contextlib.contextmanager
def generator(name):
    log.append("before " + name)
    try:
        yield name
    except ValueError as error:
        log.append(f"caught {error}")
    finally:
        log.append("after " + name)

def take():
    taken = list(log)
    log.clear()
    return taken
`,
  globals,
);
const { Manager, AsyncManager, generator, take } = globals;

describe("with()", () => {
  test("is `with manager as value: return body(value)`", () => {
    expect(with_(Manager("a"), (value: string) => value + "!")).toBe("a!");
    expect(take()).toEqual(["enter a", "exit a None True"]);
    expect(python.with).toBe(with_);
  });

  test("takes several managers", () => {
    expect(with_(Manager("a"), Manager("b"), (a: string, b: string) => a + b)).toBe("ab");
    expect(take()).toEqual(["enter a", "enter b", "exit b None True", "exit a None True"]);
    expect(with_(() => "no manager at all")).toBe("no manager at all");
  });

  test("tells __exit__ what the body threw, which goes on", () => {
    const error = new ValueError("x");
    expect(() => with_(Manager("a"), () => { throw error; })).toThrow(error); // prettier-ignore
    expect(take()).toEqual(["enter a", "exit a ValueError True"]);

    const ofJavaScript = new RangeError("js");
    expect(() => with_(Manager("a"), Manager("b"), () => { throw ofJavaScript; })).toThrow(ofJavaScript); // prettier-ignore
    expect(take()).toEqual(["enter a", "enter b", "exit b JSError True", "exit a JSError True"]);
  });

  test("__exit__ can swallow it", () => {
    expect(with_(Manager("a"), Manager("b", true), () => { throw new ValueError("x"); })).toBeUndefined(); // prettier-ignore
    expect(take()).toEqual(["enter a", "enter b", "exit b ValueError True", "exit a None True"]);
    expect(with_(contextlib.suppress(ValueError), () => { throw new ValueError("x"); })).toBeUndefined(); // prettier-ignore
  });

  test("a manager that fails", () => {
    expect(() => with_(Manager("a"), Manager("b", false, "enter"), () => "not reached")).toThrow("'b'");
    expect(take()).toEqual(["enter a", "exit a KeyError True"]);
    expect(() => with_(Manager("a"), Manager("b", false, "exit"), () => "reached")).toThrow("'b'");
    expect(take()).toEqual(["enter a", "enter b", "exit b None True", "exit a KeyError True"]);
  });

  test("a generator as a manager", () => {
    expect(with_(generator("g"), () => { throw new ValueError("in the body"); })).toBeUndefined(); // prettier-ignore
    expect(take()).toEqual(["before g", "caught in the body", "after g"]);
    const ofJavaScript = contextlib.contextmanager(function* () {
      try {
        yield "value";
      } finally {
        globals.log.push("finally");
      }
    });
    expect(with_(ofJavaScript(), (value: string) => value)).toBe("value");
    expect(take()).toEqual(["finally"]);
  });

  test("what is no manager", () => {
    expect(() => with_(5, () => 1)).toThrow("'int' object does not support the context manager protocol");
    expect(() => with_(AsyncManager("x"), () => 1)).toThrow("Did you mean to use 'async with'?");
    expect(() => with_(AsyncManager("x"), () => 1)).toThrow(PyTypeError);
  });

  test("lasts as long as a body that is async", async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    const result = with_(Manager("a"), async (value: string) => {
      await promise;
      return value + "?";
    });
    expect(take()).toEqual(["enter a"]);
    resolve();
    expect(await result).toBe("a?");
    expect(take()).toEqual(["exit a None True"]);

    const error = new ValueError("late");
    expect(with_(Manager("a"), async () => { await 0; throw error; })).rejects.toBe(error); // prettier-ignore
    expect(await with_(Manager("b", true), async () => { await 0; throw error; })).toBeUndefined(); // prettier-ignore
  });

  test("the managers of the standard library", () => {
    const lock = threading.Lock();
    expect(with_(lock, () => lock.locked())).toBe(true);
    expect(lock.locked()).toBe(false);
    const precision = with_(decimal.localcontext(), (context: any) => {
      context.prec = 5;
      return String(decimal.Decimal(1) / 3);
    });
    expect(precision).toBe("0.33333");
    expect(String(decimal.Decimal(1) / 3)).toBe("0.3333333333333333333333333333");
    const closed: string[] = [];
    with_(contextlib.ExitStack(), (stack: any) => {
      stack.callback(() => closed.push("first"));
      stack.callback(() => closed.push("second"));
    });
    expect(closed).toEqual(["second", "first"]);
  });
});

describe("asyncWith()", () => {
  test("is `async with manager as value: return await body(value)`", async () => {
    take();
    expect(await asyncWith(AsyncManager("x"), AsyncManager("y"), async (x: string, y: string) => x + y)).toBe("xy");
    expect(take()).toEqual(["enter x", "enter y", "exit y None", "exit x None"]);
    expect(await asyncWith(AsyncManager("x"), (x: string) => x + ", not async")).toBe("x, not async");
    take();
  });

  test("tells __aexit__ what the body threw", async () => {
    const error = new ValueError("x");
    expect(asyncWith(AsyncManager("x"), async () => { throw error; })).rejects.toBe(error); // prettier-ignore
    expect(await asyncWith(AsyncManager("y", true), async () => { throw error; })).toBeUndefined(); // prettier-ignore
    expect(take()).toEqual(["enter x", "enter y", "exit x ValueError", "exit y ValueError"]);
    expect(asyncWith(Manager("a"), () => 1)).rejects.toThrow("Did you mean to use 'with'?");
  });

  test("is one task, which a timeout cancels", async () => {
    expect(asyncWith(asyncio.timeout(0.001), () => asyncio.sleep(3600))).rejects.toBeInstanceOf(TimeoutError);
    const lock = asyncio.Lock();
    expect(await asyncWith(lock, () => lock.locked())).toBe(true);
    expect(lock.locked()).toBe(false);
  });
});

describe("a task of a promise", () => {
  const work = async (value: unknown) => {
    await Promise.resolve();
    return value;
  };

  test("create_task() takes what an `async def` gives JavaScript", async () => {
    const task = asyncio.create_task(asyncio.sleep(0, "python"), kwargs({ name: "named" }));
    expect(task).toBeInstanceOf(asyncio.Task);
    expect(task.get_name()).toBe("named");
    expect(await task).toBe("python");
  });

  test("and what an async function gives", async () => {
    const task = asyncio.create_task(work("javascript"));
    expect(task.done()).toBe(false);
    expect(await task).toBe("javascript");
    expect(task.result()).toBe("javascript");
  });

  test("to cancel it cancels the coroutine", async () => {
    const queue = asyncio.Queue();
    const task = asyncio.create_task(queue.get());
    await asyncio.sleep(0);
    task.cancel();
    expect(task).rejects.toBeInstanceOf(asyncio.CancelledError);
    await asyncio.sleep(0);
    queue.put_nowait(1);
    expect(queue.qsize()).toBe(1);
  });

  test("a failure belongs to the task", async () => {
    const task = asyncio.create_task((async () => { throw new ValueError("bad"); })()); // prettier-ignore
    await asyncio.wait([task]);
    expect(task.exception()).toBeInstanceOf(ValueError);
  });

  test("TaskGroup.create_task()", async () => {
    const tasks = await asyncWith(asyncio.TaskGroup(), async (group: any) => [
      group.create_task(asyncio.sleep(0, 1)),
      group.create_task(work(2)),
    ]);
    expect(tasks.map((task: any) => task.result())).toEqual([1, 2]);

    let group: any;
    try {
      await asyncWith(asyncio.TaskGroup(), async (group: any) => {
        group.create_task((async () => { throw new ValueError("bad"); })()); // prettier-ignore
        group.create_task(asyncio.sleep(3600));
      });
    } catch (error) {
      group = error;
    }
    expect(group.name).toBe("ExceptionGroup");
    expect(Array.from(group.exceptions, (error: any) => error.message)).toEqual(["bad"]);
  });
});
