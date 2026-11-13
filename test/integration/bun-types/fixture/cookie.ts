import { expectType } from "./utilities";

declare const cookie: Bun.Cookie;
declare const other: Bun.Cookie;
declare const init: Bun.CookieInit;

// The getter gives `null` for a cookie that has no Domain attribute.
expectType(other.domain).is<string | null>();

// `null` and `undefined` both remove the Domain attribute.
cookie.domain = "example.com";
cookie.domain = null;
cookie.domain = undefined;
cookie.domain = other.domain;
cookie.domain = init.domain;

// A Cookie, and the domain of a Cookie, pass where a CookieInit is read.
new Bun.Cookie("name", "value", { domain: null });
new Bun.Cookie("name", "value", { domain: other.domain });
new Bun.Cookie({ name: "name", value: "value", domain: other.domain });
Bun.Cookie.from("name", "value", { domain: other.domain });

const map = new Bun.CookieMap();
map.set(other);
map.set("name", "value", { domain: other.domain });
map.set({ name: "name", value: "value", domain: other.domain });
map.delete({ name: "name", domain: other.domain });

// toJSON() leaves `domain` out for a cookie that has none. It does not give `null`.
expectType(other.toJSON().domain).is<string | undefined>();
new Bun.Cookie(other.toJSON());

class SessionCookie extends Bun.Cookie {}
const session = new SessionCookie("name", "value", { domain: "example.com" });
session.domain = null;
expectType(new SessionCookie("name", "value").domain).is<string | null>();
