var listener = DOM.listen(
  introCard,
  'click',
  sigil,
  (event: JavelinEvent): void =>
    BanzaiLogger.log(
      config,
      {...logData, ...DataStore.get(event.getNode(sigil))},
    ),
);
