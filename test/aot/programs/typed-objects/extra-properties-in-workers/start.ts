import { Worker } from "node:worker_threads";
import { make, work } from "./work";

console.log("main: " + work(20));
const answers: string[] = [];
let waiting = 3;
for (let number = 0; number < 3; number++) {
  const worker = new Worker("./main.ts", { workerData: number });
  worker.on("message", (message: any) => {
    const { request } = message;
    answers[number] = [message.digest, Object.keys(request).join(), request.params, request.query.of, request.route[0], request.self === request, JSON.stringify(message.copy), typeof request.describe].join(" | ");
    if (--waiting) return;
    for (const answer of answers) console.log("worker: " + answer);
    const cloned: any = structuredClone(make(7));
    console.log("clone: " + JSON.stringify(cloned) + " " + Object.keys(cloned).join());
    console.log("main again: " + work(10));
  });
}
