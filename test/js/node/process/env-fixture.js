console.error(process.env.FOO);
if(process.argv[2] == "delete")
    delete process.env.FOO;
else
    process.env.FOO = process.argv[2];
console.error(process.env.FOO);
