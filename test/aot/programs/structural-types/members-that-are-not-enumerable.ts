interface User {
  id: number;
  name: string;
  secret: string;
}

function read(u: User): string {
  return u.id + "/" + u.name + "/" + u.secret;
}

function listing(u: User): string {
  const walked: string[] = [];
  for (const key in u) walked.push(key);
  return [
    "keys " + Object.keys(u).join(),
    "for-in " + walked.join(),
    "json " + JSON.stringify(u),
    "spread " + JSON.stringify({ ...u }),
    "entries " + Object.entries(u).join("|"),
    "values " + Object.values(u).join(),
    "assign " + JSON.stringify(Object.assign({}, u)),
    "names " + Object.getOwnPropertyNames(u).join(),
    "enumerable " + Object.prototype.propertyIsEnumerable.call(u, "secret"),
    "in " + ("secret" in u),
  ].join("; ");
}

function hide(u: User, key: keyof User): User {
  return Object.defineProperty(u, key, { enumerable: false });
}

class Account {
  id = 4;
  name = "account";
  secret = "class";
  constructor() {
    Object.defineProperty(this, "secret", { enumerable: false });
  }
}

const open: User = { id: 1, name: "open", secret: "visible" };
const last = hide({ id: 2, name: "last hidden", secret: "hidden" }, "secret");
const first = hide({ id: 3, name: "first hidden", secret: "shown" }, "id");
const all = hide(hide(hide({ id: 5, name: "all hidden", secret: "none" }, "id"), "name"), "secret");
const defined: User = Object.defineProperties({ id: 6, name: "defined", secret: "" }, {
  secret: { value: "by defineProperties", enumerable: false },
});

const table: User[] = [open, last, first, all, defined, new Account()];

for (const u of table) {
  console.log(read(u));
  console.log("  " + listing(u));
}

function rest(u: User): string {
  const { id, ...others } = u;
  return id + " " + JSON.stringify(others);
}
for (const u of table) console.log("rest: " + rest(u));

function merge(u: User): User {
  return { ...open, ...u };
}
for (const u of table) console.log("merged over the open one: " + read(merge(u)));

last.secret = "stored";
console.log("a store keeps it hidden: " + read(last) + " " + JSON.stringify(last));

const later: User = { id: 7, name: "later", secret: "seen" };
const seen: string[] = [];
for (let i = 0; i < 4; i++) {
  seen.push(JSON.stringify(later) + Object.keys(later).length);
  if (i === 1) hide(later, "secret");
}
console.log("hidden inside a loop: " + seen.join(" "));

let length = 0;
const keysOf = (u: User) => Object.keys(u).length;
const copyOf = (u: User) => Object.keys({ ...u }).length;
for (let i = 0; i < 2000; i++) length += keysOf(open) + copyOf(open);
console.log("2000 honest: " + length);
console.log("then: " + table.map(u => keysOf(u) + ":" + copyOf(u)).join());

export {};
