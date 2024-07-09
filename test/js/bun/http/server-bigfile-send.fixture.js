import { serve, file } from "bun";
import { join } from "node:path";
const bigfile = join(import.meta.dir, "../../web/encoding/utf8-encoding-fixture.bin");
const server = serve({
  port: 0,
  async fetch() {
    return new Response(file(bigfile), {
      headers: { "Content-Type": "text/html" },
    });
  },
});

console.log(server.url.href);
