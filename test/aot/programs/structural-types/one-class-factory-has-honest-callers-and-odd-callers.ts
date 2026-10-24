function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

class Base {
  x = 1;
  y = 2;
  sum(): number {
    return this.x + this.y;
  }
}

function derive(Parent: typeof Base) {
  return class extends Parent {
    extra = "dq";
    twice(): number {
      return this.sum() * 2;
    }
  };
}

function honestOne(): number {
  return new (derive(Base))().twice();
}

function honestTwo(): string {
  return describe(new (derive(Base))());
}

const Kept = derive(Base);

function honestThree(): number {
  const made = new Kept();
  made.x = 5;
  return made.twice();
}

console.log("honest: " + honestOne() + " " + honestTwo() + " " + honestThree());
let warm = 0;
for (let i = 0; i < 2000; i++) warm += honestOne() + honestThree();
console.log("2000 honest rounds: " + warm);

class LookAlike {
  y = 20;
  x = 10;
  more = "more";
  sum(): number {
    return -1;
  }
}

class Child extends Base {
  z = 3;
  sum(): number {
    return super.sum() + this.z;
  }
}

class WithAccessors {
  #x = 100;
  get x(): number {
    return this.#x;
  }
  set x(value: number) {
    this.#x = value;
  }
  y = 200;
  sum(): number {
    return this.x + this.y;
  }
}

const Wrapped = new Proxy(Base, {});
const Returning: typeof Base = class {
  x = 0;
  y = 0;
  constructor() {
    return { x: 7, y: 8, sum: () => 15 };
  }
  sum(): number {
    return 0;
  }
};

function report(label: string, Parent: typeof Base): void {
  const made = new (derive(Parent))();
  console.log(label + ": " + describe(made) + " sum " + made.sum() + " typeof twice " + typeof made.twice + " base " + (made instanceof Base));
}

report("a look-alike", LookAlike);
report("a subclass", Child);
report("accessors", WithAccessors);
report("a proxy", Wrapped);
report("a constructor that returns a literal", Returning);
report("what the factory made", derive(Base));
report("the honest base again", Base);
console.log("honest again: " + honestOne() + " " + honestTwo() + " " + honestThree());
