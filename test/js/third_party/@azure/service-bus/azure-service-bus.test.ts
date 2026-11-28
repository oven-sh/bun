import { ServiceBusClient } from "@azure/service-bus";
import { expect, test } from "bun:test";
import { tls } from "harness";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import rhea from "rhea";

// The SDK talks AMQP 1.0 over TLS to an endpoint. Here the endpoint is a broker on localhost and not Azure.
// rhea is the AMQP library that the SDK is built on.
test("@azure/service-bus sends a message to a queue", async () => {
  const broker = rhea.create_container();
  const received: { queue: string; body: string }[] = [];

  // The broker accepts every link as the SDK asks for it.
  broker.on("receiver_open", ({ receiver }) => receiver.set_target(receiver.target));
  broker.on("sender_open", ({ sender }) => sender.set_source(sender.source));
  broker.on("message", ({ connection, receiver, message }) => {
    const queue = receiver.target.address;
    if (queue === "$cbs") {
      // Before it sends, the SDK puts its access token on $cbs and waits for this answer.
      connection
        .find_sender(sender => sender.source.address === "$cbs")
        .send({ correlation_id: message.message_id, application_properties: { "status-code": 202 } });
      return;
    }
    // The SDK sends the body as JSON in a data section.
    received.push({ queue, body: String(message.body?.content) });
  });

  await using server = broker.listen({ transport: "tls", port: 0, ...tls });
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  // The SDK has no option for a certificate authority. It verifies the broker against the default ones.
  const defaultCACertificates = getCACertificates("default");
  setDefaultCACertificates([tls.cert]);
  try {
    const sbClient = new ServiceBusClient("Endpoint=sb://localhost;SharedAccessKeyName=test;SharedAccessKey=test", {
      customEndpointAddress: `https://localhost:${port}`,
      // A failure is reported at once, not after the 30 second delay of a retry.
      retryOptions: { maxRetries: 0 },
    });
    const sender = sbClient.createSender("test");

    try {
      await sender.sendMessages({ body: "Hello, world!" });
      await sender.close();
    } finally {
      await sbClient.close();
    }
  } finally {
    setDefaultCACertificates(defaultCACertificates);
  }

  expect(received).toEqual([{ queue: "test", body: JSON.stringify("Hello, world!") }]);
});
