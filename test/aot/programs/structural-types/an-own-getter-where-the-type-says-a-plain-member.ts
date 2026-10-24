interface Sample {
  value: number;
  label: string;
}

let reads = 0;

function counting(): Sample {
  return {
    get value() {
      return ++reads;
    },
    label: "counting",
  };
}

function report(label: string, result: unknown): void {
  console.log(label + ": " + String(result) + " (reads so far " + reads + ")");
}

function once(s: Sample): number {
  return s.value;
}

function twice(s: Sample): number {
  return s.value * 100 + s.value;
}

function unused(s: Sample): string {
  s.value;
  return s.label;
}

function inALoop(s: Sample): number {
  let total = 0;
  for (let i = 0; i < 5; i++) total += s.value;
  return total;
}

function conditional(s: Sample, wanted: boolean): number {
  return wanted ? s.value : -1;
}

class Holder {
  constructor(public sample: Sample) {}
  read(): number {
    return this.sample.value + this.sample.value;
  }
}

const local: Sample = counting();
report("local, first read", local.value);
report("local, second read", local.value);
report("parameter, one read", once(local));
report("parameter, two reads", twice(local));
report("a read whose value is dropped", unused(local));
report("five reads in a loop", inALoop(local));
report("a read that is not reached", conditional(local, false));
report("a read that is reached", conditional(local, true));
report("result", counting().value);
report("field", new Holder(local).read());
const list: Sample[] = [{ value: -5, label: "plain" }, local];
report("element", list[1].value + list[1].value);
const captured = () => local.value;
report("captured", captured() + captured());
report("destructured", (({ value }: Sample) => value)(local));
report("destructured twice", (({ value: a, value: b }: Sample) => a * 100 + b)(local));
report("optional chain", local?.value);
report("computed name", local["value"]);
report("typeof", typeof local.value);
report("in does not read", "value" in local);
report("hasOwn does not read", Object.hasOwn(local, "value"));
report("keys do not read", Object.keys(local).join());
report("values read", Object.values(local).join());
report("entries read", Object.entries(local).join("|"));
report("json reads", JSON.stringify(local));
report("spread reads", JSON.stringify({ ...local }));
report("assign reads", JSON.stringify(Object.assign({}, local)));
report("for-in does not read", (() => {
  let keys = "";
  for (const key in local) keys += key;
  return keys;
})());
report("a descriptor does not read", typeof Object.getOwnPropertyDescriptor(local, "value")?.get);

const plain: Sample = { value: 1, label: "plain" };
let sum = 0;
for (let i = 0; i < 2000; i++) sum += twice(plain) + inALoop(plain);
report("2000 honest", sum);
report("then the getter, two reads", twice(local));
report("then the getter, five reads", inALoop(local));
report("then plain", twice(plain));

export {};
