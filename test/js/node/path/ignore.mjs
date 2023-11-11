import path from "path";

// console.log(path.win32.resolve("/one", "D:two", "three", "F:four", "five"));
// console.log(path.win32.resolve("c:/ignore", "d:\\a/b\\c/d", "\\e.exe"));

console.log(path.win32.normalize("////wtf"));
