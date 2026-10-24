function bracket(text: string) { return "[" + text + "]"; }
function cents(amount: number) { return amount * 100; }
function forJSON(amount: number) { return { amount, currency: "EUR" }; }

export class Label {
  constructor(public text: string) {}
  toString() { return bracket(this.text); }
}
export class Money {
  constructor(public amount: number) {}
  valueOf() { return cents(this.amount); }
  toJSON() { return forJSON(this.amount); }
}
export class Both {
  toString() { return "as text"; }
  valueOf() { return 42; }
}
