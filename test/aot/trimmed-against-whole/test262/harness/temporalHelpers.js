// Copyright (C) 2021 Igalia, S.L. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.
/*---
description: |
    This defines helper objects and functions for testing Temporal.
defines: [TemporalHelpers]
features: [Symbol.species, Symbol.iterator, Temporal]
---*/

const ASCII_IDENTIFIER = /^[$_a-zA-Z][$_a-zA-Z0-9]*$/u;

function formatPropertyName(propertyKey, objectName = "") {
  switch (typeof propertyKey) {
    case "symbol":
      if (Symbol.keyFor(propertyKey) !== undefined) {
        return `${objectName}[Symbol.for('${Symbol.keyFor(propertyKey)}')]`;
      } else if (propertyKey.description.startsWith("Symbol.")) {
        return `${objectName}[${propertyKey.description}]`;
      } else {
        return `${objectName}[Symbol('${propertyKey.description}')]`;
      }
    case "string":
      if (propertyKey !== String(Number(propertyKey))) {
        if (ASCII_IDENTIFIER.test(propertyKey)) {
          return objectName ? `${objectName}.${propertyKey}` : propertyKey;
        }
        return `${objectName}['${propertyKey.replace(/'/g, "\\'")}']`;
      }
      // fall through
    default:
      // integer or string integer-index
      return `${objectName}[${propertyKey}]`;
  }
}

const SKIP_SYMBOL = Symbol("Skip");

