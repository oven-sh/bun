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

interface Fields {
  id: number;
  email: string;
  admin: boolean;
  tags: string[];
}

interface User extends Fields {}
class User {
  constructor(given: Partial<Fields>) {
    Object.assign(this, given);
  }
  next(): number {
    return this.id + 1;
  }
  domain(): string {
    return this.email.slice(this.email.indexOf("@") + 1);
  }
  role(): string {
    return this.admin ? "admin" : "member";
  }
  tagCount(): number {
    return this.tags.length;
  }
}

function idOf(user: User): number {
  return user.id;
}

function all(label: string, user: User): void {
  show(label + ": id", () => idOf(user));
  show(label + ": next", () => user.next());
  show(label + ": email", () => user.email);
  show(label + ": domain", () => user.domain());
  show(label + ": role", () => user.role());
  show(label + ": tag count", () => user.tagCount());
  show(label + ": keys", () => Object.keys(user));
  show(label + ": JSON", () => JSON.stringify(user));
}

let sum = 0;
for (let i = 0; i < 2000; i++) {
  const user = new User({ id: i, email: "a@b.c", admin: i % 2 === 0, tags: ["t"] });
  sum += idOf(user) + user.next() + user.domain().length + user.role().length + user.tagCount();
}
show("2000 with all four", () => sum);

all("all four", new User({ id: 1, email: "x@y.z", admin: true, tags: [] }));
all("in another order", new User({ tags: ["a", "b"], admin: false, email: "q@r.s", id: 2 }));
all("only the number", new User({ id: 3 }));
all("only the text", new User({ email: "m@n.o" }));
all("nothing", new User({}));
all("undefined under each name", new User({ id: undefined, email: undefined, admin: undefined, tags: undefined }));
