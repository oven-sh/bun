// Copyright 2013 the V8 project authors. All rights reserved.
// Copyright (C) 2005, 2006, 2007, 2008, 2009 Apple Inc. All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions
// are met:
// 1.  Redistributions of source code must retain the above copyright
//     notice, this list of conditions and the following disclaimer.
// 2.  Redistributions in binary form must reproduce the above copyright
//     notice, this list of conditions and the following disclaimer in the
//     documentation and/or other materials provided with the distribution.
//
// THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS'' AND ANY
// EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
// WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
// DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS BE LIABLE FOR ANY
// DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
// (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
// LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
// ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
// (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
// SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

const todoOnWindows = process.platform === "win32" ? test.todo : test;

if (typeof Bun !== "undefined") {
  const aggressiveGC = Bun.unsafe.gcAggressionLevel();
  beforeAll(() => {
    Bun.unsafe.gcAggressionLevel(0);
  });

  afterAll(() => {
    Bun.unsafe.gcAggressionLevel(aggressiveGC);
  });
}

describe("v8 date parser", () => {
  // https://github.com/v8/v8/blob/c45b7804109ece574f71fd45417b4ad498a99e6f/test/webkit/date-parse-comments-test.js#L27
  test("test/webkit/date-parse-comments-test.js", () => {
    var timeZoneOffset = Date.parse(" Dec 25 1995 1:30 ") - Date.parse(" Dec 25 1995 1:30 GMT ");
    function testDateParse(date, numericResult) {
      if (numericResult === "NaN") {
        expect(Date.parse(date)).toBeNaN();
        expect(Date.parse(date.toUpperCase())).toBeNaN();
        expect(Date.parse(date.toLowerCase())).toBeNaN();
        expect(new Date(date).getMilliseconds()).toBeNaN();
      } else {
        expect(Date.parse(date)).toBe(numericResult);
        expect(Date.parse(date.toUpperCase())).toBe(numericResult);
        expect(Date.parse(date.toLowerCase())).toBe(numericResult);
        expect(new Date(date).toString()).toBe(new Date(numericResult).toString());
      }
    }

    testDateParse("Dec ((27) 26 (24)) 25 1995 1:30 PM UTC", 819898200000);
    testDateParse("Dec 25 1995 1:30 PM UTC (", 819898200000);
    testDateParse("Dec 25 1995 1:30 (PM)) UTC", "NaN");
    testDateParse("(Nov) Dec (24) 25 (26) 1995 (1996) GMT (EST)", 819849600000);
    testDateParse("(Nov) Dec (24) 25 (26) 1995 (1996)", 819849600000 + timeZoneOffset);

    testDateParse("(Nov) Dec (24) 25 (26) 1995 (1996) 1:30 (1:40) GMT (EST)", 819855000000);
    testDateParse("(Nov) Dec (24) 25 (26) 1995 (1996) 1:30 (1:40)", 819855000000 + timeZoneOffset);
    testDateParse("(Nov) Dec (24) 25 (26) 1995 (1996) 1:30 ", 819855000000 + timeZoneOffset);
    testDateParse("(Nov) Dec (24) 25 (26) 1995 (1996) 1:30 AM (1:40 PM) GMT (EST)", 819855000000);
    testDateParse("(Nov) Dec (24) 25 (26) 1995 (1996) 1:30 AM (1:40 PM)", 819855000000 + timeZoneOffset);
    testDateParse("Dec 25 1995 1:30( )AM (PM)", "NaN");
    testDateParse("Dec 25 1995 1:30 AM (PM)", 819855000000 + timeZoneOffset);

    testDateParse("(Nov) Dec (24) 25 (26) 1995 (1996) 13:30 (13:40) GMT (PST)", 819898200000);
    testDateParse("(Nov) Dec (24) 25 (26) 1995 (1996) 13:30 (13:40)", 819898200000 + timeZoneOffset);
    testDateParse("(Nov) Dec (24) 25 (26) 13:30 (13:40) 1995 (1996)", 819898200000 + timeZoneOffset);
    testDateParse("(Nov) Dec (24) 25 (26) 1995 (1996) 13:30 (13:40) ", 819898200000 + timeZoneOffset);
    testDateParse("(Nov) Dec (24) 25 (26) 1995 (1996) 1:30 (1:40) PM (AM) GMT (PST)", 819898200000);
    testDateParse("(Nov) Dec (24) 25 (26) 1995 (1996) 1:30 (1:40) PM (AM)", 819898200000 + timeZoneOffset);
    testDateParse("Dec 25 1995 1:30(AM)PM", "NaN");
    testDateParse("Dec 25 1995 1:30 (AM)PM ", 819898200000 + timeZoneOffset);

    testDateParse("Dec 25 1995 (PDT)UTC(PST)", 819849600000);
    testDateParse("Dec 25 1995 (PDT)UT(PST)", 819849600000);
    testDateParse("Dec 25 1995 (UTC)PST(GMT)", 819878400000);
    testDateParse("Dec 25 1995 (UTC)PDT(GMT)", 819874800000);

    testDateParse("Dec 25 1995 1:30 (PDT)UTC(PST)", 819855000000);
    testDateParse("Dec 25 1995 1:30 (PDT)UT(PST)", 819855000000);
    testDateParse("Dec 25 1995 1:30 (UTC)PST(GMT)", 819883800000);
    testDateParse("Dec 25 1995 1:30 (UTC)PDT(GMT)", 819880200000);

    testDateParse("Dec 25 1995 1:30 (AM) PM (PST) UTC", 819898200000);
    testDateParse("Dec 25 1995 1:30 PM (AM) (PST) UT", 819898200000);
    testDateParse("Dec 25 1995 1:30 PM (AM) (UTC) PST", 819927000000);
    testDateParse("Dec 25 1995 1:30 (AM) PM PDT (UTC)", 819923400000);

    testDateParse("Dec 25 1995 XXX (GMT)", "NaN");
    testDateParse("Dec 25 1995 1:30 XXX (GMT)", "NaN");

    testDateParse("Dec 25 1995 1:30 U(TC)", "NaN");
    testDateParse("Dec 25 1995 1:30 V(UTC)", "NaN");
    testDateParse("Dec 25 1995 1:30 (UTC)W", "NaN");
    testDateParse("Dec 25 1995 1:30 (GMT)X", "NaN");

    testDateParse("Dec 25 1995 0:30 (PM) GMT", 819851400000);
    testDateParse("Dec 25 1995 (1)0:30 AM GMT", 819851400000);
    testDateParse("Dec 25 1995 (1)0:30 PM GMT", 819894600000);

    testDateParse("Anf(Dec) 25 1995 GMT", "NaN");

    testDateParse("(Sat) Wed (Nov) Dec (Nov) 25 1995 1:30 GMT", 819855000000);
    testDateParse("Wed (comment 1) (comment 2) Dec 25 1995 1:30 GMT", 819855000000);
    testDateParse("Wed(comment 1) (comment 2) Dec 25 1995 1:30 GMT", 819855000000);
    testDateParse("We(comment 1) (comment 2) Dec 25 1995 1:30 GMT", 819855000000);
  });

  // https://github.com/v8/v8/blob/c45b7804109ece574f71fd45417b4ad498a99e6f/test/mjsunit/regress/regress-4640.js#L6
  test("test/mjsunit/regress-4640.js", () => {
    expect(new Date("275760-10-14").getMilliseconds()).toBeNaN();
    expect(new Date("275760-09-23").getMilliseconds()).toBeNaN();
    expect(new Date("+275760-09-24").getMilliseconds()).toBeNaN();
    expect(new Date("+275760-10-13").getMilliseconds()).toBeNaN();

    // The following cases used to throw "illegal access"
    expect(new Date("275760-09-24").getMilliseconds()).toBeNaN();
    expect(new Date("275760-10-13").getMilliseconds()).toBeNaN();
    expect(new Date("+275760-10-13 ").getMilliseconds()).toBeNaN();

    // However, dates within the range or valid
    expect(new Date("100000-10-13").getMilliseconds()).not.toBeNaN();
    expect(new Date("+100000-10-13").getMilliseconds()).not.toBeNaN();
    expect(new Date("+100000-10-13 ").getMilliseconds()).not.toBeNaN();
  });

  // https://github.com/v8/v8/blob/c45b7804109ece574f71fd45417b4ad498a99e6f/test/mjsunit/date-parse.js#L34
  test("test/mjsunit/date-parse.js", () => {
    // Test that we can parse dates in all the different formats that we
    // have to support.
    //
    // These formats are all supported by KJS but a lot of them are not
    // supported by Spidermonkey.

    function testDateParse(string) {
      var d = Date.parse(string);
      expect(d).toBe(946713600000);
    }

    // For local time we just test that parsing returns non-NaN positive
    // number of milliseconds to make it timezone independent.
    function testDateParseLocalTime(string) {
      var d = Date.parse("parse-local-time:" + string);
      expect(d).not.toBeNaN();
      expect(d).toBeGreaterThan(0);
    }

    function testDateParseMisc(array) {
      expect(array.length).toBe(2);
      var string = array[0];
      var expected = array[1];
      var d = Date.parse(string);
      expect(expected).toBe(d);
    }

    //
    // Test all the formats in UT timezone.
    //
    var testCasesUT = [
      "Sat, 01-Jan-2000 08:00:00 UT",
      "Sat, 01 Jan 2000 08:00:00 UT",
      "Jan 01 2000 08:00:00 UT",
      "Jan 01 08:00:00 UT 2000",
      "Saturday, 01-Jan-00 08:00:00 UT",
      "01 Jan 00 08:00 +0000",
      // Ignore weekdays.
      "Mon, 01 Jan 2000 08:00:00 UT",
      "Tue, 01 Jan 2000 08:00:00 UT",
      // Ignore prefix that is not part of a date.
      "[Saturday] Jan 01 08:00:00 UT 2000",
      "Ignore all of this stuff because it is annoying 01 Jan 2000 08:00:00 UT",
      "[Saturday] Jan 01 2000 08:00:00 UT",
      "All of this stuff is really annnoying, so it will be ignored Jan 01 2000 08:00:00 UT",
      // If the three first letters of the month is a
      // month name we are happy - ignore the rest.
      "Sat, 01-Janisamonth-2000 08:00:00 UT",
      "Sat, 01 Janisamonth 2000 08:00:00 UT",
      "Janisamonth 01 2000 08:00:00 UT",
      "Janisamonth 01 08:00:00 UT 2000",
      "Saturday, 01-Janisamonth-00 08:00:00 UT",
      "01 Janisamonth 00 08:00 +0000",
      // Allow missing space between month and day.
      "Janisamonthandtherestisignored01 2000 08:00:00 UT",
      "Jan01 2000 08:00:00 UT",
      // Allow year/month/day format.
      "Sat, 2000/01/01 08:00:00 UT",
      // Allow month/day/year format.
      "Sat, 01/01/2000 08:00:00 UT",
      // Allow month/day year format.
      "Sat, 01/01 2000 08:00:00 UT",
      // Allow comma instead of space after day, month and year.
      "Sat, 01,Jan,2000,08:00:00 UT",
      // Seconds are optional.
      "Sat, 01-Jan-2000 08:00 UT",
      "Sat, 01 Jan 2000 08:00 UT",
      "Jan 01 2000 08:00 UT",
      "Jan 01 08:00 UT 2000",
      "Saturday, 01-Jan-00 08:00 UT",
      "01 Jan 00 08:00 +0000",
      // Allow AM/PM after the time.
      "Sat, 01-Jan-2000 08:00 AM UT",
      "Sat, 01 Jan 2000 08:00 AM UT",
      "Jan 01 2000 08:00 AM UT",
      "Jan 01 08:00 AM UT 2000",
      "Saturday, 01-Jan-00 08:00 AM UT",
      "01 Jan 00 08:00 AM +0000",
      // White space and stuff in parenthesis is
      // apparently allowed in most places where white
      // space is allowed.
      "   Sat,   01-Jan-2000   08:00:00   UT  ",
      "  Sat,   01   Jan   2000   08:00:00   UT  ",
      "  Saturday,   01-Jan-00   08:00:00   UT  ",
      "  01    Jan   00    08:00   +0000   ",
      " ()(Sat, 01-Jan-2000)  Sat,   01-Jan-2000   08:00:00   UT  ",
      "  Sat()(Sat, 01-Jan-2000)01   Jan   2000   08:00:00   UT  ",
      "  Sat,(02)01   Jan   2000   08:00:00   UT  ",
      "  Sat,  01(02)Jan   2000   08:00:00   UT  ",
      "  Sat,  01  Jan  2000 (2001)08:00:00   UT  ",
      "  Sat,  01  Jan  2000 (01)08:00:00   UT  ",
      "  Sat,  01  Jan  2000 (01:00:00)08:00:00   UT  ",
      "  Sat,  01  Jan  2000  08:00:00 (CDT)UT  ",
      "  Sat,  01  Jan  2000  08:00:00  UT((((CDT))))",
      "  Saturday,   01-Jan-00 ()(((asfd)))(Sat, 01-Jan-2000)08:00:00   UT  ",
      "  01    Jan   00    08:00 ()(((asdf)))(Sat, 01-Jan-2000)+0000   ",
      "  01    Jan   00    08:00   +0000()((asfd)(Sat, 01-Jan-2000)) ",
    ];

    //
    // Test that we do the right correction for different time zones.
    // I'll assume that we can handle the same formats as for UT and only
    // test a few formats for each of the timezones.
    //

    // GMT = UT
    var testCasesGMT = [
      "Sat, 01-Jan-2000 08:00:00 GMT",
      "Sat, 01-Jan-2000 08:00:00 GMT+0",
      "Sat, 01-Jan-2000 08:00:00 GMT+00",
      "Sat, 01-Jan-2000 08:00:00 GMT+000",
      "Sat, 01-Jan-2000 08:00:00 GMT+0000",
      "Sat, 01-Jan-2000 08:00:00 GMT+00:00", // Interestingly, KJS cannot handle this.
      "Sat, 01 Jan 2000 08:00:00 GMT",
      "Saturday, 01-Jan-00 08:00:00 GMT",
      "01 Jan 00 08:00 -0000",
      "01 Jan 00 08:00 +0000",
    ];

    // EST = UT minus 5 hours.
    var testCasesEST = [
      "Sat, 01-Jan-2000 03:00:00 UTC-0500",
      "Sat, 01-Jan-2000 03:00:00 UTC-05:00", // Interestingly, KJS cannot handle this.
      "Sat, 01-Jan-2000 03:00:00 EST",
      "Sat, 01 Jan 2000 03:00:00 EST",
      "Saturday, 01-Jan-00 03:00:00 EST",
      "01 Jan 00 03:00 -0500",
    ];

    // EDT = UT minus 4 hours.
    var testCasesEDT = [
      "Sat, 01-Jan-2000 04:00:00 EDT",
      "Sat, 01 Jan 2000 04:00:00 EDT",
      "Saturday, 01-Jan-00 04:00:00 EDT",
      "01 Jan 00 04:00 -0400",
    ];

    // CST = UT minus 6 hours.
    var testCasesCST = [
      "Sat, 01-Jan-2000 02:00:00 CST",
      "Sat, 01 Jan 2000 02:00:00 CST",
      "Saturday, 01-Jan-00 02:00:00 CST",
      "01 Jan 00 02:00 -0600",
    ];

    // CDT = UT minus 5 hours.
    var testCasesCDT = [
      "Sat, 01-Jan-2000 03:00:00 CDT",
      "Sat, 01 Jan 2000 03:00:00 CDT",
      "Saturday, 01-Jan-00 03:00:00 CDT",
      "01 Jan 00 03:00 -0500",
    ];

    // MST = UT minus 7 hours.
    var testCasesMST = [
      "Sat, 01-Jan-2000 01:00:00 MST",
      "Sat, 01 Jan 2000 01:00:00 MST",
      "Saturday, 01-Jan-00 01:00:00 MST",
      "01 Jan 00 01:00 -0700",
    ];

    // MDT = UT minus 6 hours.
    var testCasesMDT = [
      "Sat, 01-Jan-2000 02:00:00 MDT",
      "Sat, 01 Jan 2000 02:00:00 MDT",
      "Saturday, 01-Jan-00 02:00:00 MDT",
      "01 Jan 00 02:00 -0600",
    ];

    // PST = UT minus 8 hours.
    var testCasesPST = [
      "Sat, 01-Jan-2000 00:00:00 PST",
      "Sat, 01 Jan 2000 00:00:00 PST",
      "Saturday, 01-Jan-00 00:00:00 PST",
      "01 Jan 00 00:00 -0800",
      // Allow missing time.
      "Sat, 01-Jan-2000 PST",
    ];

    // PDT = UT minus 7 hours.
    var testCasesPDT = [
      "Sat, 01-Jan-2000 01:00:00 PDT",
      "Sat, 01 Jan 2000 01:00:00 PDT",
      "Saturday, 01-Jan-00 01:00:00 PDT",
      "01 Jan 00 01:00 -0700",
    ];

    // Local time cases.
    var testCasesLocalTime = [
      // Allow timezone omission.
      "Sat, 01-Jan-2000 08:00:00",
      "Sat, 01 Jan 2000 08:00:00",
      "Jan 01 2000 08:00:00",
      "Jan 01 08:00:00 2000",
      "Saturday, 01-Jan-00 08:00:00",
      "01 Jan 00 08:00",
    ];

    // Misc. test cases that result in a different time value.
    var testCasesMisc = [
      // Special handling for years in the [0, 100) range.
      ["Sat, 01 Jan 0 08:00:00 UT", 946713600000], // year 2000
      ["Sat, 01 Jan 49 08:00:00 UT", 2493100800000], // year 2049
      ["Sat, 01 Jan 50 08:00:00 UT", -631123200000], // year 1950
      ["Sat, 01 Jan 99 08:00:00 UT", 915177600000], // year 1999
      ["Sat, 01 Jan 100 08:00:00 UT", -59011430400000], // year 100
      // Test PM after time.
      ["Sat, 01-Jan-2000 08:00 PM UT", 946756800000],
      ["Sat, 01 Jan 2000 08:00 PM UT", 946756800000],
      ["Jan 01 2000 08:00 PM UT", 946756800000],
      ["Jan 01 08:00 PM UT 2000", 946756800000],
      ["Saturday, 01-Jan-00 08:00 PM UT", 946756800000],
      ["01 Jan 00 08:00 PM +0000", 946756800000],
    ];

    // Test different version of the ES5 date time string format.
    var testCasesES5Misc = [
      ["2000-01-01T08:00:00.000Z", 946713600000],
      ["2000-01-01T08:00:00Z", 946713600000],
      ["2000-01-01T08:00Z", 946713600000],
      ["2000-01T08:00:00.000Z", 946713600000],
      ["2000T08:00:00.000Z", 946713600000],
      ["2000T08:00Z", 946713600000],
      ["2000-01T00:00:00.000-08:00", 946713600000],
      ["2000-01T08:00:00.001Z", 946713600001],
      ["2000-01T08:00:00.099Z", 946713600099],
      ["2000-01T08:00:00.999Z", 946713600999],
      ["2000-01T00:00:00.001-08:00", 946713600001],
      ["2000-01-01T24:00Z", 946771200000],
      ["2000-01-01T24:00:00Z", 946771200000],
      ["2000-01-01T24:00:00.000Z", 946771200000],
      ["2000-01-01T24:00:00.000Z", 946771200000],
    ];

    var testCasesES5MiscNegative = [
      "2000-01-01TZ",
      "2000-01-01T60Z",
      "2000-01-01T60:60Z",
      "2000-01-0108:00Z",
      "2000-01-01T08Z",
      "2000-01-01T24:01",
      "2000-01-01T24:00:01",
      "2000-01-01T24:00:00.001",
      "2000-01-01T24:00:00.999Z",
    ];

    // TODO(littledan): This is an hack that could break in historically
    // changing timezones that happened on this day, but allows us to
    // check the date value for local times.
    var localOffset = new Date("2000-01-01").getTimezoneOffset() * 1000 * 60;

    // Sanity check which is even more of a hack: in the timezones where
    // these tests are likely to be run, the offset is nonzero because
    // dates which don't include Z are in the local timezone.
    if (
      this.Intl &&
      ["America/Los_Angeles", "Europe/Berlin", "Europe/Madrid"].indexOf(
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      ) != -1
    ) {
      expect(localOffset).not.toBe(0);
    }

    var testCasesES2016TZ = [
      // If the timezone is absent and time is present, use local time
      ["2000-01-02T00:00", 946771200000 + localOffset],
      ["2000-01-02T00:00:00", 946771200000 + localOffset],
      ["2000-01-02T00:00:00.000", 946771200000 + localOffset],
      // If timezone is absent and time is absent, use UTC
      ["2000-01-02", 946771200000],
      ["2000-01-02", 946771200000],
      ["2000-01-02", 946771200000],
    ];

    // Run all the tests.
    testCasesUT.forEach(testDateParse);
    testCasesGMT.forEach(testDateParse);
    testCasesEST.forEach(testDateParse);
    testCasesEDT.forEach(testDateParse);
    testCasesCST.forEach(testDateParse);
    testCasesCDT.forEach(testDateParse);
    testCasesMST.forEach(testDateParse);
    testCasesMDT.forEach(testDateParse);
    testCasesPST.forEach(testDateParse);
    testCasesPDT.forEach(testDateParse);
    testCasesLocalTime.forEach(testDateParseLocalTime);
    testCasesMisc.forEach(testDateParseMisc);

    // ES5 date time string format compliance.
    testCasesES5Misc.forEach(testDateParseMisc);
    testCasesES5MiscNegative.forEach(function (s) {
      expect(new Date(s).toString()).toBe("Invalid Date");
    });

    testCasesES2016TZ.forEach(testDateParseMisc);

    // Test that we can parse our own date format.
    // (Dates from 1970 to ~2070 with 150h steps.)
    for (var i = 0; i < 24 * 365 * 100; i += 150) {
      var ms = i * (3600 * 1000);
      var s = new Date(ms).toString();
      expect(Date.parse(s)).toBe(ms);
    }

    // Negative tests.
    var testCasesNegative = [
      "May 25 2008 1:30 (PM)) UTC", // Bad unmatched ')' after number.
      "May 25 2008 1:30( )AM (PM)", //
      "a1", // Issue 126448, 53209.
      "nasfdjklsfjoaifg1",
      "x_2",
      "May 25 2008 AAA (GMT)",
    ]; // Unknown word after number.

    testCasesNegative.forEach(function (s) {
      expect(new Date(s).getMilliseconds()).toBeNaN();
    });
  });

  // https://github.com/v8/v8/blob/c45b7804109ece574f71fd45417b4ad498a99e6f/test/intl/regress-1451943.js#L5
  // TODO: fix this on windows, see https://github.com/v8/v8/commit/8cf4ef33389eb4f47b37ffede388dbdcce16e1ee#diff-9adde1d14b1ec0068b077d06b5dadf0aae9717f63c809263604f9853d27d11db
  todoOnWindows("test/intl/regress-1451943.js", () => {
    let beforeOct1582GregorianTransition = new Date("1582-01-01T00:00Z");
    let afterOct1582GregorianTransition = new Date("1583-01-01T00:00Z");

    expect(beforeOct1582GregorianTransition.toLocaleDateString("en-US", { timeZone: "UTC", calendar: "gregory" })).toBe(
      "1/1/1582",
    );
    expect(beforeOct1582GregorianTransition.toLocaleDateString("en-US", { timeZone: "UTC", calendar: "iso8601" })).toBe(
      "1/1/1582",
    );
    expect(afterOct1582GregorianTransition.toLocaleDateString("en-US", { timeZone: "UTC", calendar: "iso8601" })).toBe(
      "1/1/1583",
    );
  });

  test("random invalid dates in JSC", () => {
    var input = "Sep 09 2022 03:53:45Z";
    expect(Date.parse(input)).toBe(1662695625000);

    input = "2020-09-21 15:19:06 +00:00";
    expect(Date.parse(input)).toBe(1600701546000);
  });
});
