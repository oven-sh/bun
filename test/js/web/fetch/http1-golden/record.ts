// Fills clients.json with what the Bun that runs this script does, and with --parser the results in parser.json.gz too:
//
//   bun record.ts --accept [--parser]
//
// What is in the repository does not come from the code under test:
// - clients.json was recorded with the last Bun that linked picohttpparser (9b8347a24e).
// - No such Bun has `http1Internals`. The results in parser.json.gz were printed by a program that called
//   picohttpparser itself, at f4d94b48 with Bun's patch, the way Bun did, built with and without SSE4.2. The inputs are
//   1,851 that were picked by coverage from the corpus of a fuzzer that compared the two parsers, and reach every line
//   and branch of src/http1, and then every byte value at 16 places of a head and 10 places of a body.
import {
  clients,
  decoded,
  deliveries,
  loadParserCases,
  observed,
  parsed,
  parserCasesPath,
  recordedPath,
  responses,
  type Client,
  type Delivery,
  type Part,
  type Recorded,
} from "./observe";

if (!process.argv.includes("--accept")) {
  throw new Error("This records the code under test. Pass --accept after a change that is meant.");
}

if (process.argv.includes("--parser")) {
  const cases = await loadParserCases();
  for (const head of cases.heads) head[2] = parsed(head[0], head[1]);
  for (const body of cases.bodies) body[2] = decoded(body[0], body[1]);
  await Bun.write(parserCasesPath, Bun.gzipSync(Buffer.from(JSON.stringify(cases)), { level: 9 }));
}

const recorded = {} as Recorded;
for (const client of Object.keys(clients) as Client[]) {
  recorded[client] = {} as Recorded[Client];
  for (const part of Object.keys(responses) as Part[]) {
    const [first, ...others] = await Promise.all(
      (Object.keys(deliveries) as Delivery[]).map(delivery => observed(client, responses[part], delivery)),
    );
    for (const other of others) {
      if (!Bun.deepEquals(first, other)) throw new Error(`${client} ${part}: the result depends on the delivery`);
    }
    recorded[client][part] = Object.fromEntries(responses[part].map(([label]) => [label, first[label]]));
  }
}
// Some of the characters cannot be told apart by eye, or seen at all.
const escaped = JSON.stringify(recorded, null, 1).replace(
  /[^\n -~]/g,
  character => "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"),
);
await Bun.write(recordedPath, escaped + "\n");
