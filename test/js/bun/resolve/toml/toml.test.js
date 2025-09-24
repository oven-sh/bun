import { expect, it } from "bun:test";
import emptyToml from "./toml-empty.toml";
import tomlFromCustomTypeAttribute from "./toml-fixture.toml.txt" with { type: "toml" };

function checkToml(toml) {
  expect(toml.framework).toBe("next");
  expect(toml.bundle.packages["@emotion/react"]).toBe(true);
  expect(toml.array[0].entry_one).toBe("one");
  expect(toml.array[0].entry_two).toBe("two");
  expect(toml.array[1].entry_one).toBe("three");
  expect(toml.array[1].entry_two).toBe(undefined);
  expect(toml.array[1].nested[0].entry_one).toBe("four");
  expect(toml.dev.one.two.three).toBe(4);
  expect(toml.dev.foo).toBe(123);
  expect(toml.inline.array[0]).toBe(1234);
  expect(toml.inline.array[1]).toBe(4);
  expect(toml.dev["foo.bar"]).toBe("baz");
  expect(toml.install.scopes["@mybigcompany"].url).toBe("https://registry.mybigcompany.com");
  expect(toml.install.scopes["@mybigcompany2"].url).toBe("https://registry.mybigcompany.com");
  expect(toml.install.scopes["@mybigcompany3"].three).toBe(4);
  expect(toml.install.cache.dir).toBe("C:\\Windows\\System32");
  expect(toml.install.cache.dir2).toBe("C:\\Windows\\System32\\🏳️‍🌈");

  expect(toml.calendar["odt1"]).toBe("1979-05-27T07:32:00Z");
  expect(toml.calendar["odt2"]).toBe("1979-05-27T00:32:00-07:00");
  expect(toml.calendar["odt3"]).toBe("1979-05-27T00:32:00");
  expect(toml.calendar["odt4"]).toBe("1979-05-27T00:32:00+07:00");
  expect(toml.calendar["odt5"]).toBe("1979-05-27T00:32:00.9-07:00");
  expect(toml.calendar["odt6"]).toBe("1979-05-27T00:32:00.99-07:00");
  expect(toml.calendar["odt7"]).toBe("1979-05-27T00:32:00.999-07:00");
  expect(toml.calendar["odt8"]).toBe("1979-05-27T00:32:00.999-07:00");
  expect(toml.calendar["odt9"]).toBe("1979-05-27T00:32:00.999+07:00");
  expect(toml.calendar["odt10"]).toBe("1979-05-27 07:32:00Z");
  expect(toml.calendar["odt11"]).toBe("1979-05-27T00:32:00.999+07:00");
  expect(toml.calendar["odt12"]).toBe("1979-05-27T07:32:00.999+05:00");
  expect(toml.calendar["odt13"]).toBe("1979-05-27T07:32:00.123-07:00");
  expect(toml.calendar["odt14"]).toBe("1979-05-27T07:32:00.999Z");

  expect(toml.calendar["date_array"][0]).toBe("1979-05-27");
  expect(toml.calendar["date_array"][1]).toBe("2025-09-24");
  expect(toml.calendar["date_array"][2]).toBe("2026-01-01");

  expect(toml.calendar["ldt1"]).toBe("1979-05-27T07:32:00.9");
  expect(toml.calendar["ldt2"]).toBe("1979-05-27T07:32:00.99");
  expect(toml.calendar["ldt3"]).toBe("1979-05-27T00:32:00.999");
  expect(toml.calendar["ldt4"]).toBe("1979-05-27T00:32:00.999");
  expect(toml.calendar["ldt5"]).toBe("1979-05-27T00:32:00.999");

  expect(toml.calendar["ld1"]).toBe("1979-05-27");
  expect(toml.calendar["valid_leap_date"]).toBe("2024-02-29");

  expect(toml.calendar["lt1"]).toBe("07:32:00");
  expect(toml.calendar["lt2"]).toBe("00:32:00.9");
  expect(toml.calendar["lt3"]).toBe("00:32:00.99");
  expect(toml.calendar["lt4"]).toBe("00:32:00.999");
  expect(toml.calendar["lt5"]).toBe("00:32:00.999");

  expect(toml.calendar["time_array"][0]).toBe("07:32:00");
  expect(toml.calendar["time_array"][1]).toBe("04:05:06.933");
}

it("via dynamic import", async () => {
  const toml = (await import("./toml-fixture.toml")).default;
  checkToml(toml);
});

it("via import type toml", async () => {
  checkToml(tomlFromCustomTypeAttribute);
});

