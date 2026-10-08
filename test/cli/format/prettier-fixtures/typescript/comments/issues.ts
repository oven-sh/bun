// Adding a comment stops the pretty printing process and everything is
// squished in a single line afterward
export type BuckWebSocketMessage = {
  // Not actually from Buck - this is to let the receiver know that the socket is connected.
  type: 'SocketConnected',
} | {
  type: 'BuildProgressUpdated',
  progressValue: number,
} | {
  type: 'BuildFinished',
  exitCode: number,
} | {
  type: 'BuildStarted',
} | {
  type: 'ParseStarted',
} | {
  type: 'ParseFinished',
} | {
  type: 'RunStarted',
} | {
  type: 'RunComplete',
};

// Two extra levels of indentation because of the comment
export type AsyncExecuteOptions = child_process$execFileOpts & {
  // The contents to write to stdin.
  stdin?: string,
  dontLogInNuclide?: boolean,
};
