// input with some comments added to avoid reformatting

(() => {
  pipe(
    // add a descriptive comment here
    timelines,
    everyCommitTimestamps,
    A.sort(ordDate),
    A.head
  );

  pipe(
    // add a descriptive comment here
    serviceEventFromMessage(msg),
    TE.chain(
      flow(
        // add a descriptive comment here
        publishServiceEvent(analytics),
        TE.mapLeft(nackFromError)
      )
    )
  )()
    .then(messageResponse(logger, msg))
    .catch((err: Error) => {
      logger.error(
        pipe(
          // add a descriptive comment here
          O.fromNullable(err.stack),
          O.getOrElse(constant(err.message))
        )
      );
      process.exit(1);
    });

  pipe(
    // add a descriptive comment here
    Changelog.timestampOfFirstCommit([[commit]]),
    O.toUndefined
  );

  chain(
    flow(
      // add a descriptive comment here
      getUploadUrl,
      E.mapLeft(Errors.unknownError),
      TE.fromEither
    )
  );
})();
