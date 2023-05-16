import * as http from "http";
import * as fs from "fs";

const distDir = process.argv[2];
if (!distDir) {
  throw new Error(".");
}

const server = http.createServer((req, res) => {
  if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    fs.createReadStream("./index.html").pipe(res);
  } else if (req.url === "/favicon.ico") {
    res.writeHead(200, { "Content-Type": "image/x-icon" });
    fs.createReadStream("../favicon.ico").pipe(res);
  } else if (!req.url.includes("..") && fs.existsSync(distDir + req.url)) {
    res.writeHead(200, { "Content-Type": "text/javascript" });
    fs.createReadStream(distDir + req.url).pipe(res);
  } else {
    res.writeHead(404);
    res.end();
  }
});
server.listen(3000, "127.0.0.1");
console.log("Listening on http://localhost:3000");
