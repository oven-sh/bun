import { Writable } from "node:stream";
import { renderToPipeableStream } from "react-dom/server.node";
import { run } from "../turns";
import { page } from "./react/pages";

const name = process.argv[2];

await run(
  () =>
    new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const sink = new Writable({
        write(chunk: Buffer, _encoding, done) {
          chunks.push(chunk);
          done();
        },
        final(done) {
          resolve(Buffer.concat(chunks).toString());
          done();
        },
      });
      const { pipe } = renderToPipeableStream(page(name), { onAllReady: () => pipe(sink), onError: reject });
    }),
  { asARequest: true },
);
