interface Item {
  count: number;
  label: string;
  on: boolean;
  inner: { x: number };
  list: number[];
}

const item: Item = JSON.parse('{"count":null,"label":null,"on":null,"inner":null,"list":null}');
console.log(item.count, item.count === null, typeof item.count, item.count + 1, item.count * 2, item.count | 0);
console.log(item.label, item.label === null, typeof item.label, item.label + "!", typeof item.label === "string");
console.log(item.on, item.on === null, item.on ? "on" : "off", !item.on, item.on === false);
console.log(item.inner, item.inner === null, typeof item.inner);
console.log(item.list, item.list === null, Array.isArray(item.list));
try {
  console.log(item.inner.x);
} catch (error) {
  console.log(error instanceof TypeError);
}
try {
  console.log(item.list[0]);
} catch (error) {
  console.log(error instanceof TypeError);
}
try {
  console.log(item.label.length);
} catch (error) {
  console.log(error instanceof TypeError);
}
console.log(JSON.stringify(item));
