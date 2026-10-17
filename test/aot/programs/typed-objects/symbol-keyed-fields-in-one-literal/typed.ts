import { kHandle, kState, kHeaders, kCallback, kSocket, kPending } from "./symbols";
export interface Response {
  statusCode: number;
  finished: boolean;
  req: any;
  [kHandle]: any;
  [kState]: any;
  [kHeaders]: any;
  [kCallback]: any;
  [kSocket]: any;
  [kPending]: any;
}
export function ServerResponse() {}
ServerResponse.prototype.end = function end(this: Response) {
  this.finished = true;
  this[kState] = 2;
  this[kCallback]?.(this);
  return this;
};
ServerResponse.prototype.header = function header(this: Response, name: string, value: string) {
  (this[kHeaders] ??= new Map()).set(name, value);
  return this[kHeaders]?.size;
};
export function make(req: any, handle: any): Response {
  const made: Response = {
    statusCode: 200,
    finished: false,
    req,
    [kHandle]: handle,
    [kState]: 0,
    [kHeaders]: undefined,
    [kCallback]: undefined,
    [kSocket]: undefined,
    [kPending]: undefined,
  };
  Object.setPrototypeOf(made, ServerResponse.prototype);
  return made;
}
export function finish(response: Response | undefined): number {
  let n = response?.[kState] + response?.statusCode;
  if (response?.[kHandle]?.id) n += response[kHandle].id;
  if (response![kPending] === undefined) n++;
  return n;
}
