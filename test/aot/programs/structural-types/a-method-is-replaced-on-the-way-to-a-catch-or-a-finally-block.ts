interface Target {
  norm(): number;
}

const replacement = (): number => -1;

function patchAndThrow(target: Target, really: boolean): void {
  if (!really) return;
  target.norm = replacement;
  throw new RangeError("patched");
}

function deeper(target: Target, really: boolean): void {
  patchAndThrow(target, really);
}

async function patchAndReject(target: Target, really: boolean): Promise<void> {
  await null;
  patchAndThrow(target, really);
}

function trap(target: Target, really: boolean): { value: number } {
  return {
    get value(): number {
      patchAndThrow(target, really);
      return 5;
    },
  };
}

class Caught {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function aroundCaught(p: Caught, really: boolean): string {
  const before = p.norm();
  let after = -100;
  try {
    patchAndThrow(Caught.prototype, really);
    after = p.norm();
  } catch {
    after = p.norm() * 10;
  }
  return before + " " + after + " " + p.norm();
}

{
  const p = new Caught();
  const written = Caught.prototype.norm;
  let warm = 0;
  for (let i = 0; i < 2000; i++) warm += (aroundCaught(p, false)).length;
  const parts = [String(warm), aroundCaught(p, false), aroundCaught(p, true), aroundCaught(p, false)];
  Caught.prototype.norm = written;
  parts.push(aroundCaught(p, false));
  console.log("caught" + ": " + parts.join(" | "));
}

class Finally {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function aroundFinally(p: Finally, really: boolean): string {
  const before = p.norm();
  let after = -100;
  try {
    try {
      patchAndThrow(Finally.prototype, really);
    } finally {
      after = p.norm();
    }
  } catch {
    after *= 10;
  }
  return before + " " + after + " " + p.norm();
}

{
  const p = new Finally();
  const written = Finally.prototype.norm;
  let warm = 0;
  for (let i = 0; i < 2000; i++) warm += (aroundFinally(p, false)).length;
  const parts = [String(warm), aroundFinally(p, false), aroundFinally(p, true), aroundFinally(p, false)];
  Finally.prototype.norm = written;
  parts.push(aroundFinally(p, false));
  console.log("a finally block" + ": " + parts.join(" | "));
}

class Deep {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function aroundDeep(p: Deep, really: boolean): string {
  const before = p.norm();
  let after = -100;
  try {
    deeper(Deep.prototype, really);
    after = p.norm();
  } catch {
    after = p.norm() * 10;
  }
  return before + " " + after + " " + p.norm();
}

{
  const p = new Deep();
  const written = Deep.prototype.norm;
  let warm = 0;
  for (let i = 0; i < 2000; i++) warm += (aroundDeep(p, false)).length;
  const parts = [String(warm), aroundDeep(p, false), aroundDeep(p, true), aroundDeep(p, false)];
  Deep.prototype.norm = written;
  parts.push(aroundDeep(p, false));
  console.log("thrown two calls down" + ": " + parts.join(" | "));
}

class InCatch {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function aroundInCatch(p: InCatch, really: boolean): string {
  const before = p.norm();
  let after = -100;
  try {
    if (really) throw new RangeError("really");
  } catch {
    InCatch.prototype.norm = replacement;
  }
  after = p.norm();
  return before + " " + after + " " + p.norm();
}

{
  const p = new InCatch();
  const written = InCatch.prototype.norm;
  let warm = 0;
  for (let i = 0; i < 2000; i++) warm += (aroundInCatch(p, false)).length;
  const parts = [String(warm), aroundInCatch(p, false), aroundInCatch(p, true), aroundInCatch(p, false)];
  InCatch.prototype.norm = written;
  parts.push(aroundInCatch(p, false));
  console.log("the store is in the catch block" + ": " + parts.join(" | "));
}

class InFinally {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function aroundInFinally(p: InFinally, really: boolean): string {
  const before = p.norm();
  let after = -100;
  try {
    after = p.norm();
  } finally {
    if (really) InFinally.prototype.norm = replacement;
  }
  after = after * 100 + p.norm();
  return before + " " + after + " " + p.norm();
}

{
  const p = new InFinally();
  const written = InFinally.prototype.norm;
  let warm = 0;
  for (let i = 0; i < 2000; i++) warm += (aroundInFinally(p, false)).length;
  const parts = [String(warm), aroundInFinally(p, false), aroundInFinally(p, true), aroundInFinally(p, false)];
  InFinally.prototype.norm = written;
  parts.push(aroundInFinally(p, false));
  console.log("the store is in the finally block" + ": " + parts.join(" | "));
}

class ByGetter {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function aroundByGetter(p: ByGetter, really: boolean): string {
  const before = p.norm();
  let after = -100;
  try {
    after = trap(ByGetter.prototype, really).value;
  } catch {
    after = p.norm() * 10;
  }
  return before + " " + after + " " + p.norm();
}

{
  const p = new ByGetter();
  const written = ByGetter.prototype.norm;
  let warm = 0;
  for (let i = 0; i < 2000; i++) warm += (aroundByGetter(p, false)).length;
  const parts = [String(warm), aroundByGetter(p, false), aroundByGetter(p, true), aroundByGetter(p, false)];
  ByGetter.prototype.norm = written;
  parts.push(aroundByGetter(p, false));
  console.log("a getter that replaces and throws" + ": " + parts.join(" | "));
}

class Rejected {
  n = 1;
  norm(): number {
    return this.n;
  }
}

async function aroundRejected(p: Rejected, really: boolean): Promise<string> {
  const before = p.norm();
  let after = -100;
  try {
    await patchAndReject(Rejected.prototype, really);
    after = p.norm();
  } catch {
    after = p.norm() * 10;
  }
  return before + " " + after + " " + p.norm();
}

{
  const p = new Rejected();
  const written = Rejected.prototype.norm;
  let warm = 0;
  for (let i = 0; i < 2000; i++) warm += (await aroundRejected(p, false)).length;
  const parts = [String(warm), await aroundRejected(p, false), await aroundRejected(p, true), await aroundRejected(p, false)];
  Rejected.prototype.norm = written;
  parts.push(await aroundRejected(p, false));
  console.log("a rejected promise" + ": " + parts.join(" | "));
}

export {};
