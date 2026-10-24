function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

interface Ticket {
  readonly serial: number;
  readonly code: string;
}
class Ticket {
  id: number = 1;
  next(): number {
    return this.serial + 1;
  }
}

function serialOf(ticket: Ticket): number {
  return ticket.serial;
}

const ticket = new Ticket();
show("read", () => ticket.serial);
show("typeof", () => typeof ticket.serial);
show("plus one", () => ticket.serial + 1);
show("the text", () => ticket.code);
show("the length of the text", () => ticket.code.length);
show("in a method", () => ticket.next());
show("through a function", () => serialOf(ticket));
show("read 2000 times", () => {
  let missing = 0;
  for (let i = 0; i < 2000; i++) if (serialOf(ticket) === undefined) missing++;
  return missing;
});
show("in", () => "serial" in ticket);
show("keys", () => Object.keys(ticket));

const writable: { serial: number; code: string } = ticket;
show("read in a loop that stores through a view that is not readonly", () => {
  const seen: unknown[] = [];
  for (let i = 0; i < 4; i++) {
    seen.push(ticket.serial);
    if (i === 1) writable.serial = 40;
  }
  return seen;
});
show("after the store", () => [ticket.serial, ticket.next(), serialOf(ticket), Object.keys(ticket)]);
writable.code = "xy";
show("the text after a store", () => [ticket.code, ticket.code.length]);
show("another instance", () => [serialOf(new Ticket()), new Ticket().code]);
