const fastifyLoggerOptions = async (
  fastify,
  { skip2xxHttpLogging = false },
  // eslint-disable-next-line require-await
) => {
  const middleware = getMiddleware(skip2xxHttpLogging);
};
