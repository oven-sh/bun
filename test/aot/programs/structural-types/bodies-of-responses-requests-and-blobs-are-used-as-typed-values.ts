interface Point {
  x: number;
  y: number;
}

interface User {
  id: number;
  name: string;
  home: Point;
  tags: string[];
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

async function attempt(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    console.log(label + " -> " + show(await run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function sum(p: Point): number {
  return p.x + p.y;
}

function describe(u: User): unknown {
  return [u.id + 1, u.name + "!", sum(u.home), u.tags.length, u.tags.join("+"), Object.keys(u).join()];
}

class Session {
  user: User;
  visits: number;
  constructor(user: User, visits: number) {
    this.user = user;
    this.visits = visits;
  }
  next(): number {
    return this.visits + 1;
  }
}

const sources: [string, (text: string) => Promise<ReturnType<typeof JSON.parse>>][] = [
  ["a response", text => new Response(text).json()],
  ["a request", text => new Request("http://h.example/", { method: "POST", body: text }).json()],
  ["a blob", text => new Blob([text]).json()],
  ["Response.json and back", text => Response.json(JSON.parse(text)).json()],
];

const honest = '{"id":1,"name":"n","home":{"x":1,"y":2},"tags":["a","b"]}';

const users = [
  honest,
  '{"tags":["a","b"],"home":{"y":2,"x":1},"name":"n","id":1}',
  '{"id":"1","name":5,"home":{"x":"1","y":"2"},"tags":"ab"}',
  '{"id":1,"name":"n","home":{"x":1},"tags":[]}',
  '{"id":1,"name":"n","home":[1,2],"tags":{"length":2}}',
  '{"id":null,"name":null,"home":{},"tags":[null]}',
  '{"id":1,"name":"n","home":{"x":1,"y":2},"tags":["a"],"extra":true,"__proto__":{"id":9}}',
  '{"id":1,"name":"n"}',
  "{}",
  "[]",
  '"text"',
  "1",
  "null",
];

for (const [name, read] of sources) {
  let warm = 0;
  for (let i = 0; i < 300; i++) {
    const user: User = await read(honest);
    warm += user.id + sum(user.home) + user.tags.length;
  }
  console.log(name + ": 300 honest rounds: " + warm);

  for (const text of users) {
    await attempt(name + ", a local, " + text, async () => {
      const user: User = await read(text);
      return describe(user);
    });
    await attempt(name + ", a field, " + text, async () => {
      const session = new Session(await read(text), (await read(text)).id);
      return [session.next(), session.user.name, typeof session.visits];
    });
  }

  await attempt(name + ", elements", async () => {
    const points: Point[] = await read('[{"x":1,"y":2},{"x":"3","y":4},{"y":5},[6,7],8]');
    let total = 0;
    for (const p of points) total += p.x;
    return [total, points.map(sum)];
  });
  await attempt(name + ", map values", async () => {
    const map = new Map<string, Point>(Object.entries(await read('{"a":{"x":1,"y":2},"b":{"x":"3"},"c":4}')));
    const sums: number[] = [];
    for (const p of map.values()) sums.push(sum(p));
    return sums;
  });
  await attempt(name + ", a number", async () => {
    const n: number = await read('"3"');
    return [n + 1, [10, 20, 30, 40][n], typeof n];
  });
  await attempt(name + ", through then", () => read('{"x":"1","y":2}').then((p: Point) => sum(p)));
  await attempt(name + ", text that is no JSON", async () => {
    const p: Point = await read("{x:1}");
    return p.x;
  });
}

export {};
