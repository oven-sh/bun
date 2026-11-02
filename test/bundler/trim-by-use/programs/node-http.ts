// node:http on 127.0.0.1: a server and a client in one process
import http from "node:http";
const server = http.createServer((request: any, response: any) => {
  let body = "";
  request.on("data", (chunk: any) => (body += chunk));
  request.on("end", () => {
    response.writeHead(request.url === "/missing" ? 404 : 200, {
      "content-type": "text/plain",
      "x-method": request.method,
    });
    response.write(`${request.url} `);
    response.end(body || "empty");
  });
});
const ask = (path: string, method: string, body?: string) =>
  new Promise<string>(resolve => {
    const request = http.request(
      { host: "127.0.0.1", port: (server.address() as { port: number }).port, path, method },
      (response: any) => {
        let text = "";
        response.on("data", (chunk: any) => (text += chunk));
        response.on("end", () => resolve(`${response.statusCode} ${response.headers["x-method"]} ${text}`));
      },
    );
    request.end(body);
  });
server.listen(0, "127.0.0.1", async () => {
  console.log(await ask("/a", "GET"));
  console.log(await ask("/b?c=1", "POST", "posted"));
  console.log(await ask("/missing", "DELETE"));
  server.close(() => console.log("closed"));
});
