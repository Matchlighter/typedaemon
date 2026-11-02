/**
 * Copyright (c) 2014-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// @ts-nocheck

import { NodePath } from "@babel/core";
import * as util from "./util";
import { Function } from "@babel/types";
let hasOwn = Object.prototype.hasOwnProperty;

// The hoist function takes a FunctionExpression or FunctionDeclaration
// and replaces any Declaration nodes in its body with assignments, then
// returns a VariableDeclaration containing just the names of the removed
// declarations.
export function hoist(funPath: NodePath<Function>, contextId) {
  const t = util.getTypes();
  t.assertFunction(funPath.node);

  let vars = {};

  const stateMemExpr = t.memberExpression(contextId, t.identifier("state"))

  // Identifier nodes that refer to a hoisted binding. Resolved up-front, while scope info
  // is still accurate (hoisting below removes the bindings), so the rewrite pass only
  // touches real references and leaves shadowing nested-function params/locals alone.
  const hoistedRefs = resolveHoistedRefs(funPath);

  function varDeclToExpr({ node: vdec, scope }, includeIdentifiers) {
    t.assertVariableDeclaration(vdec);
    // TODO assert.equal(vdec.kind, "var");
    let exprs = [];

    vdec.declarations.forEach(function (dec) {
      // Note: We duplicate 'dec.id' here to ensure that the variable declaration IDs don't
      // have the same 'loc' value, since that can make sourcemaps and retainLines behave poorly.
      // `dec.id` may be a pattern; hoist every name it binds and keep the pattern as the
      // assignment target.
      for (const name of Object.keys(t.getBindingIdentifiers(dec.id))) {
        vars[name] = t.identifier(name);

        // Remove the binding, to avoid "duplicate declaration" errors when it will
        // be injected again.
        scope.removeBinding(name);
      }

      if (dec.init) {
        exprs.push(t.assignmentExpression(
          "=", dec.id, dec.init
        ));
      } else if (includeIdentifiers) {
        exprs.push(dec.id);
      }
    });

    if (exprs.length === 0)
      return null;

    if (exprs.length === 1)
      return exprs[0];

    return t.sequenceExpression(exprs);
  }

  funPath.get("body").traverse({
    VariableDeclaration: {
      exit: function (path) {
        let expr = varDeclToExpr(path, false);
        if (expr === null) {
          path.remove();
        } else {
          // We don't need to traverse this expression any further because
          // there can't be any new declarations inside an expression.
          util.replaceWithOrRemove(path, t.expressionStatement(expr));
        }

        // Since the original node has been either removed or replaced,
        // avoid traversing it any further.
        path.skip();
      }
    },

    ForStatement: function (path) {
      let init = path.get("init");
      if (init.isVariableDeclaration()) {
        util.replaceWithOrRemove(init, varDeclToExpr(init, false));
      }
    },

    ForXStatement: function (path) {
      let left = path.get("left");
      if (left.isVariableDeclaration()) {
        util.replaceWithOrRemove(left, varDeclToExpr(left, true));
      }
    },

    FunctionDeclaration: function (path) {
      let node = path.node;
      vars[node.id.name] = node.id;

      const assignId = t.clone(node.id);
      if (hoistedRefs.has(node.id)) hoistedRefs.add(assignId);

      let assignment = t.expressionStatement(
        t.assignmentExpression(
          "=",
          assignId,
          t.functionExpression(
            path.scope.generateUidIdentifierBasedOnNode(node),
            node.params,
            node.body,
            node.generator,
            node.expression
          )
        )
      );

      if (path.parentPath.isBlockStatement()) {
        // Insert the assignment form before the first statement in the
        // enclosing block.
        path.parentPath.unshiftContainer("body", assignment);

        // Remove the function declaration now that we've inserted the
        // equivalent assignment form at the beginning of the block.
        path.remove();
      } else {
        // If the parent node is not a block statement, then we can just
        // replace the declaration with the equivalent assignment form
        // without worrying about hoisting it.
        util.replaceWithOrRemove(path, assignment);
      }

      // Remove the binding, to avoid "duplicate declaration" errors when it will
      // be injected again.
      path.scope.removeBinding(node.id.name);

      // Don't hoist variables out of inner functions.
      path.skip();
    },

    FunctionExpression: function (path) {
      // Don't descend into nested function expressions.
      path.skip();
    },

    ArrowFunctionExpression: function (path) {
      // Don't descend into nested function expressions.
      path.skip();
    }
  });

  // const methodPath = funPath.findParent(path => path.isMethod());
  // for (let paramPath of methodPath.get("params")) {
  //   let param = paramPath.node;
  //   if (t.isIdentifier(param)) {
  //     vars[param.name] = t.identifier(param.name);
  //   }
  // }

  // Whether an Identifier names a variable (read, write, or pattern target), as opposed to
  // a property/member key or a label, which merely share the spelling.
  function isVariableUse(path) {
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

  funPath.get("body").traverse({
    Identifier: {
      exit: function (path) {
        if (!hoistedRefs.has(path.node) || !isVariableUse(path)) return;
        const parent = path.parent;
        // `{ x }` -> `{ x: state.x }` (value side only; the key was skipped above)
        if (t.isObjectProperty(parent) && parent.shorthand) parent.shorthand = false;

        util.replaceWithOrRemove(path, t.memberExpression(stateMemExpr, path.node))
      }
    },
  });

  let paramNames = {};
  funPath.get("params").forEach(function (paramPath) {
    let param = paramPath.node;
    if (t.isIdentifier(param)) {
      paramNames[param.name] = param;
    } else {
      // Variables declared by destructuring parameter patterns will be
      // harmlessly re-declared.
    }
  });

  let declarations = [];

  Object.keys(vars).forEach(function (name) {
    if (!hasOwn.call(paramNames, name)) {
      declarations.push(t.variableDeclarator(vars[name], null));
    }
  });

  if (declarations.length === 0) {
    return null; // Be sure to handle this case!
  }

  // return t.variableDeclaration("var", declarations);
  return null;
};

// Bindings declared by the resumable fn's own body (not nested functions): these become `state.<name>`.
function collectHoistedBindings(funPath) {
  const t = util.getTypes();
  const bindings = new Set();
  const add = (path, ids) => {
    for (const name of Object.keys(ids)) {
      const binding = path.scope.getBinding(name);
      if (binding) bindings.add(binding);
    }
  };
  funPath.get("body").traverse({
    VariableDeclaration(path) {
      for (const dec of path.node.declarations) add(path, t.getBindingIdentifiers(dec.id));
    },
    FunctionDeclaration(path) {
      add(path.parentPath, { [path.node.id.name]: true });
      path.skip();
    },
    FunctionExpression(path) { path.skip(); },
    ArrowFunctionExpression(path) { path.skip(); },
  });
  return bindings;
}

// Hoisting flattens every binding into one `state` namespace, so bindings that share a name
// (e.g. a block-scoped `let x` shadowing an outer `x`) get unique names first. Then resolves
// every Identifier in the body (nested functions included) to the hoisted binding it refers to.
function resolveHoistedRefs(funPath) {
  const bindings = collectHoistedBindings(funPath);

  const seen = new Set();
  for (const binding of bindings) {
    const name = binding.identifier.name;
    if (seen.has(name)) {
      binding.scope.rename(name, binding.scope.generateUid(name));
    }
    seen.add(binding.identifier.name);
  }

  const refs = new Set();
  funPath.get("body").traverse({
    Identifier(path) {
      const binding = path.scope.getBinding(path.node.name);
      if (binding && bindings.has(binding)) refs.add(path.node);
    },
  });
  return refs;
}
