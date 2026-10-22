const list: number[] = [1, 2, 3];
const holes = new Array<number>(2);

function ask(run: () => boolean): boolean {
  return run();
}

function plainParameter(n: number): boolean {
  return ask(() => n === undefined);
}

function objectPattern({ n }: { n: number }): boolean {
  return ask(() => n === undefined);
}

function listPattern([n]: number[]): boolean {
  return ask(() => n === undefined);
}

function restElement(...[, n]: number[]): boolean {
  return ask(() => n === undefined);
}

function restList(...rest: number[]): boolean {
  return ask(() => rest[0] === undefined);
}

function defaultValue(n: number = list[9]): boolean {
  return ask(() => n === undefined);
}

function capturedParameter(n: number): () => boolean {
  return () => ask(() => n === undefined);
}

function localFromAnIndex(index: number): boolean {
  const n = list[index];
  return ask(() => n === undefined);
}

function reassignedLocal(index: number): boolean {
  let n = 5;
  n = list[index];
  return ask(() => n === undefined);
}

function resultOfACall(index: number): boolean {
  return ask(() => at(index) === undefined);
}

function at(index: number): number {
  return list[index];
}

function apply(test: (n: number) => boolean, n: number): boolean {
  return test(n);
}

class Holder {
  n: number;
  static kept: number = 1;
  constructor(n: number) {
    this.n = n;
  }
  field(): boolean {
    return ask(() => this.n === undefined);
  }
  method(n: number): boolean {
    return ask(() => n === undefined);
  }
  static check(n: number): boolean {
    return ask(() => n === undefined);
  }
  get missing(): boolean {
    return ask(() => this.n === undefined);
  }
  get value(): number {
    return this.n;
  }
  answer = false;
  set tested(n: number) {
    this.answer = ask(() => n === undefined);
  }
}

function* sent(): Generator<boolean, void, number> {
  let answer = false;
  for (;;) {
    const n: number = yield answer;
    answer = ask(() => n === undefined);
  }
}

async function awaited(promise: Promise<number>): Promise<boolean> {
  const n = await promise;
  return ask(() => n === undefined);
}

function line(label: string, missing: boolean, there: boolean): void {
  console.log(label + " " + missing + " " + there);
}

line("a parameter", plainParameter(list[9]), plainParameter(list[0]));
const narrow = { n: 1 };
const wide: { n: number | undefined } = narrow;
wide.n = undefined;
line("an object pattern", objectPattern(narrow), objectPattern({ n: 1 }));
line("a list pattern", listPattern([]), listPattern([1]));
line("an element of a rest pattern", restElement(1), restElement(1, 2));
line("a rest list", restList(), restList(1));
line("a rest list fed by holes", restList(...holes), restList(...list));
line("a default value", defaultValue(), defaultValue(1));
line("a captured parameter", capturedParameter(list[9])(), capturedParameter(list[0])());
line("a local", localFromAnIndex(9), localFromAnIndex(0));
line("a local that is stored to", reassignedLocal(9), reassignedLocal(0));
line("the result of a call", resultOfACall(9), resultOfACall(0));
line("a callback of the program's own function", apply(n => n === undefined, list[9]), apply(n => n === undefined, list[0]));
line("a field", new Holder(list[9]).field(), new Holder(list[0]).field());
line("a parameter of a method", new Holder(1).method(list[9]), new Holder(1).method(list[0]));
line("a parameter of a static method", Holder.check(list[9]), Holder.check(list[0]));
line("a field inside a getter", new Holder(list[9]).missing, new Holder(list[0]).missing);
const missingHolder = new Holder(list[9]);
const honestHolder = new Holder(list[0]);
const fromAGetter = missingHolder.value === undefined;
const fromAnHonestGetter = honestHolder.value === undefined;
line("the result of a getter", fromAGetter, fromAnHonestGetter);
missingHolder.tested = list[9];
honestHolder.tested = list[0];
line("the parameter of a setter", missingHolder.answer, honestHolder.answer);
Holder.kept = list[9];
const staticMissing = Holder.kept === undefined;
Holder.kept = list[0];
const staticThere = Holder.kept === undefined;
line("a static field", staticMissing, staticThere);
const answers: boolean[] = [];
for (const n of holes) answers.push(ask(() => n === undefined));
for (const n of list) answers.push(ask(() => n === undefined));
console.log("the variable of for of " + answers.join());
const steps = sent();
steps.next(0);
line("a value sent into a generator", steps.next(list[9]).value === true, steps.next(list[0]).value === true);
line("an awaited value", await awaited(Promise.resolve(list[9])), await awaited(Promise.resolve(list[0])));
const pair: [number, number] = [1, 2];
pair.pop();
const placeMissing = pair[1] === undefined;
const placeThere = pair[0] === undefined;
line("a place of a tuple", placeMissing, placeThere);
const mapped = holes.concat(list).map((n, i, all) => all[i] === undefined);
console.log("an element inside map " + mapped.join());
console.log("Array.from " + Array.from(holes, n => n === undefined).join());
console.log("find " + [holes.findIndex(n => n === undefined), holes.findLastIndex(n => n === undefined), list.findIndex(n => n === undefined)].join());

export {};
