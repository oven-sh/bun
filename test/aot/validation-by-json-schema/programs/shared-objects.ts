// 40 objects that each hold the next one twice are 40 objects, and spell 2^40 places.
import type { Schema } from "bun";
import { validate } from "bun:bundle";
import { accepts, acceptsOrThrowsRangeError, endsClosed, finish, refuses } from "./check";

type Unique = unknown[] & Schema.UniqueItems;

// An object that is met twice is copied and judged once. Forty levels that each hold the level below twice spell 2^40 objects.
interface Deep {
  l?: Deep;
  r?: Deep;
}
type Held = { l?: unknown; r?: unknown };
function heldTwice(levels: number, wrap: (value: unknown) => unknown, innermost: unknown): unknown {
  let value = innermost;
  for (let level = 0; level < levels; level++) value = wrap(value);
  return value;
}
const inMembers = (value: unknown) => ({ l: value, r: value });
const inElements = (value: unknown) => [value, value];
acceptsOrThrowsRangeError("met twice: members", () => validate<Deep>(heldTwice(40, inMembers, {})));
endsClosed("met twice: members, and the innermost is wrong", () => validate<Deep>(heldTwice(40, inMembers, 1)));
endsClosed("met twice: Not", () => validate<Held & Schema.Not<Deep>>(heldTwice(40, inMembers, {})));
acceptsOrThrowsRangeError("met twice: Not, and the innermost is wrong", () => validate<Held & Schema.Not<Deep>>(heldTwice(40, inMembers, 1)));
acceptsOrThrowsRangeError("met twice: If", () => validate<Held & Schema.If<Deep, Deep, never>>(heldTwice(40, inMembers, {})));
acceptsOrThrowsRangeError("met twice: OneOf", () => validate<Held & Schema.OneOf<[Deep, never]>>(heldTwice(40, inMembers, {})));
endsClosed("met twice: OneOf, both arms", () => validate<Held & Schema.OneOf<[Deep, Deep]>>(heldTwice(40, inMembers, {})));
acceptsOrThrowsRangeError("met twice: AllOf", () => validate<Held & Schema.AllOf<[Deep, Deep]>>(heldTwice(40, inMembers, {})));
acceptsOrThrowsRangeError("met twice: Contains", () => validate<unknown[] & Schema.Contains<Deep>>([heldTwice(40, inMembers, {})]));
acceptsOrThrowsRangeError("met twice: PatternProperties", () => validate<{ a?: unknown } & Schema.PatternProperties<{ "^[lr]$": Deep }>>(heldTwice(40, inMembers, {})));
acceptsOrThrowsRangeError("met twice: DependentSchemas", () => validate<Held & Schema.DependentSchemas<{ l: Deep }>>(heldTwice(40, inMembers, {})));
accepts("met twice: an element under UniqueItems", () => validate<Unique>([heldTwice(40, inElements, [1]), 1]));
refuses("met twice: an element under UniqueItems, and a list of its two elements", () => {
  const held = heldTwice(40, inElements, [1]) as unknown[];
  return validate<Unique>([held, [held[0], held[1]]]);
});
endsClosed("met twice: two elements under UniqueItems that are alike", () => validate<Unique>([heldTwice(40, inElements, [1]), heldTwice(40, inElements, [1])]));
acceptsOrThrowsRangeError("met twice: an object under UniqueItems", () => validate<Unique>([heldTwice(40, inMembers, {}), 1]));

finish();
