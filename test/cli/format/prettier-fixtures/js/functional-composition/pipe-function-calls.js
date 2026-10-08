(() => {
  pipe(
    timelines,
    everyCommitTimestamps,
    A.sort(ordDate),
    A.head
  );

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
    .catch((err) => {
      logger.error(
        pipe(
          O.fromNullable(err.stack),
          O.getOrElse(constant(err.message))
        )
      );
      process.exit(1);
    });

  pipe(
    Changelog.timestampOfFirstCommit([[commit]]),
    O.toUndefined
  );

  chain(
    flow(
      getUploadUrl,
      E.mapLeft(Errors.unknownError),
      TE.fromEither
    )
  );
})();
