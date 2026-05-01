import diagnostics_channel from "diagnostics_channel";

// Create a channel object
const channel = diagnostics_channel.channel("my-channel");

// Subscribe to the channel
channel.subscribe((message, name) => {
  console.log("Received message:", message);
});

// Publish a message to the channel
channel.publish({ some: "data" });
