function show(title: string, run: () => unknown): void {
  let result: string;
  try {
    const value = run();
    result = typeof value + " " + (Object.is(value, -0) ? "-0" : String(value));
  } catch (error) {
    result = error instanceof TypeError ? "threw a TypeError" : error instanceof ReferenceError ? "threw a ReferenceError" : "threw something else";
  }
  console.log(title + ": " + result);
}

const log: string[] = [];

class Job {
  id: number = 7;
  name: string = "job";
  note(): void {
    let seen: string;
    try {
      seen = typeof this + " " + typeof this.id + " " + this.id;
    } catch (error) {
      seen = "no this";
    }
    log.push(seen);
  }
  value(): number {
    return this.id;
  }
  title(): string {
    return this.name.toUpperCase();
  }
}

const job = new Job();

function wait(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 1));
}

async function settle(title: string, promise: Promise<unknown>): Promise<void> {
  let result: string;
  try {
    const value = await promise;
    result = typeof value + " " + String(value);
  } catch (error) {
    result = error instanceof TypeError ? "rejected with a TypeError" : "rejected with something else";
  }
  console.log(title + ": " + result);
}

async function main(): Promise<void> {
  queueMicrotask(job.note);
  await null;
  console.log("queueMicrotask: " + log.splice(0).join());
  process.nextTick(job.note);
  await wait();
  console.log("nextTick: " + log.splice(0).join());
  setTimeout(job.note, 0);
  await wait();
  await wait();
  console.log("setTimeout saw an object or nothing: " + log.splice(0).map(entry => entry.endsWith("undefined") || entry === "no this").join());
  setImmediate(job.note);
  await wait();
  await wait();
  console.log("setImmediate saw an object or nothing: " + log.splice(0).map(entry => entry.endsWith("undefined") || entry === "no this").join());
  setTimeout(job.note.bind(job), 0);
  await wait();
  await wait();
  console.log("setTimeout, bound: " + log.splice(0).join());
  setTimeout(() => job.note(), 0);
  await wait();
  await wait();
  console.log("setTimeout, an arrow: " + log.splice(0).join());

  await settle("then value", Promise.resolve(0).then(job.value));
  await settle("then title", Promise.resolve(0).then(job.title));
  await settle("then value, bound", Promise.resolve(0).then(job.value.bind(job)));
  await settle("catch value", Promise.reject(new RangeError("no")).catch(job.value));
  await settle("finally note", Promise.resolve(5).finally(job.note));
  console.log("finally: " + log.splice(0).join());
  await settle("the executor is a method", new Promise<void>(job.note));
  console.log("executor: " + log.splice(0).join());
  await settle("all of mapped", Promise.all([1, 2].map(job.value.bind(job))));
  await settle("thenable made of a method", Promise.resolve({ id: 70, then: job.thenLike }));
}

interface Job {
  thenLike(resolve: (value: number) => void): void;
}
Job.prototype.thenLike = function (this: Job, resolve: (value: number) => void): void {
  resolve(this.id);
};

main();
