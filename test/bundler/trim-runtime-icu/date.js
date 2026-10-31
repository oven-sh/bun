import { attempt, CALENDARS, done, LOCALES, NUMBERING, SOME, ZONES } from "./lists.js";

export function run(name, format) {
  const when = [new Date(Date.UTC(2024, 0, 15, 3, 4, 5, 678)), new Date(Date.UTC(1985, 6, 4, 15, 30))];
  const options = [undefined, {}, { dateStyle: "full" }, { dateStyle: "short" }, { timeStyle: "full" }, { timeStyle: "short" }, { weekday: "long", year: "numeric", month: "long", day: "numeric" }, { era: "long", year: "numeric" }, { hour: "numeric", dayPeriod: "long" }, { hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 }, { hour: "numeric", hourCycle: "h11" }, { hour: "numeric", hour12: false }];
  for (const locale of LOCALES) {
    for (const o of options) attempt(() => format(when[0], locale, o && { timeZone: "America/Los_Angeles", ...o }));
    for (const timeZoneName of ["short", "long", "shortOffset", "longOffset", "shortGeneric", "longGeneric"]) for (const timeZone of ["Europe/Berlin", "Asia/Kolkata", "Etc/GMT+5", "America/Argentina/Buenos_Aires"]) attempt(() => format(when[1], locale, { timeZone, timeZoneName }));
    for (const calendar of CALENDARS) attempt(() => format(when[0], locale, { calendar, timeZone: "UTC", year: "numeric", month: "long", day: "numeric", era: "short" }));
  }
  for (const locale of SOME) for (const numberingSystem of NUMBERING.concat(["hebr", "jpanyear", "hanidays", "roman"])) attempt(() => format(when[0], locale, { numberingSystem, timeZone: "UTC" }));
  for (const locale of ["en", "de", "ja", "ar", "zh-Hant"]) for (const timeZone of ZONES) for (const timeZoneName of ["long", "longGeneric"]) attempt(() => format(when[1], locale, { timeZone, timeZoneName }));
  attempt(() => format(when[0]));
  done(name);
}
