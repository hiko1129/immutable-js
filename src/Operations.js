/**
 *  Copyright (c) 2014, Facebook, Inc.
 *  All rights reserved.
 *
 *  This source code is licensed under the BSD-style license found in the
 *  LICENSE file in the root directory of this source tree. An additional grant
 *  of patent rights can be found in the PATENTS file in the same directory.
 */

import "TrieUtils"
import "Iterable"
import "Iterator"
import "Seq"
/* global NOT_SET, ensureSize,
          isIterable, isKeyed, isIndexed, KeyedIterable,
          hash,
          Iterator, iteratorValue, iteratorDone,
          ITERATE_KEYS, ITERATE_VALUES, ITERATE_ENTRIES,
          LazyKeyedSequence, LazySetSequence, LazyIndexedSequence,
          seqFromValue, ArraySequence */
/* exported ToIndexedSequence, ToKeyedSequence, ToSetSequence,
            FromEntriesSequence, flipFactory, mapFactory, reverseFactory,
            filterFactory, groupByFactory, takeFactory, takeWhileFactory,
            skipFactory, skipWhileFactory, concatFactory, flattenFactory,
            interposeFactory */


class ToIndexedSequence extends LazyIndexedSequence {
  constructor(iter) {
    this._iter = iter;
    this.size = iter.size;
  }

  contains(value) {
    return this._iter.contains(value);
  }

  cacheResult() {
    this._iter.cacheResult();
    this.size = this._iter.size;
    return this;
  }

  __iterate(fn, reverse) {
    var iterations = 0;
    return this._iter.__iterate(v => fn(v, iterations++, this), reverse);
  }

  __iterator(type, reverse) {
    var iterator = this._iter.__iterator(ITERATE_VALUES, reverse);
    var iterations = 0;
    return new Iterator(() => {
      var step = iterator.next();
      return step.done ? step :
        iteratorValue(type, iterations++, step.value, step)
    });
  }
}


class ToKeyedSequence extends LazyKeyedSequence {
  constructor(indexed, useKeys) {
    this._iter = indexed;
    this._useKeys = useKeys;
    this.size = indexed.size;
  }

  get(key, notSetValue) {
    return this._iter.get(key, notSetValue);
  }

  has(key) {
    return this._iter.has(key);
  }

  valueSeq() {
    return this._iter.valueSeq();
  }

  reverse() {
    var reversedSequence = reverseFactory(this, true);
    if (!this._useKeys) {
      reversedSequence.valueSeq = () => this._iter.toSeq().reverse();
    }
    return reversedSequence;
  }

  map(mapper, context) {
    var mappedSequence = mapFactory(this, mapper, context);
    if (!this._useKeys) {
      mappedSequence.valueSeq = () => this._iter.toSeq().map(mapper, context);
    }
    return mappedSequence;
  }

  cacheResult() {
    this._iter.cacheResult();
    this.size = this._iter.size;
    return this;
  }

  __iterate(fn, reverse) {
    var ii;
    return this._iter.__iterate(
      this._useKeys ?
        (v, k) => fn(v, k, this) :
        ((ii = reverse ? ensureSize(this) : 0),
          v => fn(v, reverse ? --ii : ii++, this)),
      reverse
    );
  }

  __iterator(type, reverse) {
    if (this._useKeys) {
      return this._iter.__iterator(type, reverse);
    }
    var iterator = this._iter.__iterator(ITERATE_VALUES, reverse);
    var ii = reverse ? ensureSize(this) : 0;
    return new Iterator(() => {
      var step = iterator.next();
      return step.done ? step :
        iteratorValue(type, reverse ? --ii : ii++, step.value, step);
    });
  }
}


class ToSetSequence extends LazySetSequence {
  constructor(iter) {
    this._iter = iter;
    this.size = iter.size;
  }

  has(key) {
    return this._iter.contains(key);
  }

  cacheResult() {
    this._iter.cacheResult();
    this.size = this._iter.size;
    return this;
  }

