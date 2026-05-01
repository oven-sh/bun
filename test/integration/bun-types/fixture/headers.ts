const headers = new Headers();
headers.append("Set-Cookie", "a=1");
headers.append("Set-Cookie", "b=1; Secure");

// both of these are no longer in the types
// because Headers is declared with `class` in @types/node
// and I can't find a way to add them to the prototype
// console.log(headers.getAll("Set-Cookie")); // ["a=1", "b=1; Secure"]
// console.log(headers.toJSON()); // { "set-cookie": "a=1, b=1; Secure" }
