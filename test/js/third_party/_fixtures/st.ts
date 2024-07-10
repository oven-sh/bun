import { createServer } from "node:http";
import st from "st";

function listen(server): Promise<URL> {
  return new Promise((resolve, reject) => {
    server.listen({ port: 0 }, (err, hostname, port) => {
      if (err) {
        reject(err);
      } else {
        resolve(new URL("http://" + hostname + ":" + port));
      }
    });
  });
}
await using server = createServer(st(process.cwd()));
const url = await listen(server);
const res = await fetch(new URL("/st.ts", url));
console.log(await res.text());
