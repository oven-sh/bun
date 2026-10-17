export class Message {
  declare note?: string;
  declare code?: number;
  url = "/";
  status = 200;
  #hidden = 1;
  setNote(note: string): void {
    this.note = note;
  }
  setCode(code: number): void {
    this.code = code;
  }
  hidden(): number {
    return this.#hidden;
  }
}
export type Props = { id: number; label: string; note?: string; code?: number };
export function makeProps(id: number): Props {
  return { id, label: "x" };
}
export function setNote(props: Props, note: string): void {
  props.note = note;
}
export function setCode(props: Props, code: number): void {
  props.code = code;
}
export function typedKeys(props: Props): string[] {
  return Object.keys(props);
}
export function typedEntries(props: Props): [string, unknown][] {
  return Object.entries(props);
}
export function typedValues(props: Props): unknown[] {
  return Object.values(props);
}
export function typedAssign(props: Props): object {
  return Object.assign({}, props);
}
export function typedSpreadWithMore(props: Props): object {
  return { first: 0, ...props, last: 1 };
}
export function typedRest(props: Props): object {
  const { id, ...others } = props;
  return others;
}
export function typedLoop(props: Props): string {
  let keys = "";
  for (const key in props) keys += key + ";";
  return keys;
}
export function typedMessageKeys(message: Message): string[] {
  return Object.keys(message);
}
export function typedMessageSpread(message: Message): object {
  return { ...message };
}
export class Packed {
  declare note?: unknown;
  declare code?: unknown;
  setNote(note: unknown): void {
    this.note = note;
  }
}
export function tagProps(props: Props, tag: number): void {
  (props as any).tag = tag;
  (props as any).more = tag;
}
export function tagMessage(message: Message, tag: number): void {
  (message as any).tag = tag;
  (message as any).more = tag;
}
export function typedLoopDeleting(props: Props, victim: string): string {
  let seen = "";
  for (const key in props) {
    seen += key + ";";
    delete (props as any)[victim];
  }
  return seen;
}
export function typedKeysAsking(props: Props, victim: string): string {
  let seen = "";
  for (const key of Object.keys(props)) {
    seen += key + Object.hasOwn(props, key) + (key in props) + ";";
    delete (props as any)[victim];
  }
  return seen;
}
export function tagPacked(packed: Packed, tag: number): void {
  (packed as any).tag = tag;
  (packed as any).more = tag;
}
