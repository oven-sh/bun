import { sharedTable, forMain } from "./shared";

const unusedInMain = [1, 2, 3];
const label = { text: "main got" };
export const exportedByMain = "nobody imports this";
const worker = new Worker(new URL("./main.ts", import.meta.url));
worker.onmessage = event => {
  console.log(label.text, event.data);
  console.log(sharedTable.both, forMain.text);
  worker.terminate();
};
worker.postMessage(21);
