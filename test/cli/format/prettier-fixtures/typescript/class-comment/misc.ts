export class SnapshotLogger {
  constructor(
    retentionPeriod: number = 5 * 60 * 1000, // retain past five minutes
    snapshotInterval: number = 30 * 1000, // snapshot no more than every 30s
  ) {
  }
}
