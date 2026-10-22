declare const aotRuntimeCounters: () => string;
const writersFailed = () => Number(/(\d+)\tJSONWriterFailed/.exec(aotRuntimeCounters())![1]);
declare const aotOperationCount: (name: string) => number;
interface Post { id: number; createdAt: Date; updatedAt: Date | null; deletedAt?: Date }
interface Log { name: string; at: Date[] }
class Stamp extends Date { }
class Loud extends Date { toJSON(): string { return "loud"; } }
function measure(label: string, run: () => string): void {
    const finished = (aotOperationCount("operationAOTJSONWriterFinish") - writersFailed());
    let text = "";
    for (let i = 0; i < 100; i++) text = run();
    console.log(label + ": " + text + ": " + ((aotOperationCount("operationAOTJSONWriterFinish") - writersFailed()) - finished) + " texts finished by compiled code");
}
function post(createdAt: Date, updatedAt: Date | null): Post {
    return { id: 1, createdAt, updatedAt };
}
const usual = post(new Date(1700000000123), new Date(1700000086400));
const withNull = post(new Date(0), null);
const invalid = post(new Date(NaN), new Date(Infinity));
const early = post(new Date(-1), new Date(-62167219200000));
const beforeYearZero = post(new Date(-62167219200001), new Date(-8640000000000000));
const late = post(new Date(253402300799999), new Date(253402300800000));
const last = post(new Date(8640000000000000), new Date(8640000000000001));
const leap = post(new Date(Date.UTC(2024, 1, 29, 23, 59, 59, 999)), new Date(Date.UTC(1900, 1, 28, 12)));
const fraction = post(new Date(1.9), new Date(-1.9));
const deleted: Post = { id: 2, createdAt: new Date(1), updatedAt: null, deletedAt: new Date(2) };
const log: Log = { name: "log", at: [new Date(1), new Date(2), new Date(NaN)] };
const ownToJSON = post(new Date(5), null);
(ownToJSON.createdAt as any).toJSON = () => "mine";
const ownToISOString = post(new Date(5), null);
(ownToISOString.createdAt as any).toISOString = () => "mine too";
const ownOther = post(new Date(5), null);
(ownOther.createdAt as any).other = 1;
const subclass = post(new Stamp(6), new Loud(7));
const changed = post(new Date(8), null);
changed.createdAt.setTime(9);

measure("two dates", () => JSON.stringify(usual));
measure("a date and null", () => JSON.stringify(withNull));
measure("invalid dates", () => JSON.stringify(invalid));
measure("before 1970 and the first of the year 0", () => JSON.stringify(early));
measure("before the year 0 and the first date there is", () => JSON.stringify(beforeYearZero));
measure("the last of the year 9999 and the one behind it", () => JSON.stringify(late));
measure("the last date there is and one too late", () => JSON.stringify(last));
measure("a leap day and a year that has none", () => JSON.stringify(leap));
measure("fractions of a millisecond", () => JSON.stringify(fraction));
measure("an optional date", () => JSON.stringify(deleted));
measure("a list of dates", () => JSON.stringify(log));
measure("set to another time", () => JSON.stringify(changed));
measure("in a plain literal", () => JSON.stringify({ at: usual.createdAt, none: invalid.createdAt } as any));
measure("with a toJSON of its own", () => JSON.stringify(ownToJSON));
measure("with a toISOString of its own", () => JSON.stringify(ownToISOString));
measure("with another property of its own", () => JSON.stringify(ownOther));
measure("of classes that extend Date", () => JSON.stringify(subclass));
measure("a date by itself", () => JSON.stringify(usual.createdAt));