it("via dynamic import with type attribute", async () => {
  delete require.cache[require.resolve("./toml-fixture.toml.txt")];
  const toml = (await import("./toml-fixture.toml.txt", { with: { type: "toml" } })).default;
  checkToml(toml);
});

it("empty via import statement", () => {
  expect(emptyToml).toEqual({});
});

it("inline table followed by table array", () => {
  const tomlContent = `
[global]
inline_table = { q1 = 1 }

[[items]]
q1 = 1
q2 = 2

[[items]]
q1 = 3
q2 = 4
`;

  // Test via Bun's internal TOML parser
  const Bun = globalThis.Bun;
  const parsed = Bun.TOML.parse(tomlContent);

  expect(parsed.global).toEqual({
    inline_table: { q1: 1 },
  });
  expect(parsed.items).toEqual([
    { q1: 1, q2: 2 },
    { q1: 3, q2: 4 },
  ]);
});

it("array followed by table array", () => {
  const tomlContent = `
[global]
array = [1, 2, 3]

[[items]]
q1 = 1
`;

  const Bun = globalThis.Bun;
  const parsed = Bun.TOML.parse(tomlContent);

  expect(parsed.global).toEqual({
    array: [1, 2, 3],
  });
  expect(parsed.items).toEqual([{ q1: 1 }]);
});

it("nested inline tables", () => {
  const tomlContent = `
[global]
nested = { outer = { inner = 1 } }

[[items]]
q1 = 1
`;

  const Bun = globalThis.Bun;
  const parsed = Bun.TOML.parse(tomlContent);

  expect(parsed.global).toEqual({
    nested: { outer: { inner: 1 } },
  });
  expect(parsed.items).toEqual([{ q1: 1 }]);
});

// Invalid Date/Datetime/Time testing.
// All of these are expected to throw, so it's simplest to just define them inline rather than creating a file for each.
it("handles-invalid-time: not enough hours", () => {
  const Bun = globalThis.Bun;
  const toml = `
[invalid.time]
lt1 = 4:32:00
`;
  // This error message is presently generated from the outer scope, as the time is too short to be considered a time,
  // but is not very intuitive.
  expect(() => Bun.TOML.parse(toml)).toThrow("Expected key but found :");
});

it("handles-invalid-time: hour too large", () => {
  const Bun = globalThis.Bun;
  const toml = `
[invalid.time]
lt1 = 24:32:00
`;
  expect(() => Bun.TOML.parse(toml)).toThrow("Expected hour to be in the range [00,23].");
});

it("handles-invalid-date: hour too large", () => {
  const Bun = globalThis.Bun;
  const toml = `
[invalid.time]
ldt1 = 2025-01-01T24:32:00
`;
  expect(() => Bun.TOML.parse(toml)).toThrow("Expected hour to be in the range [00,23].");
});

it("handles-invalid-time: minute too large", () => {
  const Bun = globalThis.Bun;
  const toml = `
[invalid.time]
lt1 = 12:60:00
`;
  expect(() => Bun.TOML.parse(toml)).toThrow("Expected minutes to be in the range [00,59].");
});

it("handles-invalid-date: minute too large", () => {
  const Bun = globalThis.Bun;
  const toml = `
[invalid.time]
ldt1 = 2024-01-01T12:60:00
`;
  expect(() => Bun.TOML.parse(toml)).toThrow("Expected minutes to be in the range [00,59].");
});

it("handles-invalid-time: seconds too large", () => {
  const Bun = globalThis.Bun;
  const toml = `
[invalid.time]
lt1 = 21:32:61
`;
  expect(() => Bun.TOML.parse(toml)).toThrow("Expected seconds to be in the range [00,60].");
});

it("handles-invalid-date: seconds too large", () => {
  const Bun = globalThis.Bun;
  const toml = `
[invalid.time]
ldt1 = 2024-01-01T21:32:61
`;
  expect(() => Bun.TOML.parse(toml)).toThrow("Expected seconds to be in the range [00,60].");
});

it("handles-invalid-time: malformed fraction", () => {
  const Bun = globalThis.Bun;
  const toml = `
[invalid.time]
lt1 = 14:32:00.999f
`;
  expect(() => Bun.TOML.parse(toml)).toThrow("Expected t_equal but found end of file");
});

it("handles-invalid-date: malformed fraction", () => {
  const Bun = globalThis.Bun;
  const toml = `
[invalid.time]
ldt1 = 2025-01-01T14:32:00.999f
`;
  expect(() => Bun.TOML.parse(toml)).toThrow("Expected t_equal but found end of file");
});

it("handles-invalid-date: not enough date digits", () => {
  const Bun = globalThis.Bun;
  const toml = `
[invalid.format]
ld1 = 1979-05-2
`;
  // This error message is presently generated from the outer scope, as the date is too short to be considered a date,
  // but is not very intuitive.
  expect(() => Bun.TOML.parse(toml)).toThrow("Expected key but found -");
});

