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
}

class Friendly extends Vault {
  explain(): string {
    return this.hint();
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
console.log("a subclass: " + new Friendly().explain() + " | " + openOf(new Friendly(), 7));

export {};
