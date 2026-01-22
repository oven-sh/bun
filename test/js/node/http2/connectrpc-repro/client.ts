/**
 * Bun Connect RPC client to reproduce premature close bug.
 *
 * This client connects to the Python server and reads streaming responses.
 * When the server completes quickly, the client should receive all messages
 * without "premature close" errors.
 */

import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { TestService } from "./test_pb";

async function main() {
  const transport = createConnectTransport({
    baseUrl: "http://localhost:50051",
    httpVersion: "2", // Force HTTP/2
  });

  const client = createClient(TestService, transport);

  console.log("Testing streaming with fast server responses...");

  try {
    const messages: any[] = [];

    // Request 100 messages
    // NO DELAYS - read as fast as possible
    // Client delays actually HELP avoid the bug by giving the server more time to flush
    for await (const response of client.streamData({ numMessages: 100 })) {
      messages.push(response);
      console.log(`Received message ${response.messageNum} (${response.data.length} bytes)`);
    }

    console.log(`\nSuccess! Received ${messages.length} messages without errors`);
    process.exit(0);
  } catch (error: any) {
    console.error("\n❌ ERROR OCCURRED:");
    console.error(`  Code: ${error.code}`);
    console.error(`  Message: ${error.message}`);
    console.error(`  Raw error: ${error.rawMessage || error.toString()}`);

    if (error.message?.includes("premature") || error.code === "unknown") {
      console.error("\n🐛 THIS IS THE BUG: Premature close / unknown error");
      console.error("The server completed quickly but the client didn't receive all messages");
    }

    process.exit(1);
  }
}

main();