it("handles-invalid-date: too many day digits", () => {
  const Bun = globalThis.Bun;
  const toml = `
[invalid.format]
ld1 = 1979-05-223
`;
  expect(() => Bun.TOML.parse(toml)).toThrow("Got an unexpected numeric digit while parsing datetime.");
});

it("handles-invalid-date: missing a day digit", () => {
  const Bun = globalThis.Bun;
  const toml = `
[invalid.format]
ld1 = 1979-12-1T10:10:10Z
`;
  expect(() => Bun.TOML.parse(toml)).toThrow("Got an unexpected ' ' or 'T' while parsing datetime.");
});

it("handles-invalid-date: missing a month digit", () => {
  const Bun = globalThis.Bun;
  const toml = `
[invalid.format]
ld1 = 1979-1-121
`;
  expect(() => Bun.TOML.parse(toml)).toThrow("Got an unexpected '-' while parsing datetime.");
});

it("handles-invalid-date: too many month digits", () => {
  const Bun = globalThis.Bun;
  const toml = `
[invalid.format]
ld1 = 1979-123-12
`;
  expect(() => Bun.TOML.parse(toml)).toThrow("Got an unexpected numeric digit while parsing datetime.");
});

it("handles-invalid-date: missing a year digit", () => {
  const Bun = globalThis.Bun;
  const toml = `
[invalid.format]
ld1 = 199-11-12
`;
  expect(() => Bun.TOML.parse(toml)).toThrow();
});

it("handles-invalid-date: too many year digits", () => {
  const Bun = globalThis.Bun;
  const toml = `
[invalid.format]
ld1 = 19999-11-12
`;
  expect(() => Bun.TOML.parse(toml)).toThrow();
});

it("handles-invalid-date: malformed fraction", () => {
  const Bun = globalThis.Bun;
  const toml = `
[invalid.time]
lt1 = 1963-12-31 14:32:00.999k
`;
  expect(() => Bun.TOML.parse(toml)).toThrow("Expected t_equal but found end of file");
});

it("handles-invalid-date: missing datetime separator", () => {
  const Bun = globalThis.Bun;
  const toml = `
[invalid.time]
lt1 = 1963-12-3114:32:00.999
`;
  expect(() => Bun.TOML.parse(toml)).toThrow("Got an unexpected numeric digit while parsing datetime.");
});

it("handles-invalid-date: unsupported datetime separator", () => {
  const Bun = globalThis.Bun;
  const toml = `
[invalid.time]
lt1 = 1963-12-31j14:32:00.999
`;
  // An invalid separator happens to appear at a place where date parsing COULD be complete, so the error is picked up
  // downstream.
  expect(() => Bun.TOML.parse(toml)).toThrow("Failed to parse toml");
});

it("handles-invalid-date: duplicate offset specifiers", () => {
  const Bun = globalThis.Bun;
  const toml = `
[invalid.time]
lt1 = 1963-12-31T14:32:00.999-12:00Z
`;
  expect(() => Bun.TOML.parse(toml)).toThrow("Cannot specify both 'Z' (no offset) and a specific offset");
});

it("handles-invalid-date: month too large", () => {
  const Bun = globalThis.Bun;
  const toml = `
[invalid.month]
ld1 = 1979-15-27
`;
  expect(() => Bun.TOML.parse(toml)).toThrow("Invalid Date: 1979-15-27");
});

it("handles-invalid-date: month too small", () => {
  const Bun = globalThis.Bun;
  const toml = `
[invalid.month]
ld2 = 1979-00-01
`;
  expect(() => Bun.TOML.parse(toml)).toThrow("Invalid Date: 1979-00-01");
});

it("handles-invalid-date: 0 isn't a valid day", () => {
  const Bun = globalThis.Bun;
  const toml = `
[invalid.day]
ld3 = 2025-01-00
`;
  expect(() => Bun.TOML.parse(toml)).toThrow("Invalid Date: 2025-01-00");
});

it("handles-invalid-date: not a leap year", () => {
  const Bun = globalThis.Bun;
  const toml = `
[not.a.leap.year]
ld3 = 2025-02-29
`;
  expect(() => Bun.TOML.parse(toml)).toThrow("Invalid Date: 2025-02-29");
});

it("handles-invalid-date: too many days in month", () => {
  const Bun = globalThis.Bun;
  const toml = `
[invalid.day]
ld4 = 1979-04-31
`;
  expect(() => Bun.TOML.parse(toml)).toThrow("Invalid Date: 1979-04-31");
});
