function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    if (list.length > 40) return "array of " + list.length + " with keys " + Object.keys(list).join();
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

function study(title: string, change: (list: number[], index: number) => void): void {
  console.log(title);
  attempt("  forEach", () => {
    const list = [1, 2, 3, 4];
    const seen: string[] = [];
    list.forEach((n, i) => {
      seen.push(i + ":" + show(n));
      change(list, i);
    });
    return [seen.join(" "), list];
  });
  attempt("  map", () => {
    const list = [1, 2, 3, 4];
    const mapped = list.map((n, i) => {
      change(list, i);
      return n + 1;
    });
    return [mapped, list];
  });
  attempt("  filter", () => {
    const list = [1, 2, 3, 4];
    return list.filter((n, i) => {
      change(list, i);
      return n !== 2;
    });
  });
  attempt("  reduce", () => {
    const list = [1, 2, 3, 4];
    return list.reduce((sum, n, i) => {
      change(list, i);
      return sum + n;
    }, 0);
  });
  attempt("  reduceRight", () => {
    const list = [1, 2, 3, 4];
    return list.reduceRight((text, n, i) => {
      change(list, i);
      return text + show(n);
    }, "");
  });
  attempt("  find sees holes", () => {
    const list = [1, 2, 3, 4];
    const seen: string[] = [];
    list.find((n, i) => {
      seen.push(typeof n);
      change(list, i);
      return false;
    });
    return seen.join();
  });
  attempt("  findLast", () => {
    const list = [1, 2, 3, 4];
    const seen: string[] = [];
    list.findLast((n, i) => {
      seen.push(typeof n);
      change(list, i);
      return false;
    });
    return seen.join();
  });
  attempt("  every", () => {
    const list = [1, 2, 3, 4];
    let rounds = 0;
    const all = list.every((n, i) => {
      rounds++;
      change(list, i);
      return n + 1 > 0;
    });
    return [all, rounds];
  });
  attempt("  entries", () => {
    const list = [1, 2, 3, 4];
    const seen: string[] = [];
    for (const [i, n] of list.entries()) {
      if (seen.length > 8) break;
      seen.push(i + ":" + show(n));
      change(list, i);
    }
    return seen.join(" ");
  });
  attempt("  flatMap", () => {
    const list = [1, 2, 3, 4];
    return list.flatMap((n, i) => {
      change(list, i);
      return [n, n * 2];
    });
  });
  attempt("  Array.from with a map function", () => {
    const list = [1, 2, 3, 4];
    return Array.from(list, (n, i) => {
      if (i < 8) change(list, i);
      return n + 1;
    }).length;
  });
}

study("nothing changes", () => {});
study("popped each round", list => list.pop());
study("cut to 1 in the first round", (list, i) => {
  if (i === 0 || i === 3) list.length = 1;
});
study("pushed to in the first two rounds", (list, i) => {
  if (i < 2) list.push(9);
});
study("the next one is deleted", (list, i) => {
  delete list[i + 1];
});
study("the next one is replaced by a fraction", (list, i) => {
  if (i + 1 < list.length) list[i + 1] = 0.5;
});
study("shifted in the first round", (list, i) => {
  if (i === 0) list.shift();
});

export {};
