const plain = /(x)/.exec("ax");
console.log(typeof plain?.groups, plain?.index);
const named = /(?<a>x)/.exec("ax");
console.log(typeof named?.groups?.a, named?.index);
