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

// Whether an Identifier names a variable (read, write, or pattern target), as opposed to
// a property/member key or a label, which merely share the spelling.
export function isVariableUse(path) {
  const { node, parent } = path;
  switch (parent.type) {
    case "MemberExpression":
    case "OptionalMemberExpression":
      return parent.object === node || parent.computed;
    case "ObjectProperty":
    case "ObjectMethod":
    case "ClassProperty":
    case "ClassAccessorProperty":
    case "ClassMethod":
      return parent.key !== node || parent.computed;
    case "LabeledStatement":
    case "BreakStatement":
    case "ContinueStatement":
      return parent.label !== node;
    case "MetaProperty":
      return false;
  }
  return true;
}

export function replaceWithOrRemove(path, replacement) {
  if (replacement) {
    path.replaceWith(replacement)
  } else {
    path.remove();
  }
}