  __iterate(fn, reverse) {
    return this._iter.__iterate(v => fn(v, v, this), reverse);
  }

  __iterator(type, reverse) {
    var iterator = this._iter.__iterator(ITERATE_VALUES, reverse);
    return new Iterator(() => {
      var step = iterator.next();
      return step.done ? step :
        iteratorValue(type, step.value, step.value, step);
    });
  }
}


class FromEntriesSequence extends LazyKeyedSequence {
  constructor(entries) {
    this._iter = entries;
    this.size = entries.size;
  }

  entrySeq() {
    return this._iter.toSeq();
  }

  cacheResult() {
    this._iter.cacheResult();
    this.size = this._iter.size;
    return this;
  }

  __iterate(fn, reverse) {
    return this._iter.__iterate(entry => {
      // Check if entry exists first so array access doesn't throw for holes
      // in the parent iteration.
      if (entry) {
        validateEntry(entry);
        return fn(entry[1], entry[0], this);
      }
    }, reverse);
  }

  __iterator(type, reverse) {
    var iterator = this._iter.__iterator(ITERATE_VALUES, reverse);
    return new Iterator(() => {
      while (true) {
        var step = iterator.next();
        if (step.done) {
          return step;
        }
        var entry = step.value;
        // Check if entry exists first so array access doesn't throw for holes
        // in the parent iteration.
        if (entry) {
          validateEntry(entry);
          return type === ITERATE_ENTRIES ? step :
            iteratorValue(type, entry[0], entry[1], step);
        }
      }
    });
  }
}


function flipFactory(iterable) {
  var flipSequence = makeSequence(iterable);
  flipSequence.size = iterable.size;
  flipSequence.flip = () => iterable;
  flipSequence.reverse = function () {
    var reversedSequence = iterable.reverse.apply(this); // super.reverse()
    reversedSequence.flip = () => iterable.reverse();
    return reversedSequence;
  };
  flipSequence.has = key => iterable.contains(key);
  flipSequence.contains = key => iterable.has(key);
  flipSequence.__iterateUncached = function (fn, reverse) {
    return iterable.__iterate((v, k) => fn(k, v, this) !== false, reverse);
  }
  flipSequence.__iteratorUncached = function(type, reverse) {
    if (type === ITERATE_ENTRIES) {
      var iterator = iterable.__iterator(type, reverse);
      return new Iterator(() => {
        var step = iterator.next();
        if (!step.done) {
          var k = step.value[0];
          step.value[0] = step.value[1];
          step.value[1] = k;
        }
        return step;
      });
    }
    return iterable.__iterator(
      type === ITERATE_VALUES ? ITERATE_KEYS : ITERATE_VALUES,
      reverse
    );
  }
  return flipSequence;
}


function mapFactory(iterable, mapper, context) {
  var mappedSequence = makeSequence(iterable);
  mappedSequence.size = iterable.size;
  mappedSequence.has = key => iterable.has(key);
  mappedSequence.get = (key, notSetValue) => {
    var v = iterable.get(key, NOT_SET);
    return v === NOT_SET ?
      notSetValue :
      mapper.call(context, v, key, iterable);
  };
  mappedSequence.__iterateUncached = function (fn, reverse) {
    return iterable.__iterate(
      (v, k, c) => fn(mapper.call(context, v, k, c), k, this) !== false,
      reverse
    );
  }
  mappedSequence.__iteratorUncached = function (type, reverse) {
    var iterator = iterable.__iterator(ITERATE_ENTRIES, reverse);
    return new Iterator(() => {
      var step = iterator.next();
      if (step.done) {
        return step;
      }
      var entry = step.value;
      var key = entry[0];
      return iteratorValue(
        type,
        key,
        mapper.call(context, entry[1], key, iterable),
        step
      );
    });
  }
  return mappedSequence;
}


