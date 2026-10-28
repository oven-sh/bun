const text = ["re", "quire('./data.json').version"].join("");
console.log(eval(text));
console.log(new Function("load", "return load('./data.json').nested.port")(require));
