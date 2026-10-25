import { JSON, type Schema } from "bun";
import { validate } from "bun:bundle";
import { both, changing, changingProxy, finish, handsBack, refuses } from "./check";

type WholeOrLarge = number & Schema.OneOf<[number & Schema.Int, number & Schema.Min<2>]>;
type ByTwoThreeFive = number & Schema.OneOf<[number & Schema.MultipleOf<2>, number & Schema.MultipleOf<3>, number & Schema.MultipleOf<5>]>;
type CardOrBank = Record<string, unknown> & Schema.OneOf<[{ card: string }, { bank: string }]>;
type WithAnything = unknown[] & Schema.OneOf<[unknown, number[]]>;
type OfNone = number & Schema.OneOf<[never, never]>;
type OfOne = number & Schema.OneOf<[number & Schema.Min<0>]>;

both("whole or large", value => validate<WholeOrLarge>(value), text => JSON.parse<WholeOrLarge>(text), {
  "1": true,
  "2.5": true,
  "3": false,
  "1.5": false,
  '"1"': false,
});
both("by two, three, five", value => validate<ByTwoThreeFive>(value), text => JSON.parse<ByTwoThreeFive>(text), {
  "2": true,
  "25": true,
  "6": false,
  "30": false,
  "7": false,
  "0": false,
});
both("card or bank", value => validate<CardOrBank>(value), text => JSON.parse<CardOrBank>(text), {
  '{"card":"1"}': true,
  '{"bank":"1"}': true,
  '{"card":"1","bank":"1"}': false,
  "{}": false,
  '{"card":1,"bank":"1"}': true,
  '{"card":1}': false,
});
both("with anything", value => validate<WithAnything>(value), text => JSON.parse<WithAnything>(text), {
  '["a"]': true,
  "[1]": false,
  "[]": false,
});
both("of none", value => validate<OfNone>(value), text => JSON.parse<OfNone>(text), { "1": false });
both("of one", value => validate<OfOne>(value), text => JSON.parse<OfOne>(text), { "1": true, "-1": false });

handsBack("a Proxy is read once", { card: "1" }, () => validate<CardOrBank>(changingProxy({ card: "1" }, { card: "1", bank: "1" })));
refuses("a Proxy is judged by what it first answers", () => validate<CardOrBank>(changingProxy({ card: "1", bank: "1" }, { card: "1" })));
handsBack("a getter is read once", { card: "1", bank: 1 }, () => validate<CardOrBank>(changing("bank", 1, "1", { card: "1" })));
refuses("a getter is judged by what it first answers", () => validate<CardOrBank>(changing("bank", "1", 1, { card: "1" })));
refuses("a hole fails one arm, and the array too", () => validate<WithAnything>([,]));
refuses("what is not a number fails one arm, and the array too", () => validate<WithAnything>([NaN]));

finish();
