import { describe, expect, test } from "bun:test";

describe("Bun.Cookie expires validation", () => {
  describe("Date objects", () => {
    test("accepts valid Date in future", () => {
      const futureDate = new Date(Date.now() + 86400000); // 1 day in future
      const cookie = new Bun.Cookie("name", "value", { expires: futureDate });
      expect(cookie.expires).toBeDefined();
      expect(typeof cookie.expires).toBe("object");
      // Check it's the expected timestamp in seconds
      expect(cookie.expires).toEqual(futureDate);
    });

    test("accepts valid Date in past", () => {
      const pastDate = new Date(Date.now() - 86400000); // 1 day in past
      const cookie = new Bun.Cookie("name", "value", { expires: pastDate });
      expect(cookie.expires).toBeDefined();
      expect(typeof cookie.expires).toBe("object");
      // Check it's the expected timestamp in seconds
      expect(cookie.expires).toEqual(pastDate);
    });

    test("throws for invalid Date (NaN)", () => {
      const invalidDate = new Date("invalid date"); // Creates a Date with NaN value
      expect(() => {
        new Bun.Cookie("name", "value", { expires: invalidDate });
      }).toThrow("expires must be a valid Date (or Number)");
    });
  });

  describe("Number values", () => {
    test("accepts positive integer", () => {
      const timestamp = Math.floor(Date.now() / 1000) + 86400; // 1 day in future (seconds)
      const cookie = new Bun.Cookie("name", "value", { expires: timestamp });
      expect(cookie.expires).toEqual(new Date(timestamp * 1000));
    });

    test("accepts zero", () => {
      const cookie = new Bun.Cookie("name", "value", { expires: 0 });
      expect(cookie.expires).toEqual(new Date(0));
    });

    test("throws for NaN", () => {
      expect(() => {
        new Bun.Cookie("name", "value", { expires: NaN });
      }).toThrow("expires must be a valid Number");
    });

    test("throws for Infinity", () => {
      expect(() => {
        new Bun.Cookie("name", "value", { expires: Infinity });
      }).toThrow("expires must be a valid Number");
    });

    test("throws for negative Infinity", () => {
      expect(() => {
        new Bun.Cookie("name", "value", { expires: -Infinity });
      }).toThrow("expires must be a valid Number");
    });
  });

  describe("Special values", () => {
    test("handles undefined", () => {
      const cookie = new Bun.Cookie("name", "value", { expires: undefined });
      expect(cookie.expires).toBeUndefined();
    });

    test("handles null", () => {
      const cookie = new Bun.Cookie("name", "value", { expires: null });
      expect(cookie.expires).toBeUndefined();
    });

    test("throws for non-date objects", () => {
      expect(() => {
        new Bun.Cookie("name", "value", { expires: { time: 123456 } });
      }).toThrow();
    });

    test("invalid strings throw", () => {
      expect(() => {
        new Bun.Cookie("name", "value", { expires: "tomorrow" });
      }).toThrowErrorMatchingInlineSnapshot(`"Invalid cookie expiration date"`);
    });

    test("throws for arrays", () => {
      expect(() => {
        new Bun.Cookie("name", "value", { expires: [2023, 11, 25] });
      }).toThrowErrorMatchingInlineSnapshot(
        `"The argument 'expires' Invalid expires value. Must be a Date or a number. Received [ 2023, 11, 25 ]"`,
      );
    });

    test("throws for booleans", () => {
      expect(() => {
        new Bun.Cookie("name", "value", { expires: true });
      }).toThrowErrorMatchingInlineSnapshot(
        `"The argument 'expires' Invalid expires value. Must be a Date or a number. Received true"`,
      );
    });
  });

  describe("Constructors and methods", () => {
    test("validates expires in cookie options object", () => {
      expect(() => {
        new Bun.Cookie({
          name: "test",
          value: "value",
          expires: NaN,
        });
      }).toThrow("expires must be a valid Number");
    });

    test("validates expires in Cookie.from", () => {
      const invalidDate = new Date("invalid date");
      expect(() => {
        Bun.Cookie.from("name", "value", { expires: invalidDate });
      }).toThrow("expires must be a valid Date (or Number)");
    });

    test("handles valid expires in Cookie.from", () => {
      const futureTimestamp = Math.floor(Date.now() / 1000) + 86400;
      const cookie = Bun.Cookie.from("name", "value", { expires: futureTimestamp });
      expect(cookie.expires).toEqual(new Date(futureTimestamp * 1000));
    });
  });

  describe("Date arithmetic edge cases", () => {
    test("handles Date at epoch", () => {
      const epochDate = new Date(0);
      const cookie = new Bun.Cookie("name", "value", { expires: epochDate });
      expect(cookie.expires).toEqual(epochDate);
    });

    test("handles Date at max timestamp", () => {
      // Max date that can be represented
      const maxDate = new Date(8640000000000000);
      const cookie = new Bun.Cookie("name", "value", { expires: maxDate });
      expect(cookie.expires).toEqual(maxDate);
    });

    test("handles odd Date objects", () => {
      // Date before epoch
      const beforeEpoch = new Date(-1000);
      // Should be converted to seconds but still positive because getTime() is still positive
      const cookie = new Bun.Cookie("name", "value", { expires: beforeEpoch });
      expect(cookie.expires).toEqual(beforeEpoch);
    });
  });

  describe("Conversion edge cases", () => {
    test("correctly divides milliseconds to seconds", () => {
      // Create a date with a known millisecond timestamp
      const date = new Date(1234567890123);
      const cookie = new Bun.Cookie("name", "value", { expires: date });
      // Should be converted to seconds (÷ 1000)
      expect(cookie.expires).toEqual(date);
    });

    test("handles fractional second timestamps", () => {
      // Using a fractional timestamp in seconds
      const timestamp = 1234567890.5;
      const cookie = new Bun.Cookie("name", "value", { expires: timestamp });
      expect(cookie.expires).toEqual(new Date(timestamp * 1000));
    });
  });
});
