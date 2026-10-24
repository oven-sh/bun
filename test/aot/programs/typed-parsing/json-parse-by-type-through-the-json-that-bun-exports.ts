// `import { JSON } from "bun"` and `Bun.JSON` are one object, which is not the global `JSON`, and a parse by type through them validates. The installed types give the `JSON` that "bun" exports signatures of its own.
import { JSON as Typed } from "bun";

interface User {
  id: number;
  name: string;
}
const text = '{"id":7,"name":"Ada"}';
const wrong = '{"id":"7"}';
function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, JSON.stringify(run()));
  } catch (error) {
    console.log(label, (error as Error).constructor.name);
  }
}
console.log("one object", Typed === Bun.JSON, "the global", Typed === JSON, Bun.JSON === JSON);
attempt("global, right", () => JSON.parse<User>(text));
attempt("global, wrong", () => JSON.parse<User>(wrong));
attempt("imported, right", () => Typed.parse<User>(text));
attempt("imported, wrong", () => Typed.parse<User>(wrong));
attempt("Bun.JSON, right", () => Bun.JSON.parse<User>(text));
attempt("Bun.JSON, wrong", () => Bun.JSON.parse<User>(wrong));
attempt("imported, taken off", () => {
  const { parse } = Typed;
  return parse<User>(wrong);
});
attempt("no type argument", () => JSON.parse(wrong));
attempt("imported, any", () => Typed.parse<any>(wrong));
