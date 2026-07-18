var net = require("net");

var client = new net.Socket();
client.on("error", () => {});
client.connect(process.env.PORT, "localhost", function () {
  client.write("Hello, server");
});
