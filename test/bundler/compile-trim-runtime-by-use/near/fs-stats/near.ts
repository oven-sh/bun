const file = Bun.file("/definitely/not/here.txt");
console.log(await file.exists(), file.size, file.name, file.type, new Blob(["abc"]).size);
