const map = new Map([["content-type", "text/plain"]]);
console.log(map.get("content-type"), new URLSearchParams({ a: "1" }).get("a"), typeof fetch);
