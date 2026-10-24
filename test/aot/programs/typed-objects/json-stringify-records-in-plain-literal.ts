declare const aotRuntimeCounters: () => string;
const writersFailed = () => Number(/(\d+)\tJSONWriterFailed/.exec(aotRuntimeCounters())![1]);
declare const aotOperationCount: (name: string) => number;
interface Address { city: string; zip: string }
interface User { id: number; name: string; address: Address }
interface Team { name: string; lead: User; members: User[] }
function measure(label: string, run: () => string): void {
    const finished = (aotOperationCount("operationAOTJSONWriterFinish") - writersFailed());
    const values = aotOperationCount("operationAOTJSONAppendValue");
    let text = "";
    for (let i = 0; i < 100; i++) text = run();
    console.log(label + ": " + text + ": " + ((aotOperationCount("operationAOTJSONWriterFinish") - writersFailed()) - finished) + " texts finished by compiled code, " + (aotOperationCount("operationAOTJSONAppendValue") - values) + " values handed to the runtime");
}
const users: User[] = [];
for (let i = 0; i < 2; i++) users.push({ id: i, name: "user " + i, address: { city: "Springfield", zip: "0" + i } });
const team: Team = { name: "team", lead: users[0], members: users };

measure("a record", () => JSON.stringify({ ok: true, data: users[1] } as any));
measure("a list of records", () => JSON.stringify({ total: users.length, rows: users } as any));
measure("a record that holds records and a list", () => JSON.stringify({ team } as any));
measure("a list one literal further down", () => JSON.stringify({ ok: true, page: { total: users.length, rows: users } } as any));
measure("a record two literals further down", () => JSON.stringify({ a: { b: { user: users[1] } } } as any));
