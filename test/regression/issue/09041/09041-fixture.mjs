// This file is intended to be able to run in Node and Bun
import { Readable, pipeline, PassThrough } from "node:stream";

pipeline(Readable.toWeb(process.stdin), new PassThrough(), process.stdout, () => {});
