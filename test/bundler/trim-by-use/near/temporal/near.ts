const date = new Date(Date.UTC(2026, 9, 17, 8, 30, 15, 250));
console.log(
  date.toISOString(),
  date.toJSON(),
  date.getTime(),
  date.valueOf(),
  date.toUTCString(),
  JSON.stringify({ date }),
);
console.log(
  date.getUTCFullYear(),
  date.getUTCMonth(),
  date.getUTCDate(),
  date.getUTCDay(),
  date.getUTCHours(),
  date.getUTCMinutes(),
  date.getUTCSeconds(),
  date.getUTCMilliseconds(),
);
console.log(
  Date.parse("2026-10-17T08:30:15.250Z"),
  Date.parse("2026-10-17"),
  Date.parse("Sat, 17 Oct 2026 08:30:15 GMT"),
  Date.parse("October 17, 2026 08:30:15 UTC"),
  Date.parse("not a date"),
  new Date("2026-10-17T08:30:15+02:00").getTime(),
);
date.setUTCFullYear(2027, 0, 31);
date.setUTCHours(23, 59, 59, 999);
console.log(
  date.toISOString(),
  new Date(date).setUTCMonth(1),
  new Date(8.64e15 + 1).getTime(),
  typeof Date.now(),
  typeof date.getTimezoneOffset(),
  typeof date.toString(),
  date[Symbol.toPrimitive]("number"),
);
console.log(
  Object.getOwnPropertyNames(Date).sort().join(),
  "toISOString" in date,
  Object.prototype.toString.call(date),
  structuredClone(date).getTime(),
);
const anyIntl: any = Intl;
console.log(
  new anyIntl.DurationFormat("en").format({ hours: 1, minutes: 30 }),
  new anyIntl.DurationFormat("en", { style: "digital" }).format("PT1H5M"),
);
console.log(
  new Intl.DateTimeFormat("en", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }).format(new Date(0)),
  new Intl.DateTimeFormat("en", { timeZone: "+01:00" }).resolvedOptions().timeZone,
);
Bun.gc(true);
