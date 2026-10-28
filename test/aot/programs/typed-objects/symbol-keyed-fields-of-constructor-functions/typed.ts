const kCapture = Symbol("kCapture");
const kHandle = Symbol("kHandle");
const kState = Symbol("kState");

export interface Emitter { _events: object | undefined; _eventsCount: number; [kCapture]: boolean }
export function Emitter(this: Emitter) {
  this._events = undefined;
  this._eventsCount = 0;
  this[kCapture] = false;
}
Emitter.prototype.listenerCount = function (this: Emitter) { return this._eventsCount; };

export interface Outgoing extends Emitter { finished: boolean; _header: string | null; [kState]: number }
export function Outgoing(this: Outgoing) {
  Emitter.call(this);
  this.finished = false;
  this._header = null;
  this[kState] = 0;
}
Object.setPrototypeOf(Outgoing.prototype, Emitter.prototype);
Outgoing.prototype.setState = function (this: Outgoing, state: number) { this[kState] = state; };

export interface Response extends Outgoing { req: unknown; statusCode: number; [kHandle]: object | undefined }
export function Response(this: Response, req: unknown, handle: object | undefined) {
  Outgoing.call(this);
  this.req = req;
  this.statusCode = 200;
  this[kHandle] = handle;
}
Object.setPrototypeOf(Response.prototype, Outgoing.prototype);
Response.prototype.end = function (this: Response) {
  if (this.finished) return this;
  this.finished = true;
  this[kState] = 2;
  this._header = "x";
  return this;
};
const ResponseConstructor = Response as unknown as new (req: unknown, handle: object | undefined) => Response;
const handle = {};
export function dispatch(handler: (response: Response) => unknown, req: unknown): number {
  const response = new ResponseConstructor(req, handle);
  handler(response);
  return finish(response);
}
function finish(response: Response): number {
  let n = response.statusCode + response[kState] + response._eventsCount;
  if (response.finished) n++;
  if (response[kHandle] !== undefined) n++;
  return n;
}
