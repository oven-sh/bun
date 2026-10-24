// Workers give objects of declared types properties that the types do not declare, each in its own heap, and send such objects to the main thread. start.ts is the program; this file is what each Worker runs.
import { parentPort, workerData } from "node:worker_threads";
import { make, work } from "./work";

const request: any = make(workerData);
request.self = request;
parentPort!.postMessage({ digest: work(20 + workerData), request, copy: structuredClone(request).query });
