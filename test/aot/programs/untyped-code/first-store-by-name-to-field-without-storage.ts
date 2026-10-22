// A record's fields that are born `undefined` may have no storage until a value is stored. Untyped code stores to them, on new objects every time, in every state an object can be in.
interface Reply {
  statusCode: number;
  sent: boolean;
  url: string;
  peer: object | null;
  statusMessage: string | undefined;
  header: string | undefined;
  trailer: string | undefined;
  timeout: number | undefined;
  encoding: string | undefined;
  chunked: boolean | undefined;
  size: number | undefined;
  upgrade: object | undefined;
  first: string | undefined;
  second: string | undefined;
  third: string | undefined;
  fourth: string | undefined;
}
const make = (url: string): Reply => ({
  statusCode: 200,
  sent: false,
  url,
  peer: null,
  statusMessage: undefined,
  header: undefined,
  trailer: undefined,
  timeout: undefined,
  encoding: undefined,
  chunked: undefined,
  size: undefined,
  upgrade: undefined,
  first: undefined,
  second: undefined,
  third: undefined,
  fourth: undefined,
});
const names = ["statusMessage", "header", "trailer", "timeout", "encoding", "chunked", "size", "upgrade", "first", "second", "third", "fourth"];
const holder: any[] = [null];
const lines: string[] = [];
const show = (value: any): string =>
  typeof value === "symbol" ? "symbol" : typeof value === "bigint" ? value + "n" : typeof value === "function" ? "function" : value === undefined ? "undefined" : Object.is(value, -0) ? "-0" : JSON.stringify(value);
const describe = (reply: any): string => Object.keys(reply).map(key => key + "=" + show(reply[key])).join(",");
function say(what: string, run: () => unknown) {
  let answer: string;
  try {
    answer = show(run());
  } catch (error: any) {
    answer = "threw " + error.constructor.name;
  }
  lines.push(what + ": " + answer);
}
const setters: Record<string, (reply: any, value: any) => void> = {
  statusMessage: (reply, value) => {
    reply.statusMessage = value;
  },
  header: (reply, value) => {
    reply.header = value;
  },
  trailer: (reply, value) => {
    reply.trailer = value;
  },
  timeout: (reply, value) => {
    reply.timeout = value;
  },
  encoding: (reply, value) => {
    reply.encoding = value;
  },
  chunked: (reply, value) => {
    reply.chunked = value;
  },
  size: (reply, value) => {
    reply.size = value;
  },
  upgrade: (reply, value) => {
    reply.upgrade = value;
  },
  first: (reply, value) => {
    reply.first = value;
  },
  second: (reply, value) => {
    reply.second = value;
  },
  third: (reply, value) => {
    reply.third = value;
  },
  fourth: (reply, value) => {
    reply.fourth = value;
  },
};
const setFourth = setters.fourth;
const setSize = setters.size;
const setUpgrade = setters.upgrade;
const strings: any[] = ["text", "", "rope".repeat(5) + String(1), undefined];
const valuesFor: Record<string, any[]> = {
  statusMessage: strings,
  header: strings,
  trailer: strings,
  timeout: [0, -0, 1, 1.5, NaN, 2 ** 31, -(2 ** 31) - 1, Infinity, undefined],
  encoding: strings,
  chunked: [true, false, undefined],
  size: [0, -0, 1, 1.5, NaN, 2 ** 31, -(2 ** 31) - 1, Infinity, undefined],
  upgrade: [{}, [], () => 1, new Map(), undefined],
  first: strings,
  second: strings,
  third: strings,
  fourth: strings,
};
const setAll = (reply: any, turn: any) => {
  reply.statusMessage = "m" + turn;
  reply.header = "h";
  reply.trailer = "t";
  reply.timeout = turn;
  reply.encoding = "e";
  reply.chunked = true;
  reply.size = turn + 0.5;
  reply.upgrade = holder;
  reply.first = "1";
  reply.second = "2";
  reply.third = "3";
  reply.fourth = "4";
};
const setBackwards = (reply: any) => {
  reply.fourth = "4";
  reply.third = "3";
  reply.second = "2";
  reply.first = "1";
  reply.size = 7;
  reply.header = "h";
};
const fresh = (): any => {
  holder[0] = make("/");
  return holder[0];
};
for (let warm = 0; warm < 50; warm++) {
  for (const name of names) setters[name](fresh(), valuesFor[name][0]);
  setAll(fresh(), warm);
  setBackwards(fresh());
}

