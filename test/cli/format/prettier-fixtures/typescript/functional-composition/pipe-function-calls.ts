(() => {

  pipe(
    serviceEventFromMessage(msg),
    TE.chain(
      flow(
        publishServiceEvent(analytics),
        TE.mapLeft(nackFromError)
      )
    )
  )()
    .then(messageResponse(logger, msg))
    .catch((err: Error) => {
      logger.error(
        pipe(
          O.fromNullable(err.stack),
          O.getOrElse(constant(err.message))
        )
      );
      process.exit(1);
    });
})();
