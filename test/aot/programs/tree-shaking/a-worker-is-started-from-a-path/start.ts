const worker = new Worker("./main.ts");
const answers: string[] = [];
worker.onmessage = event => {
  answers.push(event.data);
  if (answers.length < 2) return;
  console.log(answers.join(", "));
  worker.terminate();
};
worker.postMessage("first");
worker.postMessage("second");
