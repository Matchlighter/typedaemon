/**
 * Copyright (c) 2014-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import assert from "assert";
import { Emitter } from "./emit";
import { inherits } from "util";
import { getTypes } from "./util";

function Entry() {
  assert.ok(this instanceof Entry);
}

function FunctionEntry(returnLoc) {
  Entry.call(this);
  getTypes().assertLiteral(returnLoc);
  this.returnLoc = returnLoc;
}

inherits(FunctionEntry, Entry);
export { FunctionEntry }

function LoopEntry(breakLoc, continueLoc, label) {
  Entry.call(this);

  const t = getTypes();

  t.assertLiteral(breakLoc);
  t.assertLiteral(continueLoc);

  if (label) {
    t.assertIdentifier(label);
  } else {
    label = null;
  }

  this.breakLoc = breakLoc;
  this.continueLoc = continueLoc;
  this.label = label;
}

inherits(LoopEntry, Entry);
export { LoopEntry }

function SwitchEntry(breakLoc) {
  Entry.call(this);
  getTypes().assertLiteral(breakLoc);
  this.breakLoc = breakLoc;
}

inherits(SwitchEntry, Entry);
export { SwitchEntry }

function TryEntry(firstLoc, catchEntry, finallyEntry) {
  Entry.call(this);

  const t = getTypes();
  t.assertLiteral(firstLoc);

  if (catchEntry) {
    assert.ok(catchEntry instanceof CatchEntry);
  } else {
    catchEntry = null;
  }

  if (finallyEntry) {
    assert.ok(finallyEntry instanceof FinallyEntry);
  } else {
    finallyEntry = null;
  }

  // Have to have one or the other (or both).
  assert.ok(catchEntry || finallyEntry);

  this.firstLoc = firstLoc;
  this.catchEntry = catchEntry;
  this.finallyEntry = finallyEntry;
}

inherits(TryEntry, Entry);
export { TryEntry }

function CatchEntry(firstLoc, paramId) {
  Entry.call(this);

  const t = getTypes();

  t.assertLiteral(firstLoc);
  t.assertIdentifier(paramId);

  this.firstLoc = firstLoc;
  this.paramId = paramId;
}

inherits(CatchEntry, Entry);
export { CatchEntry }

function FinallyEntry(firstLoc, afterLoc) {
  Entry.call(this);
  const t = getTypes();
  t.assertLiteral(firstLoc);
  t.assertLiteral(afterLoc);
  this.firstLoc = firstLoc;
  this.afterLoc = afterLoc;
}

inherits(FinallyEntry, Entry);
export { FinallyEntry }

function LabeledEntry(breakLoc, label) {
  Entry.call(this);

  const t = getTypes();

  t.assertLiteral(breakLoc);
  t.assertIdentifier(label);

  this.breakLoc = breakLoc;
  this.label = label;
}

inherits(LabeledEntry, Entry);
export { LabeledEntry }

function LeapManager(emitter) {
  assert.ok(this instanceof LeapManager);

  assert.ok(emitter instanceof Emitter);

  this.emitter = emitter;
  // @ts-ignore
  this.entryStack = [new FunctionEntry(emitter.finalLoc)];
}

let LMp = LeapManager.prototype;
export { LeapManager }

LMp.withEntry = function (entry, callback) {
  assert.ok(entry instanceof Entry);
  this.entryStack.push(entry);
  try {
    callback.call(this.emitter);
  } finally {
    let popped = this.entryStack.pop();
    assert.strictEqual(popped, entry);
  }
};

LMp._findLeapLocation = function (property, label) {
  for (let i = this.entryStack.length - 1; i >= 0; --i) {
    let entry = this.entryStack[i];
    let loc = entry[property];
    if (loc) {
      if (label) {
        if (entry.label &&
          entry.label.name === label.name) {
          return loc;
        }
      } else if (entry instanceof LabeledEntry) {
        // Ignore LabeledEntry entries unless we are actually breaking to
        // a label.
      } else {
        return loc;
      }
    }
  }

  return null;
};

LMp.getBreakLoc = function (label) {
  return this._findLeapLocation("breakLoc", label);
};

LMp.getContinueLoc = function (label) {
  return this._findLeapLocation("continueLoc", label);
};
