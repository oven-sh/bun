import { createServer } from "node:http";
import st from "st";

function listen(server): Promise<URL> {
  return new Promise(resolve => {
    server.listen({ port: 0 }, () => resolve(new URL("http://localhost:" + server.address().port)));
  });
}
await using server = createServer(st(process.cwd()));
const url = await listen(server);
const res = await fetch(new URL("/st.fixture.ts", url));
console.log(await res.text());
