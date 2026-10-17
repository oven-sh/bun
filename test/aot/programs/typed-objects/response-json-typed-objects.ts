interface Address { street: string; city: string }
interface Order { id: number; total: number; paid: boolean }
interface Customer { id: number; name: string; address: Address; tags: string[]; orders: Order[]; note: string | null }
interface Link { value: number; next: Link | null }

function hide(value: unknown): any {
    return value;
}

async function show(label: string, make: () => Response) {
    try {
        const response = make();
        console.log(label, response.status, response.headers.get("content-type"), response.headers.get("x-more"), await response.text());
    } catch (error) {
        console.log(label, "throws", (error as Error).constructor.name, (error as Error).message);
    }
}

function customer(i: number): Customer {
    return { id: i, name: "customer " + i, address: { street: i + " Main Street", city: "Springfield" }, tags: ["a" + i, "b"], orders: [{ id: i * 2, total: 10.5 + i, paid: true }, { id: i * 2 + 1, total: 99 + i, paid: false }], note: i & 1 ? null : "note " + i };
}

const first = customer(1);
await show("a record", () => Response.json(first));
await show("the same record again", () => Response.json(first));
first.name = "changed";
await show("after a store", () => Response.json(first));
await show("a status", () => Response.json(customer(2), { status: 201 }));
await show("a number for the status", () => Response.json(customer(2), hide(202)));
await show("headers", () => Response.json(customer(3), { headers: { "x-more": "yes" } }));
await show("another content type", () => Response.json(customer(3), { headers: { "content-type": "text/plain" } }));
await show("a list", () => Response.json([customer(4), customer(5)]));
await show("an empty list", () => Response.json(((): Customer[] => [])()));
const wide = customer(6);
wide.name = "Ж中 😀 \ud800";
await show("16-bit text", () => Response.json(wide));
const withExtra = customer(7);
hide(withExtra).extra = 1;
await show("an extra property", () => Response.json(withExtra));
const withToJSON = customer(8);
hide(withToJSON.address).toJSON = () => "address";
await show("toJSON inside", () => Response.json(withToJSON));
const cycle: Link = { value: 1, next: null };
cycle.next = cycle;
await show("a cycle", () => Response.json(cycle));
const perhaps: (Customer | undefined | null)[] = [undefined, null, customer(9)];
for (const each of perhaps) await show("perhaps", () => Response.json(each));
await show("init that throws", () => Response.json(customer(10), { get status(): number { throw new RangeError("no status"); } }));
await show("behind a throw", () => Response.json(customer(11)));
await show("init that changes the record", () => {
    const changed = customer(12);
    return Response.json(changed, { get status() { changed.name = "changed while init was read"; return 200; } });
});
await show("JSON.stringify behind Response.json", () => {
    const value = customer(13);
    const response = Response.json(value);
    value.id = 14;
    return new Response(JSON.stringify(value) + (await0(response) ? "" : ""));
});
function await0(_: Response): boolean {
    return true;
}
const original = Response.json;
hide(Response).json = (value: unknown) => new Response("replaced " + typeof value);
await show("replaced", () => Response.json(customer(17)));
hide(Response).json = original;
await show("put back", () => Response.json(customer(18)));
let length = 0;
for (let i = 0; i < 2000; i++) length += (await Response.json(customer(i)).text()).length;
console.log("two thousand", length);
