class Job {
  id: number;
  constructor(id: number) {
    this.id = id;
  }
  state(): string {
    return "method " + this.id;
  }
  async watch(gate: Promise<void>): Promise<string> {
    const before = this.state();
    await gate;
    return before + " -> " + this.state();
  }
  static kind(): string {
    return "static method";
  }
}

async function watch(j: Job, gate: Promise<void>): Promise<string> {
  const before = j.state();
  await gate;
  return before + " -> " + j.state();
}

async function watchStatic(gate: Promise<void>): Promise<string> {
  const before = Job.kind();
  await gate;
  return before + " -> " + Job.kind();
}

async function watchMany(j: Job, gates: Promise<void>[]): Promise<string> {
  const seen: string[] = [j.state()];
  for (const gate of gates) {
    await gate;
    seen.push(j.state());
  }
  return seen.join(" -> ");
}

function gate(): { promise: Promise<void>; open: () => void } {
  let open: () => void = () => {};
  const promise = new Promise<void>(resolve => {
    open = resolve;
  });
  return { promise, open };
}

const original = Job.prototype.state;
const originalKind = Job.kind;

{
  const j = new Job(1);
  const g = gate();
  const results = [watch(j, g.promise), j.watch(g.promise)];
  j.state = () => "own";
  g.open();
  console.log("an own member: " + (await Promise.all(results)).join(" | "));
  Reflect.deleteProperty(j, "state");
  console.log("uncovered: " + (await watch(j, Promise.resolve())));
}

{
  const j = new Job(2);
  const g = gate();
  const results = [watch(j, g.promise), j.watch(g.promise), watchStatic(g.promise)];
  Job.prototype.state = function () {
    return "patched " + this.id;
  };
  Job.kind = () => "patched static";
  g.open();
  console.log("the prototype and the class: " + (await Promise.all(results)).join(" | "));
  Job.prototype.state = original;
  Job.kind = originalKind;
  console.log("put back: " + (await watch(j, Promise.resolve())) + " | " + (await watchStatic(Promise.resolve())));
}

{
  const j = new Job(3);
  const gates = [gate(), gate(), gate(), gate()];
  const result = watchMany(
    j,
    gates.map(g => g.promise),
  );
  j.state = () => "own";
  gates[0].open();
  await gates[0].promise;
  await null;
  Reflect.deleteProperty(j, "state");
  gates[1].open();
  await gates[1].promise;
  await null;
  Job.prototype.state = () => "arrow on the prototype";
  gates[2].open();
  await gates[2].promise;
  await null;
  Job.prototype.state = original;
  gates[3].open();
  console.log("four awaits in a loop: " + (await result));
}

{
  const j = new Job(4);
  let letters = 0;
  for (let i = 0; i < 2000; i++) letters += (await watch(j, Promise.resolve())).length;
  console.log("2000 honest: " + letters);
  const g = gate();
  const result = watch(j, g.promise);
  j.state = () => "own";
  g.open();
  console.log("then an own member: " + (await result));
}

export {};
