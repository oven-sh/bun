// A Worker starts two Workers, each of which starts two, four levels deep; answers go up. Then a parent is terminated while its children run, and a parent ends by itself while a child still runs.
import { Worker as NodeWorker, isMainThread, parentPort, workerData } from "node:worker_threads";
type Task = { depth: number; path: string; mode: string };
function leaf(path: string): number {
  let hash = 7;
  for (let i = 0; i < path.length; i++) hash = (hash * 31 + path.charCodeAt(i)) | 0;
  return hash & 0xffff;
}
function child(task: Task): Promise<number> {
  return new Promise((resolve, reject) => {
    const worker = new NodeWorker(new URL(import.meta.url), { workerData: task });
    worker.once("message", resolve);
    worker.once("error", reject);
  });
}

if (isMainThread) {
  console.log("the tree:", await child({ depth: 4, path: "r", mode: "tree" }));

  for (let round = 0; round < 5; round++) {
    const parent = new NodeWorker(new URL(import.meta.url), { workerData: { depth: 2, path: "p", mode: "spin" } satisfies Task });
    await new Promise(resolve => parent.once("message", resolve));
    console.log("a parent of spinning children ends with:", await parent.terminate());
  }

  const leaves = new NodeWorker(new URL(import.meta.url), { workerData: { depth: 1, path: "q", mode: "leave" } satisfies Task });
  console.log("a parent that ends before its child:", await new Promise(resolve => leaves.once("exit", resolve)));
} else {
  const task: Task = workerData;
  if (task.mode === "tree") {
    if (task.depth === 0) parentPort!.postMessage(leaf(task.path));
    else {
      const [a, b] = await Promise.all([child({ ...task, depth: task.depth - 1, path: task.path + "a" }), child({ ...task, depth: task.depth - 1, path: task.path + "b" })]);
      parentPort!.postMessage((a * 3 + b) | 0);
    }
  } else if (task.mode === "spin") {
    if (task.depth === 0) {
      parentPort!.postMessage(0);
      for (let i = 0; ; i++) leaf("spin" + (i & 7));
    } else {
      await Promise.all([child({ ...task, depth: task.depth - 1 }), child({ ...task, depth: task.depth - 1 })]);
      parentPort!.postMessage(1);
      setInterval(() => {}, 1000);
    }
  } else if (task.mode === "leave") {
    if (task.depth === 0) {
      parentPort!.postMessage(0);
      setInterval(() => leaf("still here"), 1);
    } else {
      await child({ ...task, depth: 0 });
      process.exit(3);
    }
  }
}
