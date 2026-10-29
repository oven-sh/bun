const store = new Map<string, string>();

function commandsIn(text: string): string[][] {
  const commands: string[][] = [];
  const lines = text.split("\r\n");
  for (let at = 0; at < lines.length - 1; ) {
    const count = Number(lines[at++]!.slice(1));
    const words: string[] = [];
    for (let word = 0; word < count; word++, at += 2) words.push(lines[at + 1]!);
    commands.push(words);
  }
  return commands;
}

function replyTo(words: string[]): string {
  switch (words[0]!.toUpperCase()) {
    case "HELLO":
      return "%1\r\n+proto\r\n:3\r\n";
    case "SET":
      store.set(words[1]!, words[2]!);
      return "+OK\r\n";
    case "GET": {
      const value = store.get(words[1]!);
      return value === undefined ? "_\r\n" : `$${value.length}\r\n${value}\r\n`;
    }
    case "INCR": {
      const next = Number(store.get(words[1]!) ?? 0) + 1;
      store.set(words[1]!, String(next));
      return `:${next}\r\n`;
    }
    default:
      return "+OK\r\n";
  }
}

const server = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: {
    data(socket, bytes) {
      socket.write(commandsIn(bytes.toString()).map(replyTo).join(""));
    },
  },
});

const client = new Bun.RedisClient(`redis://127.0.0.1:${server.port}`);
console.log(await client.set("greeting", "hello from the client"));
console.log(await client.get("greeting"));
console.log(await client.incr("count"), await client.incr("count"));
console.log(await client.get("missing"));
client.close();
server.stop(true);