var TemporalHelpers = {
  /*
   * Codes and maximum lengths of months in the ISO 8601 calendar.
   */
  ISOMonths: [
    { month: 1, monthCode: "M01", daysInMonth: 31 },
    { month: 2, monthCode: "M02", daysInMonth: 29 },
    { month: 3, monthCode: "M03", daysInMonth: 31 },
    { month: 4, monthCode: "M04", daysInMonth: 30 },
    { month: 5, monthCode: "M05", daysInMonth: 31 },
    { month: 6, monthCode: "M06", daysInMonth: 30 },
    { month: 7, monthCode: "M07", daysInMonth: 31 },
    { month: 8, monthCode: "M08", daysInMonth: 31 },
    { month: 9, monthCode: "M09", daysInMonth: 30 },
    { month: 10, monthCode: "M10", daysInMonth: 31 },
    { month: 11, monthCode: "M11", daysInMonth: 30 },
    { month: 12, monthCode: "M12", daysInMonth: 31 }
  ],

  /*
   * List of known calendar eras and their possible aliases.
   *
   * https://tc39.es/proposal-intl-era-monthcode/#table-eras
   */
  CalendarEras: {
    buddhist: [
      { era: "be" },
    ],
    coptic: [
      { era: "am" },
    ],
    ethiopic: [
      { era: "aa" },
      { era: "am" },
    ],
    ethioaa: [
      { era: "aa" },
    ],
    gregory: [
      { era: "bce", aliases: ["bc"] },
      { era: "ce", aliases: ["ad"] },
    ],
    hebrew: [
      { era: "am" },
    ],
    indian: [
      { era: "shaka" },
    ],
    "islamic-civil": [
      { era: "bh" },
      { era: "ah" },
    ],
    "islamic-tbla": [
      { era: "bh" },
      { era: "ah" },
    ],
    "islamic-umalqura": [
      { era: "bh" },
      { era: "ah" },
    ],
    japanese: [
      { era: "bce", aliases: ["bc"] },
      { era: "ce", aliases: ["ad"] },
      { era: "heisei" },
      { era: "meiji" },
      { era: "reiwa" },
      { era: "showa" },
      { era: "taisho" },
    ],
    persian: [
      { era: "ap" },
    ],
    roc: [
      { era: "roc" },
      { era: "broc" },
    ],
  },


  /**
   * Apple's fork of ICU contains code for these calendars, but they are not yet
   * allowed to be supported in AvailableCalendars. See
   * https://github.com/tc39/ecma402/blob/main/meetings/notes-2025-12-04.md#datetimeformatconstructor-options-calendar-islamic-fallbackjs-should-allow-other-fallback-values-4677
   */
  NotYetSupportedCalendars: [
    "bangla",
    "gujarati",
    "kannada",
    "marathi",
    "odia",
    "tamil",
    "telugu",
    "vikram",
  ],

  /*
   * Return the canonical era code.
   */
  canonicalizeCalendarEra(calendarId, eraName) {
    assert.sameValue(typeof calendarId, "string", "calendar must be string in canonicalizeCalendarEra");

    if (!Object.prototype.hasOwnProperty.call(TemporalHelpers.CalendarEras, calendarId)) {
      assert.sameValue(eraName, undefined);
      return undefined;
    }

    assert.sameValue(typeof eraName, "string", "eraName must be string or undefined in canonicalizeCalendarEra");

    for (let {era, aliases = []} of TemporalHelpers.CalendarEras[calendarId]) {
      if (era === eraName || aliases.includes(eraName)) {
        return era;
      }
    }
    throw new Test262Error(`Unsupported era name: ${eraName}`);
  },

  /*
   * assertDuration(duration, years, ...,  nanoseconds[, description]):
   *
   * Shorthand for asserting that each field of a Temporal.Duration is equal to
   * an expected value.
   */
  assertDuration(duration, years, months, weeks, days, hours, minutes, seconds, milliseconds, microseconds, nanoseconds, description = "") {
    const prefix = description ? `${description}: ` : "";
    assert(duration instanceof Temporal.Duration, `${prefix}instanceof`);
    assert.sameValue(duration.years, years, `${prefix}years result:`);
    assert.sameValue(duration.months, months, `${prefix}months result:`);
    assert.sameValue(duration.weeks, weeks, `${prefix}weeks result:`);
    assert.sameValue(duration.days, days, `${prefix}days result:`);
    assert.sameValue(duration.hours, hours, `${prefix}hours result:`);
    assert.sameValue(duration.minutes, minutes, `${prefix}minutes result:`);
    assert.sameValue(duration.seconds, seconds, `${prefix}seconds result:`);
    assert.sameValue(duration.milliseconds, milliseconds, `${prefix}milliseconds result:`);
    assert.sameValue(duration.microseconds, microseconds, `${prefix}microseconds result:`);
    assert.sameValue(duration.nanoseconds, nanoseconds, `${prefix}nanoseconds result`);
  },

  /*
   * assertDateDuration(duration, years, months, weeks, days, [, description]):
   *
   * Shorthand for asserting that each date field of a Temporal.Duration is
   * equal to an expected value.
   */
  assertDateDuration(duration, years, months, weeks, days, description = "") {
    const prefix = description ? `${description}: ` : "";
    assert(duration instanceof Temporal.Duration, `${prefix}instanceof`);
    assert.sameValue(duration.years, years, `${prefix}years result:`);
    assert.sameValue(duration.months, months, `${prefix}months result:`);
    assert.sameValue(duration.weeks, weeks, `${prefix}weeks result:`);
    assert.sameValue(duration.days, days, `${prefix}days result:`);
    assert.sameValue(duration.hours, 0, `${prefix}hours result should be zero:`);
    assert.sameValue(duration.minutes, 0, `${prefix}minutes result should be zero:`);
    assert.sameValue(duration.seconds, 0, `${prefix}seconds result should be zero:`);
    assert.sameValue(duration.milliseconds, 0, `${prefix}milliseconds result should be zero:`);
    assert.sameValue(duration.microseconds, 0, `${prefix}microseconds result should be zero:`);
    assert.sameValue(duration.nanoseconds, 0, `${prefix}nanoseconds result should be zero:`);
  },

  /*
   * assertDurationsEqual(actual, expected[, description]):
   *
   * Shorthand for asserting that each field of a Temporal.Duration is equal to
   * the corresponding field in another Temporal.Duration.
   */
  assertDurationsEqual(actual, expected, description = "") {
    const prefix = description ? `${description}: ` : "";
    assert(expected instanceof Temporal.Duration, `${prefix}expected value should be a Temporal.Duration`);
    TemporalHelpers.assertDuration(actual, expected.years, expected.months, expected.weeks, expected.days, expected.hours, expected.minutes, expected.seconds, expected.milliseconds, expected.microseconds, expected.nanoseconds, description);
  },

  /*
   * assertInstantsEqual(actual, expected[, description]):
   *
   * Shorthand for asserting that two Temporal.Instants are of the correct type
   * and equal according to their equals() methods.
   */
  assertInstantsEqual(actual, expected, description = "") {
    const prefix = description ? `${description}: ` : "";
    assert(expected instanceof Temporal.Instant, `${prefix}expected value should be a Temporal.Instant`);
    assert(actual instanceof Temporal.Instant, `${prefix}instanceof`);
    assert(actual.equals(expected), `${prefix}equals method`);
  },

  /*
   * assertPlainDate(date, year, ..., nanosecond[, description[, era, eraYear]]):
   *
   * Shorthand for asserting that each field of a Temporal.PlainDate is equal to
   * an expected value. (Except the `calendar` property, since callers may want
   * to assert either object equality with an object they put in there, or the
   * value of date.calendarId.)
   */
  assertPlainDate(date, year, month, monthCode, day, description = "", era = undefined, eraYear = undefined) {
    const prefix = description ? `${description}: ` : "";
    assert(date instanceof Temporal.PlainDate, `${prefix}instanceof`);
    assert.sameValue(
      TemporalHelpers.canonicalizeCalendarEra(date.calendarId, date.era),
      TemporalHelpers.canonicalizeCalendarEra(date.calendarId, era),
      `${prefix}era result:`
    );
    assert.sameValue(date.eraYear, eraYear, `${prefix}eraYear result:`);
    assert.sameValue(date.year, year, `${prefix}year result:`);
    assert.sameValue(date.month, month, `${prefix}month result:`);
    assert.sameValue(date.monthCode, monthCode, `${prefix}monthCode result:`);
    assert.sameValue(date.day, day, `${prefix}day result:`);
  },

  /*
   * assertPlainDateTime(datetime, year, ..., nanosecond[, description[, era, eraYear]]):
   *
   * Shorthand for asserting that each field of a Temporal.PlainDateTime is
   * equal to an expected value. (Except the `calendar` property, since callers
   * may want to assert either object equality with an object they put in there,
   * or the value of datetime.calendarId.)
   */
  assertPlainDateTime(datetime, year, month, monthCode, day, hour, minute, second, millisecond, microsecond, nanosecond, description = "", era = undefined, eraYear = undefined) {
    const prefix = description ? `${description}: ` : "";
    assert(datetime instanceof Temporal.PlainDateTime, `${prefix}instanceof`);
    assert.sameValue(
      TemporalHelpers.canonicalizeCalendarEra(datetime.calendarId, datetime.era),
      TemporalHelpers.canonicalizeCalendarEra(datetime.calendarId, era),
      `${prefix}era result:`
    );
    assert.sameValue(datetime.eraYear, eraYear, `${prefix}eraYear result:`);
    assert.sameValue(datetime.year, year, `${prefix}year result:`);
    assert.sameValue(datetime.month, month, `${prefix}month result:`);
    assert.sameValue(datetime.monthCode, monthCode, `${prefix}monthCode result:`);
    assert.sameValue(datetime.day, day, `${prefix}day result:`);
    assert.sameValue(datetime.hour, hour, `${prefix}hour result:`);
    assert.sameValue(datetime.minute, minute, `${prefix}minute result:`);
    assert.sameValue(datetime.second, second, `${prefix}second result:`);
    assert.sameValue(datetime.millisecond, millisecond, `${prefix}millisecond result:`);
    assert.sameValue(datetime.microsecond, microsecond, `${prefix}microsecond result:`);
    assert.sameValue(datetime.nanosecond, nanosecond, `${prefix}nanosecond result:`);
  },

  /*
   * assertPlainDatesEqual(actual, expected[, description]):
   *
   * Shorthand for asserting that two Temporal.PlainDates are of the correct
   * type, equal according to their equals() methods, and additionally that
   * their calendar internal slots are the same value.
   */
  assertPlainDatesEqual(actual, expected, description = "") {
    const prefix = description ? `${description}: ` : "";
    assert(expected instanceof Temporal.PlainDate, `${prefix}expected value should be a Temporal.PlainDate`);
    assert(actual instanceof Temporal.PlainDate, `${prefix}instanceof`);
    assert(actual.equals(expected), `${prefix}equals method`);
    assert.sameValue(
      actual.calendarId,
      expected.calendarId,
      `${prefix}calendar same value:`
    );
  },

  /*
   * assertPlainDateTimesEqual(actual, expected[, description]):
   *
   * Shorthand for asserting that two Temporal.PlainDateTimes are of the correct
   * type, equal according to their equals() methods, and additionally that
   * their calendar internal slots are the same value.
   */
  assertPlainDateTimesEqual(actual, expected, description = "") {
    const prefix = description ? `${description}: ` : "";
    assert(expected instanceof Temporal.PlainDateTime, `${prefix}expected value should be a Temporal.PlainDateTime`);
    assert(actual instanceof Temporal.PlainDateTime, `${prefix}instanceof`);
    assert(actual.equals(expected), `${prefix}equals method`);
    assert.sameValue(
      actual.calendarId,
      expected.calendarId,
      `${prefix}calendar same value:`
    );
  },

  /*
   * assertPlainMonthDay(monthDay, monthCode, day[, description [, referenceISOYear]]):
   *
   * Shorthand for asserting that each field of a Temporal.PlainMonthDay is
   * equal to an expected value. (Except the `calendar` property, since callers
   * may want to assert either object equality with an object they put in there,
   * or the value of monthDay.calendarId().)
   */
  assertPlainMonthDay(monthDay, monthCode, day, description = "", referenceISOYear = 1972) {
    const prefix = description ? `${description}: ` : "";
    assert(monthDay instanceof Temporal.PlainMonthDay, `${prefix}instanceof`);
    assert.sameValue(monthDay.monthCode, monthCode, `${prefix}monthCode result:`);
    assert.sameValue(monthDay.day, day, `${prefix}day result:`);
    const isoYear = Number(monthDay.toString({ calendarName: "always" }).split("-")[0]);
    assert.sameValue(isoYear, referenceISOYear, `${prefix}referenceISOYear result:`);
  },

  /*
   * assertPlainTime(time, hour, ..., nanosecond[, description]):
   *
   * Shorthand for asserting that each field of a Temporal.PlainTime is equal to
   * an expected value.
   */
  assertPlainTime(time, hour, minute, second, millisecond, microsecond, nanosecond, description = "") {
    const prefix = description ? `${description}: ` : "";
    assert(time instanceof Temporal.PlainTime, `${prefix}instanceof`);
    assert.sameValue(time.hour, hour, `${prefix}hour result:`);
    assert.sameValue(time.minute, minute, `${prefix}minute result:`);
    assert.sameValue(time.second, second, `${prefix}second result:`);
    assert.sameValue(time.millisecond, millisecond, `${prefix}millisecond result:`);
    assert.sameValue(time.microsecond, microsecond, `${prefix}microsecond result:`);
    assert.sameValue(time.nanosecond, nanosecond, `${prefix}nanosecond result:`);
  },

  /*
   * assertPlainTimesEqual(actual, expected[, description]):
   *
   * Shorthand for asserting that two Temporal.PlainTimes are of the correct
   * type and equal according to their equals() methods.
   */
  assertPlainTimesEqual(actual, expected, description = "") {
    const prefix = description ? `${description}: ` : "";
    assert(expected instanceof Temporal.PlainTime, `${prefix}expected value should be a Temporal.PlainTime`);
    assert(actual instanceof Temporal.PlainTime, `${prefix}instanceof`);
    assert(actual.equals(expected), `${prefix}equals method`);
  },

  /*
   * assertPlainYearMonth(yearMonth, year, month, monthCode[, description[, era, eraYear, referenceISODay]]):
   *
   * Shorthand for asserting that each field of a Temporal.PlainYearMonth is
   * equal to an expected value. (Except the `calendar` property, since callers
   * may want to assert either object equality with an object they put in there,
   * or the value of yearMonth.calendarId.)
   *
   * Pass null as the referenceISODay if you don't want to give it explicitly.
   * In that case, the expected referenceISODay will be computed using PlainDate
   * and only verified for consistency, not for equality with a specific value.
   */
  assertPlainYearMonth(yearMonth, year, month, monthCode, description = "", era = undefined, eraYear = undefined, referenceISODay = 1) {
    const prefix = description ? `${description}: ` : "";
    assert(typeof referenceISODay === "number" || referenceISODay === null,
      `TemporalHelpers.assertPlainYearMonth() referenceISODay argument should be a number or null, not ${referenceISODay}`);
    assert(yearMonth instanceof Temporal.PlainYearMonth, `${prefix}instanceof`);
    assert.sameValue(
      TemporalHelpers.canonicalizeCalendarEra(yearMonth.calendarId, yearMonth.era),
      TemporalHelpers.canonicalizeCalendarEra(yearMonth.calendarId, era),
      `${prefix}era result:`
    );
    assert.sameValue(yearMonth.eraYear, eraYear, `${prefix}eraYear result:`);
    assert.sameValue(yearMonth.year, year, `${prefix}year result:`);
    assert.sameValue(yearMonth.month, month, `${prefix}month result:`);
    assert.sameValue(yearMonth.monthCode, monthCode, `${prefix}monthCode result:`);
    const isoDay = Number(yearMonth.toString({ calendarName: "always" }).slice(1).split("-")[2].slice(0, 2));
    const expectedISODay = referenceISODay ?? yearMonth.toPlainDate({ day: 1 }).withCalendar("iso8601").day;
    assert.sameValue(isoDay, expectedISODay, `${prefix}referenceISODay result:`);
  },

  /*
   * assertZonedDateTimesEqual(actual, expected[, description]):
   *
   * Shorthand for asserting that two Temporal.ZonedDateTimes are of the correct
   * type, equal according to their equals() methods, and additionally that
   * their time zones and calendar internal slots are the same value.
   */
  assertZonedDateTimesEqual(actual, expected, description = "") {
    const prefix = description ? `${description}: ` : "";
    assert(expected instanceof Temporal.ZonedDateTime, `${prefix}expected value should be a Temporal.ZonedDateTime`);
    assert(actual instanceof Temporal.ZonedDateTime, `${prefix}instanceof`);
    assert(actual.equals(expected), `${prefix}equals method`);
    assert.sameValue(actual.timeZoneId, expected.timeZoneId, `${prefix}time zone same value:`);
    assert.sameValue(
      actual.calendarId,
      expected.calendarId,
      `${prefix}calendar same value:`
    );
  },

  /*
   * assertUnreachable(description):
   *
   * Helper for asserting that code is not executed.
   */
  assertUnreachable(description) {
    let message = "This code should not be executed";
    if (description) {
      message = `${message}: ${description}`;
    }
    throw new Test262Error(message);
  },

  /*
   * checkPlainDateTimeConversionFastPath(func):
   *
   * ToTemporalDate and ToTemporalTime should both, if given a
   * Temporal.PlainDateTime instance, convert to the desired type by reading the
   * PlainDateTime's internal slots, rather than calling any getters.
   *
   * func(datetime) is the actual operation to test, that must
   * internally call the abstract operation ToTemporalDate or ToTemporalTime.
   * It is passed a Temporal.PlainDateTime instance.
   */
  checkPlainDateTimeConversionFastPath(func, message = "checkPlainDateTimeConversionFastPath") {
    const actual = [];
    const expected = [];

    const calendar = "iso8601";
    const datetime = new Temporal.PlainDateTime(2000, 5, 2, 12, 34, 56, 987, 654, 321, calendar);
    const prototypeDescrs = Object.getOwnPropertyDescriptors(Temporal.PlainDateTime.prototype);
    ["year", "month", "monthCode", "day", "hour", "minute", "second", "millisecond", "microsecond", "nanosecond"].forEach((property) => {
      Object.defineProperty(datetime, property, {
        get() {
          actual.push(`get ${formatPropertyName(property)}`);
          const value = prototypeDescrs[property].get.call(this);
          return {
            toString() {
              actual.push(`toString ${formatPropertyName(property)}`);
              return value.toString();
            },
            valueOf() {
              actual.push(`valueOf ${formatPropertyName(property)}`);
              return value;
            },
          };
        },
      });
    });
    Object.defineProperty(datetime, "calendar", {
      get() {
        actual.push("get calendar");
        return calendar;
      },
    });

    func(datetime);
    assert.compareArray(actual, expected, `${message}: property getters not called`);
  },

  /*
   * Check that an options bag that accepts units written in the singular form,
   * also accepts the same units written in the plural form.
   * func(unit) should call the method with the appropriate options bag
   * containing unit as a value. This will be called twice for each element of
   * validSingularUnits, once with singular and once with plural, and the
   * results of each pair should be the same (whether a Temporal object or a
   * primitive value.)
   */
  checkPluralUnitsAccepted(func, validSingularUnits) {
    const plurals = {
      year: "years",
      month: "months",
      week: "weeks",
      day: "days",
      hour: "hours",
      minute: "minutes",
      second: "seconds",
      millisecond: "milliseconds",
      microsecond: "microseconds",
      nanosecond: "nanoseconds",
    };

    validSingularUnits.forEach((unit) => {
      const singularValue = func(unit);
      const pluralValue = func(plurals[unit]);
      const desc = `Plural ${plurals[unit]} produces the same result as singular ${unit}`;
      if (singularValue instanceof Temporal.Duration) {
        TemporalHelpers.assertDurationsEqual(pluralValue, singularValue, desc);
      } else if (singularValue instanceof Temporal.Instant) {
        TemporalHelpers.assertInstantsEqual(pluralValue, singularValue, desc);
      } else if (singularValue instanceof Temporal.PlainDateTime) {
        TemporalHelpers.assertPlainDateTimesEqual(pluralValue, singularValue, desc);
      } else if (singularValue instanceof Temporal.PlainTime) {
        TemporalHelpers.assertPlainTimesEqual(pluralValue, singularValue, desc);
      } else if (singularValue instanceof Temporal.ZonedDateTime) {
        TemporalHelpers.assertZonedDateTimesEqual(pluralValue, singularValue, desc);
      } else {
        assert.sameValue(pluralValue, singularValue);
      }
    });
  },

  /*
   * checkRoundingIncrementOptionWrongType(checkFunc, assertTrueResultFunc, assertObjectResultFunc):
   *
   * Checks the type handling of the roundingIncrement option.
   * checkFunc(roundingIncrement) is a function which takes the value of
   * roundingIncrement to test, and calls the method under test with it,
   * returning the result. assertTrueResultFunc(result, description) should
   * assert that result is the expected result with roundingIncrement: true, and
   * assertObjectResultFunc(result, description) should assert that result is
   * the expected result with roundingIncrement being an object with a valueOf()
   * method.
   */
  checkRoundingIncrementOptionWrongType(checkFunc, assertTrueResultFunc, assertObjectResultFunc) {
    // null converts to 0, which is out of range
    assert.throws(RangeError, () => checkFunc(null), "null");
    // Booleans convert to either 0 or 1, and 1 is allowed
    const trueResult = checkFunc(true);
    assertTrueResultFunc(trueResult, "true");
    assert.throws(RangeError, () => checkFunc(false), "false");
    // Symbols and BigInts cannot convert to numbers
    assert.throws(TypeError, () => checkFunc(Symbol()), "symbol");
    assert.throws(TypeError, () => checkFunc(2n), "bigint");

    // Objects prefer their valueOf() methods when converting to a number
    assert.throws(RangeError, () => checkFunc({}), "plain object");

    const expected = [
      "get roundingIncrement.valueOf",
      "call roundingIncrement.valueOf",
    ];
    const actual = [];
    const observer = TemporalHelpers.toPrimitiveObserver(actual, 2, "roundingIncrement");
    const objectResult = checkFunc(observer);
    assertObjectResultFunc(objectResult, "object with valueOf");
    assert.compareArray(actual, expected, "order of operations");
  },

  /*
   * checkStringOptionWrongType(propertyName, value, checkFunc, assertFunc):
   *
   * Checks the type handling of a string option, of which there are several in
   * Temporal.
   * propertyName is the name of the option, and value is the value that
   * assertFunc should expect it to have.
   * checkFunc(value) is a function which takes the value of the option to test,
   * and calls the method under test with it, returning the result.
   * assertFunc(result, description) should assert that result is the expected
   * result with the option value being an object with a toString() method
   * which returns the given value.
   */
  checkStringOptionWrongType(propertyName, value, checkFunc, assertFunc) {
    // null converts to the string "null", which is an invalid string value
    assert.throws(RangeError, () => checkFunc(null), "null");
    // Booleans convert to the strings "true" or "false", which are invalid
    assert.throws(RangeError, () => checkFunc(true), "true");
    assert.throws(RangeError, () => checkFunc(false), "false");
    // Symbols cannot convert to strings
    assert.throws(TypeError, () => checkFunc(Symbol()), "symbol");
    // Numbers convert to strings which are invalid
    assert.throws(RangeError, () => checkFunc(2), "number");
    // BigInts convert to strings which are invalid
    assert.throws(RangeError, () => checkFunc(2n), "bigint");

    // Objects prefer their toString() methods when converting to a string
    assert.throws(RangeError, () => checkFunc({}), "plain object");

    const expected = [
      `get ${propertyName}.toString`,
      `call ${propertyName}.toString`,
    ];
    const actual = [];
    const observer = TemporalHelpers.toPrimitiveObserver(actual, value, propertyName);
    const result = checkFunc(observer);
    assertFunc(result, "object with toString");
    assert.compareArray(actual, expected, "order of operations");
  },

  /*
   * checkSubclassingIgnored(construct, constructArgs, method, methodArgs,
   *   resultAssertions):
   *
   * Methods of Temporal classes that return a new instance of the same class,
   * must not take the constructor of a subclass into account, nor the @@species
   * property. This helper runs tests to ensure this.
   *
   * construct(...constructArgs) must yield a valid instance of the Temporal
   * class. instance[method](...methodArgs) is the method call under test, which
   * must also yield a valid instance of the same Temporal class, not a
   * subclass. See below for the individual tests that this runs.
   * resultAssertions() is a function that performs additional assertions on the
   * instance returned by the method under test.
   */
  checkSubclassingIgnored(...args) {
    this.checkSubclassConstructorNotObject(...args);
    this.checkSubclassConstructorUndefined(...args);
    this.checkSubclassConstructorThrows(...args);
    this.checkSubclassConstructorNotCalled(...args);
    this.checkSubclassSpeciesInvalidResult(...args);
    this.checkSubclassSpeciesNotAConstructor(...args);
    this.checkSubclassSpeciesNull(...args);
    this.checkSubclassSpeciesUndefined(...args);
    this.checkSubclassSpeciesThrows(...args);
  },

  /*
   * Checks that replacing the 'constructor' property of the instance with
   * various primitive values does not affect the returned new instance.
   */
  checkSubclassConstructorNotObject(construct, constructArgs, method, methodArgs, resultAssertions) {
    function check(value, description) {
      const instance = new construct(...constructArgs);
      instance.constructor = value;
      const result = instance[method](...methodArgs);
      assert.sameValue(Object.getPrototypeOf(result), construct.prototype, description);
      resultAssertions(result);
    }

    check(null, "null");
    check(true, "true");
    check("test", "string");
    check(Symbol(), "Symbol");
    check(7, "number");
    check(7n, "bigint");
  },

  /*
   * Checks that replacing the 'constructor' property of the subclass with
   * undefined does not affect the returned new instance.
   */
  checkSubclassConstructorUndefined(construct, constructArgs, method, methodArgs, resultAssertions) {
    let called = 0;

    class MySubclass extends construct {
      constructor() {
        ++called;
        super(...constructArgs);
      }
    }

    const instance = new MySubclass();
    assert.sameValue(called, 1);

    MySubclass.prototype.constructor = undefined;

    const result = instance[method](...methodArgs);
    assert.sameValue(called, 1);
    assert.sameValue(Object.getPrototypeOf(result), construct.prototype);
    resultAssertions(result);
  },

  /*
   * Checks that making the 'constructor' property of the instance throw when
   * called does not affect the returned new instance.
   */
  checkSubclassConstructorThrows(construct, constructArgs, method, methodArgs, resultAssertions) {
    function CustomError() {}
    const instance = new construct(...constructArgs);
    Object.defineProperty(instance, "constructor", {
      get() {
        throw new CustomError();
      }
    });
    const result = instance[method](...methodArgs);
    assert.sameValue(Object.getPrototypeOf(result), construct.prototype);
    resultAssertions(result);
  },

  /*
   * Checks that when subclassing, the subclass constructor is not called by
   * the method under test.
   */
  checkSubclassConstructorNotCalled(construct, constructArgs, method, methodArgs, resultAssertions) {
    let called = 0;

    class MySubclass extends construct {
      constructor() {
        ++called;
        super(...constructArgs);
      }
    }

    const instance = new MySubclass();
    assert.sameValue(called, 1);

    const result = instance[method](...methodArgs);
    assert.sameValue(called, 1);
    assert.sameValue(Object.getPrototypeOf(result), construct.prototype);
    resultAssertions(result);
  },

  /*
   * Check that the constructor's @@species property is ignored when it's a
   * constructor that returns a non-object value.
   */
  checkSubclassSpeciesInvalidResult(construct, constructArgs, method, methodArgs, resultAssertions) {
    function check(value, description) {
      const instance = new construct(...constructArgs);
      instance.constructor = {
        [Symbol.species]: function() {
          return value;
        },
      };
      const result = instance[method](...methodArgs);
      assert.sameValue(Object.getPrototypeOf(result), construct.prototype, description);
      resultAssertions(result);
    }

    check(undefined, "undefined");
    check(null, "null");
    check(true, "true");
    check("test", "string");
    check(Symbol(), "Symbol");
    check(7, "number");
    check(7n, "bigint");
    check({}, "plain object");
  },

  /*
   * Check that the constructor's @@species property is ignored when it's not a
   * constructor.
   */
  checkSubclassSpeciesNotAConstructor(construct, constructArgs, method, methodArgs, resultAssertions) {
    function check(value, description) {
      const instance = new construct(...constructArgs);
      instance.constructor = {
        [Symbol.species]: value,
      };
      const result = instance[method](...methodArgs);
      assert.sameValue(Object.getPrototypeOf(result), construct.prototype, description);
      resultAssertions(result);
    }

    check(true, "true");
    check("test", "string");
    check(Symbol(), "Symbol");
    check(7, "number");
    check(7n, "bigint");
    check({}, "plain object");
  },

  /*
   * Check that the constructor's @@species property is ignored when it's null.
   */
  checkSubclassSpeciesNull(construct, constructArgs, method, methodArgs, resultAssertions) {
    let called = 0;

    class MySubclass extends construct {
      constructor() {
        ++called;
        super(...constructArgs);
      }
    }

    const instance = new MySubclass();
    assert.sameValue(called, 1);

    MySubclass.prototype.constructor = {
      [Symbol.species]: null,
    };

    const result = instance[method](...methodArgs);
    assert.sameValue(called, 1);
    assert.sameValue(Object.getPrototypeOf(result), construct.prototype);
    resultAssertions(result);
  },

  /*
   * Check that the constructor's @@species property is ignored when it's
   * undefined.
   */
  checkSubclassSpeciesUndefined(construct, constructArgs, method, methodArgs, resultAssertions) {
    let called = 0;

    class MySubclass extends construct {
      constructor() {
        ++called;
        super(...constructArgs);
      }
    }

    const instance = new MySubclass();
    assert.sameValue(called, 1);

    MySubclass.prototype.constructor = {
      [Symbol.species]: undefined,
    };

    const result = instance[method](...methodArgs);
    assert.sameValue(called, 1);
    assert.sameValue(Object.getPrototypeOf(result), construct.prototype);
    resultAssertions(result);
  },

  /*
   * Check that the constructor's @@species property is ignored when it throws,
   * i.e. it is not called at all.
   */
  checkSubclassSpeciesThrows(construct, constructArgs, method, methodArgs, resultAssertions) {
    function CustomError() {}

    const instance = new construct(...constructArgs);
    instance.constructor = {
      get [Symbol.species]() {
        throw new CustomError();
      },
    };

    const result = instance[method](...methodArgs);
    assert.sameValue(Object.getPrototypeOf(result), construct.prototype);
  },

  /*
   * checkSubclassingIgnoredStatic(construct, method, methodArgs, resultAssertions):
   *
   * Static methods of Temporal classes that return a new instance of the class,
   * must not use the this-value as a constructor. This helper runs tests to
   * ensure this.
   *
   * construct[method](...methodArgs) is the static method call under test, and
   * must yield a valid instance of the Temporal class, not a subclass. See
   * below for the individual tests that this runs.
   * resultAssertions() is a function that performs additional assertions on the
   * instance returned by the method under test.
   */
  checkSubclassingIgnoredStatic(...args) {
    this.checkStaticInvalidReceiver(...args);
    this.checkStaticReceiverNotCalled(...args);
    this.checkThisValueNotCalled(...args);
  },

  /*
   * Check that calling the static method with a receiver that's not callable,
   * still calls the intrinsic constructor.
   */
  checkStaticInvalidReceiver(construct, method, methodArgs, resultAssertions) {
    function check(value, description) {
      const result = construct[method].apply(value, methodArgs);
      assert.sameValue(Object.getPrototypeOf(result), construct.prototype);
      resultAssertions(result);
    }

    check(undefined, "undefined");
    check(null, "null");
    check(true, "true");
    check("test", "string");
    check(Symbol(), "symbol");
    check(7, "number");
    check(7n, "bigint");
    check({}, "Non-callable object");
  },

  /*
   * Check that calling the static method with a receiver that returns a value
   * that's not callable, still calls the intrinsic constructor.
   */
  checkStaticReceiverNotCalled(construct, method, methodArgs, resultAssertions) {
    function check(value, description) {
      const receiver = function () {
        return value;
      };
      const result = construct[method].apply(receiver, methodArgs);
      assert.sameValue(Object.getPrototypeOf(result), construct.prototype);
      resultAssertions(result);
    }

    check(undefined, "undefined");
    check(null, "null");
    check(true, "true");
    check("test", "string");
    check(Symbol(), "symbol");
    check(7, "number");
    check(7n, "bigint");
    check({}, "Non-callable object");
  },

  /*
   * Check that the receiver isn't called.
   */
  checkThisValueNotCalled(construct, method, methodArgs, resultAssertions) {
    let called = false;

    class MySubclass extends construct {
      constructor(...args) {
        called = true;
        super(...args);
      }
    }

    const result = MySubclass[method](...methodArgs);
    assert.sameValue(called, false);
    assert.sameValue(Object.getPrototypeOf(result), construct.prototype);
    resultAssertions(result);
  },

  /*
   * Check that any calendar-carrying Temporal object has its [[Calendar]]
   * internal slot read by ToTemporalCalendar, and does not fetch the calendar
   * by calling getters.
   */
  checkToTemporalCalendarFastPath(func) {
    const plainDate = new Temporal.PlainDate(2000, 5, 2, "iso8601");
    const plainDateTime = new Temporal.PlainDateTime(2000, 5, 2, 12, 34, 56, 987, 654, 321, "iso8601");
    const plainMonthDay = new Temporal.PlainMonthDay(5, 2, "iso8601");
    const plainYearMonth = new Temporal.PlainYearMonth(2000, 5, "iso8601");
    const zonedDateTime = new Temporal.ZonedDateTime(1_000_000_000_000_000_000n, "UTC", "iso8601");

    [plainDate, plainDateTime, plainMonthDay, plainYearMonth, zonedDateTime].forEach((temporalObject) => {
      Object.defineProperty(temporalObject, "calendar", {
        get() {
          throw new Test262Error("should not get 'calendar' property");
        },
      });
      Object.defineProperty(temporalObject, "calendarId", {
        get() {
          throw new Test262Error("should not get 'calendarId' property");
        },
      });

      func(temporalObject);
    });
  },

  checkToTemporalInstantFastPath(func) {
    const actual = [];
    const expected = [];

    const datetime = new Temporal.ZonedDateTime(1_000_000_000_987_654_321n, "UTC");
    Object.defineProperty(datetime, "toString", {
      get() {
        actual.push("get toString");
        return function (options) {
          actual.push("call toString");
          return Temporal.ZonedDateTime.prototype.toString.call(this, options);
        };
      },
    });

    func(datetime);
    assert.compareArray(actual, expected, "toString not called");
  },

  checkToTemporalPlainDateTimeFastPath(func) {
    const actual = [];
    const expected = [];

    const date = new Temporal.PlainDate(2000, 5, 2, "iso8601");
    const prototypeDescrs = Object.getOwnPropertyDescriptors(Temporal.PlainDate.prototype);
    ["year", "month", "monthCode", "day"].forEach((property) => {
      Object.defineProperty(date, property, {
        get() {
          actual.push(`get ${formatPropertyName(property)}`);
          const value = prototypeDescrs[property].get.call(this);
          return TemporalHelpers.toPrimitiveObserver(actual, value, property);
        },
      });
    });
    ["hour", "minute", "second", "millisecond", "microsecond", "nanosecond"].forEach((property) => {
      Object.defineProperty(date, property, {
        get() {
          actual.push(`get ${formatPropertyName(property)}`);
          return undefined;
        },
      });
    });
    Object.defineProperty(date, "calendar", {
      get() {
        actual.push("get calendar");
        return "iso8601";
      },
    });

    func(date);
    assert.compareArray(actual, expected, "property getters not called");
  },

  /*
   * observeProperty(calls, object, propertyName, value):
   *
   * Defines an own property @object.@propertyName with value @value, that
   * will log any calls to its accessors to the array @calls.
   */
  observeProperty(calls, object, propertyName, value, objectName = "") {
    Object.defineProperty(object, propertyName, {
      get() {
        calls.push(`get ${formatPropertyName(propertyName, objectName)}`);
        return value;
      },
      set() {
        calls.push(`set ${formatPropertyName(propertyName, objectName)}`);
      }
    });
  },

  /*
   * observeMethod(calls, object, propertyName, value):
   *
   * Defines an own property @object.@propertyName with value @value, that
   * will log any calls of @value to the array @calls.
   */
  observeMethod(calls, object, propertyName, objectName = "") {
    const method = object[propertyName];
    object[propertyName] = function () {
      calls.push(`call ${formatPropertyName(propertyName, objectName)}`);
      return method.apply(object, arguments);
    };
  },

  /*
   * Used for substituteMethod to indicate default behavior instead of a
   * substituted value
   */
  SUBSTITUTE_SKIP: SKIP_SYMBOL,

  /*
   * substituteMethod(object, propertyName, values):
   *
   * Defines an own property @object.@propertyName that will, for each
   * subsequent call to the method previously defined as
   * @object.@propertyName:
   *  - Call the method, if no more values remain
   *  - Call the method, if the value in @values for the corresponding call
   *    is SUBSTITUTE_SKIP
   *  - Otherwise, return the corresponding value in @value
   */
  substituteMethod(object, propertyName, values) {
    let calls = 0;
    const method = object[propertyName];
    object[propertyName] = function () {
      if (calls >= values.length) {
        return method.apply(object, arguments);
      } else if (values[calls] === SKIP_SYMBOL) {
        calls++;
        return method.apply(object, arguments);
      } else {
        return values[calls++];
      }
    };
  },

  /*
   * propertyBagObserver():
   * Returns an object that behaves like the given propertyBag but tracks Get
   * and Has operations on any of its properties, by appending messages to an
   * array. If the value of a property in propertyBag is a primitive, the value
   * of the returned object's property will additionally be a
   * TemporalHelpers.toPrimitiveObserver that will track calls to its toString
   * and valueOf methods in the same array. This is for the purpose of testing
   * order of operations that are observable from user code. objectName is used
   * in the log.
   * If skipToPrimitive is given, it must be an array of property keys. Those
   * properties will not have a TemporalHelpers.toPrimitiveObserver returned,
   * and instead just be returned directly.
   */
  propertyBagObserver(calls, propertyBag, objectName, skipToPrimitive) {
    return new Proxy(propertyBag, {
      ownKeys(target) {
        calls.push(`ownKeys ${objectName}`);
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, key) {
        calls.push(`getOwnPropertyDescriptor ${formatPropertyName(key, objectName)}`);
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
      get(target, key, receiver) {
        calls.push(`get ${formatPropertyName(key, objectName)}`);
        const result = Reflect.get(target, key, receiver);
        if (result === undefined) {
          return undefined;
        }
        if ((result !== null && typeof result === "object") || typeof result === "function") {
          return result;
        }
        if (skipToPrimitive && skipToPrimitive.indexOf(key) >= 0) {
          return result;
        }
        return TemporalHelpers.toPrimitiveObserver(calls, result, `${formatPropertyName(key, objectName)}`);
      },
      has(target, key) {
        calls.push(`has ${formatPropertyName(key, objectName)}`);
        return Reflect.has(target, key);
      },
    });
  },

  /*
   * Returns an object that will append logs of any Gets or Calls of its valueOf
   * or toString properties to the array calls. Both valueOf and toString will
   * return the actual primitiveValue. propertyName is used in the log.
   */
  toPrimitiveObserver(calls, primitiveValue, propertyName) {
    return {
      get valueOf() {
        calls.push(`get ${propertyName}.valueOf`);
        return function () {
          calls.push(`call ${propertyName}.valueOf`);
          return primitiveValue;
        };
      },
      get toString() {
        calls.push(`get ${propertyName}.toString`);
        return function () {
          calls.push(`call ${propertyName}.toString`);
          if (primitiveValue === undefined) return undefined;
          return primitiveValue.toString();
        };
      },
    };
  },

  /*
   * An object containing further methods that return arrays of ISO strings, for
   * testing parsers.
   */
  ISO: {
    /*
     * PlainMonthDay strings that are not valid.
     */
    plainMonthDayStringsInvalid() {
      return [
        "11-18junk",
        "11-18[u-ca=gregory]",
        "11-18[u-ca=hebrew]",
        "11-18[U-CA=iso8601]",
        "11-18[u-CA=iso8601]",
        "11-18[FOO=bar]",
        "-999999-01-01[u-ca=gregory]",
        "-999999-01-01[u-ca=chinese]",
        "+999999-01-01[u-ca=gregory]",
        "+999999-01-01[u-ca=chinese]",
      ];
    },

    /*
     * PlainMonthDay strings that are valid and that should produce October 1st.
     */
    plainMonthDayStringsValid() {
      return [
        "10-01",
        "1001",
        "1965-10-01",
        "1976-10-01T152330.1+00:00",
        "19761001T15:23:30.1+00:00",
        "1976-10-01T15:23:30.1+0000",
        "1976-10-01T152330.1+0000",
        "19761001T15:23:30.1+0000",
        "19761001T152330.1+00:00",
        "19761001T152330.1+0000",
        "+001976-10-01T152330.1+00:00",
        "+0019761001T15:23:30.1+00:00",
        "+001976-10-01T15:23:30.1+0000",
        "+001976-10-01T152330.1+0000",
        "+0019761001T15:23:30.1+0000",
        "+0019761001T152330.1+00:00",
        "+0019761001T152330.1+0000",
        "1976-10-01T15:23:00",
        "1976-10-01T15:23",
        "1976-10-01T15",
        "1976-10-01",
        "--10-01",
        "--1001",
        "-999999-10-01",
        "-999999-10-01[u-ca=iso8601]",
        "+999999-10-01",
        "+999999-10-01[u-ca=iso8601]",
      ];
    },

    /*
     * PlainTime strings that may be mistaken for PlainMonthDay or
     * PlainYearMonth strings, and so require a time designator.
     */
    plainTimeStringsAmbiguous() {
      const ambiguousStrings = [
        "2021-12",  // ambiguity between YYYY-MM and HHMM-UU
        "2021-12[-12:00]",  // ditto, TZ does not disambiguate
        "1214",     // ambiguity between MMDD and HHMM
        "0229",     //   ditto, including MMDD that doesn't occur every year
        "1130",     //   ditto, including DD that doesn't occur in every month
        "12-14",    // ambiguity between MM-DD and HH-UU
        "12-14[-14:00]",  // ditto, TZ does not disambiguate
        "202112",   // ambiguity between YYYYMM and HHMMSS
        "202112[UTC]",  // ditto, TZ does not disambiguate
      ];
      // Adding a calendar annotation to one of these strings must not cause
      // disambiguation in favour of time.
      const stringsWithCalendar = ambiguousStrings.map((s) => s + "[u-ca=iso8601]");
      return ambiguousStrings.concat(stringsWithCalendar);
    },

    /*
     * PlainTime strings that are of similar form to PlainMonthDay and
     * PlainYearMonth strings, but are not ambiguous due to components that
     * aren't valid as months or days.
     */
    plainTimeStringsUnambiguous() {
      return [
        "2021-13",          // 13 is not a month
        "202113",           //   ditto
        "2021-13[-13:00]",  //   ditto
        "202113[-13:00]",   //   ditto
        "0000-00",          // 0 is not a month
        "000000",           //   ditto
        "0000-00[UTC]",     //   ditto
        "000000[UTC]",      //   ditto
        "1314",             // 13 is not a month
        "13-14",            //   ditto
        "1232",             // 32 is not a day
        "0230",             // 30 is not a day in February
        "0631",             // 31 is not a day in June
        "0000",             // 0 is neither a month nor a day
        "00-00",            //   ditto
      ];
    },

    /*
     * PlainYearMonth-like strings that are not valid.
     */
    plainYearMonthStringsInvalid() {
      return [
        "2020-13",
        "1976-11[u-ca=gregory]",
        "1976-11[u-ca=hebrew]",
        "1976-11[U-CA=iso8601]",
        "1976-11[u-CA=iso8601]",
        "1976-11[FOO=bar]",
        "+999999-01",
        "-999999-01",
      ];
    },

    /*
     * PlainYearMonth-like strings that are valid and should produce November
     * 1976 in the ISO 8601 calendar.
     */
    plainYearMonthStringsValid() {
      return [
        "1976-11",
        "1976-11-10",
        "1976-11-01T09:00:00+00:00",
        "1976-11-01T00:00:00+05:00",
        "197611",
        "+00197611",
        "1976-11-18T15:23:30.1-02:00",
        "1976-11-18T152330.1+00:00",
        "19761118T15:23:30.1+00:00",
        "1976-11-18T15:23:30.1+0000",
        "1976-11-18T152330.1+0000",
        "19761118T15:23:30.1+0000",
        "19761118T152330.1+00:00",
        "19761118T152330.1+0000",
        "+001976-11-18T152330.1+00:00",
        "+0019761118T15:23:30.1+00:00",
        "+001976-11-18T15:23:30.1+0000",
        "+001976-11-18T152330.1+0000",
        "+0019761118T15:23:30.1+0000",
        "+0019761118T152330.1+00:00",
        "+0019761118T152330.1+0000",
        "1976-11-18T15:23",
        "1976-11-18T15",
        "1976-11-18",
      ];
    },

    /*
     * PlainYearMonth-like strings that are valid and should produce November of
     * the ISO year -9999.
     */
    plainYearMonthStringsValidNegativeYear() {
      return [
        "-009999-11",
      ];
    },
  }
};
