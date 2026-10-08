useStableCallback(function useShowToast(
    ...args: Parameters<typeof toastService.addToastItem>
  ): void {
    toastService.addToastItem(...args);
  });

