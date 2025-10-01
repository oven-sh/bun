import { expectType } from "./utilities";

// Test string literal autocomplete and return types
expectType(Bun.ms("1s")).is<number>();
expectType(Bun.ms("1m")).is<number>();
expectType(Bun.ms("1h")).is<number>();
expectType(Bun.ms("1d")).is<number>();
expectType(Bun.ms("1w")).is<number>();
expectType(Bun.ms("1mo")).is<number>();
expectType(Bun.ms("1y")).is<number>();

// Test with all unit variations
expectType(Bun.ms("1ms")).is<number>();
expectType(Bun.ms("1millisecond")).is<number>();
expectType(Bun.ms("1milliseconds")).is<number>();
expectType(Bun.ms("1second")).is<number>();
expectType(Bun.ms("1 second")).is<number>();
expectType(Bun.ms("1 seconds")).is<number>();
expectType(Bun.ms("1minute")).is<number>();
expectType(Bun.ms("1 minute")).is<number>();
expectType(Bun.ms("1hour")).is<number>();
expectType(Bun.ms("1 hour")).is<number>();
expectType(Bun.ms("1day")).is<number>();
expectType(Bun.ms("1 day")).is<number>();
expectType(Bun.ms("1week")).is<number>();
expectType(Bun.ms("1 week")).is<number>();
expectType(Bun.ms("1month")).is<number>();
expectType(Bun.ms("1 month")).is<number>();
expectType(Bun.ms("1year")).is<number>();
expectType(Bun.ms("1 year")).is<number>();

// Test with decimals and negatives
expectType(Bun.ms("1.5h")).is<number>();
expectType(Bun.ms("-1s")).is<number>();
expectType(Bun.ms(".5m")).is<number>();
expectType(Bun.ms("-.5h")).is<number>();

// Test number input (formatting)
expectType(Bun.ms(1000)).is<string>();
expectType(Bun.ms(60000)).is<string>();
expectType(Bun.ms(3600000)).is<string>();

// Test with options
expectType(Bun.ms(1000, { long: true })).is<string>();
expectType(Bun.ms(60000, { long: false })).is<string>();

// Test generic string input (for dynamic values)
const dynamicString: string = "1s";
expectType(Bun.ms(dynamicString)).is<number>();

// Should NOT accept options with string input
// @ts-expect-error - options only valid with number input
Bun.ms("1s", { long: true });

// Number with options should work
const formatted = Bun.ms(1000, { long: true });
expectType(formatted).is<string>();

// Options should be optional
const shortFormat = Bun.ms(1000);
expectType(shortFormat).is<string>();

// Test that invalid inputs still return number (NaN is a number)
expectType(Bun.ms("invalid")).is<number>();
expectType(Bun.ms("")).is<number>();
