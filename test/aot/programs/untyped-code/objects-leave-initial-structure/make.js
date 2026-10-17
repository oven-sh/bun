export function literal(raw, id, name) { return { raw, sent: false, id, name }; }
export function Thing(raw, id, name) { this.raw = raw; this.sent = false; this.id = id; this.name = name; }
Thing.prototype.send = function (value) { this.sent = true; return value; };
export class Kind { constructor(raw, id, name) { this.raw = raw; this.sent = false; this.id = id; this.name = name; } send(value) { this.sent = true; return value; } }
export function Heir(raw, id, name, more) { Thing.call(this, raw, id, name); this.more = more; }
Heir.prototype = Object.create(Thing.prototype);
export function Guarded(raw, id, name) { if (!(this instanceof Guarded)) return new Guarded(raw, id, name); this.raw = raw; this.sent = false; this.id = id; this.name = name; }
export function Sometimes(raw, id, name, early) { this.raw = raw; if (early) this.early = early; this.sent = false; this.id = id; this.name = name; }
export function Emitter() { if (this.listeners === undefined || this.listeners === Object.getPrototypeOf(this).listeners) { this.listeners = null; this.count = 0; } }
export function Listening(raw, id, name) { Emitter.call(this); this.raw = raw; this.sent = false; this.id = id; this.name = name; }
Listening.prototype = Object.create(Emitter.prototype);
export class Fields { raw = null; sent = false; id = 0; name = ""; constructor(raw, id, name) { this.raw = raw; this.id = id; this.name = name; } }
export class Derived extends Fields { more = 1; constructor(raw, id, name) { super(raw, id, name); this.last = 2; } }
export class Quiet extends Fields {}
export function Keyed(raw, id, name, key) { this.raw = raw; this[key] = 1; this.sent = false; this.id = id; this.name = name; }
