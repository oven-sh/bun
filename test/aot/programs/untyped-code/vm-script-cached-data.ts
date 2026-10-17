// A node:vm Script accepts the cached data another Script of the same source made, and rejects any other bytes.
import { Script } from "node:vm";

const source = "1 + 1;";
const first = new Script(source, { produceCachedData: false });
const cachedData = first.createCachedData();
console.log("made", cachedData instanceof Buffer, cachedData.length > 0);

const second = new Script(source, { cachedData });
console.log("the same source", second.cachedDataRejected, first.runInThisContext(), second.runInThisContext());

const other = new Script("2 + 2;", { cachedData });
console.log("another source", other.cachedDataRejected, other.runInThisContext());

const none = new Script(source, { cachedData: Buffer.from("not bytecode") });
console.log("no bytecode", none.cachedDataRejected, none.runInThisContext());

const without = new Script(source);
console.log("none given", without.cachedDataRejected, without.runInThisContext());
