import { Meter } from "./meter.ts";

declare module "./meter.ts" {
  interface Meter {
    extra: number;
  }
}

export function extraOf(meter: Meter): number {
  return meter.extra;
}

export function extraPlusOwn(meter: Meter): number {
  return meter.extra + meter.own;
}
