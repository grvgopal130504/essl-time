/**
 * Merging + paging for the live feed, without a browser.
 *
 *     npm --prefix frontend run test:feed
 */
import assert from "node:assert/strict";
import { mergeFeed, pageOf, onlyDay, feedKey } from "../src/lib/feedView.js";

let n = 0;
const it = (name, fn) => {
  fn();
  n++;
  console.log(`  ✓ ${name}`);
};

// WebSocket shape
const live = (pin, hhmm, extra = {}) => ({
  id: `SN1-${pin}-${hhmm}`,
  deviceSn: "SN1",
  pin,
  punchTime: `2026-08-06T${hhmm}:00+05:30`,
  roleLabel: "Check In",
  ...extra,
});

// Postgres shape from /api/feed
const stored = (pin, hhmm, extra = {}) => ({
  event_id: `SN1-${pin}-${hhmm}`,
  device_sn: "SN1",
  pin,
  punch_time: `2026-08-06T${hhmm}:00+05:30`,
  role_label: "Check In",
  ...extra,
});

console.log("keys");
it("the same punch keys identically from either source", () =>
  assert.equal(feedKey(live("14", "09:30")), feedKey(stored("14", "09:30"))));

it("keys fall back to sn+pin+time when there is no id", () =>
  assert.equal(
    feedKey({ deviceSn: "SN1", pin: "14", punchTime: "T" }),
    feedKey({ device_sn: "SN1", pin: "14", punch_time: "T" })
  ));

console.log("merge");
it("de-duplicates a punch present in both sources", () => {
  const out = mergeFeed([live("14", "09:30")], [stored("14", "09:30")]);
  assert.equal(out.length, 1);
});

it("the live copy wins, so a rename isn't reverted by the stored row", () => {
  const out = mergeFeed(
    [live("14", "09:30", { employeeName: "Ravi Kumar" })],
    [stored("14", "09:30", { employee_name: null })]
  );
  assert.equal(out[0].employeeName, "Ravi Kumar");
});

it("newest first, regardless of which source it came from", () => {
  const out = mergeFeed(
    [live("1", "18:00"), live("2", "08:00")],
    [stored("3", "12:00"), stored("4", "21:00")]
  );
  assert.deepEqual(out.map((p) => p.pin), ["4", "1", "3", "2"]);
});

it("a live-only punch survives when the stored page didn't include it yet", () => {
  const out = mergeFeed([live("99", "23:30")], [stored("1", "09:00")]);
  assert.equal(out.length, 2);
  assert.equal(out[0].pin, "99");
});

it("empty inputs are fine", () => {
  assert.deepEqual(mergeFeed([], []), []);
  assert.equal(mergeFeed(undefined, undefined).length, 0);
});

console.log("paging");
const many = Array.from({ length: 420 }, (_, i) =>
  live(String(i), String(Math.floor(i / 60)).padStart(2, "0") + ":00")
);

it("50 / 100 / 300 cap the rendered list", () => {
  assert.equal(pageOf(many, 50).length, 50);
  assert.equal(pageOf(many, 100).length, 100);
  assert.equal(pageOf(many, 300).length, 300);
});

it("'all' renders everything", () => assert.equal(pageOf(many, "all").length, 420));

it("a page larger than the data returns the data, not padding", () =>
  assert.equal(pageOf(many.slice(0, 10), 300).length, 10));

it("paging never mutates the source", () => {
  const before = many.length;
  pageOf(many, 50);
  assert.equal(many.length, before);
});

console.log("day scoping");
it("punches from another day are dropped", () => {
  const rows = [
    live("1", "09:00"),
    { ...live("2", "09:00"), punchTime: "2026-08-05T09:00:00+05:30", id: "old" },
  ];
  assert.deepEqual(onlyDay(rows, "2026-08-06").map((p) => p.pin), ["1"]);
});

it("no workDate means no filtering — don't blank the feed on a bad payload", () =>
  assert.equal(onlyDay([live("1", "09:00")], null).length, 1));

console.log(`\n${n} assertions passed`);
