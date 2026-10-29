const lines: string[] = [];
const say = (name: string, value: unknown) => lines.push(`${name}: ${JSON.stringify(value)}`);
const later = <T>(value: T, after: number) => new Promise<T>(resolve => setTimeout(() => resolve(value), after));
const failing = (reason: string, after: number) =>
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error(reason)), after));

say(
  "all",
  await Promise.all([1, later(2, 2), Promise.resolve(3), { then: (resolve: (value: number) => void) => resolve(4) }]),
);
say("all, empty", await Promise.all([]));
say("all, one fails", await Promise.all([later(1, 3), failing("second", 1)]).catch(error => error.message));
say(
  "allSettled",
  await Promise.allSettled([1, failing("no", 1), later("yes", 2)]).then(all =>
    all.map(one => (one.status === "fulfilled" ? one.value : one.reason.message)),
  ),
);
say("any", await Promise.any([failing("a", 1), later("b", 3), later("c", 2)]));
say(
  "any, all fail",
  await Promise.any([failing("a", 1), failing("b", 2)]).catch(error => [error.name, error.errors.length]),
);
say("race", await Promise.race([later("slow", 5), later("fast", 1)]));
say("race, a failure first", await Promise.race([later("slow", 5), failing("fast", 1)]).catch(error => error.message));
say("of a set", await Promise.all(new Set([later(1, 1), 2])));
class Mine<T> extends Promise<T> {}
say("a subclass", Mine.all([1]) instanceof Mine && (await Mine.race([7])));
console.log(lines.join("\n"));
