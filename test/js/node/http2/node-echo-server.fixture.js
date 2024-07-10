const http2 = require("http2");
const fs = require("fs");
const server = http2.createSecureServer({
  ...JSON.parse(process.argv[2]),
  rejectUnauthorized: false,
});
const setCookie = ["a=b", "c=d; Wed, 21 Oct 2015 07:28:00 GMT; Secure; HttpOnly", "e=f"];

server.on("stream", (stream, headers, flags) => {
  // errors here are not useful the test should handle on the client side
  stream.on("error", err => console.error(err));

  if (headers["x-wait-trailer"]) {
    const response = { headers, flags };
    stream.respond({
      "content-type": "text/html",
      ":status": 200,
      "set-cookie": setCookie,
    });
    stream.on("trailers", (headers, flags) => {
      stream.end(JSON.stringify({ ...response, trailers: headers }));
    });
  } else if (headers["x-no-echo"]) {
    let byteLength = 0;
    stream.on("data", chunk => {
      byteLength += chunk.length;
    });
    stream.respond({
      "content-type": "application/json",
      ":status": 200,
    });
    stream.on("end", () => {
      stream.end(JSON.stringify(byteLength));
    });
  } else {
    // Store the request information, excluding pseudo-headers in the header echo
    const requestData = {
      method: headers[":method"],
      path: headers[":path"],
      headers: Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])),
      body: [],
      url: `${baseurl}${headers[":path"]}`,
    };

    // Collect data from the stream
    stream.on("data", chunk => {
      requestData.body.push(chunk);
    });

    // Once all data is received, echo it back
    stream.on("end", () => {
      if (requestData.body.length > 0) {
        requestData.data = Buffer.concat(requestData.body).toString();
        try {
          requestData.json = JSON.parse(requestData.data); // Convert buffer array to string
        } catch (e) {}
      }
      stream.respond({
        "content-type": "application/json",
        ":status": 200,
        // Set security and cache-control headers
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "set-cookie": setCookie,
      });
      stream.end(JSON.stringify(requestData));
    });
  }
});
let baseurl = "https://localhost:";

server.listen(0, "localhost");

server.on("listening", () => {
  const { port, address, family } = server.address();
  baseurl = `https://localhost:${port}`;
  process.stdout.write(JSON.stringify({ port, address: "localhost", family: "IPv4" }));
});
