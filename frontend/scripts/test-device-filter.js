/**
 * The device filter shared by the Live Feed and the Timesheet, without a browser.
 *
 *     npm --prefix frontend run test:device
 */
import assert from "node:assert/strict";
import {
  deviceLabel,
  deviceOptions,
  deviceSnOf,
  filterByDevice,
  rowSnOf,
  snsIn,
} from "../src/lib/deviceFilter.js";
import { filterDays } from "../src/lib/timesheetView.js";

let n = 0;
const it = (name, fn) => {
  fn();
  n++;
  console.log(`  ✓ ${name}`);
};

// WebSocket shape
const wsDevice = (sn, name) => ({ sn, name, ip: "192.168.1.9", lastSeen: null });
// Postgres shape from /api/devices
const dbDevice = (sn, name) => ({ serial_number: sn, name, ip_address: "192.168.1.9" });

const livePunch = (sn, pin) => ({ id: `${sn}-${pin}`, deviceSn: sn, pin });
const storedPunch = (sn, pin) => ({ event_id: `${sn}-${pin}`, device_sn: sn, pin });

console.log("shapes");
it("reads the serial from either device shape", () => {
  assert.equal(deviceSnOf(wsDevice("SN1", "Gate")), "SN1");
  assert.equal(deviceSnOf(dbDevice("SN1", "Gate")), "SN1");
});

it("reads the serial from either row shape", () => {
  assert.equal(rowSnOf(livePunch("SN1", "14")), "SN1");
  assert.equal(rowSnOf(storedPunch("SN1", "14")), "SN1");
});

console.log("labels");
it("named device reads 'Device <sn> - <name>'", () =>
  assert.equal(deviceLabel(wsDevice("SN1", "Main Gate")), "Device SN1 - Main Gate"));

it("an unnamed device is still identified by its serial", () =>
  assert.equal(deviceLabel(dbDevice("SN2", null)), "Device SN2"));

it("a blank or whitespace name is not treated as a name", () =>
  assert.equal(deviceLabel(wsDevice("SN2", "   ")), "Device SN2"));

console.log("options");
it("All is always the first option and selects nothing", () => {
  const o = deviceOptions([wsDevice("SN1", "Gate")]);
  assert.equal(o[0].label, "All");
  assert.equal(o[0].sn, "");
});

it("lists every known device, sorted by serial", () => {
  const o = deviceOptions([wsDevice("SN2", "Back"), wsDevice("SN1", "Gate")]);
  assert.deepEqual(o.map((x) => x.sn), ["", "SN1", "SN2"]);
});

it("a serial seen only on punches is still selectable", () => {
  const o = deviceOptions([wsDevice("SN1", "Gate")], ["SN9"]);
  assert.deepEqual(o.map((x) => x.sn), ["", "SN1", "SN9"]);
  assert.equal(o[2].label, "Device SN9");
});

it("a punch serial that is already registered isn't duplicated", () => {
  const o = deviceOptions([wsDevice("SN1", "Gate")], ["SN1", "SN1"]);
  assert.equal(o.length, 2);
});

it("collects the distinct serials from a mixed list of rows", () =>
  assert.deepEqual(snsIn([livePunch("SN1", "1"), storedPunch("SN2", "1"), livePunch("SN1", "2")]), [
    "SN1",
    "SN2",
  ]));

console.log("filtering the feed");
const feed = [livePunch("SN1", "14"), storedPunch("SN2", "14"), livePunch("SN1", "22")];

it("All returns everything untouched", () =>
  assert.equal(filterByDevice(feed, ""), feed));

it("selecting a device keeps only its punches, in both shapes", () => {
  assert.deepEqual(filterByDevice(feed, "SN1").map((p) => p.pin), ["14", "22"]);
  assert.deepEqual(filterByDevice(feed, "SN2").map((p) => p.pin), ["14"]);
});

it("PIN 14 on two devices are different people and never merge", () => {
  assert.equal(filterByDevice(feed, "SN1").length, 2);
  assert.equal(filterByDevice(feed, "SN2").length, 1);
});

it("a device with no punches yields an empty feed, not the whole feed", () =>
  assert.deepEqual(filterByDevice(feed, "SN9"), []));

console.log("filtering the timesheet");
const day = (sn, pin, name) => ({
  deviceSn: sn,
  pin,
  employeeName: name,
  dayType: "FULL_DAY",
  hours: 8,
  effectiveScans: 2,
  flags: [],
  needsReview: false,
  workDate: "2026-08-06",
});
const days = [day("SN1", "14", "Ravi"), day("SN2", "14", "Priya"), day("SN1", "22", "Anu")];

it("no device filter leaves the days alone", () =>
  assert.equal(filterDays(days, {}).length, 3));

it("device narrows the table", () =>
  assert.deepEqual(
    filterDays(days, { device: "SN1" }).map((d) => d.employeeName),
    ["Ravi", "Anu"]
  ));

it("device combines with the other filters", () =>
  assert.deepEqual(
    filterDays(days, { device: "SN1", query: "anu" }).map((d) => d.employeeName),
    ["Anu"]
  ));

it("an employee from another device is filtered out, not shown", () =>
  assert.deepEqual(filterDays(days, { device: "SN2", employee: "SN1:22" }), []));

console.log(`\n${n} assertions passed`);
