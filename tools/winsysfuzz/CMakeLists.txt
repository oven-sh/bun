cmake_minimum_required(VERSION 3.24)
project(winsysfuzz CXX)

if(NOT WIN32)
  message(FATAL_ERROR "winsysfuzz targets Windows (ntdll hooking)")
endif()

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# --- Microsoft Detours (MIT). No CMake project upstream; build its sources. --
include(FetchContent)
FetchContent_Declare(
  detours
  GIT_REPOSITORY https://github.com/microsoft/Detours.git
  GIT_TAG        v4.0.1
  GIT_SHALLOW    ON
)
FetchContent_GetProperties(detours)
if(NOT detours_POPULATED)
  cmake_policy(SET CMP0169 OLD) # FetchContent_Populate: fine for a no-CMake dep
  FetchContent_Populate(detours)
endif()

set(DETOURS_SRC ${detours_SOURCE_DIR}/src)
add_library(detours STATIC
  ${DETOURS_SRC}/detours.cpp
  ${DETOURS_SRC}/modules.cpp
  ${DETOURS_SRC}/disasm.cpp
  ${DETOURS_SRC}/image.cpp
  ${DETOURS_SRC}/creatwth.cpp
)
target_include_directories(detours PUBLIC ${DETOURS_SRC})

# --- interceptor DLL ---------------------------------------------------------
add_library(winsysfuzz SHARED
  src/dllmain.cpp
  src/runtime.cpp
  src/generated/hooks.gen.cpp
)
target_include_directories(winsysfuzz PRIVATE src)
target_link_libraries(winsysfuzz PRIVATE detours)

# --- launcher ----------------------------------------------------------------
add_executable(wsfrun src/launcher.cpp)
target_link_libraries(wsfrun PRIVATE detours)

# --- RVA symbolizer (DbgHelp) --------------------------------------------------
add_executable(wsfsym src/symbolize.cpp)
target_link_libraries(wsfsym PRIVATE dbghelp)

# System32's dbghelp.dll is too old to parse PDBs from current toolchains. If
# Debugging Tools for Windows is installed, deploy its modern dbghelp/symsrv
# beside wsfsym.exe (DLL search order prefers the app directory). Without it
# wsfsym still runs but symbols won't resolve — setup.ps1 flags that.
find_program(WSF_CDB cdb.exe PATHS
  "$ENV{ProgramFiles\(x86\)}/Windows Kits/10/Debuggers/x64"
  "$ENV{ProgramFiles}/Windows Kits/10/Debuggers/x64"
  NO_DEFAULT_PATH)
if(WSF_CDB)
  get_filename_component(WSF_DBGTOOLS "${WSF_CDB}" DIRECTORY)
  message(STATUS "Debugging Tools found: ${WSF_DBGTOOLS} (deploying modern dbghelp)")
  add_custom_command(TARGET wsfsym POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
      "${WSF_DBGTOOLS}/dbghelp.dll" "${WSF_DBGTOOLS}/symsrv.dll" $<TARGET_FILE_DIR:wsfsym>
    COMMENT "Deploying modern dbghelp.dll/symsrv.dll beside wsfsym.exe")
else()
  message(WARNING "Debugging Tools for Windows not found: wsfsym symbols will not resolve and hang/crash capture is disabled. Run setup.ps1 -InstallDebuggers.")
endif()

if(MSVC)
  foreach(t winsysfuzz wsfrun wsfsym)
    target_compile_options(${t} PRIVATE /W3 /wd4996)
  endforeach()
endif()
