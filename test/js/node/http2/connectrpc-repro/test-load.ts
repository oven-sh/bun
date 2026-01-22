import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { TestService } from "./test_pb";

const transport = createConnectTransport({
  baseUrl: "http://localhost:50051",
  httpVersion: "2",
});

const client = createClient(TestService, transport);

const numMessages = parseInt(process.argv[2] || "500");

try {
  let count = 0;
  for await (const response of client.streamData({ numMessages })) {
    count++;
  }
  console.log(`✓ Received ${count}/${numMessages} messages`);
  if (count !== numMessages) {
    console.error(`❌ Expected ${numMessages} messages but got ${count}`);
    process.exit(1);
  }
} catch (error: any) {
  console.error(`✗ Error: ${error.message}`);
  process.exit(1);
}
