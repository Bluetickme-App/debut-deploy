// Run: node --test server/comp.test.js
// Per-org billing override: comp (100% free) or a bounded % discount.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_FILE = ":memory:";
await import("./db.js"); // side-effect: create schema
const { getComp, setComp, compFactor } = await import("./comp.js");

test("getComp defaults to not-comped, 0% when nothing is stored", () => {
  assert.deepEqual(getComp(1), { comp: false, discountPct: 0 });
});

test("setComp persists a comp flag and a discount independently", () => {
  setComp(2, { comp: true });
  assert.equal(getComp(2).comp, true);
  assert.equal(getComp(2).discountPct, 0, "discount untouched when only comp is set");

  setComp(3, { discountPct: 25 });
  assert.equal(getComp(3).discountPct, 25);
  assert.equal(getComp(3).comp, false, "comp untouched when only discount is set");
});

test("setComp rejects a 100% discount — that is comp, not a discount", () => {
  assert.throws(() => setComp(4, { discountPct: 100 }), /0.?.?99|comp/i);
});

test("setComp rejects a negative or fractional discount", () => {
  assert.throws(() => setComp(5, { discountPct: -1 }));
  assert.throws(() => setComp(5, { discountPct: 10.5 }));
});

test("compFactor: comp scales to 0, a discount scales proportionally, default is 1", () => {
  setComp(6, { comp: true, discountPct: 25 }); // comp wins over any discount
  assert.equal(compFactor(6), 0);

  setComp(7, { discountPct: 25 });
  assert.equal(compFactor(7), 0.75);

  assert.equal(compFactor(8), 1, "an org with no override is charged in full");
});
