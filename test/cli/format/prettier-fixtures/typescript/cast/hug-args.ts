postMessage(
  <IActionMessage>{
    context: item.context,
    topic: item.topic
  }
);

window.postMessage(
  {
    context: item.context,
    topic: item.topic
  } as IActionMessage
);

postMessages(
  <IActionMessage[]>[
    {
      context: item.context,
      topic: item.topic
    }
  ]
);