for (const name of names) {
  for (const value of valuesFor[name]) {
    say(name + " = " + show(value), () => {
      const reply = fresh();
      setters[name](reply, value);
      return describe(reply) + " | " + show(reply[name]) + " | " + (Object.is(reply[name], value) ? "same" : "DIFFERENT");
    });
  }
}
say("read by type after the store", () => {
  const reply = make("/");
  holder[0] = reply;
  setFourth(holder[0], "typed");
  setSize(holder[0], 12);
  return [reply.fourth, reply.size, reply.third, reply.timeout].map(show).join();
});
say("all", () => {
  const reply = fresh();
  setAll(reply, 3);
  return describe({ ...reply, upgrade: 0 });
});
say("backwards", () => {
  const reply = fresh();
  setBackwards(reply);
  return describe(reply);
});
say("twice", () => {
  const reply = fresh();
  setFourth(reply, "a");
  setFourth(reply, "b");
  setFourth(reply, undefined);
  setFourth(reply, "c");
  return describe(reply);
});
say("frozen", () => {
  const reply = Object.freeze(fresh());
  setFourth(reply, "x");
  return describe(reply);
});
say("sealed", () => {
  const reply = Object.seal(fresh());
  setFourth(reply, "x");
  return describe(reply);
});
say("not extensible", () => {
  const reply = Object.preventExtensions(fresh());
  setFourth(reply, "x");
  return describe(reply);
});
say("deleted first", () => {
  const reply = fresh();
  delete reply.fourth;
  const before = describe(reply);
  setFourth(reply, "again");
  return before + " | " + describe(reply);
});
say("another deleted first", () => {
  const reply = fresh();
  delete reply.size;
  setFourth(reply, "x");
  setSize(reply, 1);
  return describe(reply);
});
say("deleted, not extensible", () => {
  const reply = fresh();
  delete reply.fourth;
  Object.preventExtensions(reply);
  setFourth(reply, "x");
  return describe(reply);
});
say("a setter on the prototype", () => {
  const reply = fresh();
  let called = 0;
  Object.setPrototypeOf(reply, {
    set fourth(value: unknown) {
      called++;
    },
  });
  setFourth(reply, "own");
  return describe(reply) + " | " + called;
});
say("deleted, a setter on the prototype", () => {
  const reply = fresh();
  let called = 0;
  Object.setPrototypeOf(reply, {
    set fourth(value: unknown) {
      called++;
    },
  });
  delete reply.fourth;
  setFourth(reply, "not own");
  return describe(reply) + " | " + called;
});
say("read-only", () => {
  const reply = fresh();
  Object.defineProperty(reply, "fourth", { writable: false });
  setFourth(reply, "x");
  return describe(reply);
});
say("not enumerable", () => {
  const reply = fresh();
  Object.defineProperty(reply, "fourth", { enumerable: false });
  setFourth(reply, "x");
  return describe(reply) + " | " + show(reply.fourth);
});
say("an undeclared property first", () => {
  const reply = fresh();
  reply.extra = 1;
  setFourth(reply, "x");
  reply.more = 2;
  setSize(reply, 3);
  return describe(reply);
});
say("a descriptor", () => {
  const reply = fresh();
  const before = show(Object.getOwnPropertyDescriptor(reply, "fourth"));
  setFourth(reply, "x");
  return before + " | " + show(Object.getOwnPropertyDescriptor(reply, "fourth"));
});
say("has", () => {
  const reply = fresh();
  const before = names.map(name => (name in reply ? 1 : 0) + (Object.hasOwn(reply, name) ? 2 : 0)).join("");
  setFourth(reply, "x");
  return before + " | " + names.map(name => (name in reply ? 1 : 0) + (Object.hasOwn(reply, name) ? 2 : 0)).join("");
});
say("a copy", () => {
  const reply = fresh();
  setFourth(reply, "x");
  setSize(reply, 2);
  return describe({ ...reply }) + " | " + describe(Object.assign({}, reply));
});
for (const name of names) {
  const value = valuesFor[name][0];
  const set = setters[name];
  say(name + " in every state", () => {
    const answers: string[] = [];
    const attempt = (prepare: (reply: any) => void) => {
      const reply = fresh();
      try {
        prepare(reply);
        set(reply, value);
        answers.push(Object.keys(reply).join() + ":" + show(reply[name]));
      } catch (error: any) {
        answers.push(error.constructor.name + ":" + show(reply[name]));
      }
    };
    attempt(() => {});
    attempt(reply => Object.freeze(reply));
    attempt(reply => Object.seal(reply));
    attempt(reply => Object.preventExtensions(reply));
    attempt(reply => Object.defineProperty(reply, name, { writable: false }));
    attempt(reply => Object.setPrototypeOf(reply, Object.defineProperty({}, name, { set() {} })));
    attempt(reply => {
      reply.extra = 1;
    });
    attempt(reply => set(reply, undefined));
    attempt(reply => set(reply, valuesFor[name][1]));
    return answers.join(" ; ");
  });
}
const count: (name: string) => number = (globalThis as any).aotOperationCount ?? (() => 0);
say("many, some kept", () => {
  const kept: any[] = [];
  const before = count("operationAOTPutByIdAndCache");
  for (let i = 0; i < 300000; i++) {
    const reply = fresh();
    setFourth(reply, "f" + (i & 7));
    setSize(reply, i);
    const name = names[i % names.length];
    setters[name](reply, valuesFor[name][0]);
    if (i % 1000 === 0) setAll(reply, i);
    if (i % 997 === 0) kept.push(reply);
  }
  let sum = 0;
  for (const reply of kept) sum += reply.size + reply.fourth.length + (reply.third === undefined ? 1 : 2);
  return kept.length + " " + sum + " " + (count("operationAOTPutByIdAndCache") - before < 10000);
});
say("old objects", () => {
  const old: any[] = [];
  for (let i = 0; i < 2000; i++) old.push(make("/" + i));
  const garbage: any[] = [];
  for (let i = 0; i < 400000; i++) garbage[i & 1023] = { i };
  for (let i = 0; i < old.length; i++) setUpgrade(old[i], { i });
  for (let i = 0; i < 400000; i++) garbage[i & 1023] = { i };
  let sum = 0;
  for (const reply of old) sum += reply.upgrade.i;
  return sum;
});
console.log(lines.join("\n"));
