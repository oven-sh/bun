import { expectType } from "./utilities";

class TrimmedResponse extends Response {
  override async text(): Promise<string> {
    return (await super.text()).trim();
  }
  override async json(): Promise<unknown> {
    return super.json();
  }
  override async arrayBuffer(): Promise<ArrayBuffer> {
    return super.arrayBuffer();
  }
  override get ok(): boolean {
    return true;
  }
  override clone(): TrimmedResponse {
    return new TrimmedResponse(null);
  }
}

class TracedRequest extends Request {
  override async text(): Promise<string> {
    return super.text();
  }
  override get method(): string {
    return "GET";
  }
  override clone(): TracedRequest {
    return new TracedRequest(this);
  }
}

class LowercaseHeaders extends Headers {
  override get(name: string): string | null {
    return super.get(name.toLowerCase());
  }
  override set(name: string, value: string): void {
    super.set(name.toLowerCase(), value);
  }
  override has(name: string): boolean {
    return super.has(name.toLowerCase());
  }
}

class NamedBlob extends Blob {
  override async text(): Promise<string> {
    return super.text();
  }
  override slice(start?: number, end?: number, contentType?: string): Blob {
    return super.slice(start, end, contentType);
  }
}

class ShownURL extends URL {
  override toString(): string {
    return super.toString();
  }
  override toJSON(): string {
    return super.toJSON();
  }
}

class SortedParams extends URLSearchParams {
  override get(name: string): string | null {
    return super.get(name);
  }
  override toString(): string {
    this.sort();
    return super.toString();
  }
}

const response = new TrimmedResponse(" a ");
expectType(response.text()).is<Promise<string>>();
expectType(response.clone()).is<TrimmedResponse>();
expectType(new Response("a").clone()).is<Response>();
expectType(new Request("http://localhost").clone()).is<Request>();

const readText: () => Promise<string> = response.text.bind(response);
const getHeader: (name: string) => string | null = response.headers.get.bind(response.headers);
const asResponse: Response = response;
const asRequest: Request = new TracedRequest("http://localhost");
const asHeaders: Headers = new LowercaseHeaders();
for (const [name, value] of asHeaders) expectType([name, value]).is<string[]>();
new Response(null, { headers: asHeaders });
new Headers(asHeaders);
void fetch(asRequest, { headers: new LowercaseHeaders({ a: "b" }) });

export { NamedBlob, ShownURL, SortedParams, asResponse, getHeader, readText };
