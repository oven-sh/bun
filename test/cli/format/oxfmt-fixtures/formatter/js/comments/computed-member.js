prop[
  0
  /* shouldCast */
] = shouldCast;

let handler =
  props[handlerName = toHandlerKey(event)] || // also try camelCase event handler (#2249)
  props[handlerName = toHandlerKey(camelize(event))];
