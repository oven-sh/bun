declare module "express" {
  import type { IncomingMessage, Server, ServerResponse } from "node:http";

  namespace express {
    interface Request extends IncomingMessage {
      params: { [name: string]: any };
      query: { [name: string]: unknown };
      body: unknown;
    }
    interface Response extends ServerResponse {
      type(value: string): this;
      status(code: number): this;
      send(body: string): this;
      json(body: unknown): this;
    }
    type NextFunction = (error?: unknown) => void;
    type Handler = (req: Request, res: Response, next: NextFunction) => unknown;
    interface Application {
      get(path: string, ...handlers: Handler[]): this;
      post(path: string, ...handlers: Handler[]): this;
      use(...handlers: Handler[]): this;
      listen(port: number, hostname: string, callback?: () => void): Server;
    }
    function json(): Handler;
    function text(options: { type: string }): Handler;
  }

  function express(): express.Application;
  export = express;
}
