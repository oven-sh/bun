export const exitCodeMap = {
  usage: 1,

  websocketMessagesAreBanned: 30,
  consoleError: 31,
  assertionFailed: 32,
  unexpectedReload: 33,
  reloadFailed: 34,
  reloadNotCalled: 35,
};
export const exitCodeMapStrings = {
  [exitCodeMap.usage]: "CLI Usage error",
  [exitCodeMap.websocketMessagesAreBanned]: "Websocket messages are banned",
  [exitCodeMap.consoleError]: "Runtime error",
  [exitCodeMap.assertionFailed]: "Assertion failed",
  [exitCodeMap.unexpectedReload]: "Unexpected reload",
  [exitCodeMap.reloadFailed]: "Reload failed",
  [exitCodeMap.reloadNotCalled]: "Reload not called",
};
