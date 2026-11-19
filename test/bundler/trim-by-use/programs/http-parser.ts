const { HTTPParser, methods }: any = (process as any).binding("http_parser");
const parser = new HTTPParser();
parser.initialize(HTTPParser.REQUEST, {});
parser[HTTPParser.kOnHeadersComplete] = (
  major: number,
  minor: number,
  headers: string[],
  method: number,
  url: string,
) => {
  console.log(major, minor, headers.join("|"), methods[method], url);
};
parser[HTTPParser.kOnBody] = (body: Uint8Array) => console.log(Buffer.from(body).toString());
parser[HTTPParser.kOnMessageComplete] = () => console.log("complete");
console.log(
  parser.execute(Buffer.from("POST /items?x=1 HTTP/1.1\r\nHost: localhost\r\nContent-Length: 5\r\n\r\nhello")),
);
const bad = new HTTPParser();
bad.initialize(HTTPParser.REQUEST, {});
console.log((bad.execute(Buffer.from("NOT HTTP\r\n\r\n")) as Error).message);
