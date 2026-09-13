// Included several ways by 6.10.2-source-file-inclusion.c.
#ifndef INCLUDED_TIMES
#define INCLUDED_TIMES 0
#endif
#if INCLUDED_TIMES == 0
#undef INCLUDED_TIMES
#define INCLUDED_TIMES 1
#elif INCLUDED_TIMES == 1
#undef INCLUDED_TIMES
#define INCLUDED_TIMES 2
#elif INCLUDED_TIMES == 2
#undef INCLUDED_TIMES
#define INCLUDED_TIMES 3
#else
#undef INCLUDED_TIMES
#define INCLUDED_TIMES 4
#endif
static const char *const included_file = __FILE__;
#define INCLUDE_LEVEL_INSIDE __INCLUDE_LEVEL__
enum { LINE_INSIDE = __LINE__ };
