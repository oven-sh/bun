// A worker that does in Python what it is asked to.
import { bytes, dict, exec, id, memoryview, tuple } from "python:builtins";
import sys from "python:sys";
import threading from "python:threading";
import time from "python:time";

declare var self: Worker;

const operations: Record<string, (message: any) => unknown> = {
  identity: () => id(sys.modules),
  write: ({ buffer, index, value }) => {
    const view = memoryview(new Uint8Array(buffer));
    view[index] = value;
    return [...bytes(view)];
  },
  postTuple: () => tuple([1, 2]),
  threads: () => {
    const globals = dict();
    exec(
      `
import threading
results = []
def work(i):
    results.append(sum(range(1000)) + i)
threads = [threading.Thread(target=work, args=(i,)) for i in range(4)]
for thread in threads: thread.start()
for thread in threads: thread.join()
`,
      globals,
    );
    return {
      results: [...globals.results].sort(),
      isMainThread: threading.current_thread() === threading.main_thread(),
    };
  },
  sleep: () => (postMessage("started"), time.sleep(3600)),
  loop: () => (postMessage("started"), exec("while True: pass", dict())),
  raise: () => exec("raise ValueError('in the worker')", dict()),
  exit: () => exec("import sys; sys.exit(3)", dict()),
};

self.onmessage = ({ data }: MessageEvent) => {
  let result;
  try {
    result = operations[data.operation](data);
    postMessage(result);
  } catch (error: any) {
    if (error.name !== "DataCloneError") throw error;
    postMessage(error.name);
  }
};
