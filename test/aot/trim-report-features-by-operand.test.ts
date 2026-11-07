// The table hangs some features on an operand: an option of Bun.serve, the scheme of an address. Such a feature is kept where a call may meet the condition, and wherever nobody knows the operands.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithBunTypes } from "harness";
import { run } from "./harness/run";
import { describe, test } from "./supported";

// What the program uses. A Bun that can trim also keeps what those features need.
async function kept(text: string) {
  using dir = tempDirWithBunTypes("aot-trim-report-features-by-operand", { "main.ts": text });
  const { stderr } = await run([bunExe(), "check", "--aot", "--no-pretty", "--explain=trim", "main.ts"], String(dir), {
    ...bunEnv,
    NO_COLOR: "1",
  });
  return stderr
    .split("\n")
    .flatMap(line => /^aot: trim: kept (?<feature>.+?)(?: \([a-z0-9-]+\))?: used\b/.exec(line)?.groups?.feature ?? []);
}

const interpreter = "eval, new Function and the JavaScript interpreter";
const temporal = "Temporal and Date.prototype.toTemporalInstant";
const bundler = "Bun.build, HTML imports and the development server";
const nodeServers = "node:http and node:https servers";
const laterProtocols = "HTTP/2 and HTTP/3 in Bun.serve";
const client = "the HTTP client behind fetch, S3 and WebSocket";
const s3 = ["S3 response parsing", "Bun.s3, Bun.S3Client and s3: URLs"];
const byOptionsOfServer = [interpreter, temporal, bundler, nodeServers, laterProtocols, "TLS", client];
const handler = `fetch() { return new Response("a"); }`;

describe.concurrent("the options of Bun.serve", () => {
  test("a server that names none of them keeps none of their features", async () => {
    const features = await kept(`Bun.serve({ port: 3000, ${handler} });`);
    expect(features).toContain("Bun.serve");
    expect(features.filter(feature => byOptionsOfServer.includes(feature))).toEqual([]);
  });
  test("a server that names `tls` keeps TLS", async () => {
    expect(await kept(`Bun.serve({ port: 3000, tls: { key: "a", cert: "b" }, ${handler} });`)).toContain("TLS");
  });
  test.each([
    ["options that nobody knows", `Bun.serve(JSON.parse(process.argv[2]!));`],
    [
      "an option that is laid later",
      `const options: Record<string, unknown> = { port: 3000, ${handler} }; options.tls = { key: "a", cert: "b" }; Bun.serve(options as never);`,
    ],
    [
      "a default export, which the host starts",
      `export default { port: 3000, tls: { key: "a", cert: "b" }, ${handler} };`,
    ],
  ])("%s: every feature stays", async (_, text) => {
    expect(await kept(text)).toEqual(expect.arrayContaining([bundler, nodeServers, laterProtocols, "TLS"]));
  });
});

describe.concurrent("the scheme of an address", () => {
  test("fetch of a written address of another scheme keeps nothing of S3", async () => {
    const features = await kept(`console.log((await fetch("https://made.up/")).ok);`);
    expect(features).toContain(client);
    expect(features.filter(feature => s3.includes(feature))).toEqual([]);
  });
  // The parser of addresses drops blanks in front, and tabs and line breaks everywhere.
  test.each([
    `"s3://made-up/key"`,
    `"S3://made-up/key"`,
    `" s3://made-up/key"`,
    `"\\ts3://made-up/key"`,
    `"s\\n3://made-up/key"`,
    `process.argv[2]!`,
  ])("fetch(%s) keeps S3", async address => {
    expect(await kept(`console.log((await fetch(${address})).ok);`)).toEqual(expect.arrayContaining(s3));
  });
  test("Bun.file of a written path keeps neither S3 nor the HTTP client", async () => {
    const features = await kept(`console.log(await Bun.file("a.txt").text());`);
    expect(features).toContain("Bun.file and Bun.write");
    expect(features.filter(feature => feature === client || s3.includes(feature))).toEqual([]);
  });
  test("Bun.file of an address of S3 keeps both", async () => {
    expect(await kept(`console.log(await Bun.file("s3://made-up/key").text());`)).toEqual(
      expect.arrayContaining([client, ...s3]),
    );
  });
});
