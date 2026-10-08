window.postMessage(
    {
      context: item.context,
      topic: item.topic
    } satisfies IActionMessage
  );
