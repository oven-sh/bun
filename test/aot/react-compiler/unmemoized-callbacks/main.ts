import { callbacks } from "./parts";

const log = (text: string) => console.log(text);
const { Panel } = await import("./Panel");
console.log(Panel({ store: { names: ["a", "b", "c"] }, log }));
const { Used } = await import("./Siblings");
console.log(Used({ names: ["d", "e"], log }));
for (const callback of callbacks) callback(1);
