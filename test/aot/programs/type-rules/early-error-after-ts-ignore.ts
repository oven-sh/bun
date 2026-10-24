// Plain Bun does not read `@ts-ignore`, so the comment does not suppress an ECMAScript early error in a compiled file.
console.log("never printed");
// @ts-ignore
break;
