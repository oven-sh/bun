import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

class Point {
  x = 3;
  norm(): number {
    return this.x * this.x;
  }
}

class Raised extends Point {
  norm(): number {
    return super.norm() + 100;
  }
}

function normOf(p: Point): number {
  return p.norm();
}

function facts(): string {
  let warm = 0;
  for (let i = 0; i < 2000; i++) warm += normOf(new Point()) + normOf(new Raised());
  return warm + " " + normOf(new Point()) + " " + normOf(new Raised()) + " " + new Point().norm();
}

function ask(order: string): Promise<string> {
  return new Promise(resolve => {
    const worker = new Worker(new URL(import.meta.url), { workerData: order });
    worker.once("message", (answer: string) => {
      void worker.terminate().then(() => resolve(answer));
    });
  });
}

if (isMainThread) {
  console.log("main, at first: " + facts());
  Point.prototype.norm = () => -1;
  console.log("main, after its own replacement: " + facts());
  console.log("a worker that changes nothing: " + (await ask("nothing")));
  console.log("a worker that replaces the method for itself: " + (await ask("replace")));
  console.log("main, after the workers: " + facts());
  console.log("another worker that changes nothing: " + (await ask("nothing")));
} else {
  const before = facts();
  if (workerData === "replace") Point.prototype.norm = () => -2;
  parentPort?.postMessage(String(workerData) + ": " + before + " then " + facts());
}

export {};
