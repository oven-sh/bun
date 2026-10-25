import { JSON, type Schema } from "bun";
import { validate } from "bun:bundle";
import { both, changing, changingProxy, finish, handsBack, refuses } from "./check";

type EachClosesItsOwn = Record<string, unknown> & Schema.AllOf<[{ a?: number } & Schema.Strict, { b?: unknown }]>;
type OddWhole = number & Schema.AllOf<[number & Schema.Int, number & Schema.Not<number & Schema.MultipleOf<2>>]>;
type WithNever = number & Schema.AllOf<[unknown, never]>;
type TwoChoices = unknown[] & Schema.AllOf<[unknown[] & Schema.Contains<number>, unknown[] & Schema.Contains<string>]>;

both("each closes its own", value => validate<EachClosesItsOwn>(value), text => JSON.parse<EachClosesItsOwn>(text), {
  "{}": true,
  '{"a":1}': true,
  '{"a":"1"}': false,
  '{"a":1,"b":1}': false,
  '{"b":1}': false,
});
both("odd whole", value => validate<OddWhole>(value), text => JSON.parse<OddWhole>(text), { "1": true, "2": false, "1.5": false });
both("with never", value => validate<WithNever>(value), text => JSON.parse<WithNever>(text), { "1": false });
both("two choices", value => validate<TwoChoices>(value), text => JSON.parse<TwoChoices>(text), {
  '[1,"a"]': true,
  "[1]": false,
  '["a"]': false,
});

handsBack("a getter is read once", { a: 1 }, () => validate<EachClosesItsOwn>(changing("a", 1, "1")));
refuses("a getter is judged by what it first answers", () => validate<EachClosesItsOwn>(changing("a", "1", 1)));
handsBack("a Proxy is read once", { a: 1 }, () => validate<EachClosesItsOwn>(changingProxy({ a: 1 }, { a: 1, b: 1 })));
refuses("a Proxy is judged by what it first answers", () => validate<EachClosesItsOwn>(changingProxy({ a: 1, b: 1 }, { a: 1 })));

finish();
