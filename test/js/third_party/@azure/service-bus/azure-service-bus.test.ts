import { ServiceBusClient } from "@azure/service-bus";
import { describe, test } from "bun:test";
import { getSecret } from "harness";

const azureCredentials = getSecret("TEST_INFO_AZURE_SERVICE_BUS");

describe.skipIf(!azureCredentials)("@azure/service-bus", () => {
  test("works", async () => {
    const sbClient = new ServiceBusClient(azureCredentials!);
    const sender = sbClient.createSender("test");

    try {
      await sender.sendMessages({ body: "Hello, world!" });
      await sender.close();
    } finally {
      await sbClient.close();
    }
  }, 10_000);
  // this takes ~4s locally so increase the time to try and ensure its
  // not flaky in a higher pressure environment
});
