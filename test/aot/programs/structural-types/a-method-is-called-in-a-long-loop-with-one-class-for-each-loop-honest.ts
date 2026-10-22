const replacement = (): number => -1;
const other = {
  norm(): number {
    return -2;
  },
};

class StoredOnPrototype {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function loopOverStoredOnPrototype(p: StoredOnPrototype, rounds: number, at: number): string {
  const seen: number[] = [];
  let total = 0;
  for (let i = 0; i < rounds; i++) {
    const n = p.norm();
    total += n;
    if (i >= at - 1) seen.push(n);
  }
  return seen.join(" ") + " total " + total;
}

console.log("a named store on the prototype" + ": " + loopOverStoredOnPrototype(new StoredOnPrototype(), 2006, 2002));

class StoredOnInstance {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function loopOverStoredOnInstance(p: StoredOnInstance, rounds: number, at: number): string {
  const seen: number[] = [];
  let total = 0;
  for (let i = 0; i < rounds; i++) {
    const n = p.norm();
    total += n;
    if (i >= at - 1) seen.push(n);
  }
  return seen.join(" ") + " total " + total;
}

console.log("a named store on the instance" + ": " + loopOverStoredOnInstance(new StoredOnInstance(), 2006, 2002));

class DefinedOnPrototype {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function loopOverDefinedOnPrototype(p: DefinedOnPrototype, rounds: number, at: number): string {
  const seen: number[] = [];
  let total = 0;
  for (let i = 0; i < rounds; i++) {
    const n = p.norm();
    total += n;
    if (i >= at - 1) seen.push(n);
  }
  return seen.join(" ") + " total " + total;
}

console.log("a definition on the prototype" + ": " + loopOverDefinedOnPrototype(new DefinedOnPrototype(), 2006, 2002));

class DefinedOnInstance {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function loopOverDefinedOnInstance(p: DefinedOnInstance, rounds: number, at: number): string {
  const seen: number[] = [];
  let total = 0;
  for (let i = 0; i < rounds; i++) {
    const n = p.norm();
    total += n;
    if (i >= at - 1) seen.push(n);
  }
  return seen.join(" ") + " total " + total;
}

console.log("a definition on the instance" + ": " + loopOverDefinedOnInstance(new DefinedOnInstance(), 2006, 2002));

class AssignedOnPrototype {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function loopOverAssignedOnPrototype(p: AssignedOnPrototype, rounds: number, at: number): string {
  const seen: number[] = [];
  let total = 0;
  for (let i = 0; i < rounds; i++) {
    const n = p.norm();
    total += n;
    if (i >= at - 1) seen.push(n);
  }
  return seen.join(" ") + " total " + total;
}

console.log("Object.assign on the prototype" + ": " + loopOverAssignedOnPrototype(new AssignedOnPrototype(), 2006, 2002));

class InstanceMoved {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function loopOverInstanceMoved(p: InstanceMoved, rounds: number, at: number): string {
  const seen: number[] = [];
  let total = 0;
  for (let i = 0; i < rounds; i++) {
    const n = p.norm();
    total += n;
    if (i >= at - 1) seen.push(n);
  }
  return seen.join(" ") + " total " + total;
}

console.log("another prototype for the instance" + ": " + loopOverInstanceMoved(new InstanceMoved(), 2006, 2002));

class PrototypeMovedBase {
  n = 1;
  norm(): number {
    return this.n;
  }
}

class PrototypeMoved extends PrototypeMovedBase {}

function loopOverPrototypeMoved(p: PrototypeMoved, rounds: number, at: number): string {
  const seen: number[] = [];
  let total = 0;
  for (let i = 0; i < rounds; i++) {
    const n = p.norm();
    total += n;
    if (i >= at - 1) seen.push(n);
  }
  return seen.join(" ") + " total " + total;
}

console.log("another parent for the prototype" + ": " + loopOverPrototypeMoved(new PrototypeMoved(), 2006, 2002));

class DeletedBelowBase {
  n = 1;
  norm(): number {
    return this.n;
  }
}

class DeletedBelow extends DeletedBelowBase {}

function loopOverDeletedBelow(p: DeletedBelow, rounds: number, at: number): string {
  const seen: number[] = [];
  let total = 0;
  for (let i = 0; i < rounds; i++) {
    const n = p.norm();
    total += n;
    if (i >= at - 1) seen.push(n);
  }
  return seen.join(" ") + " total " + total;
}

console.log("the method deleted from a subclass" + ": " + loopOverDeletedBelow(new DeletedBelow(), 2006, 2002));

export {};
