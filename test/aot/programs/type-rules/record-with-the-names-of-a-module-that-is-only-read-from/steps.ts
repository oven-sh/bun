export const attempt = () => 7
export const recover = (error: unknown) => (error instanceof Error ? error.message.length : 0)
