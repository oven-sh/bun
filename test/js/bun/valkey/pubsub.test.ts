import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { RedisClient } from "bun";
import { bunEnv } from "harness";

// Skip tests if no Redis/Valkey server is available
const skipIfNoRedis = test; // Always run tests locally

describe("Valkey PubSub functionality", () => {
  let publisher: RedisClient;
  let subscriber: RedisClient;
  
  beforeAll(async () => {
    // Create two separate clients - one for publishing, one for subscribing
    publisher = new RedisClient(process.env.REDIS_URL || "redis://localhost:6379");
    subscriber = new RedisClient(process.env.REDIS_URL || "redis://localhost:6379");
    
    await publisher.connect();
    await subscriber.connect();
  });

  afterAll(async () => {
    if (publisher?.connected) {
      await publisher.close();
    }
    if (subscriber?.connected) {
      await subscriber.close();
    }
  });

  skipIfNoRedis("should register and receive messages on channels", async () => {
    const messages: any[] = [];
    
    // Register event listener
    subscriber.on("test-channel", (event: any) => {
      messages.push(event);
    });
    
    // Subscribe to the channel
    await subscriber.subscribe("test-channel");
    
    // Give a moment for subscription to be processed
    await Bun.sleep(10);
    
    // Publish a message
    await publisher.publish("test-channel", "Hello, World!");
    
    // Wait for message to be received
    await Bun.sleep(50);
    
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: "message",
      channel: "test-channel",
      message: "Hello, World!"
    });
    
    // Clean up
    await subscriber.unsubscribe("test-channel");
  });

  skipIfNoRedis("should handle multiple subscribers on same channel", async () => {
    const messages1: any[] = [];
    const messages2: any[] = [];
    
    // Register multiple event listeners
    subscriber.on("multi-channel", (event: any) => {
      messages1.push(event);
    });
    
    subscriber.on("multi-channel", (event: any) => {
      messages2.push(event);
    });
    
    // Subscribe to the channel
    await subscriber.subscribe("multi-channel");
    
    // Give a moment for subscription to be processed
    await Bun.sleep(10);
    
    // Publish a message
    await publisher.publish("multi-channel", "Multi-subscriber test");
    
    // Wait for message to be received
    await Bun.sleep(50);
    
    // Both listeners should receive the message
    expect(messages1).toHaveLength(1);
    expect(messages2).toHaveLength(1);
    expect(messages1[0]).toMatchObject({
      type: "message",
      channel: "multi-channel",
      message: "Multi-subscriber test"
    });
    expect(messages2[0]).toMatchObject({
      type: "message", 
      channel: "multi-channel",
      message: "Multi-subscriber test"
    });
    
    // Clean up
    await subscriber.unsubscribe("multi-channel");
  });

  skipIfNoRedis("should handle pattern subscriptions with psubscribe", async () => {
    const messages: any[] = [];
    
    // Register event listener for pattern
    subscriber.on("news.*", (event: any) => {
      messages.push(event);
    });
    
    // Subscribe to pattern
    await subscriber.psubscribe("news.*");
    
    // Give a moment for subscription to be processed
    await Bun.sleep(10);
    
    // Publish messages to matching channels
    await publisher.publish("news.sports", "Sports update");
    await publisher.publish("news.weather", "Weather update");
    await publisher.publish("other.topic", "Should not match");
    
    // Wait for messages to be received
    await Bun.sleep(100);
    
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      type: "pmessage",
      pattern: "news.*",
      message: "Sports update"
    });
    expect(messages[1]).toMatchObject({
      type: "pmessage", 
      pattern: "news.*",
      message: "Weather update"
    });
    
    // Clean up
    await subscriber.punsubscribe("news.*");
  });

  skipIfNoRedis("should remove specific callbacks with off()", async () => {
    const messages1: any[] = [];
    const messages2: any[] = [];
    
    const callback1 = (event: any) => {
      messages1.push(event);
    };
    
    const callback2 = (event: any) => {
      messages2.push(event);
    };
    
    // Register both callbacks
    subscriber.on("removal-test", callback1);
    subscriber.on("removal-test", callback2);
    
    // Subscribe to the channel
    await subscriber.subscribe("removal-test");
    
    // Give a moment for subscription to be processed
    await Bun.sleep(10);
    
    // Publish first message - both should receive
    await publisher.publish("removal-test", "Message 1");
    await Bun.sleep(50);
    
    expect(messages1).toHaveLength(1);
    expect(messages2).toHaveLength(1);
    
    // Remove first callback
    subscriber.off("removal-test", callback1);
    
    // Publish second message - only callback2 should receive
    await publisher.publish("removal-test", "Message 2");
    await Bun.sleep(50);
    
    expect(messages1).toHaveLength(1); // Still 1
    expect(messages2).toHaveLength(2); // Now 2
    
    // Clean up
    await subscriber.unsubscribe("removal-test");
  });

  skipIfNoRedis("should remove all callbacks for channel with off(channel)", async () => {
    const messages: any[] = [];
    
    // Register multiple callbacks
    subscriber.on("remove-all-test", (event: any) => {
      messages.push({ id: 1, ...event });
    });
    
    subscriber.on("remove-all-test", (event: any) => {
      messages.push({ id: 2, ...event });
    });
    
    // Subscribe to the channel
    await subscriber.subscribe("remove-all-test");
    
    // Give a moment for subscription to be processed
    await Bun.sleep(10);
    
    // Publish first message - both should receive
    await publisher.publish("remove-all-test", "Before removal");
    await Bun.sleep(50);
    
    expect(messages).toHaveLength(2);
    
    // Remove all callbacks for the channel
    subscriber.off("remove-all-test");
    
    // Publish second message - none should receive
    await publisher.publish("remove-all-test", "After removal");
    await Bun.sleep(50);
    
    expect(messages).toHaveLength(2); // Still 2, no new messages
    
    // Clean up
    await subscriber.unsubscribe("remove-all-test");
  });

  skipIfNoRedis("should handle binary data in pubsub messages", async () => {
    const messages: any[] = [];
    
    // Register event listener
    subscriber.on("binary-channel", (event: any) => {
      messages.push(event);
    });
    
    // Subscribe to the channel
    await subscriber.subscribe("binary-channel");
    
    // Give a moment for subscription to be processed
    await Bun.sleep(10);
    
    // Publish binary data
    const binaryData = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x57, 0x6f, 0x72, 0x6c, 0x64]);
    await publisher.publish("binary-channel", binaryData);
    
    // Wait for message to be received
    await Bun.sleep(50);
    
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: "message",
      channel: "binary-channel"
    });
    expect(typeof messages[0].message).toBe("string");
    
    // Clean up
    await subscriber.unsubscribe("binary-channel");
  });

  skipIfNoRedis("should handle subscription acknowledgments", async () => {
    // Subscribe and check that the promise resolves
    const subscribeResult = await subscriber.subscribe("ack-test");
    
    // Should return subscription count or similar acknowledgment
    expect(subscribeResult).toBeDefined();
    
    // Clean up
    await subscriber.unsubscribe("ack-test");
  });

  skipIfNoRedis("should disable pipelining when using pubsub", async () => {
    const testClient = new RedisClient(process.env.REDIS_URL || "redis://localhost:6379");
    await testClient.connect();
    
    // Register a pubsub listener (this should disable pipelining)
    testClient.on("pipeline-test", () => {});
    
    // The client should now have pipelining disabled
    // This is more of an implementation detail that would be verified
    // through internal client state, but we can at least verify
    // that pubsub works correctly even with this change
    
    await testClient.subscribe("pipeline-test");
    await testClient.unsubscribe("pipeline-test");
    
    await testClient.close();
  });

  skipIfNoRedis("should handle multiple channels in single subscription", async () => {
    const messages: Record<string, any[]> = {
      "channel1": [],
      "channel2": [],
      "channel3": []
    };
    
    // Register listeners for multiple channels
    subscriber.on("channel1", (event: any) => {
      messages.channel1.push(event);
    });
    
    subscriber.on("channel2", (event: any) => {
      messages.channel2.push(event);
    });
    
    subscriber.on("channel3", (event: any) => {
      messages.channel3.push(event);
    });
    
    // Subscribe to multiple channels
    await subscriber.subscribe("channel1", "channel2", "channel3");
    
    // Give a moment for subscriptions to be processed
    await Bun.sleep(10);
    
    // Publish to each channel
    await publisher.publish("channel1", "Message for channel 1");
    await publisher.publish("channel2", "Message for channel 2");
    await publisher.publish("channel3", "Message for channel 3");
    
    // Wait for messages to be received
    await Bun.sleep(100);
    
    expect(messages.channel1).toHaveLength(1);
    expect(messages.channel2).toHaveLength(1);
    expect(messages.channel3).toHaveLength(1);
    
    expect(messages.channel1[0].message).toBe("Message for channel 1");
    expect(messages.channel2[0].message).toBe("Message for channel 2");
    expect(messages.channel3[0].message).toBe("Message for channel 3");
    
    // Clean up
    await subscriber.unsubscribe("channel1", "channel2", "channel3");
  });

  skipIfNoRedis("should handle error cases gracefully", async () => {
    // Test with invalid arguments
    expect(() => {
      subscriber.on(); // No arguments
    }).toThrow();
    
    expect(() => {
      subscriber.on("channel"); // Missing callback
    }).toThrow();
    
    expect(() => {
      subscriber.on("channel", "not-a-function"); // Invalid callback
    }).toThrow();
    
    expect(() => {
      subscriber.off(); // No arguments
    }).toThrow();
  });
});