import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("v2 UI does not ask for manual Facebook GraphQL tokens", () => {
  const source = fs.readFileSync("ui/app.js", "utf8");

  assert.equal(source.includes("sniper-facebook-search-doc"), false);
  assert.equal(source.includes("sniper-facebook-search-vars"), false);
  assert.equal(source.includes("sniper-facebook-detail-doc"), false);
  assert.equal(source.includes("sniper-facebook-detail-vars"), false);
  assert.equal(source.includes("Search doc_id"), false);
  assert.equal(source.includes("Detail doc_id"), false);
});

test("v2 user guide does not include manual Facebook token setup", () => {
  const guide = fs.readFileSync("docs/USER-GUIDE.md", "utf8");

  assert.equal(guide.includes("Facebook GraphQL Token Setup"), false);
  assert.equal(guide.includes("Facebook Search doc_id"), false);
  assert.equal(guide.includes("Facebook Detail doc_id"), false);
});
