async function f1() {
  if (untrackedChoice === 0) /* Cancel */ {
    return null;
  } else if (untrackedChoice === 1) /* Add */ {
    await repository.addAll(Array.from(untrackedChanges.keys()));
    shouldAmend = true;
  } else if (untrackedChoice === 2) /* Allow Untracked */ {
    allowUntracked = true;
  }
}

async function f2() {
  if (untrackedChoice === 0) /* Cancel */
    null;
  else if (untrackedChoice === 1) /* Add */
    shouldAmend = true;
  else if (untrackedChoice === 2) /* Allow Untracked */
    allowUntracked = true;
}

async function f3() {
  if (untrackedChoice === 0) /* Cancel */ // Cancel
    null;
  else if (untrackedChoice === 1) /* Add */ // Add
    shouldAmend = true;
  else if (untrackedChoice === 2) /* Allow Untracked */ // Allow Untracked
    allowUntracked = true;
}

async function f4() {
  if (untrackedChoice === 0)
    /* Cancel */ {
      return null;
    }
  else if (untrackedChoice === 1)
    /* Add */ {
      await repository.addAll(Array.from(untrackedChanges.keys()));
      shouldAmend = true;
    }
  else if (untrackedChoice === 2)
    /* Allow Untracked */ {
      allowUntracked = true;
    }
}

async function f5() {
  if (untrackedChoice === 0) {
    /* Cancel */ return null;
  } else if (untrackedChoice === 1) {
    /* Add */ await repository.addAll(Array.from(untrackedChanges.keys()));
    shouldAmend = true;
  } else if (untrackedChoice === 2) {
    /* Allow Untracked */ allowUntracked = true;
  }
}

// https://github.com/prettier/prettier/issues/13079
if (dotPos > this.pos) /** transition forward */;
      else /** transition backward */;
