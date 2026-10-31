// Node.js v26.12.1, lib/internal/util/inspect.js: getDuplicateErrorFrameRanges (L1627-L1734) and the step of
// getStackFrames that calls it (L1782-L1798), unchanged.
// https://github.com/nodejs/node/blob/v26.12.1/lib/internal/util/inspect.js#L1627-L1734
// Copyright Node.js contributors. MIT license: https://github.com/nodejs/node/blob/v26.12.1/LICENSE
//
// util.inspect of Bun finds the same ranges in another way. internal-inspect.test.js compares the two.
const SafeMap = Map;
const SafeSet = Set;

function getDuplicateErrorFrameRanges(frames) {
  // Build a map: frame line -> sorted list of indices where it occurs
  const result = [];
  const lineToPositions = new SafeMap();

  for (let i = 0; i < frames.length; i++) {
    const positions = lineToPositions.get(frames[i]);
    if (positions === undefined) {
      lineToPositions.set(frames[i], [i]);
    } else {
      positions[positions.length] = i;
    }
  }

  const minimumDuplicateRange = 3;
  // Not enough duplicate lines to consider collapsing
  if (frames.length - lineToPositions.size <= minimumDuplicateRange) {
    return result;
  }

  for (let i = 0; i < frames.length - minimumDuplicateRange; i++) {
    const positions = lineToPositions.get(frames[i]);
    // Find the next occurrence of the same line after i, if any
    if (positions.length === 1 || positions[positions.length - 1] === i) {
      continue;
    }

    const current = positions.indexOf(i) + 1;
    if (current === positions.length) {
      continue;
    }

    // Theoretical maximum range, adjusted while iterating
    let range = positions[positions.length - 1] - i;
    if (range < minimumDuplicateRange) {
      continue;
    }
    let extraSteps;
    if (current + 1 < positions.length) {
      // Optimize initial step size by choosing the greatest common divisor (GCD)
      // of all candidate distances to the same frame line. This tends to match
      // the true repeating block size and minimizes fallback iterations.
      let gcdRange = 0;
      for (let j = current; j < positions.length; j++) {
        let distance = positions[j] - i;
        while (distance !== 0) {
          const remainder = gcdRange % distance;
          if (gcdRange !== 0) {
            // Add other possible ranges as fallback
            extraSteps ??= new SafeSet();
            extraSteps.add(gcdRange);
          }
          gcdRange = distance;
          distance = remainder;
        }
        if (gcdRange === 1) break;
      }
      range = gcdRange;
      if (extraSteps) {
        extraSteps.delete(range);
        extraSteps = [...extraSteps];
      }
    }
    let maxRange = range;
    let maxDuplicates = 0;

    let duplicateRanges = 0;

    for (let nextStart = i + range; /* ignored */ ; nextStart += range) {
      let equalFrames = 0;
      for (let j = 0; j < range; j++) {
        if (frames[i + j] !== frames[nextStart + j]) {
          break;
        }
        equalFrames++;
      }
      // Adjust the range to match different type of ranges.
      if (equalFrames !== range) {
        if (!extraSteps?.length) {
          break;
        }
        // Memorize former range in case the smaller one would hide less.
        if (duplicateRanges !== 0 && maxRange * maxDuplicates < range * duplicateRanges) {
          maxRange = range;
          maxDuplicates = duplicateRanges;
        }
        range = extraSteps.pop();
        nextStart = i;
        duplicateRanges = 0;
        continue;
      }
      duplicateRanges++;
    }

    if (maxDuplicates !== 0 && maxRange * maxDuplicates >= range * duplicateRanges) {
      range = maxRange;
      duplicateRanges = maxDuplicates;
    }

    if (duplicateRanges * range >= 3) {
      result.push(i + range, range, duplicateRanges);
      // Skip over the collapsed portion to avoid overlapping matches.
      i += range * (duplicateRanges + 1) - 1;
    }
  }

  return result;
}

function getStackFrames(ctx, frames) {
  // Remove recursive repetitive stack frames in long stacks
  if (frames.length > 10) {
    const ranges = getDuplicateErrorFrameRanges(frames);

    for (let i = ranges.length - 3; i >= 0; i -= 3) {
      const offset = ranges[i];
      const length = ranges[i + 1];
      const duplicateRanges = ranges[i + 2];

      const msg = `    ... collapsed ${length * duplicateRanges} duplicate lines ` +
        'matching above ' +
        (duplicateRanges > 1 ?
          `${length} lines ${duplicateRanges} times...` :
          'lines ...');
      frames.splice(offset, length * duplicateRanges, ctx.stylize(msg, 'undefined'));
    }
  }

  return frames;
}

module.exports = { getStackFrames };
