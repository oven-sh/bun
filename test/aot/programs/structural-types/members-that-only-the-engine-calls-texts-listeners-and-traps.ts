const log: string[] = [];

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  let line: string;
  try {
    line = label + " -> " + show(run());
  } catch (error) {
    line = label + " threw " + (error instanceof Error ? error.constructor.name : typeof error);
  }
  console.log(log.length > 0 ? line + " | " + log.join(" ") : line);
}

class Loud extends RegExp {
  exec(text: string): RegExpExecArray | null {
    log.push("exec");
    return super.exec(text);
  }
}

class Matcher {
  [Symbol.match](text: string): RegExpMatchArray | null {
    log.push("match");
    return text.match(/a/);
  }
  [Symbol.matchAll](text: string): RegExpStringIterator<RegExpMatchArray> {
    log.push("matchAll");
    return text.matchAll(/a/g);
  }
  [Symbol.search](text: string): number {
    log.push("search");
    return text.length;
  }
  [Symbol.split](text: string, limit?: number): string[] {
    log.push("split " + limit);
    return [text, "split"];
  }
  [Symbol.replace](text: string, replacement: string): string {
    log.push("replace");
    return text + replacement;
  }
}

attempt("test calls exec", () => new Loud("a").test("ba"));
attempt("match calls exec", () => "aa".match(new Loud("a", "g")));
attempt("replace calls exec", () => "aa".replace(new Loud("a", "g"), "b"));
attempt("split makes another one", () => "a,b".split(new Loud(",")));
attempt("search calls exec", () => "ba".search(new Loud("a")));
attempt("matchAll calls exec", () => [..."aa".matchAll(new Loud("a", "g"))].length);
attempt("an object that matches", () => ["ba".match(new Matcher())?.index, [...Reflect.apply(String.prototype.matchAll, "aa", [new Matcher()])].length, "ba".search(new Matcher()), "ba".split(new Matcher(), 3), "ba".replace(new Matcher(), "!")]);
attempt("the callback of replace", () => "a1b2".replace(/\d/g, digit => String(Number(digit) + 1)));
attempt("the callback of replaceAll", () => "a-b-c".replaceAll("-", (dash, offset: number) => dash + offset));
attempt("a tag of a template", () => {
  function tag(texts: TemplateStringsArray, ...values: number[]): string {
    log.push("tag");
    return texts.raw.join("|") + values.join();
  }
  return tag`a${1}b${2}c`;
});
attempt("String.raw reads raw", () =>
  String.raw(
    {
      get raw(): string[] {
        log.push("raw");
        return ["x", "y"];
      },
    },
    1,
  ),
);
attempt("the inspector asks the object", () => {
  class Secret {
    hidden = "hidden";
    [Symbol.for("nodejs.util.inspect.custom")](): string {
      log.push("inspect");
      return "<secret>";
    }
  }
  return [Bun.inspect(new Secret()), Bun.inspect({ inner: new Secret() })];
});
attempt("listeners", () => {
  const target = new EventTarget();
  class Handler {
    seen = 0;
    handleEvent(event: Event): void {
      log.push("handleEvent " + event.type);
      this.seen++;
    }
  }
  const handler = new Handler();
  target.addEventListener("a", handler);
  target.addEventListener("a", event => log.push("function " + event.type), { once: true });
  target.dispatchEvent(new Event("a"));
  target.dispatchEvent(new Event("a"));
  return handler.seen;
});
attempt("a proxy and its traps", () => {
  class Traps implements ProxyHandler<{ x: number }> {
    get(target: { x: number }, key: string | symbol): unknown {
      log.push("get " + String(key));
      return Reflect.get(target, key);
    }
    has(target: { x: number }, key: string | symbol): boolean {
      log.push("has " + String(key));
      return Reflect.has(target, key);
    }
    ownKeys(target: { x: number }): (string | symbol)[] {
      log.push("ownKeys");
      return Reflect.ownKeys(target);
    }
    getOwnPropertyDescriptor(target: { x: number }, key: string | symbol): PropertyDescriptor | undefined {
      log.push("descriptor " + String(key));
      return Reflect.getOwnPropertyDescriptor(target, key);
    }
  }
  const proxy = new Proxy({ x: 1 }, new Traps());
  return [proxy.x, "x" in proxy, Object.keys(proxy), { ...proxy }.x, JSON.stringify(proxy)];
});

process.on("exit", code => console.log("the exit listener ran with " + code));
process.on("beforeExit", () => console.log("the beforeExit listener ran"));

export {};
