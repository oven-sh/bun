#include <dirent.h>
#include <filesystem>
#include <iostream>
#include <fstream>
#include <unistd.h>
#include <vector>

int passed = 0;
int failed = 0;

/**
 * @brief Run an executable and capture the output.
 *
 * @param path The path to the executable.
 * @param argv The null-terminated arguments to pass to the executable.
 * @param output [out] The string into which to place the output. This string will NOT be cleared first.
 * @param exitCode [out] The return code of the executable.
 * @return -1 if something went wrong, otherwise 0.
 */
int exec(char const* const path, char const* const argv[], std::string* const output, int* const exitCode) {
  int stdpipe[2];
  if (pipe(stdpipe) == -1) {
    std::cerr << "ERROR: Unable to capture pipe" << std::endl;
    return -1;
  }

  pid_t pid = fork();
  if (pid == -1) {
    std::cerr << "ERROR: Unable to capture pipe for stderr"  << std::endl;
    return -1;
  } else if (pid == 0) {
    close(stdpipe[0]); // Child doesn't need to read the pipe.
    // Capture stdout and stderr
    dup2(stdpipe[1], 1);
    dup2(stdpipe[1], 2);
    execv(const_cast<char const*>(path), const_cast<char* const*>(argv));
    return -1; // This is just to make the compiler happy.
  } else {
    close(stdpipe[1]); // Parent doesn't need to write.

    if (output != nullptr) {
      char buf[8];
      int count;
      while((count = read(stdpipe[0], buf, 8)) > 0) {
        output->append(buf, count);
      }
    }
    close(stdpipe[0]); // Done

    // parent
    int status;
    if (waitpid(pid, &status, 0) == -1) {
      std::cerr << "ERROR: waitpid failed somehow" << std::endl;
      return -1;
    }

    if (exitCode != nullptr)
      *exitCode = WEXITSTATUS(status);

    return 0;
  }
}

int execTest(char const* const bunBin, char const* const testMatch, std::string* const output, int* const exitCode) {
  char const* args[] = {bunBin, "wiptest", testMatch, NULL};
  return exec(bunBin, args, output, exitCode);
}

void parseMacros(std::string const filePath, int* const expectPass, std::vector<std::string const>& expects, std::vector<std::string const>& expectNots, std::string& testPattern, std::vector<std::string const>& errors) {
  std::ifstream fstream(filePath);

  if (!fstream.is_open()) {
    errors.push_back("Unable to open file");
    return;
  }

  std::string line;
  size_t idx;
  char const* rest;
  while (fstream) {
    std::getline(fstream, line);
    idx = line.find("// ");
    if (idx == std::string::npos)
      continue;

    idx += 3;

    if (idx >= line.length())
      continue;

    switch (line.at(idx)) {
    // STATUS
    case 'S':
      rest = line.c_str() + (idx);
      if (strncmp(rest, "STATUS: ", 8) != 0)
        continue;
      if (idx + 8 >= line.length())
        continue;
      rest += 8;
      if (strcmp(rest, "PASS") == 0)
        *expectPass = 1;
      else if (strcmp(rest, "FAIL") == 0)
        *expectPass = 0;
      else {
        std::string err = "Invalid STATUS: '";
        err += rest;
        err += "', must be PASS or FAIL";
        errors.push_back(err);
      }
      break;

    // EXPECT
    // EXPECTNOT
    case 'E': {
      rest = line.c_str() + (idx);
      if (strncmp(rest, "EXPECT", 6) != 0)
        continue;
      idx += 6;
      if (idx >= line.length())
        continue;
      rest += 6;
      bool isNot = strncmp(rest, "NOT", 3) == 0;
      if (isNot) {
        idx += 3;
        if (idx >= line.length())
          continue;
        rest += 3;
      }

      if (strncmp(rest, ": ", 2) != 0)
        continue;

      idx += 2;
      if (idx >= line.length()) {
        std::string err = isNot ? "EXPECTNOT" : "EXPECT";
        err += " must not be empty";
        errors.push_back(err);
        continue;
      }
      rest += 2;

      if (isNot)
        expectNots.push_back(rest);
      else
        expects.push_back(rest);
      break;
    }

    // TESTPATTERN
    case 'T':
      rest = line.c_str() + (idx);
      if (strncmp(rest, "TESTPATTERN: ", 13) != 0)
        continue;
      if (idx + 13 >= line.length()) {
        errors.push_back("TESTPATTERN must not be empty");
        continue;
      }
      rest += 13;
      testPattern.assign(rest);
      break;

    default:
      break;
    }
  }
}

