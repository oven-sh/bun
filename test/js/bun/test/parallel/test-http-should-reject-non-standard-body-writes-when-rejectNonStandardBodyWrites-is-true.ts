import { createTest } from "node-harness";
import { once } from "node:events";
import http from "node:http";
const { expect } = createTest(import.meta.path);

let body_not_allowed_on_write;
let body_not_allowed_on_end;

await using server = http.createServer({
  rejectNonStandardBodyWrites: true,
});

server.on("request", (req, res) => {
  body_not_allowed_on_write = false;
  body_not_allowed_on_end = false;
  res.writeHead(204);

  try {
    res.write("bun");
  } catch (e: any) {
    expect(e?.code).toBe("ERR_HTTP_BODY_NOT_ALLOWED");
    body_not_allowed_on_write = true;
  }
  try {
    res.end("bun");
  } catch (e: any) {
    expect(e?.code).toBe("ERR_HTTP_BODY_NOT_ALLOWED");
    body_not_allowed_on_end = true;
    // if we throw here, we need to call end() to actually end the request
    res.end();
  }
});

await once(server.listen(0), "listening");
const url = `http://localhost:${server.address().port}`;

{
  await fetch(url, {
    method: "GET",
  }).then(res => res.text());

  expect(body_not_allowed_on_write).toBe(true);
  expect(body_not_allowed_on_end).toBe(true);
}
