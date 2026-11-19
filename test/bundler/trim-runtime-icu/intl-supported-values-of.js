import { attempt, done } from "./lists.js";

for (const k of ["calendar", "collation", "currency", "numberingSystem", "timeZone", "unit"]) attempt(() => Intl.supportedValuesOf(k).length);
done("intl-supportedvaluesof");
