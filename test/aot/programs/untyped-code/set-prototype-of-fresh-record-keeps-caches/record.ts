export interface Reply {
  count: number; limit: number | undefined; open: boolean; size: number; closed: boolean; head: string | null; state: number;
  later0: object | undefined; later1: object | undefined; later2: object | undefined; later3: object | undefined; later4: object | undefined; later5: object | undefined; later6: object | undefined; later7: object | undefined; later8: object | undefined; later9: object | undefined; later10: object | undefined; later11: object | undefined;
  from: unknown; status: number; message: string | undefined; handle: object | undefined;
}
export function Shared(this: any) {}
Shared.prototype.finish = function (this: any) { return finish(this); };
function finish(r: Reply): Reply {
  if (r.closed) return r;
  r.closed = true;
  r.state = 2;
  r.head = "x";
  return r;
}
const prototype: object = Shared.prototype;
const handle = {};
function make(from: unknown): Reply {
  const made: Reply = {
    count: 0, limit: undefined, open: true, size: 0, closed: false, head: null, state: 0,
    later0: undefined, later1: undefined, later2: undefined, later3: undefined, later4: undefined, later5: undefined, later6: undefined, later7: undefined, later8: undefined, later9: undefined, later10: undefined, later11: undefined,
    from, status: 200, message: undefined, handle,
  };
  Object.setPrototypeOf(made, prototype);
  return made;
}
export function dispatch(handler: (r: Reply) => unknown, from: unknown): number {
  const r = make(from);
  handler(r);
  return r.status + r.state + r.count + r.size + (r.closed ? 1 : 0) + (r.handle !== undefined ? 1 : 0);
}
