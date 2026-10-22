function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Base {
  asText: string;
  asTemplate: string;
  asJson: string;
  asNumber: number;
  compared: boolean;
  constructor() {
    this.asText = String(this);
    this.asTemplate = `<${this}>`;
    this.asJson = JSON.stringify(this);
    this.asNumber = +this;
    this.compared = this.valueOf() > 1;
  }
  valueOf(): number {
    return 0;
  }
}

class Money extends Base {
  amount: number = 12.5;
  unit: string = "usd";
  parts: number[] = [1, 2];
  toString(): string {
    return typeof this.amount + " " + this.amount + " " + typeof this.unit + " " + this.unit;
  }
  toJSON(): { amount: number; unit: string; doubled: number } {
    return { amount: this.amount, unit: this.unit, doubled: this.amount * 2 };
  }
  valueOf(): number {
    return this.amount;
  }
}

class Careless extends Base {
  unit: string = "eur";
  parts: number[] = [1, 2];
  toString(): string {
    return this.unit.toUpperCase();
  }
}

class Listing extends Base {
  parts: number[] = [1, 2];
  toJSON(): number {
    return this.parts.length;
  }
}

const money = new Money();
show("asText", () => money.asText);
show("asTemplate", () => money.asTemplate);
show("asJson", () => money.asJson);
show("asNumber", () => money.asNumber);
show("compared", () => money.compared);
show("String now", () => String(money));
show("JSON now", () => JSON.stringify(money));
show("number now", () => +money);
show("compared now", () => money.valueOf() > 1);
show("keys", () => Object.keys(money).join());
show("a toString that needs its field", () => new Careless());
show("a toJSON that needs its field", () => new Listing());
