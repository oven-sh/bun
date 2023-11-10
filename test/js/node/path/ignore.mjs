import path from "path";

// console.log(path.win32.normalize(""));
// console.log(path.win32.normalize("./././"));
// console.log(path.win32.join("//foo/", "bar"));
console.log(path.win32.join("c:", "file"));
console.log(path.win32.join("c:.", "file"));
console.log(path.win32.join("c:", "/"));
