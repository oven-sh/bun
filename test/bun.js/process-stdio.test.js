import { describe, it, expect, beforeAll } from "bun:test";
import { spawn, execSync } from "node:child_process";

const CHILD_PROCESS_FILE = import.meta.dir + "/spawned-child.js";
const OUT_FILE = import.meta.dir + "/stdio-test-out.txt";

// describe("process.stdout", () => {
//   // it("should allow us to write to it", () => {
//   //   process.stdout.write("Bun is cool\n");
//   // });
//   // it("should allow us to use a file as stdout", () => {
//   //   const output = "Bun is cool\n";
//   //   execSync(`rm -f ${OUT_FILE}`);
//   //   const result = execSync(`bun ${CHILD_PROCESS_FILE} STDOUT > ${OUT_FILE}`, {
//   //     encoding: "utf8",
//   //     stdin,
//   //   });
//   //   expect(result).toBe(output);
//   //   expect(readSync(OUT_FILE)).toBe(output);
//   // });
// });

describe("process.stdin", () => {
  it("should allow us to read from stdin in readable mode", (done) => {
    // Child should read from stdin and write it back
    const child = spawn("bun", [CHILD_PROCESS_FILE, "STDIN", "READABLE"]);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (data) => {
      expect(data.trim()).toBe("data: hello");
      done();
    });
    child.stdin.write("hello\n");
    child.stdin.end();
  });

  it("should allow us to read from stdin via flowing mode", (done) => {
    // Child should read from stdin and write it back
    const child = spawn("bun", [CHILD_PROCESS_FILE, "STDIN", "FLOWING"]);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (data) => {
      expect(data.trim()).toBe("data: hello");
      done();
    });
    child.stdin.write("hello\n");
    child.stdin.end();
  });

  it("should allow us to read > 65kb from stdin", (done) => {
    // Child should read from stdin and write it back
    const child = spawn("bun", [CHILD_PROCESS_FILE, "STDIN", "FLOWING"]);
    child.stdout.setEncoding("utf8");

    const numReps = Math.ceil((66 * 1024) / 5);
    const input = "hello".repeat(numReps);

    let data = "";
    child.stdout.on("end", () => {
      expect(data).toBe(`data: ${input}`);
      done();
    });
    child.stdout.on("readable", () => {
      let chunk;
      while ((chunk = child.stdout.read()) !== null) {
        data += chunk.trim();
      }
    });
    child.stdin.write(input);
    child.stdin.end();
  });

  it("should allow us to read from a file", () => {
    const result = execSync(
      `bun ${CHILD_PROCESS_FILE} STDIN FLOWING < ${
        import.meta.dir
      }/readFileSync.txt`,
      { encoding: "utf8" },
    );
    expect(result.trim()).toEqual("File read successfully");
  });
});
