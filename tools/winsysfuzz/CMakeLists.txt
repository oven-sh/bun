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

if(MSVC)
  foreach(t winsysfuzz wsfrun wsfsym)
    target_compile_options(${t} PRIVATE /W3 /wd4996)
  endforeach()
endif()