function reverseFactory(iterable, useKeys) {
  var reversedSequence = makeSequence(iterable);
  reversedSequence.size = iterable.size;
  reversedSequence.reverse = () => iterable;
  if (iterable.flip) {
    reversedSequence.flip = function () {
      var flipSequence = flipFactory(iterable);
      flipSequence.reverse = () => iterable.flip();
      return flipSequence;
    };
  }
  reversedSequence.get = (key, notSetValue) =>
    iterable.get(useKeys ? key : -1 - key, notSetValue);
  reversedSequence.has = key =>
    iterable.has(useKeys ? key : -1 - key);
  reversedSequence.contains = value => iterable.contains(value);
  reversedSequence.cacheResult = function () {
    iterable.cacheResult(); // iterable is a Seq
    this.size = iterable.size;
    return this;
  };
  reversedSequence.__iterate = function (fn, reverse) {
    return iterable.__iterate((v, k) => fn(v, k, this), !reverse);
  };
  reversedSequence.__iterator =
    (type, reverse) => iterable.__iterator(type, !reverse);
  return reversedSequence;
}


function filterFactory(iterable, predicate, context, useKeys) {
  var filterSequence = makeSequence(iterable);
  if (useKeys) {
    filterSequence.has = key => {
      var v = iterable.get(key, NOT_SET);
      return v !== NOT_SET && !!predicate.call(context, v, key, iterable);
    };
    filterSequence.get = (key, notSetValue) => {
      var v = iterable.get(key, NOT_SET);
      return v !== NOT_SET && predicate.call(context, v, key, iterable) ?
        v : notSetValue;
    };
  }
  filterSequence.__iterateUncached = function (fn, reverse) {
    var iterations = 0;
    iterable.__iterate((v, k, c) => {
      if (predicate.call(context, v, k, c)) {
        iterations++;
        return fn(v, useKeys ? k : iterations - 1, this);
      }
    }, reverse);
    return iterations;
  };
  filterSequence.__iteratorUncached = function (type, reverse) {
    var iterator = iterable.__iterator(ITERATE_ENTRIES, reverse);
    var iterations = 0;
    return new Iterator(() => {
      while (true) {
        var step = iterator.next();
        if (step.done) {
          return step;
        }
        var entry = step.value;
        var key = entry[0];
        var value = entry[1];
        if (predicate.call(context, value, key, iterable)) {
          return iteratorValue(type, useKeys ? key : iterations++, value, step);
        }
      }
    });
  }
  return filterSequence;
}


function groupByFactory(seq, grouper, context, useKeys) {
  var groupMap = {};
  var groups = [];
  seq.__iterate((v, k) => {
    var g = grouper.call(context, v, k, seq);
    var h = hash(g);
    var e = useKeys ? [k, v] : v;
    if (!groupMap.hasOwnProperty(h)) {
      groupMap[h] = groups.length;
      groups.push([g, [e]]);
    } else {
      groups[groupMap[h]][1].push(e);
    }
  });
  return new ArraySequence(groups).fromEntrySeq().map(
    useKeys ?
      group => new ArraySequence(group).fromEntrySeq() :
      group => new ArraySequence(group)
  );
}


function takeFactory(iterable, amount) {
  if (amount > iterable.size) {
    return iterable;
  }
  if (amount < 0) {
    amount = 0;
  }
  var takeSequence = makeSequence(iterable);
  takeSequence.size = iterable.size && Math.min(iterable.size, amount);
  takeSequence.__iterateUncached = function(fn, reverse) {
    if (amount === 0) {
      return 0;
    }
    if (reverse) {
      return this.cacheResult().__iterate(fn, reverse);
    }
    var iterations = 0;
    iterable.__iterate((v, k) =>
      ++iterations && fn(v, k, this) !== false && iterations < amount
    );
    return iterations;
  };
  takeSequence.__iteratorUncached = function(type, reverse) {
    if (reverse) {
      return this.cacheResult().__iterator(type, reverse);
    }
    // Don't bother instantiating parent iterator if taking 0.
    var iterator = amount && iterable.__iterator(type, reverse);
    var iterations = 0;
    return new Iterator(() => {
      if (iterations++ > amount) {
        return iteratorDone();
      }
      return iterator.next();
    });
  };
  return takeSequence;
}


