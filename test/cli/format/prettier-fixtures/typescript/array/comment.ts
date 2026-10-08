export class ViewTokensChangedEvent {
  public readonly ranges: {
    /**
     * Start line number of range
     */
    readonly fromLineNumber: number;
  }[];
}
