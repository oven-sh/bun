class Vault {
  private code = 7;
  private check(guess: number): boolean {
    return guess === this.code;
  }
  protected hint(): string {
    return "starts with " + this.code;
  }
  private static attempts(): number {
    return 3;
  }
  private get masked(): string {
    return "*" + this.code;
  }
  open(guess: number): string {
    return (this.check(guess) ? "open" : "shut") + ", " + this.hint() + ", " + Vault.attempts() + " attempts, " + this.masked;
  }
  weaken(): void {
    this.check = () => true;
  }
}

class Friendly extends Vault {
  explain(): string {
    return this.hint();
  }
  soften(): void {
    this.hint = () => "an own hint";
  }
}

function openOf(v: Vault, guess: number): string {
  return v.open(guess);
}

const v = new Vault();
const other = new Vault();
let warm = 0;
for (let i = 0; i < 2000; i++) warm += openOf(v, i % 10).length;
console.log("2000 honest: " + warm);
console.log("before: " + openOf(v, 1) + " | " + openOf(v, 7));

v["check"] = guess => guess === 1;
console.log("the private method covered from outside: " + openOf(v, 1) + " | " + openOf(v, 7) + " | the other " + openOf(other, 1));

Reflect.deleteProperty(v, "check");
console.log("uncovered: " + openOf(v, 1));

v.weaken();
console.log("covered by a method of the class: " + openOf(v, 1) + " | keys " + Object.keys(v).join());
Reflect.deleteProperty(v, "check");

const check = Vault.prototype["check"];
Vault.prototype["check"] = function (guess) {
  return guess === this["code"] + 1;
};
console.log("replaced on the prototype: " + openOf(v, 7) + " | " + openOf(other, 8));
Vault.prototype["check"] = check;

v["code"] = 1;
console.log("the private field stored to: " + openOf(v, 1) + " | " + openOf(other, 1));

const attempts = Vault["attempts"];
Vault["attempts"] = () => 99;
console.log("the private static method replaced: " + openOf(v, 1));
Vault["attempts"] = attempts;

Object.defineProperty(v, "masked", { value: "not masked", configurable: true });
console.log("the private getter covered: " + openOf(v, 1) + " | " + openOf(other, 7));
Reflect.deleteProperty(v, "masked");

const f = new Friendly();
console.log("a subclass: " + f.explain() + " | " + openOf(f, 7));
f.soften();
console.log("the protected method covered by the subclass: " + f.explain() + " | " + openOf(f, 7));
console.log("restored: " + openOf(v, 1) + " | " + openOf(new Vault(), 7));

export {};
