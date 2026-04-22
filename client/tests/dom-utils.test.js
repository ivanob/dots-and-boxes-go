import test from "node:test";
import assert from "node:assert/strict";

import { clearElementCache, getElement } from "../modules/dom-utils.js";

test("getElement caches DOM lookups until cleared", () => {
  const calls = [];
  const button = { id: "button" };

  global.document = {
    getElementById(id) {
      calls.push(id);
      return button;
    },
  };

  clearElementCache();

  assert.equal(getElement("save"), button);
  assert.equal(getElement("save"), button);
  assert.deepEqual(calls, ["save"]);

  clearElementCache("save");
  assert.equal(getElement("save"), button);
  assert.deepEqual(calls, ["save", "save"]);
});

test("getElement caches null results too", () => {
  let callCount = 0;

  global.document = {
    getElementById() {
      callCount += 1;
      return null;
    },
  };

  clearElementCache();

  assert.equal(getElement("missing"), null);
  assert.equal(getElement("missing"), null);
  assert.equal(callCount, 1);
});