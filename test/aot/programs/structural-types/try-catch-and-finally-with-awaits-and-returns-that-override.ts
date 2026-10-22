function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "rejected " + (error instanceof Error ? error.constructor.name : text(error));
}

let log: string[] = [];

function soon<T>(label: string, value: T): Promise<T> {
  return Promise.resolve().then(() => {
    log.push(label);
    return value;
  });
}

function fails(label: string, error: unknown): Promise<never> {
  return Promise.resolve().then(() => {
    log.push(label);
    throw error;
  });
}

const cases: [string, () => Promise<number>][] = [
  ["return in try, await in finally", async () => {
    let n = 1;
    try {
      return n;
    } finally {
      n = await soon("finally", 2);
      log.push("n is " + n);
    }
  }],
  ["return await in try, return in finally", async () => {
    try {
      return await soon("try", 1);
    } finally {
      return await soon("finally", 2);
    }
  }],
  ["throw in try, return in finally", async () => {
    try {
      throw new RangeError("try");
    } finally {
      return await soon("finally", 3);
    }
  }],
  ["rejection awaited in try, caught", async () => {
    try {
      return await fails("try", new TypeError("try"));
    } catch (error) {
      log.push("caught " + failure(error));
      return await soon("catch", 4);
    } finally {
      await soon("finally", 0);
    }
  }],
  ["rejection returned without await, not caught", async () => {
    try {
      return fails("try", new TypeError("try"));
    } catch (error) {
      log.push("never caught");
      return -1;
    } finally {
      log.push("finally");
    }
  }],
  ["throw in catch, throw in finally", async () => {
    try {
      throw new RangeError("try");
    } catch {
      throw new TypeError("catch");
    } finally {
      await fails("finally", new SyntaxError("finally"));
    }
  }],
  ["break out of a finally in a loop", async () => {
    let rounds = 0;
    for (;;) {
      try {
        rounds++;
        return await soon("try", -1);
      } finally {
        if (rounds === 2) break;
        await soon("finally " + rounds, 0);
        continue;
      }
    }
    return rounds;
  }],
  ["nested finally blocks", async () => {
    try {
      try {
        return await soon("inner try", 1);
      } finally {
        await soon("inner finally", 0);
      }
    } finally {
      await soon("outer finally", 0);
    }
  }],
  ["a thrown number", async () => {
    try {
      throw 5;
    } catch (error) {
      return typeof error === "number" ? error + (await soon("catch", 1)) : -1;
    }
  }],
  ["a thrown undefined", async () => {
    try {
      await fails("try", undefined);
      return 0;
    } catch (error) {
      return error === undefined ? 1 : -1;
    }
  }],
  ["a local changed after the return value was computed", async () => {
    const box = { n: 1 };
    let copy = box.n;
    try {
      return copy + box.n;
    } finally {
      copy = 100;
      box.n = await soon("finally", 100);
    }
  }],
];

for (const [label, run] of cases) {
  log = [];
  const outcome = await run().then(text, failure);
  console.log(label + ": " + outcome + " [" + log.join(", ") + "]");
}

export {};
