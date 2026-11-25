// The red control of exception-scope-lint.ts. Nothing compiles this file but the checker, with the flags of BunPlugin.cpp.
// `unchecked` must be reported and `checked` must not, or the run has shown nothing: a checker that sees no check reports both, one that sees no scope neither.
#include "root.h"

#include <JavaScriptCore/ThrowScope.h>
#include <JavaScriptCore/VM.h>

namespace ExceptionScopeLintControl {

static bool mayThrow(JSC::VM& vm)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    return !scope.exception();
}

bool unchecked(JSC::VM& vm)
{
    if (mayThrow(vm))
        return true;
    return mayThrow(vm);
}

bool checked(JSC::VM& vm)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    bool isDone = mayThrow(vm);
    RETURN_IF_EXCEPTION(scope, false);
    if (isDone)
        return true;
    RELEASE_AND_RETURN(scope, mayThrow(vm));
}

} // namespace ExceptionScopeLintControl
