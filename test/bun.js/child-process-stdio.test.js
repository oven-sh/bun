import { describe, it, expect, beforeAll } from "bun:test";
import { spawn, execSync } from "node:child_process";
import { bunExe } from "bunExe";

const CHILD_PROCESS_FILE = import.meta.dir + "/spawned-child.js";
const OUT_FILE = import.meta.dir + "/stdio-test-out.txt";

describe("process.stdout", () => {
  it("should allow us to write to it", (done) => {
    const child = spawn(bunExe(), [CHILD_PROCESS_FILE, "STDOUT"]);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (data) => {
      try {
        expect(data).toBe("stdout_test");
        done();
      } catch (err) {
        done(err);
      }
    });
  });
});

describe("process.stdin", () => {
  it("should allow us to read from stdin in readable mode", (done) => {
    const input = "hello\n";
    // Child should read from stdin and write it back
    const child = spawn(bunExe(), [CHILD_PROCESS_FILE, "STDIN", "READABLE"]);
    let data = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      data += chunk;
    }).on("end", function() {
      try {
        expect(data).toBe(`data: ${input}`);
        done();
      } catch (err) {
        done(err);
      }
    });
    child.stdin.write(input);
    child.stdin.end();
  });

  it("should allow us to read from stdin via flowing mode", (done) => {
    const input = "hello\n";
    // Child should read from stdin and write it back
    const child = spawn(bunExe(), [CHILD_PROCESS_FILE, "STDIN", "FLOWING"]);
    let data = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("readable", () => {
      let chunk;
      while ((chunk = child.stdout.read()) !== null) {
        data += chunk;
      }
    }).on("end", function() {
      try {
        expect(data).toBe(`data: ${input}`);
        done();
      } catch (err) {
        done(err);
      }
    });
    child.stdin.write(input);
    child.stdin.end();
  });

  it("should allow us to read > 65kb from stdin", (done) => {
    const numReps = Math.ceil((66 * 1024) / 5);
    const input = "hello".repeat(numReps);
    // Child should read from stdin and write it back
    const child = spawn(bunExe(), [CHILD_PROCESS_FILE, "STDIN", "FLOWING"]);
    let data = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("readable", () => {
      let chunk;
      while ((chunk = child.stdout.read()) !== null) {
        data += chunk;
      }
    }).on("end", function() {
      try {
        expect(data).toBe(`data: ${input}`);
        done();
      } catch (err) {
        done(err);
      }
    });
    child.stdin.write(input);
    child.stdin.end();
  });

  it("should allow us to read from a file", () => {
    const result = execSync(
      `${bunExe()} ${CHILD_PROCESS_FILE} STDIN FLOWING < ${
        import.meta.dir
      }/readFileSync.txt`,
      { encoding: "utf8" },
    );
    expect(result).toEqual("data: File read successfully");
  });
});
