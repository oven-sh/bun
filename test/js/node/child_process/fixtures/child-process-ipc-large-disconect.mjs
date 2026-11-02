import { fork } from "child_process";

// usage: <sender: "child" | "parent">
const [sender, role = "parent"] = process.argv.slice(2);
const other = role === "parent" ? fork(process.argv[1], [sender, "child"]) : process;

if (role === sender) {
  other.send("a!");
  other.send("b!");
  other.send("c!");
  other.send("d!");
  other.send("hello".repeat(2 ** 15));
  other.send("goodbye".repeat(2 ** 15));
  other.send("hello".repeat(2 ** 15));
  other.send("goodbye".repeat(2 ** 15));
  other.disconnect();
} else {
  other.on("message", message => {
    console.log(message.length + ": " + message[message.length - 2]);
  });

  other.on("disconnect", () => {
    console.log("disconnected");
  });
}
