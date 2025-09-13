/**
 * Copyright (c) 2014-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { types } from "@babel/core";

export type BabelTypes = typeof types;

let currentTypes = null;

export function wrapWithTypes<T extends (...args: any[]) => any>(types: any, fn: T): T {
  return function (...args) {
    const oldTypes = currentTypes;
    currentTypes = types;
    try {
      return fn.apply(this, args);
    } finally {
      currentTypes = oldTypes;
    }
  } as any;
}

export function getTypes() {
  return currentTypes;
}

export function runtimeProperty(name) {
  const t = getTypes();
  return t.memberExpression(
    t.identifier("_regen_executor"),
    t.identifier(name),
    false
  );
}

export function isReference(path) {
  return path.isReferenced() || path.parentPath.isAssignmentExpression({ left: path.node });
}

export function replaceWithOrRemove(path, replacement) {
  if (replacement) {
    path.replaceWith(replacement)
  } else {
    path.remove();
  }
}
