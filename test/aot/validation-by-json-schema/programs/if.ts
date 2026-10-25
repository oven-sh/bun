import { JSON, type Schema } from "bun";
import { validate } from "bun:bundle";
import { both, changing, changingProxy, finish, handsBack, refuses } from "./check";

type Shape = { kind: string; radius?: number; side?: number } & Schema.If<{ kind: "circle" }, { radius: number }, { side: number }>;
type OnlyThen = { country: string; zip?: string } & Schema.If<{ country: "US" }, { zip: string & Schema.Pattern<"^[0-9]{5}$"> }>;
type OnlyElse = (number | string) & Schema.If<number, unknown, string & Schema.MinLength<2>>;
type Nested = number & Schema.If<number & Schema.Min<0>, number & Schema.If<number & Schema.Max<10>, number & Schema.Int>, number & Schema.Max<-5>>;

both("shape", value => validate<Shape>(value), text => JSON.parse<Shape>(text), {
  '{"kind":"circle","radius":1}': true,
  '{"kind":"circle","side":1}': false,
  '{"kind":"square","side":1}': true,
  '{"kind":"square","radius":1}': false,
  '{"kind":"circle","radius":"1"}': false,
  '{"radius":1}': false,
});
both("only then", value => validate<OnlyThen>(value), text => JSON.parse<OnlyThen>(text), {
  '{"country":"US","zip":"94105"}': true,
  '{"country":"US","zip":"9410"}': false,
  '{"country":"US"}': false,
  '{"country":"DE"}': true,
  '{"country":"DE","zip":"x"}': true,
});
both("only else", value => validate<OnlyElse>(value), text => JSON.parse<OnlyElse>(text), {
  "1": true,
  '"ab"': true,
  '"a"': false,
  "null": false,
});
both("nested", value => validate<Nested>(value), text => JSON.parse<Nested>(text), {
  "5": true,
  "5.5": false,
  "10.5": true,
  "-5": true,
  "-1": false,
});

handsBack("a getter under the condition is read once", { side: 1, kind: "square" }, () => validate<Shape>(changing("kind", "square", "circle", { side: 1 })));
refuses("a getter under the condition is judged by what it first answers", () => validate<Shape>(changing("kind", "circle", "square", { side: 1 })));
handsBack("a Proxy under the condition is read once", { kind: "square", side: 1 }, () =>
  validate<Shape>(changingProxy({ kind: "square", side: 1 }, { kind: "circle", side: 1 })));
refuses("a Proxy under the condition is judged by what it first answers", () =>
  validate<Shape>(changingProxy({ kind: "circle", side: 1 }, { kind: "square", side: 1 })));
type NoListOfNumbers = unknown[] & Schema.If<number[], never>;
refuses("a hole fails the condition, and the array too", () => validate<NoListOfNumbers>([,]));
refuses("what is not a number fails the condition, and the array too", () => validate<NoListOfNumbers>([NaN]));

finish();
