declare module "koa" {
  import type { IncomingMessage, Server, ServerResponse } from "node:http";

  namespace Koa {
    interface Request {
      body?: unknown;
    }
    interface Context {
      req: IncomingMessage;
      res: ServerResponse;
      request: Request;
      params: { [name: string]: any };
      query: { [name: string]: unknown };
      status: number;
      type: string;
      body: unknown;
      state: { [name: string]: unknown };
      get(name: string): string;
      set(name: string, value: string): void;
    }
    type Next = () => Promise<void>;
    type Middleware = (ctx: Context, next: Next) => unknown;
  }

  class Koa {
    use(middleware: Koa.Middleware): this;
    listen(port: number, hostname: string, callback?: () => void): Server;
  }
  export = Koa;
}

declare module "@koa/router" {
  import type { Middleware } from "koa";

  export default class Router {
    get(path: string, ...middleware: Middleware[]): this;
    post(path: string, ...middleware: Middleware[]): this;
    routes(): Middleware;
    allowedMethods(): Middleware;
  }
}

declare module "@koa/bodyparser" {
  import type { Middleware } from "koa";

  export function bodyParser(): Middleware;
}
