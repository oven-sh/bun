// A server's collections come between requests: the objects of a request are all dead by then, and their shapes with them or not, as the engine pleases. Whatever it keeps, the next request reads and stores the same.
const shell = globalThis as any;
const collect: (full: boolean) => void = shell.Bun ? (full: boolean) => shell.Bun.gc(full) : (full: boolean) => (full ? shell.fullGC() : shell.edenGC());
interface Request {
  method: string;
  url: string;
  headers: Record<string, string>;
  params?: Record<string, string>;
  body?: unknown;
  user?: { id: number; name: string };
}
interface Reply {
  status: number;
  headers: Record<string, string>;
  sent: boolean;
  text?: string;
  length?: number;
}

function makeRequest(i: number): Request {
  const request: Request = { method: i % 3 ? "GET" : "POST", url: "/items/" + (i % 7), headers: {} };
  request.headers.host = "localhost";
  request.headers.accept = "*/*";
  if (i % 2) request.headers["content-type"] = "application/json";
  if (i % 3 === 0) request.body = { id: i, tags: ["a", "b"], nested: { deep: i % 5 } };
  if (i % 4 === 0) request.params = { id: String(i % 7) };
  if (i % 5 === 0) request.user = { id: i, name: "user" + (i % 3) };
  return request;
}

function handle(request: Request): Reply {
  const reply: Reply = { status: 200, headers: {}, sent: false };
  reply.headers["x-powered-by"] = "test";
  if (request.user) reply.headers["x-user"] = request.user.name;
  if (request.params) reply.text = "item " + request.params.id;
  else if (request.body) reply.text = JSON.stringify(request.body);
  else reply.text = request.method + " " + request.url;
  reply.length = reply.text.length;
  reply.sent = true;
  return reply;
}

function makeKind(round: number) {
  return class Kind {
    first = round;
    second = "s" + (round % 4);
    get both(): string {
      return this.first + this.second;
    }
  };
}

let total = 0;
let wrong = 0;
for (let round = 0; round < 240; round++) {
  const Kind = makeKind(round);
  for (let i = 0; i < 60; i++) {
    const request = makeRequest(round * 60 + i);
    const reply = handle(request);
    total += reply.length! + Object.keys(reply.headers).length + Object.keys(request).length;
    if (!reply.sent || reply.status !== 200) wrong++;
    const kind = new Kind();
    if (kind.both !== round + "s" + (round % 4)) wrong++;
    const bag: Record<string, number> = {};
    bag.alpha = i;
    bag.beta = round;
    if (i % 2) bag.gamma = 1;
    else bag.delta = 2;
    total += Object.keys(bag).join("").length + bag.alpha + bag.beta;
  }
  collect(round % 50 === 49);
  if (round % 7 === 3) collect(false);
}
console.log(total, wrong);
