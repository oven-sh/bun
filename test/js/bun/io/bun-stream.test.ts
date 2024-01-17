import { expect, it } from "bun:test";
import { tmpdir } from "os";
import fs from "fs";

function create_file(filename, contents) {
    try {
        fs.writeFileSync(filename, contents);
    } catch (e) {
        console.log(e);
    }
}

it("stream a BunFile correctly", async () => {
    const filename = tmpdir() + "bun-stream.test.txt";
    create_file(filename, "12345");

    const file = Bun.file(filename);
    const content = await(new Response(file.stream())).text();
    expect(content).toBe("12345");
    expect(file.size).toBe(5);
});

it("stream on sliced BunFile correctly", async () => {
    const filename = tmpdir() + "bun-stream.test.txt";
    create_file(filename, "12345");

    const file = Bun.file(filename).slice(0, 2);
    const content = await(new Response(file.stream())).text();
    expect(content).toBe("12");
    expect(file.size).toBe(2);
});

it("stream on doubly sliced BunFile", async () => {
    const filename = tmpdir() + "bun-stream.test.txt";
    create_file(filename, "0123456789");

    const file = Bun.file(filename).slice(5, 10).slice(0, 3);
    const content = await(new Response(file.stream())).text();
    expect(content).toBe("567");
    expect(file.size).toBe(3);
});
