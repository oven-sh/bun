import syslog as S
def t(f):
    try: print(repr(f()))
    except BaseException as x: print(type(x).__name__ + ':', x)
names = sorted(n for n in dir(S) if not n.startswith('__'))
print(names); print([(n, getattr(S, n)) for n in names if isinstance(getattr(S, n), int)])
for n in names:
    f = getattr(S, n)
    if callable(f): print(n, type(f).__name__, f.__text_signature__.replace('\n       ', '') if f.__text_signature__ else None)
print([S.LOG_MASK(i) for i in range(8)], [S.LOG_UPTO(i) for i in range(8)], S.LOG_MASK(S.LOG_ERR), S.LOG_UPTO(S.LOG_WARNING))
old = S.setlogmask(S.LOG_UPTO(S.LOG_ERR)); print(old, S.setlogmask(old), S.setlogmask(0) == old)
print(S.openlog(), S.openlog('ident'), S.openlog('ident', S.LOG_PID), S.openlog('ident', S.LOG_PID, S.LOG_LOCAL0), S.openlog(ident='x', logoption=0, facility=S.LOG_USER), S.closelog(), S.closelog())
S.setlogmask(S.LOG_MASK(S.LOG_EMERG))
print(S.syslog('masked message'), S.syslog(S.LOG_DEBUG, 'masked'), S.syslog(S.LOG_DEBUG | S.LOG_LOCAL1, 'masked %s %d'), S.closelog())
t(lambda: S.syslog()); t(lambda: S.syslog(1)); t(lambda: S.syslog('a', 'b')); t(lambda: S.syslog(1, 2)); t(lambda: S.syslog(1, 'a', 'b')); t(lambda: S.syslog(b'x')); t(lambda: S.syslog('a\0b')); t(lambda: S.syslog(2**40, 'x')); t(lambda: S.syslog(message='x')); t(lambda: S.syslog('\ud800'))
t(lambda: S.openlog(1)); t(lambda: S.openlog(b'x')); t(lambda: S.openlog('x', 'y')); t(lambda: S.openlog('x', 0, 'z')); t(lambda: S.openlog('x', 0, 0, 0)); t(lambda: S.openlog(foo=1)); t(lambda: S.openlog('x', 2**70)); t(lambda: S.openlog('\ud800')); t(lambda: S.openlog(None))
t(lambda: S.setlogmask('x')); t(lambda: S.setlogmask()); t(lambda: S.LOG_MASK('x')); t(lambda: S.LOG_UPTO()); t(lambda: S.closelog(1)); t(lambda: S.LOG_MASK(2**70))
S.closelog()
