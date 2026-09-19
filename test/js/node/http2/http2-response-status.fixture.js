// Calls ServerHttp2Stream#respond(), respondWithFile() and respondWithFD() once per case, each on
// its own stream, and reports one line per case: what the call threw and what the client received.
// node-http2.test.js runs it in-process under Bun and as a script under Node.js (argv[2] is a file
// whose content is "file body"): the lines must be identical.
const http2 = require("node:http2");
const fs = require("node:fs");

const neverIndex = http2.sensitiveHeaders;

function buildCases(file) {
  const methods = {
    respond(stream, headers) {
      stream.respond(headers);
      stream.end("respond body");
    },
    respondWithFile(stream, headers, options) {
      stream.respondWithFile(file, headers, options);
    },
    respondWithFD(stream, headers, options, fd) {
      if (fd === undefined) {
        fd = fs.openSync(file, "r");
        stream.on("close", () => fs.closeSync(fd));
      }
      stream.respondWithFD(fd, headers, options);
    },
  };

  const cases = [];
  function add(name, run) {
    cases.push({ name, run });
  }

  for (const method of Object.keys(methods)) {
    const statuses = [
      // Each of these coerces to 0 with `| 0`. Node sends 200 for them.
      ["0", 0],
      ['""', ""],
      ["null", null],
      ["NaN", NaN],
      ['"abc"', "abc"],
      ['"404"', "404"],
      // A 1xx block is not a final response: node rejects every 1xx here, 101 included.
      ["99", 99],
      ["100", 100],
      ["101", 101],
      ["600", 600],
    ];
    if (method !== "respond") statuses.push(['"204"', "204"]);
    for (const [label, value] of statuses) {
      add(`${method}({ ":status": ${label} })`, stream => methods[method](stream, { ":status": value }));
    }
    // A never-index list that is not an array is rejected after the status range check.
    add(`${method}({ [sensitiveHeaders]: "x" })`, stream => methods[method](stream, { [neverIndex]: "x" }));
    add(`${method}({ ":status": 99, [sensitiveHeaders]: "x" })`, stream =>
      methods[method](stream, { ":status": 99, [neverIndex]: "x" }),
    );
  }

  // The status is checked before the header list is walked.
  add(`respond({ ":status": 99, "content-type": ["a", "b"] })`, stream =>
    methods.respond(stream, { ":status": 99, "content-type": ["a", "b"] }),
  );
  add(`respond([":status", 100])`, stream => methods.respond(stream, [":status", 100]));
  // The date default is added before the header list is walked too: a `Date` key makes two date
  // fields, and a date value that cannot be sent is dropped with no default in its place.
  add(`respond({ Date: "x" })`, stream => methods.respond(stream, { Date: "x" }));
  add(`respond({ date: "x\\r\\n" })`, stream => methods.respond(stream, { date: "x\r\n" }));

  // `options` is validated before the headers, and in respondWithFD() before `fd` too.
  for (const method of ["respondWithFile", "respondWithFD"]) {
    add(`${method}({ ":status": 99 }, { offset: "1" })`, stream =>
      methods[method](stream, { ":status": 99 }, { offset: "1" }),
    );
    add(`${method}({ ":status": 204 }, { statCheck: 1 })`, stream =>
      methods[method](stream, { ":status": 204 }, { statCheck: 1 }),
    );
    add(`${method}("headers", { length: "1" })`, stream => methods[method](stream, "headers", { length: "1" }));
    add(`${method}({ ":status": 204, [sensitiveHeaders]: "x" })`, stream =>
      methods[method](stream, { ":status": 204, [neverIndex]: "x" }),
    );
    // statCheck receives the prepared headers.
    add(`${method}({ ":status": "0" }, { statCheck })`, (stream, note) =>
      methods[method](
        stream,
        { ":status": "0" },
        {
          statCheck(stat, headers) {
            note(`statCheck saw :status ${JSON.stringify(headers[":status"])} and a ${typeof headers.date} date`);
          },
        },
      ),
    );
  }
  add(`respondWithFD("fd", { ":status": 99 }, { offset: "1" })`, stream =>
    methods.respondWithFD(stream, { ":status": 99 }, { offset: "1" }, "fd"),
  );
  add(`respondWithFD("fd", { ":status": 99 })`, stream =>
    methods.respondWithFD(stream, { ":status": 99 }, undefined, "fd"),
  );

  // A closed stream is rejected before every other check, like a destroyed one.
  for (const method of ["respondWithFile", "respondWithFD"]) {
    add(`close(), then ${method}({ ":status": 99 }, { offset: "1" })`, stream => {
      stream.close();
      methods[method](stream, { ":status": 99 }, { offset: "1" });
    });
  }
  return cases;
}

function request(client, path) {
  return new Promise(resolve => {
    const req = client.request({ ":path": path });
    const seen = [];
    let body = "";
    req.setEncoding("utf8");
    req.on("headers", headers => seen.push(`headers ${headers[":status"]}`));
    req.on("response", headers => {
      seen.push(`response ${headers[":status"]}`);
      if (headers.date === undefined) seen.push("no date");
    });
    req.on("data", chunk => (body += chunk));
    req.on("error", err => seen.push(`error ${err.code}`));
    req.on("close", () => {
      seen.push(`body ${JSON.stringify(body)}`);
      resolve(seen.join(", "));
    });
    req.end();
  });
}

async function run(file) {
  const cases = buildCases(file);
  const lines = [];
  const server = http2.createServer();
  const serverSide = [];
  server.on("stream", (stream, headers) => {
    const index = Number(headers[":path"].slice(1));
    const seen = (serverSide[index] = []);
    stream.on("error", err => seen.push(`stream error ${err.code}`));
    try {
      cases[index].run(stream, note => seen.push(note));
      seen.unshift("returns");
    } catch (err) {
      seen.unshift(`throws ${err.name} ${err.code}: ${err.message}`);
      // A synchronous throw leaves the stream open for another response.
      if (!stream.closed) {
        stream.respond({ ":status": 200 });
        stream.end("fallback");
      }
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const client = http2.connect(`http://127.0.0.1:${server.address().port}`);
  client.on("error", err => lines.push(`client session error ${err.code}`));
  const clientSide = await Promise.all(cases.map((_, i) => request(client, `/${i}`)));
  for (let i = 0; i < cases.length; i++) {
    lines.push(
      `${cases[i].name}: ${(serverSide[i] ?? ["never reached the server"]).join(", ")} | client: ${clientSide[i]}`,
    );
  }
  client.close();
  server.close();
  return lines;
}

module.exports = { run };

if (require.main === module) {
  run(process.argv[2]).then(lines => console.log(lines.join("\n")));
}
