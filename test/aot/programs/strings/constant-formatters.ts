// Constant Intl formatters, with the values their format patterns decline and the uses that must take the real function.
const print = (s: string) => console.log(s);
function attempt(name: string, f: () => unknown): void {
    try {
        print(name + ": " + String(f()));
    } catch (e) {
        print(name + ": throws " + (e as Error).name);
    }
}

const beforeSpringChange = new Date(Date.UTC(2024, 2, 10, 6, 59, 59));
const afterSpringChange = new Date(Date.UTC(2024, 2, 10, 7, 0, 0));
const beforeFallChange = new Date(Date.UTC(2024, 10, 3, 5, 59, 59));
const afterFallChange = new Date(Date.UTC(2024, 10, 3, 6, 0, 0));
const dates = [beforeSpringChange, afterSpringChange, beforeFallChange, afterFallChange];

const utc = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "medium" });
const fixedOffset = new Intl.DateTimeFormat("en-US", { timeZone: "+05:30", dateStyle: "medium", timeStyle: "medium" });
const newYork = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "medium" });
const defaultZone = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "medium" });
for (const date of dates) {
    attempt("utc date", () => utc.format(date));
    attempt("utc number", () => utc.format(date.getTime()));
    attempt("fixed offset date", () => fixedOffset.format(date));
    attempt("fixed offset number", () => fixedOffset.format(date.getTime()));
    attempt("new york date", () => newYork.format(date));
    attempt("new york number", () => newYork.format(date.getTime()));
    attempt("default zone date", () => defaultZone.format(date));
    attempt("default zone number", () => defaultZone.format(date.getTime()));
    attempt("toLocaleString utc", () => date.toLocaleString("en-US", { timeZone: "UTC" }));
    attempt("toLocaleString fixed offset", () => date.toLocaleString("en-US", { timeZone: "+05:30" }));
    attempt("toLocaleString new york", () => date.toLocaleString("en-US", { timeZone: "America/New_York" }));
    attempt("toLocaleString default zone", () => date.toLocaleString("en-US"));
    attempt("toLocaleDateString utc", () => date.toLocaleDateString("en-US", { timeZone: "UTC" }));
    attempt("toLocaleDateString new york", () => date.toLocaleDateString("en-US", { timeZone: "America/New_York" }));
    attempt("toLocaleDateString default zone", () => date.toLocaleDateString("en-US"));
    attempt("toLocaleTimeString utc", () => date.toLocaleTimeString("en-US", { timeZone: "UTC" }));
    attempt("toLocaleTimeString new york", () => date.toLocaleTimeString("en-US", { timeZone: "America/New_York" }));
    attempt("toLocaleTimeString default zone", () => date.toLocaleTimeString("en-US"));
}

const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat("en-US", { style: "percent" });
const numbers = [0, 1, -1, 1234.5, 1234567.891, 0.125, NaN, 1e21, -0, Infinity];
for (const value of numbers) {
    attempt("decimal format", () => decimal.format(value));
    attempt("percent format", () => percent.format(value));
    attempt("toLocaleString number", () => value.toLocaleString("en-US", { maximumFractionDigits: 2 }));
}

attempt("new york fraction before change", () => newYork.format(-1633280400000.5));

const yearZero = new Date(-62198755200000);
const invalid = new Date(NaN);
attempt("year zero format", () => utc.format(yearZero));
attempt("year zero toLocaleString", () => yearZero.toLocaleString("en-US", { timeZone: "UTC" }));
attempt("invalid format", () => utc.format(invalid));
attempt("invalid number format", () => utc.format(NaN));
attempt("invalid toLocaleString", () => invalid.toLocaleString("en-US", { timeZone: "UTC" }));

const withOwnValueOf = new Date(0);
withOwnValueOf.valueOf = () => 86400000;
attempt("own valueOf", () => utc.format(withOwnValueOf));

class LoudNumberFormat extends Intl.NumberFormat {
    describe(value: number): string {
        return "<" + this.format(value) + ">";
    }
}
const loud = new LoudNumberFormat("en-US", { maximumFractionDigits: 1 });
attempt("subclass format", () => loud.format(1234.56));
attempt("subclass method", () => loud.describe(1234.56));

const formatNumberLater = decimal.format;
const formatDateLater = utc.format;
attempt("number format as value", () => formatNumberLater(9876.543));
attempt("date format as value", () => formatDateLater(afterFallChange));

attempt("format without argument", () => typeof utc.format());

for (let i = 0; i < 3; i++) {
    const inLoop = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2 });
    attempt("number formatter in loop", () => inLoop.format(i * 1000.5));
    const dateInLoop = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", dateStyle: "short" });
    attempt("date formatter in loop", () => dateInLoop.format(i * 86400000));
}
