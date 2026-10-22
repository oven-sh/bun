function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  const parent = Object.getPrototypeOf(value);
  const mark = parent === Object.prototype ? "" : parent === null ? "without a prototype " : "with another prototype ";
  return mark + "{" + Object.entries(value).map(([key, held]) => JSON.stringify(key) + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

interface Account {
  id: number;
  owner: string;
  limits: { daily: number };
}

function idOf(account: Account): number {
  return account.id;
}
function ownerLength(account: Account): number {
  return account.owner.length;
}
function daily(account: Account): number {
  return account.limits.daily * 2;
}
function look(account: Account): unknown[] {
  return [idOf(account), account.owner, daily(account), Object.keys(account), JSON.stringify(account)];
}
function fresh(): Account {
  return JSON.parse<Account>('{"id":1,"owner":"ann","limits":{"daily":10}}');
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const account = fresh();
  warm += idOf(account) + ownerLength(account) + daily(account);
}
console.log("2000 honest rounds", warm);

attempt("typed stores", () => {
  const account = fresh();
  account.id = 2.5;
  account.owner = "bob";
  account.limits = { daily: -0 };
  return look(account);
});
attempt("a member is added", () => {
  const account = fresh();
  Object.assign(account, { extra: true, another: [1] });
  return look(account);
});
attempt("a member is deleted by reflection", () => {
  const account = fresh();
  Reflect.deleteProperty(account, "id");
  return [idOf(account), idOf(account) + 1, Object.keys(account), "id" in account];
});
attempt("a deleted member is used", () => {
  const account = fresh();
  Reflect.deleteProperty(account, "owner");
  return ownerLength(account);
});
attempt("a member gets another kind of value by reflection", () => {
  const account = fresh();
  Reflect.set(account, "id", "seven");
  Reflect.set(account, "limits", null);
  return [idOf(account), typeof idOf(account), idOf(account) + 1, JSON.stringify(account)];
});
attempt("the member that is now null is used", () => {
  const account = fresh();
  Reflect.set(account, "limits", null);
  return daily(account);
});
attempt("a member becomes an accessor", () => {
  const account = fresh();
  let reads = 0;
  Object.defineProperty(account, "id", { get: () => ++reads * 100, enumerable: true, configurable: true });
  return [idOf(account), idOf(account), reads, JSON.stringify(account)];
});
attempt("frozen", () => {
  const account = Object.freeze(fresh());
  const open: Account = account;
  let threw = "no";
  try {
    open.id = 5;
  } catch (error) {
    threw = error instanceof Error ? error.constructor.name : typeof error;
  }
  open.limits.daily = 50;
  return [threw, look(account)];
});
attempt("given another prototype", () => {
  const account = fresh();
  Object.setPrototypeOf(account, { inherited: 1, id: 99 });
  Reflect.deleteProperty(account, "id");
  return [idOf(account), Object.keys(account), "inherited" in account, JSON.stringify(account)];
});
attempt("given no prototype", () => {
  const account = fresh();
  Object.setPrototypeOf(account, null);
  return [idOf(account), daily(account), Object.keys(account), JSON.stringify(account)];
});
attempt("very many members are added", () => {
  const account = fresh();
  const open: Record<string, unknown> = { ...account };
  for (let i = 0; i < 200; i++) Reflect.set(account, "k" + i, i);
  return [idOf(account), daily(account), Object.keys(account).length, Object.keys(open).length];
});
attempt("honest again", () => look(fresh()));
