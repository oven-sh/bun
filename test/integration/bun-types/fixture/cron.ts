import { expectType } from "./utilities";

// -- Bun.cron() --

// 5-field expressions
Bun.cron("./worker.ts", "* * * * *", "all-stars");
Bun.cron("./worker.ts", "30 2 * * 1", "weekly-report");
Bun.cron("./worker.ts", "0 0 1 1 *", "new-year");
Bun.cron("./worker.ts", "*/15 * * * *", "every-15-min");
Bun.cron("./worker.ts", "0 9 * * 1-5", "weekday-morning");
Bun.cron("./worker.ts", "0 0 1-15/2 1-3 *", "biweekly-q1");
Bun.cron("./worker.ts", "0,15,30,45 * * * *", "quarter-hours");
Bun.cron("./worker.ts", "30 2 * * MON", "weekly-named");
Bun.cron("./worker.ts", "0 0 * * MON-FRI", "weekday-range");
Bun.cron("./worker.ts", "0 0 * JAN-MAR *", "month-range");

// All nicknames
Bun.cron("./worker.ts", "@yearly", "yearly");
Bun.cron("./worker.ts", "@annually", "annually");
Bun.cron("./worker.ts", "@monthly", "monthly");
Bun.cron("./worker.ts", "@weekly", "weekly");
Bun.cron("./worker.ts", "@daily", "daily");
Bun.cron("./worker.ts", "@midnight", "midnight");
Bun.cron("./worker.ts", "@hourly", "hourly");

// -- Bun.cron.parse() --

expectType(Bun.cron.parse("* * * * *")).is<Date | null>();
expectType(Bun.cron.parse("@daily")).is<Date | null>();
expectType(Bun.cron.parse("30 9 * * MON-FRI")).is<Date | null>();
expectType(Bun.cron.parse("@hourly", new Date())).is<Date | null>();
expectType(Bun.cron.parse("@hourly", Date.now())).is<Date | null>();
expectType(Bun.cron.parse("0 0 1 1 *", Date.UTC(2025, 0, 1))).is<Date | null>();

// -- Bun.cron.remove() --

expectType(Bun.cron.remove("weekly-report")).is<Promise<void>>();

// -- Return type --

expectType(Bun.cron("./worker.ts", "@daily", "daily")).is<Promise<void>>();

// -- @ts-expect-error cases --

// @ts-expect-error - missing schedule and title
Bun.cron("./worker.ts");

// -- Cron type is accessible --

declare const schedule: Bun.CronWithAutocomplete;
