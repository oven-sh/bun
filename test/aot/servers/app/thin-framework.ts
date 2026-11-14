// A thin framework over Bun.serve, written for a compiler that uses types. It has the parts of a framework that the servers here need: routes with parameters, middleware
// with `await next()`, typed context variables, response headers, an error handler and a 404 handler.
// Three choices keep a request cheap: routes go to Bun.serve's own router; the middleware chain of a route is built once, when the route is added; and the Response is
// built once, after the chain has run, so a header set by a middleware after `await next()` is an array push.
export type Next = () => Promise<void>;
export type Handler<Variables> = (c: Context<Variables>) => void | Promise<void>;
export type Middleware<Variables> = (c: Context<Variables>, next: Next) => Promise<void>;
export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type RouteHandler = (request: Request & { params: Record<string, string> }) => Promise<Response> | Response;

export class Context<Variables> {
  readonly request: Request;
  readonly params: Record<string, string>;
  readonly variables: Partial<Variables> = {};
  private headerNames: string[] = [];
  private headerValues: string[] = [];
  private body: string | ReadableStream<Uint8Array> = "";
  private status: number = 200;
  private contentType: string = "text/plain;charset=UTF-8";
  private searchParams: URLSearchParams | undefined;

  constructor(request: Request, params: Record<string, string>) {
    this.request = request;
    this.params = params;
  }

  requestHeader(name: string): string | undefined {
    return this.request.headers.get(name) ?? undefined;
  }

  param(name: string): string {
    return this.params[name]!;
  }

  query(name: string): string | undefined {
    this.searchParams ??= new URL(this.request.url).searchParams;
    return this.searchParams.get(name) ?? undefined;
  }

  set<Key extends keyof Variables>(key: Key, value: Variables[Key]): void {
    this.variables[key] = value;
  }

  get<Key extends keyof Variables>(key: Key): Variables[Key] {
    return this.variables[key] as Variables[Key];
  }

  header(name: string, value: string): void {
    this.headerNames.push(name);
    this.headerValues.push(value);
  }

  text(body: string, status: number = 200): void {
    this.body = body;
    this.status = status;
    this.contentType = "text/plain;charset=UTF-8";
  }

  json<Value>(value: Value, status: number = 200): void {
    this.body = JSON.stringify(value);
    this.status = status;
    this.contentType = "application/json";
  }

  stream(body: ReadableStream<Uint8Array>, contentType: string): void {
    this.body = body;
    this.status = 200;
    this.contentType = contentType;
  }

  toResponse(): Response {
    const headers: Record<string, string> = { "content-type": this.contentType };
    for (let i = 0; i < this.headerNames.length; i++) headers[this.headerNames[i]!] = this.headerValues[i]!;
    return new Response(this.body, { status: this.status, headers });
  }
}

export class App<Variables = {}> {
  private middlewares: { prefix: string; run: Middleware<Variables> }[] = [];
  private table: Record<string, Partial<Record<Method, RouteHandler>>> = {};
  private handleError: (error: Error, c: Context<Variables>) => void = (error, c) => c.text(error.message, 500);
  private handleNotFound: Handler<Variables> = (c) => c.text("Not Found", 404);

  use(prefix: string, run: Middleware<Variables>): void {
    this.middlewares.push({ prefix, run });
  }

  onError(handle: (error: Error, c: Context<Variables>) => void): void {
    this.handleError = handle;
  }

  notFound(handle: Handler<Variables>): void {
    this.handleNotFound = handle;
  }

  private chainFor(path: string, last: Handler<Variables>): Handler<Variables> {
    let run: Handler<Variables> = last;
    const applicable = this.middlewares.filter((each) => path.startsWith(each.prefix));
    for (let i = applicable.length - 1; i >= 0; i--) {
      const middleware = applicable[i]!.run;
      const inner = run;
      run = (c) =>
        middleware(c, async () => {
          try {
            await inner(c);
          } catch (error) {
            if (!(error instanceof Error)) throw error;
            this.handleError(error, c);
          }
        });
    }
    return run;
  }

  private async finish(pending: Promise<void>, c: Context<Variables>): Promise<Response> {
    try {
      await pending;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      this.handleError(error, c);
    }
    return c.toResponse();
  }

  private respond(run: Handler<Variables>, c: Context<Variables>): Promise<Response> | Response {
    try {
      const pending = run(c);
      if (pending) return this.finish(pending, c);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      this.handleError(error, c);
    }
    return c.toResponse();
  }

  on(method: Method, path: string, handle: Handler<Variables>): void {
    const run = this.chainFor(path, handle);
    (this.table[path] ??= {})[method] = (request) => this.respond(run, new Context<Variables>(request, request.params));
  }

  get routes(): Record<string, Partial<Record<Method, RouteHandler>>> {
    return this.table;
  }

  fetch = (request: Request): Promise<Response> | Response => {
    const path = new URL(request.url).pathname;
    return this.respond(this.chainFor(path, this.handleNotFound), new Context<Variables>(request, {}));
  };
}
