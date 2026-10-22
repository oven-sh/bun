declare const aotRuntimeCounters: () => string;
const writersFailed = () => Number(/(\d+)\tJSONWriterFailed/.exec(aotRuntimeCounters())![1]);
declare const aotOperationCount: (name: string) => number;
interface Address { street: string; city: string }
interface Order { id: number; paid: boolean }
interface User { id: number; name: string; active: boolean }
interface Customer { id: number; name: string; address: Address; tags: string[]; orders: Order[]; note: string | null }
interface Holder { id: number; held: unknown }

function hide(value: unknown): any {
    return value;
}

function measure(label: string, run: () => string | undefined): void {
    const finished = (aotOperationCount("operationAOTJSONWriterFinish") - writersFailed());
    const handedOver = aotOperationCount("operationAOTJSONAppendValue");
    let length = 0;
    for (let i = 0; i < 100; i++) length += run()!.length;
    console.log(label + ": " + length + " characters, " + ((aotOperationCount("operationAOTJSONWriterFinish") - writersFailed()) - finished) + " texts finished by compiled code, " + (aotOperationCount("operationAOTJSONAppendValue") - handedOver) + " values handed to the runtime");
}

function customer(i: number): Customer {
    return { id: i, name: "customer " + i, address: { street: i + " Main Street", city: "Springfield" }, tags: ["a" + i, "b"], orders: [{ id: i * 2, paid: true }, { id: i * 2 + 1, paid: false }], note: i & 1 ? null : "note " + i };
}

const user: User = { id: 7, name: "seven", active: true };
measure("a flat record", () => JSON.stringify(user));
const first = customer(1);
measure("records and lists inside", () => JSON.stringify(first));
const list = [customer(2), customer(3)];
measure("a list of records", () => JSON.stringify(list));
const withExtra = customer(4);
hide(withExtra).extra = 1;
measure("a property that the type does not name", () => JSON.stringify(withExtra));
const withExtraInside = customer(5);
hide(withExtraInside.address).extra = 1;
measure("such a property one level down", () => JSON.stringify(withExtraInside));
const holder: Holder = { id: 1, held: [1, "two"] };
measure("a member of unknown type", () => JSON.stringify(holder));
const wide: User = { id: 8, name: "\u0416\u4e2d \ud83d\ude00", active: false };
measure("16-bit text", () => JSON.stringify(wide));
const parsed: any = JSON.parse('{"id":7,"name":"seven","active":true}');
measure("an object without a type", () => JSON.stringify(parsed));
