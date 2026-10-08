export const LOG_LEVEL = {
    EMERGENCY: 0,
    ALERT: 1,
    CRITICAL: 2,
    ERROR: 3,
    WARNING: 4,
    NOTICE: 5,
    INFO: 6,
    DEBUG: 7,
} as const;

const TYPE_MAP = {
    'character device': 'special',
    'character special file': 'special',
    directory: 'directory',
    'regular file': 'file',
    socket: 'socket',
    'symbolic link': 'link',
} as Foo;

this.previewPlayerHandle = (setInterval(async () => {
  if (this.previewIsPlaying) {
    await this.fetchNextPreviews();
    this.currentPreviewIndex++;
  }
}, this.refreshDelay) as unknown) as number;

this.intervalID = (setInterval(() => {
  self.step();
}, 30) as unknown) as number;
