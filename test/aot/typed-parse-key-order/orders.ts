// `orders <declared | sorted> <rounds>` parses the same four orders from texts whose keys are in declaration order or in alphabetical order.
interface Address {
  street: string;
  city: string;
  zip: string;
  country: string;
}

interface Item {
  sku: string;
  title: string;
  quantity: number;
  price: number;
  inStock: boolean;
}

interface Order {
  id: number;
  customer: string;
  email: string;
  paid: boolean;
  total: number;
  note: string | null;
  address: Address;
  items: Item[];
  createdAt: string;
  updatedAt: string;
  status: string;
  currency: string;
}

function makeOrder(id: number): Order {
  return {
    id,
    customer: "customer " + id,
    email: "someone@example.com",
    paid: (id & 1) === 0,
    total: id * 1.25,
    note: id % 3 === 0 ? null : "leave at the door",
    address: { street: "1 Main Street", city: "Springfield", zip: "12345", country: "US" },
    items: [
      { sku: "a-1", title: "first", quantity: 1 + (id & 3), price: 9.5, inStock: true },
      { sku: "b-2", title: "second", quantity: 2, price: 19.25, inStock: false },
      { sku: "c-3", title: "third", quantity: 3, price: 0.75, inStock: true },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    status: "open",
    currency: "USD",
  };
}

function readOrder(text: string): number {
  const order: Order = JSON.parse(text);
  return order.items.length + order.id;
}

function withSortedKeys(value: any): any {
  if (Array.isArray(value)) return value.map(withSortedKeys);
  if (value === null || typeof value !== "object") return value;
  const result: any = {};
  for (const key of Object.keys(value).sort()) result[key] = withSortedKeys(value[key]);
  return result;
}

function run(keyOrder: string, rounds: number): number {
  const declared = [makeOrder(1), makeOrder(2), makeOrder(3), makeOrder(4)].map(order => JSON.stringify(order));
  const texts = keyOrder === "sorted" ? declared.map(text => JSON.stringify(withSortedKeys(JSON.parse(text)))) : declared;
  let sum = 0;
  for (let round = 0; round < rounds; round++) {
    for (let index = 0; index < 4; index++) sum += readOrder(texts[index]);
  }
  return sum;
}

console.log(run(process.argv[2], Number(process.argv[3])));
