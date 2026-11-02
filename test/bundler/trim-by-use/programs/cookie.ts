const cookie = new Bun.Cookie("session", "a b", { path: "/", httpOnly: true, maxAge: 60, sameSite: "lax" });
console.log(cookie.toString(), cookie.name, cookie.isExpired());
console.log(JSON.stringify(Bun.Cookie.parse("id=7; Secure; Path=/x")));
const map = new Bun.CookieMap("a=1; b=two");
map.set("c", "3");
map.delete("a");
console.log(map.get("b"), map.has("a"), map.size, map.toSetCookieHeaders().join(" | "));
