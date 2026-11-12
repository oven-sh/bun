// A method of a class of Bun's runs on an instance of the class alone, and whoever makes an instance is listed with the features of the class. So what hangs on the
// prototype object of a class keeps none of them: a program that gets a value from native code which the compiler knows nothing about, and calls a method on it, keeps
// what it makes and what it names, and not the databases, the shell, the bundler and the C compiler because one of their classes has a method of that name.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const ofClassesThatNobodyMakes = [
  "Bun.sql and Bun.SQL for PostgreSQL and MySQL (sql)",
  "the Bun.$ shell (shell)",
  "Bun.build, HTML imports and the development server (bundler)",
  "bun:ffi and its C compiler (ffi)",
  "Bun.cron (cron)",
  "Bun.udpSocket and node:dgram (udp)",
  "node:http2 (http2)",
  "node:quic (http3)",
];
const ofChildren = "Bun.spawn and Bun.spawnSync (spawn)";

const aValueThatNobodyKnows = `
const harbor = new WebSocket("ws://localhost:1");
harbor.onerror = () => console.log("no harbor");
harbor.onmessage = letter => console.log(letter.data.query("cargo"), letter.data.resourceUsage());
`;
const programs = {
  "a method is called on a value that native code hands over": aValueThatNobodyKnows,
  "a child is started beside it": `${aValueThatNobodyKnows}console.log(Bun.spawnSync(["true"]).resourceUsage().maxRSS > 0);\n`,
  "a class is named beside it": `${aValueThatNobodyKnows}console.log(typeof Bun.Glob.prototype.match);\n`,
  "a server of node:http says hello": `
import { createServer } from "node:http";
const server = createServer((request, response) => response.end(request.url));
server.listen(0, () => server.close());
`,
};

async function featuresKeptBy(text: string) {
  using dir = tempDir("aot-features-of-classes", { "main.mjs": text });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "check", "--aot", "--no-pretty", "--explain=trim", "main.mjs"],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr] = await Promise.all([proc.stderr.text(), proc.exited]);
  return [...stderr.matchAll(/^aot: trim: kept (.+): used/gm)].map(line => line[1]);
}

// All the programs are checked side by side, once the first case asks.
let checked: Map<string, Promise<string[]>> | undefined;
const keptBy = (title: keyof typeof programs) =>
  (checked ??= new Map(Object.entries(programs).map(([each, text]) => [each, featuresKeptBy(text)]))).get(title)!;

for (const title of Object.keys(programs) as (keyof typeof programs)[]) {
  test(`${title}: no feature of a class that nobody makes is kept`, async () => {
    const kept = await keptBy(title);
    expect(kept).not.toBeEmpty();
    expect(kept.filter(feature => ofClassesThatNobodyMakes.includes(feature))).toEqual([]);
  }, 600_000);
}

test("what a child has used is kept where a child is started, and there alone", async () => {
  expect(await keptBy("a child is started beside it")).toContain(ofChildren);
  expect(await keptBy("a method is called on a value that native code hands over")).not.toContain(ofChildren);
}, 600_000);

test("a class that the program names is kept without an instance", async () => {
  expect(await keptBy("a class is named beside it")).toContain("Bun.Glob (glob)");
}, 600_000);
