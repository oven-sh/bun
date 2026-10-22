abstract class Job {
  abstract run(): string;
  priority = 1;
  describe(): string {
    return "job " + this.run() + " at " + this.priority;
  }
  static compare(a: Job, b: Job): number {
    return a.priority - b.priority;
  }
}

class Build extends Job {
  run(): string {
    return "build";
  }
}

class Deploy extends Job {
  priority = 5;
  run(): string {
    return "deploy";
  }
  describe(): string {
    return "careful " + super.describe();
  }
}

class Stranger {
  priority = 3;
  run(): string {
    return "stranger";
  }
  describe(): string {
    return "a stranger at " + this.priority;
  }
}

const literal: Job = {
  describe() {
    return "literal " + this.run();
  },
  run: () => "literal run",
  priority: 2,
};

function show(job: Job): string {
  return job.describe() + " | " + job.run() + " | " + job.priority + " | " + (job instanceof Job) + " | " + job.constructor.name;
}

function baseDescribe(job: Job): string {
  return Job.prototype.describe.call(job);
}

const jobs: Job[] = [new Deploy(), new Stranger(), new Build(), literal];

for (const job of jobs) console.log(show(job));
for (const job of jobs) console.log("the base's describe: " + baseDescribe(job));

console.log("sorted: " + [...jobs].sort(Job.compare).map(job => job.run()).join());
console.log("real jobs: " + jobs.filter(job => job instanceof Job).map(job => job.run()).join());
console.log("json: " + JSON.stringify(jobs));

let text = "";
for (let i = 0; i < 2000; i++) text = show(i % 2 === 0 ? jobs[0] : jobs[2]);
console.log("2000 real jobs, the last: " + text);
console.log("then the stranger: " + show(jobs[1]));
console.log("then the literal: " + show(jobs[3]));

class Queue {
  current: Job = new Build();
  waiting: Job[] = [];
  push(job: Job): void {
    this.waiting.push(this.current);
    this.current = job;
  }
  report(): string {
    return this.current.describe() + " after " + this.waiting.map(job => job.describe()).join("; ");
  }
}

const queue = new Queue();
for (const job of jobs) {
  queue.push(job);
  console.log("queue: " + queue.report());
}

const Concrete: new () => Job = Stranger;
console.log("a construct signature: " + show(new Concrete()));

export {};
