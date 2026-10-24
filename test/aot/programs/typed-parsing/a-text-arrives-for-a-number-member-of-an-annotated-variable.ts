interface User {
  id: number;
  name: string;
}

const user: User = JSON.parse('{"id":"7","name":"ann"}');
console.log(user.id);
console.log(typeof user.id);
console.log(typeof user.id === "number");
console.log(user.id + 1);
console.log(user.id * 2);
console.log(user.id === 7);
console.log(user.id | 0);
console.log(user.id > 5, user.id < 10);
console.log(-user.id, +user.id);
console.log(JSON.stringify(user));
