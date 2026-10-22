function makeClass(tag: string, factor: number) {
  return class Tagged {
    n = 2;
    who(): string {
      return tag + " " + this.n * factor;
    }
    get label(): string {
      return "label of " + tag;
    }
    static kind(): string {
      return "kind of " + tag;
    }
    both(): string {
      return this.who() + " / " + this.label;
    }
  };
}

const A = makeClass("a", 10);
const B = makeClass("b", 0.5);

type Instance = InstanceType<typeof A>;

function whoOf(t: Instance): string {
  return t.who();
}

const a = new A();
const b = new B();

function round(label: string): void {
  console.log(label + ": a " + a.who() + " | " + whoOf(a) + " | " + a.both() + " | " + A.kind() + " || b " + b.who() + " | " + whoOf(b) + " | " + b.both() + " | " + B.kind());
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += whoOf(a).length + whoOf(b).length + a.both().length + A.kind().length;
console.log("2000 honest: " + warm);
round("before");
console.log("the same function: " + (A.prototype.who === B.prototype.who) + ", the same class: " + (Object.is(A, B)));

const whoOfA = A.prototype.who;
A.prototype.who = B.prototype.who;
round("a's class runs b's closure of the same method");

a.who = whoOfA;
round("the instance covers it with the one its class had");

Reflect.deleteProperty(a, "who");
A.prototype.who = whoOfA;
round("restored");

const kindOfA = A.kind;
A.kind = B.kind;
round("the static method");
A.kind = kindOfA;

const labelOfB = Object.getOwnPropertyDescriptor(B.prototype, "label");
const labelOfA = Object.getOwnPropertyDescriptor(A.prototype, "label");
if (labelOfB) Object.defineProperty(A.prototype, "label", labelOfB);
round("the getter");
if (labelOfA) Object.defineProperty(A.prototype, "label", labelOfA);
round("restored");

Object.setPrototypeOf(a, B.prototype);
round("the instance hangs under the other evaluation's prototype");
console.log("instanceof: " + (a instanceof A) + " " + (a instanceof B));
Object.setPrototypeOf(a, A.prototype);
round("and back");

const classes = [makeClass("c", 1), makeClass("d", 2), makeClass("e", 3)];
classes[0].prototype.who = classes[2].prototype.who;
console.log("three more: " + classes.map(C => new C().who()).join(" | "));

export {};