/**
 * @brief Execute a single test.
 *
 * @param bunBin The path to the Bun binary to execute.
 * @param baseDir The directory in which the test file is stored.
 * @param testFile The name of the test file.
 * @return The output of the test command (stdout + stderr).
 */
void runTest(char const* const bunBin, char const* const baseDir, char const* const testFile) {
  printf("Running test '%s'...", testFile);
  std::string filePath;
  filePath += baseDir;
  filePath += "/";
  filePath += testFile;

  std::vector<std::string const> errors;

  int expectPass = 2;
  std::vector<std::string const> expects;
  std::vector<std::string const> expectNots;
  parseMacros(filePath, &expectPass, expects, expectNots, filePath, errors);

  if (expectPass == 2)
    errors.push_back("Missing STATUS macro");

  if (expects.size() == 0 && expectNots.size() == 0)
    errors.push_back("File must contain at least one EXPECT or EXPECTNOT macro");

  // Only run the test suite if we haven't yet failed.
  if (errors.size() == 0) {
    int exitCode;
    std::string output;
    if (execTest(bunBin, filePath.c_str(), &output, &exitCode) < 0) {
      errors.push_back("Unable to parse test file");
    }

    auto didPass = exitCode == 0;
    if (expectPass != didPass) {
      if (expectPass) {
        std::string err = "Expected exit code to be 0, got ";
        err += exitCode;
        errors.push_back(err);
      } else
        errors.push_back("Expected non-zero exit code");
    }


    for (auto ex : expects) {
      if (output.find(ex) == std::string::npos) {
        std::string msg = "Output does not contain '";
        msg += ex;
        msg += "'";
        errors.push_back(msg);
      }
    }
    for (auto ex : expectNots){
      if (output.find(ex) != std::string::npos) {
        std::string msg = "Output contains '";
        msg += ex;
        msg += "'";
        errors.push_back(msg);
      }
    }
  }

  if (errors.size() > 0) {
    ++failed;
    printf(" Fail\n");
    for (auto err : errors)
      printf("  ERROR: %s\n", err.c_str());
    printf("\n");
  } else {
    ++passed;
    printf(" Pass\n");
  }
}

/**
 * @brief Run all tests in a directory.
 *
 * @param dir The directory to run tests in.
 * @param bunBin The path to the Bun binary to execute.
 */
int runAll(char const* const dir, char const* const bunBin) {
  struct dirent *entry = nullptr;

  auto* dp = opendir(dir);
  if (dp == nullptr) {
    std::cerr << "ERROR: Unable to open directory '" << dir << "'" << std::endl;
    return -1;
  }

  while ((entry = readdir(dp))) {
    if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, ".."))
      continue;
    runTest(bunBin, dir, entry->d_name);
  }

  if (closedir(dp) < 0) {
    std::cerr << "ERROR: Unable to close directory '" << dir << "'" << std::endl;
    return -1;
  }

  return 0;
}

int main(int argc, char const* argv[]) {
  if (argc != 2) {
    std::cerr << "Must provide path to test files" << std::endl;
    return 1;
  }

  auto bunBin = std::getenv("BUN_BIN");
  if (bunBin == nullptr) {
    std::cerr << "ERROR: `$BUN_BIN` is not defined. Either set it manually or run this file via `make`'" << std::endl;
    return 1;
  }

  if (!std::filesystem::exists(bunBin)) {
    std::cerr << "ERROR: " << bunBin << " does not exist. Did you forget to run `make dev`?" << std::endl;
    return 1;
  }

  char testDir[PATH_MAX];
  realpath(argv[1], testDir);

  if (runAll(testDir, bunBin) < 0)
    return -1;

  printf("\n\n\nFinished running tests.\nTotal: %d\nPassed: %d\nFailed: %d\n", passed + failed, passed, failed);

  return failed;
}
