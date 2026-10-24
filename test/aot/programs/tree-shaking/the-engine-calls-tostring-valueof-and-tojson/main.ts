// No code names toString, valueOf or toJSON: a template, an addition, a comparison, String(), a key of an object, join and JSON.stringify call them. Each calls a function of its file that nothing else names.
import { Money, Label, Both } from "./values";

console.log(`${new Label("template")}`);
console.log("" + new Label("addition"));
console.log(String(new Label("String")));
console.log(Object.keys({ [new Label("key") as any]: 1 })[0]);
console.log([new Label("join"), new Label("join")].join());
console.log(+new Money(5), new Money(2) < new Money(3), (new Money(2) as any) * 2);
console.log(JSON.stringify({ price: new Money(7), list: [new Money(8)] }));
console.log(`${new Both()}`, (new Both() as any) + "", (new Both() as any) * 1);
