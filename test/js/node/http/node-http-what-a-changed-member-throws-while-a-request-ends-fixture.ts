import http from "node:http";

type Changed = Record<PropertyKey, unknown>;

const lines: string[] = [];
let seen: string[] = [];

function say(error: unknown): string {
  const { name, message } = error as Error;
  return name === "Error" ? message : name;
}

process.on("uncaughtException", error => {
  seen.push("uncaught " + say(error));
});

function keyOf(object: object, name: string): PropertyKey {
  if (!name.startsWith("@")) return name;
  for (let level: object | null = object; level !== null; level = Object.getPrototypeOf(level)) {
    for (const symbol of Object.getOwnPropertySymbols(level)) if (symbol.description === name.slice(1)) return symbol;
  }
  throw new Error("no " + name);
}

const changes: Record<string, (object: Changed, key: PropertyKey, name: string) => void> = {
  "getter throws"(object, key, name) {
    Object.defineProperty(object, key, {
      get() {
        throw new Error("get " + name);
      },
      set() {},
      configurable: true,
      enumerable: true,
    });
  },
  "setter throws"(object, key, name) {
    const held = object[key];
    Object.defineProperty(object, key, {
      get() {
        return held;
      },
      set() {
        throw new Error("set " + name);
      },
      configurable: true,
      enumerable: true,
    });
  },
  "read-only"(object, key) {
    Object.defineProperty(object, key, { value: object[key], writable: false, configurable: true, enumerable: true });
  },
  "a number"(object, key) {
    object[key] = 7;
  },
  "throws when called"(object, key, name) {
    object[key] = function () {
      throw new Error("call " + name);
    };
  },
};

const steps: [which: "req" | "socket", name: string, change: string][] = [
  ["req", "_consuming", "getter throws"],
  ["req", "_consuming", "setter throws"],
  ["req", "_consuming", "read-only"],
  ["req", "complete", "getter throws"],
  ["req", "socket", "getter throws"],
  ["req", "upgrade", "getter throws"],
  ["req", "_read", "getter throws"],
  ["req", "_read", "throws when called"],
  ["req", "_destroy", "getter throws"],
  ["req", "_destroy", "throws when called"],
  ["req", "@eofInProgress", "getter throws"],
  ["req", "@eofInProgress", "setter throws"],
  ["req", "@eofInProgress", "read-only"],
  ["req", "@handle", "setter throws"],
  ["req", "@handle", "read-only"],
  ["req", "@handle", "a number"],
  ["req", "@noBody", "getter throws"],
  ["socket", "resume", "getter throws"],
  ["socket", "resume", "a number"],
  ["socket", "resume", "throws when called"],
  ["socket", "readable", "getter throws"],
  ["socket", "readableLength", "getter throws"],
  ["socket", "readableHighWaterMark", "getter throws"],
  ["socket", "_paused", "getter throws"],
  ["socket", "parser", "getter throws"],
  ["socket", "@kUpgradeIncoming", "getter throws"],
  ["socket", "@kUpgradeIncoming", "a number"],
  ["socket", "@kHandoffResponse", "getter throws"],
  ["socket", "@kStreamingEnabled", "getter throws"],
];

let step: (typeof steps)[number];
let listens = false;
let reads = "";

function answer(res: http.ServerResponse) {
  try {
    res.end("ok");
  } catch (error) {
    seen.push("end() throws " + say(error));
  }
}

const server = http.createServer((req, res) => {
  if (listens) {
    req.on("error", error => seen.push("the request: " + say(error)));
    res.on("error", error => seen.push("the response: " + say(error)));
    req.socket.on("error", error => seen.push("the socket: " + say(error)));
  }
  const [which, name, change] = step;
  const object = (which === "req" ? req : req.socket) as unknown as Changed;
  changes[change](object, keyOf(object, name), name);
  if (reads === "unread") return answer(res);
  try {
    if (reads === "data") req.on("data", chunk => seen.push("data " + chunk.length));
    else {
      req.on("readable", () => {
        for (let chunk; (chunk = req.read()) !== null; ) seen.push("read " + chunk.length);
      });
    }
    req.on("end", () => {
      seen.push("end");
      answer(res);
    });
  } catch (error) {
    seen.push("on() throws " + say(error));
    answer(res);
  }
});

function exchange(method: string): Promise<string> {
  const { promise, resolve } = Promise.withResolvers<string>();
  let got = "nothing";
  const request = http.request(
    { method, port: (server.address() as { port: number }).port, host: "127.0.0.1", agent: false },
    response => {
      let body = "";
      response.on("error", () => {});
      response.on("data", chunk => (body += chunk));
      response.on("end", () => (got = response.statusCode + " " + body));
    },
  );
  request.on("error", error => (got = (error as NodeJS.ErrnoException).code!));
  const timer = setTimeout(() => {
    console.log(lines.join("\n"));
    console.log(`  ${step.join(" ")}: ${seen.join(", ") || "nothing"}; the exchange never ends`);
    process.exit(1);
  }, 20_000);
  request.on("close", () => {
    clearTimeout(timer);
    setImmediate(setImmediate, () => resolve(got));
  });
  request.end(method === "POST" ? "body" : undefined);
  return promise;
}

server.listen(0, "127.0.0.1", async () => {
  for (const [method, how] of [
    ["GET", "unread"],
    ["POST", "unread"],
    ["GET", "data"],
    ["POST", "data"],
    ["POST", "readable"],
  ]) {
    for (listens of [true, false]) {
      lines.push(`${method}, ${how}, ${listens ? "with" : "without"} 'error' listeners`);
      reads = how;
      for (step of steps) {
        // Nobody answers these once the request has failed: its 'end' never comes.
        if (how !== "unread" && step[0] === "req" && (step[1] === "socket" || step[2] === "a number")) continue;
        seen = [];
        const got = await exchange(method);
        lines.push(`  ${step.join(" ")}: ${seen.join(", ") || "nothing"}; the client: ${got}`);
      }
    }
  }
  console.log(lines.join("\n"));
  process.exit(0);
});
