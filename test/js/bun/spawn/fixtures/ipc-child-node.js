console.log("c start");
process.on("message", message => {
  console.log("c", message);
  process.send(message);
  process.exit(0);
});
console.log("c end");
