const initializeSnapshotState = (
  testFile: Path,
  update: boolean,
  testPath: string,
  expand: boolean,
) => new SnapshotState(testFile, update, testPath, expand);
