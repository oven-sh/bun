(<T>pendingSetRef.flags) |= SchedulerJobFlags.DISPOSED;
(pendingSetRef.flags as T) |= SchedulerJobFlags.DISPOSED;
(pendingSetRef.flags satisfies T) |= SchedulerJobFlags.DISPOSED;
(pendingSetRef.flags!) |= SchedulerJobFlags.DISPOSED;