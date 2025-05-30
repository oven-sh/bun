import { describe, expect, test } from "bun:test";
const { HTTPParser, ConnectionsList } = process.binding("http_parser");

describe("HTTPParser.prototype.close", () => {
  test("does not double free", () => {
    const parser = new HTTPParser();

    expect(parser.close()).toBeUndefined();
    expect(parser.close()).toBeUndefined();
  });

  test("does not segfault calling other methods after close", () => {
    const parser = new HTTPParser();

    parser.close();

    // implementation was freed, test each method

    expect(parser.close()).toBeUndefined();
    expect(parser.free()).toBeUndefined();
    expect(parser.remove()).toBeUndefined();
    expect(parser.execute()).toBeUndefined();
    expect(parser.finish()).toBeUndefined();
    expect(parser.initialize()).toBeUndefined();
    expect(parser.pause()).toBeUndefined();
    expect(parser.resume()).toBeUndefined();
    expect(parser.consume()).toBeUndefined();
    expect(parser.unconsume()).toBeUndefined();
    expect(parser.getCurrentBuffer()).toBeUndefined();
    expect(parser.duration()).toBeUndefined();
    expect(parser.headersCompleted()).toBeUndefined();
  });
});
