function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Invoice {
  id = 7;
  lines: number[] = [1, 2, 3];
  paid = false;
  total(): number {
    return this.lines.reduce((a, b) => a + b, 0);
  }
  pay(): boolean {
    this.paid = true;
    return this.paid;
  }
  get open(): boolean {
    return !this.paid;
  }
}

type Totals = Pick<Invoice, "total">;
type Data = Omit<Invoice, "total" | "pay" | "open">;
type Payable = Pick<Invoice, "pay" | "paid">;
type Status = Pick<Invoice, "open">;

function total(t: Totals): number {
  return t.total();
}

function pay(p: Payable): string {
  return p.pay() + " " + p.paid;
}

function data(d: Data): string {
  return d.id + " " + d.lines.join("+") + " " + d.paid + " / " + Object.keys(d).join() + " / " + JSON.stringify(d) + " / " + ("total" in d);
}

function status(s: Status): boolean {
  return s.open;
}

const invoice = new Invoice();
let warm = 0;
for (let i = 0; i < 2000; i++) warm += total(invoice) + (status(invoice) ? 1 : 0);
console.log("2000 honest: " + warm);

attempt("an instance, total", () => total(invoice));
attempt("an instance, data", () => data(invoice));
attempt("an instance, status", () => status(invoice));
attempt("an instance, pay", () => pay(invoice));
attempt("an instance, status afterwards", () => status(invoice));

const borrowedTotal: Totals = { total: invoice.total };
attempt("only the method, taken off the instance", () => total(borrowedTotal));

const prototypeTotal: Totals = Invoice.prototype;
attempt("the prototype itself", () => total(prototypeTotal));

const ownTotal: Totals = { total: () => 99 };
attempt("another function", () => total(ownTotal));

const withLines = { lines: [10, 20], total: invoice.total };
attempt("the method and what it reads", () => total(withLines));

const plainData: Data = { paid: true, lines: [], id: 8 };
attempt("a literal as the data", () => data(plainData));

const copied: Data = { ...new Invoice() };
attempt("a copy as the data", () => data(copied));

const payable: Payable = {
  paid: false,
  pay: invoice.pay,
};
attempt("pay on a literal", () => pay(payable) + " " + JSON.stringify(payable));

const frozenPayable: Payable = Object.freeze(new Invoice());
attempt("pay on a frozen instance", () => pay(frozenPayable));

const fixedStatus: Status = { open: true };
attempt("a plain member where the class has a getter", () => status(fixedStatus));

const prototypeStatus: Status = Invoice.prototype;
attempt("the getter run on the prototype", () => status(prototypeStatus));

const all: Totals[] = [invoice, ownTotal, withLines, new Invoice()];
attempt("elements", () => all.map(total).join());

class Ledger {
  main: Totals = new Invoice();
  rows: Data[] = [new Invoice(), plainData, copied];
  sum(): number {
    return this.main.total() + this.rows.reduce((sum, row) => sum + row.id, 0);
  }
}
const ledger = new Ledger();
attempt("fields", () => ledger.sum());
ledger.main = ownTotal;
attempt("the field reassigned", () => ledger.sum());
attempt("json", () => JSON.stringify(ledger));

export {};
