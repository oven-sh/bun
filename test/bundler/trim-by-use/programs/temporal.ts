declare const Temporal: any;
const date = Temporal.PlainDate.from("2026-10-17");
console.log(
  date.add({ days: 20 }).toString(),
  date.dayOfWeek,
  date.daysInMonth,
  date.until("2027-01-01").toString(),
  date.with({ month: 2 }).toString(),
);
console.log(
  Temporal.Duration.from("P1DT2H").total("hours"),
  Temporal.Duration.from({ minutes: 90 }).round({ largestUnit: "hours" }).toString(),
);
console.log(
  Temporal.Instant.fromEpochMilliseconds(0).toString(),
  String((new Date(5) as any).toTemporalInstant().epochNanoseconds),
);
console.log(
  Temporal.PlainTime.from("10:20").add({ minutes: 50 }).toString(),
  Temporal.PlainDateTime.from("2026-10-17T08:00").toPlainDate().toString(),
);
console.log(
  Temporal.ZonedDateTime.from("2026-10-17T00:00[UTC]").add({ hours: 25 }).toString(),
  Temporal.PlainYearMonth.from("2026-10").daysInMonth,
  Temporal.PlainMonthDay.from("10-17").toString(),
);
console.log(
  typeof Temporal.Now.timeZoneId(),
  Temporal.PlainDate.compare("2026-01-01", "2026-01-02"),
  Object.prototype.toString.call(date),
);