function takeWhileFactory(iterable, predicate, context) {
  var takeSequence = makeSequence(iterable);
  takeSequence.__iterateUncached = function(fn, reverse) {
    if (reverse) {
      return this.cacheResult().__iterate(fn, reverse);
    }
    var iterations = 0;
    iterable.__iterate((v, k, c) =>
      predicate.call(context, v, k, c) && ++iterations && fn(v, k, this)
    );
    return iterations;
  };
  takeSequence.__iteratorUncached = function(type, reverse) {
    if (reverse) {
      return this.cacheResult().__iterator(type, reverse);
    }
    var iterator = iterable.__iterator(ITERATE_ENTRIES, reverse);
    var iterating = true;
    return new Iterator(() => {
      if (!iterating) {
        return iteratorDone();
      }
      var step = iterator.next();
      if (step.done) {
        return step;
      }
      var entry = step.value;
      var k = entry[0];
      var v = entry[1];
      if (!predicate.call(context, v, k, this)) {
        iterating = false;
        return iteratorDone();
      }
      return type === ITERATE_ENTRIES ? step :
        iteratorValue(type, k, v, step);
    });
  };
  return takeSequence;
}


function skipFactory(iterable, amount, useKeys) {
  if (amount <= 0) {
    return iterable;
  }
  var skipSequence = makeSequence(iterable);
  skipSequence.size = iterable.size && Math.max(0, iterable.size - amount);
  skipSequence.__iterateUncached = function (fn, reverse) {
    if (reverse) {
      return this.cacheResult().__iterate(fn, reverse);
    }
    var skipped = 0;
    var isSkipping = true;
    var iterations = 0;
    iterable.__iterate((v, k) => {
      if (!(isSkipping && (isSkipping = skipped++ < amount))) {
        iterations++;
        return fn(v, useKeys ? k : iterations - 1, this);
      }
    });
    return iterations;
  };
  skipSequence.__iteratorUncached = function (type, reverse) {
    if (reverse) {
      return this.cacheResult().__iterator(type, reverse);
    }
    var iterator = amount && iterable.__iterator(type, reverse);
    var skipped = 0;
    var iterations = 0;
    return new Iterator(() => {
      while (skipped < amount) {
        skipped++;
        iterator.next();
      }
      var step = iterator.next();
      if (useKeys || type === ITERATE_VALUES) {
        return step;
      } else if (type === ITERATE_KEYS) {
        return iteratorValue(type, iterations++, undefined, step);
      } else {
        return iteratorValue(type, iterations++, step.value[1], step);
      }
    });
  };
  return skipSequence;
}


function skipWhileFactory(iterable, predicate, context, useKeys) {
  var skipSequence = makeSequence(iterable);
  skipSequence.__iterateUncached = function (fn, reverse) {
    if (reverse) {
      return this.cacheResult().__iterate(fn, reverse);
    }
    var isSkipping = true;
    var iterations = 0;
    iterable.__iterate((v, k, c) => {
      if (!(isSkipping && (isSkipping = predicate.call(context, v, k, c)))) {
        iterations++;
        return fn(v, useKeys ? k : iterations - 1, this);
      }
    });
    return iterations;
  };
  skipSequence.__iteratorUncached = function(type, reverse) {
    if (reverse) {
      return this.cacheResult().__iterator(type, reverse);
    }
    var iterator = iterable.__iterator(ITERATE_ENTRIES, reverse);
    var skipping = true;
    var iterations = 0;
    return new Iterator(() => {
      var step, k, v;
      do {
        step = iterator.next();
        if (step.done) {
          if (useKeys || type === ITERATE_VALUES) {
            return step;
          } else if (type === ITERATE_KEYS) {
            return iteratorValue(type, iterations++, undefined, step);
          } else {
            return iteratorValue(type, iterations++, step.value[1], step);
          }
        }
        var entry = step.value;
        k = entry[0];
        v = entry[1];
        skipping && (skipping = predicate.call(context, v, k, this));
      } while (skipping);
      return type === ITERATE_ENTRIES ? step :
        iteratorValue(type, k, v, step);
    });
  };
  return skipSequence;
}


