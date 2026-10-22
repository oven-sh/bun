interface User {
  id: number;
  name: string;
  on: boolean;
  tags: string[];
}

const user: User = JSON.parse('{"id":7}');
console.log(user.name);
console.log(user.name === undefined);
console.log(typeof user.name);
console.log(typeof user.name === "string");
console.log(user.name ?? "no name");
console.log("" + user.name);
console.log(user.on, user.on ? "on" : "off", user.on === false, typeof user.on === "boolean");
console.log(user.tags, user.tags === undefined, Array.isArray(user.tags));
console.log("name" in user, Object.keys(user).join());
try {
  console.log(user.name.length);
} catch (error) {
  console.log(error instanceof TypeError);
}
try {
  console.log(user.tags.length);
} catch (error) {
  console.log(error instanceof TypeError);
}
