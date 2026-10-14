import { test } from "node:test";
import assert from "node:assert/strict";
import { browserCommand } from "../plugin/browser.js";

test("browserCommand per platform", () => {
  assert.deepEqual(browserCommand("win32", "http://x"), {
    command: "cmd", args: ["/c", "start", "", "http://x"],
  });
  assert.deepEqual(browserCommand("darwin", "http://x"), {
    command: "open", args: ["http://x"],
  });
  assert.deepEqual(browserCommand("linux", "http://x"), {
    command: "xdg-open", args: ["http://x"],
  });
});