function concatFactory(iterable, values, useKeys) {
  var isKeyedIter = isKeyed(iterable);
  var iters = new ArraySequence([iterable].concat(values)).map(v => {
    if (!isIterable(v)) {
      v = seqFromValue(v, true);
    }
    if (isKeyedIter) {
      v = KeyedIterable(v);
    }
    return v;
  });
  if (isKeyedIter) {
    iters = iters.toKeyedSeq();
  } else if (!isIndexed(iterable)) {
    iters = iters.toSetSeq();
  }
  var flat = iters.flatten(true);
  flat.size = iters.reduce(
    (sum, seq) => {
      if (sum !== undefined) {
        var size = seq.size;
        if (size !== undefined) {
          return sum + size;
        }
      }
    },
    0
  );
  return flat;
}


function flattenFactory(iterable, depth, useKeys) {
  var flatSequence = makeSequence(iterable);
  flatSequence.__iterateUncached = function(fn, reverse) {
    var iterations = 0;
    var stopped = false;
    function flatDeep(iter, currentDepth) {
      iter.__iterate((v, k) => {
        if ((!depth || currentDepth < depth) && isIterable(v)) {
          flatDeep(v, currentDepth + 1);
        } else if (fn(v, useKeys ? k : iterations++, this) === false) {
          stopped = true;
        }
        return !stopped;
      }, reverse);
    }
    flatDeep(iterable, 0);
    return iterations;
  }
  flatSequence.__iteratorUncached = function(type, reverse) {
    var iterator = iterable.__iterator(type, reverse);
    var stack = [];
    var iterations = 0;
    return new Iterator(() => {
      while (iterator) {
        var step = iterator.next();
        if (step.done !== false) {
          iterator = stack.pop();
          continue;
        }
        var v = step.value;
        if (type === ITERATE_ENTRIES) {
          v = v[1];
        }
        if ((!depth || stack.length < depth) && isIterable(v)) {
          stack.push(iterator);
          iterator = v.__iterator(type, reverse);
        } else {
          return useKeys ? step : iteratorValue(type, iterations++, v, step);
        }
      }
      return iteratorDone();
    });
  }
  return flatSequence;
}


function interposeFactory(iterable, separator) {
  var interposedSequence = makeSequence(iterable);
  interposedSequence.size = iterable.size && iterable.size * 2 -1;
  interposedSequence.__iterateUncached = function(fn, reverse) {
    var iterations = 0;
    iterable.__iterate((v, k) =>
      (!iterations || fn(separator, iterations++, this) !== false) &&
      fn(v, iterations++, this) !== false,
      reverse
    );
    return iterations;
  };
  interposedSequence.__iteratorUncached = function(type, reverse) {
    var iterator = iterable.__iterator(ITERATE_VALUES, reverse);
    var iterations = 0;
    var step;
    return new Iterator(() => {
      if (!step || iterations % 2) {
        step = iterator.next();
        if (step.done) {
          return step;
        }
      }
      return iterations % 2 ?
        iteratorValue(type, iterations++, separator) :
        iteratorValue(type, iterations++, step.value, step);
    });
  };
  return interposedSequence;
}



// #pragma Helper Functions

function validateEntry(entry) {
  if (entry !== Object(entry)) {
    throw new TypeError('Expected [K, V] tuple: ' + entry);
  }
}

function makeSequence(iterable) {
  return Object.create(
    (
      isKeyed(iterable) ? LazyKeyedSequence :
      isIndexed(iterable) ? LazyIndexedSequence :
      LazySetSequence
    ).prototype
  );
}
