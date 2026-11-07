import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

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

    test("accepts Number at max Date boundary (seconds)", () => {
      const seconds = 8640000000000;
      const cookie = new Bun.Cookie("name", "value", { expires: seconds });
      expect(cookie.expires).toEqual(new Date(seconds * 1000));
    });

    test("accepts Number at min Date boundary (seconds)", () => {
      const seconds = -8640000000000;
      const cookie = new Bun.Cookie("name", "value", { expires: seconds });
      expect(cookie.expires).toEqual(new Date(seconds * 1000));
    });

    test.each([
      1e16,
      -1e16,
      8640000000001,
      -8640000000001,
      Number.MAX_VALUE,
      -Number.MAX_VALUE,
      Number.MAX_SAFE_INTEGER,
    ])("throws RangeError for out-of-range Number %p", value => {
      expect(() => {
        new Bun.Cookie("name", "value", { expires: value });
      }).toThrow(RangeError);
      expect(() => {
        new Bun.Cookie("name", "value", { expires: value });
      }).toThrow("expires must be a Number within the range of a valid Date");
    });

    test("throws RangeError for out-of-range Number via setter", () => {
      const cookie = new Bun.Cookie("name", "value");
      expect(() => {
        cookie.expires = 1e16 as any;
      }).toThrow(RangeError);
    });

    test("throws RangeError for out-of-range Number via Cookie.from", () => {
      expect(() => {
        Bun.Cookie.from("name", "value", { expires: 1e16 });
      }).toThrow(RangeError);
    });

    test("throws RangeError for out-of-range Number via CookieMap.set", () => {
      const map = new Bun.CookieMap();
      expect(() => {
        map.set("name", "value", { expires: 1e16 });
      }).toThrow(RangeError);
      expect(() => {
        map.set({ name: "name", value: "value", expires: 1e16 });
      }).toThrow(RangeError);
      expect(map.toSetCookieHeaders()).toEqual([]);
    });
  });

  describe("Special values", () => {
    test("handles undefined", () => {
      const cookie = new Bun.Cookie("name", "value", { expires: undefined });
      expect(cookie.expires).toBeUndefined();
    });

    test("handles null", () => {
      const cookie = new Bun.Cookie("name", "value", { expires: null as any });
      expect(cookie.expires).toBeUndefined();
    });

    test("throws for non-date objects", () => {
      expect(() => {
        new Bun.Cookie("name", "value", { expires: { time: 123456 } as any });
      }).toThrow();
    });

    test("invalid strings throw", () => {
      expect(() => {
        new Bun.Cookie("name", "value", { expires: "tomorrow" });
      }).toThrowErrorMatchingInlineSnapshot(`"Invalid cookie expiration date"`);
    });

    describe("accepts a string that parses to the epoch (0 ms)", () => {
      // The date that a handler writes to delete a cookie. `new Date(0).toUTCString()` returns it.
      const epoch = "Thu, 01 Jan 1970 00:00:00 GMT";
      const serialized = `sid=; Path=/; Expires=${epoch}; SameSite=Lax`;

      test("new Bun.Cookie(name, value, options)", () => {
        const cookie = new Bun.Cookie("sid", "", { expires: epoch });
        expect(cookie.expires).toEqual(new Date(0));
        expect(cookie.isExpired()).toBe(true);
        expect(cookie.toString()).toBe(serialized);
      });

      test("new Bun.Cookie(options)", () => {
        expect(new Bun.Cookie({ name: "sid", value: "", expires: epoch }).toString()).toBe(serialized);
      });

      test("Bun.Cookie.from", () => {
        expect(Bun.Cookie.from("sid", "", { expires: epoch }).toString()).toBe(serialized);
      });

      test("expires setter", () => {
        const cookie = new Bun.Cookie("sid", "");
        cookie.expires = epoch as any;
        expect(cookie.toString()).toBe(serialized);
      });

      test("CookieMap.set(name, value, options)", () => {
        const map = new Bun.CookieMap();
        map.set("sid", "", { expires: epoch });
        expect(map.toSetCookieHeaders()).toEqual([serialized]);
      });

      test("CookieMap.set(options)", () => {
        const map = new Bun.CookieMap();
        map.set({ name: "sid", value: "", expires: epoch });
        expect(map.toSetCookieHeaders()).toEqual([serialized]);
      });
    });

    describe("a date string outside the Date range", () => {
      // WTF::parseDate returns NaN for a date outside ±8.64e15 ms, but it applies the UTC offset after that check.
      // The last two dates are the largest and the smallest Date, and the offset moves each one hour out of range.
      const outOfRange = [
        "Wed, 01 Jan 300000000 00:00:00 GMT",
        "Sat, 13 Sep 275760 00:00:00 -0100",
        "Tue, 20 Apr -271821 00:00:00 +0100",
      ];

      test.each(outOfRange)("new Bun.Cookie throws for %s", expires => {
        expect(() => {
          new Bun.Cookie("name", "value", { expires });
        }).toThrow("Invalid cookie expiration date");
      });

      test.each(outOfRange)("Cookie.parse ignores Expires=%s", expires => {
        const cookie = Bun.Cookie.parse("a=b; Expires=" + expires);
        expect(cookie.expires).toBeUndefined();
        expect(cookie.toString()).toBe("a=b; Path=/; SameSite=Lax");
      });
    });

    test("throws for arrays", () => {
      expect(() => {
        new Bun.Cookie("name", "value", { expires: [2023, 11, 25] as any });
      }).toThrowErrorMatchingInlineSnapshot(
        `"The argument 'expires' Invalid expires value. Must be a Date or a number. Received [ 2023, 11, 25 ]"`,
      );
    });

    test("throws for booleans", () => {
      expect(() => {
        new Bun.Cookie("name", "value", { expires: true as any });
      }).toThrowErrorMatchingInlineSnapshot(
        `"The argument 'expires' Invalid expires value. Must be a Date or a number. Received true"`,
      );
    });
  });

  describe("ISO 8601 date strings", () => {
    // Every way to give a cookie an `expires` option. Each one returns the `Set-Cookie` text.
    const entryPoints: [string, (expires: string) => string][] = [
      ["new Bun.Cookie(name, value, options)", expires => new Bun.Cookie("a", "b", { expires }).toString()],
      ["new Bun.Cookie(options)", expires => new Bun.Cookie({ name: "a", value: "b", expires }).toString()],
      ["Bun.Cookie.from", expires => Bun.Cookie.from("a", "b", { expires }).toString()],
      [
        "expires setter",
        expires => {
          const cookie = new Bun.Cookie("a", "b");
          cookie.expires = expires as any;
          return cookie.toString();
        },
      ],
      [
        "CookieMap.set(name, value, options)",
        expires => {
          const map = new Bun.CookieMap();
          map.set("a", "b", { expires });
          return map.toSetCookieHeaders().join("\n");
        },
      ],
      [
        "CookieMap.set(options)",
        expires => {
          const map = new Bun.CookieMap();
          map.set({ name: "a", value: "b", expires });
          return map.toSetCookieHeaders().join("\n");
        },
      ],
    ];

    // A date string, and the time it means. JSON.stringify writes a Date in the first form.
    const readable: [string, number][] = [
      ["2030-01-01T00:00:00.000Z", Date.UTC(2030, 0, 1)],
      ["1970-01-01T00:00:00.000Z", 0],
      ["+058822-08-22T00:00:00.000Z", 1794096000000000],
      ["-271821-04-20T00:00:00.000Z", -8.64e15],
      ["2030-01-01", Date.UTC(2030, 0, 1)],
      ["2030-01-01T05:30:00+05:30", Date.UTC(2030, 0, 1)],
    ];

    // new Date(string) does not read these. Each one has the shape of an ISO 8601 date.
    const malformed = ["2030-13-45", "2030-00-00", "2030-01-01T25:00", "2030-01-01T", "2030-01-01T00:00:00.000Zjunk"];

    describe.each(entryPoints)("%s", (_, create) => {
      test.each(readable)("reads %p", (expires, time) => {
        expect(create(expires)).toBe(`a=b; Path=/; Expires=${new Date(time).toUTCString()}; SameSite=Lax`);
      });

      test.each(malformed)("refuses %p", expires => {
        expect(Date.parse(expires)).toBeNaN();
        expect(() => create(expires)).toThrow("Invalid cookie expiration date");
      });
    });

    test.each([
      new Date(Date.UTC(2030, 0, 1)),
      new Date(0),
      new Date(1709212455167),
      new Date(1794096000000000),
      new Date(8.64e15),
      new Date(-8.64e15),
    ])("a cookie that expires at %p survives JSON.parse(JSON.stringify(cookie))", expires => {
      const cookie = new Bun.Cookie("session", "abc123", { expires, domain: "example.com", secure: true });
      const copy = new Bun.Cookie(JSON.parse(JSON.stringify(cookie)));
      expect(copy.expires).toEqual(expires);
      expect(copy.toJSON()).toEqual(cookie.toJSON());
      expect(copy.toString()).toBe(cookie.toString());
    });

    test("req.cookies.set in a Bun.serve route reads an ISO 8601 string", async () => {
      await using server = Bun.serve({
        port: 0,
        routes: {
          "/": req => {
            req.cookies.set("a", "b", { expires: "2030-01-01T00:00:00.000Z" });
            return new Response("ok");
          },
        },
      });
      const response = await fetch(server.url);
      expect(response.headers.getSetCookie()).toEqual([
        "a=b; Path=/; Expires=Tue, 01 Jan 2030 00:00:00 GMT; SameSite=Lax",
      ]);
    });

    describe("the ends of the Date range", () => {
      test.each([
        ["+275760-09-13T00:00:00.000Z", 8.64e15],
        ["+275760-09-13", 8.64e15],
        ["+275760-09-13T05:30:00.000+05:30", 8.64e15],
        ["-271821-04-20T00:00:00.000Z", -8.64e15],
        ["-271821-04-20", -8.64e15],
      ])("reads %p", (expires, time) => {
        expect(new Bun.Cookie("a", "b", { expires }).expires).toEqual(new Date(time));
      });

      test.each([
        "+275760-09-13T00:00:00.001Z",
        "+275760-09-14",
        "+275760-09-13T00:00:00.000-00:01",
        "-271821-04-19T23:59:59.999Z",
        "-271821-04-19",
        "-271821-04-20T00:00:00.000+00:01",
      ])("refuses %p", expires => {
        expect(() => new Bun.Cookie("a", "b", { expires })).toThrow("Invalid cookie expiration date");
      });
    });

    test("a string in this shape means what new Date(string) means, in the time zone of the process", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
            process.env.TZ = "America/New_York";
            const text = time => (Number.isNaN(time) ? "Invalid Date" : new Date(time).toISOString());
            const read = expires => {
              try {
                return text(new Bun.Cookie("a", "b", { expires }).expires.getTime());
              } catch (error) {
                return error.message;
              }
            };
            for (const expires of ["2021-01-01", "2021-01-01T00:00:00Z", "2021-01-01T00:00:00", "2021-02-30"]) {
              console.log(expires, "|", read(expires), "|", read(expires) === text(Date.parse(expires)));
            }
            const refused = {
              "a newline after the date": "2021-01-01\\n",
              "a space before the time": "2021-01-01 00:00:00",
              "a no-break space before the time": "2021-01-01\\u00a000:00:00",
              "the year -000000": "-000000-01-01",
            };
            for (const [label, expires] of Object.entries(refused)) {
              console.log(label, "|", read(expires), "|", text(Date.parse(expires)));
            }
          `,
        ],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout.trim().split("\n")).toEqual([
        // The string | the time the cookie has | whether new Date(string) has the same time.
        "2021-01-01 | 2021-01-01T00:00:00.000Z | true",
        "2021-01-01T00:00:00Z | 2021-01-01T00:00:00.000Z | true",
        "2021-01-01T00:00:00 | 2021-01-01T05:00:00.000Z | true",
        "2021-02-30 | 2021-03-02T00:00:00.000Z | true",
        // A string outside the shape | what the cookie does | what new Date(string) reads.
        "a newline after the date | Invalid cookie expiration date | 2021-01-01T05:00:00.000Z",
        "a space before the time | Invalid cookie expiration date | 2021-01-01T05:00:00.000Z",
        "a no-break space before the time | Invalid cookie expiration date | 2021-01-01T05:00:00.000Z",
        "the year -000000 | Invalid cookie expiration date | 2001-01-01T05:00:00.000Z",
      ]);
      expect(exitCode).toBe(0);
    });

    test("a refused string leaves the cookie and the map as they were", () => {
      const cookie = new Bun.Cookie("a", "b", { expires: "2030-01-01" });
      for (const expires of ["2030", "2030-13-45"]) {
        expect(() => {
          cookie.expires = expires as any;
        }).toThrow("Invalid cookie expiration date");
        expect(cookie.expires).toEqual(new Date(Date.UTC(2030, 0, 1)));

        const map = new Bun.CookieMap();
        expect(() => map.set("a", "b", { expires })).toThrow("Invalid cookie expiration date");
        expect(map.size).toBe(0);
      }
    });

    // new Date(string) reads all of these but "" and "1893456000": "60" is the year 1960 and
    // "Max-Age=3600" is the year 3600. A number of seconds is a valid `expires`, so a string
    // that does not have the shape of an ISO 8601 date is not read that way.
    test.each([
      "",
      "0",
      "60",
      "2030",
      "3600",
      "1893456000",
      "2030-01",
      " 2030-01-01",
      "2030-01-01t00:00:00",
      "Max-Age=3600",
    ])("still refuses %p", expires => {
      expect(() => new Bun.Cookie("a", "b", { expires })).toThrow("Invalid cookie expiration date");
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

    test("getter returns a fresh Date when the cached one was mutated to NaN", () => {
      // The epoch, because a cast of NaN to int64_t gives 0 on aarch64, and that made the stale Date look current.
      const cookie = new Bun.Cookie("name", "value", { expires: 0 });
      const first = cookie.expires!;
      expect(first.getTime()).toBe(0);
      first.setTime(NaN);
      const second = cookie.expires!;
      expect(second.getTime()).toBe(0);
      expect(second).not.toBe(first);
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
