const text: string = ["a", "b", "c"].join(",");
let numbered = "";
for (let i = 0; i < 3; i++) numbered += `${i}:${i + 1};`;
console.log(/b/.test(text), text.replace("a", "x"), text.split(/,/).length, text.lastIndexOf("c"), numbered);
