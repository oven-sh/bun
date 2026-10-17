import fallback, { type Cookie } from "./cookie";
export class Jar {
  #last: Cookie | null = null;
  get last(): Cookie {
    return <Cookie>this.#last;
  }
  add(cookie: Partial<Cookie>): string {
    const made = Object.assign({}, fallback, cookie);
    this.#last = made;
    const host = (<URL>made.origin).hostname;
    return host + (<string[]>[]).length + <number>(<unknown>made.key.length);
  }
}
export { Event } from "./event";
import settings from "./settings";
export const name = (): string | undefined => settings.name;
