import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// The library lays two accessors of its own on every http.Server. The short dispatcher reads fields off the server, so it asks first whether the server is as its class makes it.
// The fixture does one deed to the accessor `maxHeadersCount` of a fresh server at a time and tells the road of its requests by who called the listener, without touching the server.
function read(stdout: string) {
  const lines = stdout.split("\n");
  return {
    answers: lines.filter(line => line.startsWith("answer: ")),
    roadsDiffer: lines.includes("roads differ: true"),
    roads: lines
      .filter(line => line.startsWith("road: "))
      .map(line => /^road: (.*): expected (\w+): (.*)$/.exec(line)!.slice(1)),
  };
}

// The constructor of http.Server lays the two accessors on the objects of a class below it too, the program's own among them.
function madeByAnHeir(fixture: string) {
  const text = fixture
    .replace("const deeds = [", "class Mine extends http.Server {}\nconst deeds = [")
    .replace("http.createServer(", "new Mine(");
  expect(text.length).toBe(
    fixture.length + "class Mine extends http.Server {}\n".length + "new Mine(".length - "http.createServer(".length,
  );
  return text;
}

test.each([
  ["http.createServer()", [] as string[]],
  ["http.createServer()", ["--aot-allow-code-from-disk"]],
  ["a class of the program below http.Server", [] as string[]],
  ["a class of the program below http.Server", ["--aot-allow-code-from-disk"]],
])(
  "a server whose own accessors are the library's takes the short dispatcher; one on which a program laid a function of its own does not: %s %j",
  async (maker, flags) => {
    const fixture = await Bun.file(
      join(import.meta.dir, "what-is-laid-on-a-server-object", "deeds.fixture.mjs"),
    ).text();
    using dir = tempDir("what-is-laid-on-a-server-object", {
      "deeds.mjs": maker === "http.createServer()" ? fixture : madeByAnHeir(fixture),
    });
    const executable = join(String(dir), isWindows ? "deeds.exe" : "deeds");
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", ...flags, "deeds.mjs", "--outfile", executable],
      String(dir),
      bunEnv,
    );
    expect(built.exitCode).toBe(0);
    const plain = read((await run([bunExe(), "deeds.mjs"], String(dir), bunEnv)).stdout);
    const compiled = read((await run([executable], String(dir), bunEnv)).stdout);
    expect(plain.answers.length).toBe(16);
    expect(compiled.answers).toEqual(plain.answers);
    // The case holds nothing unless there are two roads to tell apart.
    expect(compiled.roadsDiffer).toBe(true);
    expect(compiled.roads.map(([deed, , taken]) => [deed, taken])).toEqual(
      compiled.roads.map(([deed, expected]) => [deed, expected]),
    );
  },
);
