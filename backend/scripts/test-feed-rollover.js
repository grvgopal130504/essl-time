/**
 * The in-memory half of the daily feed reset.
 *
 * Runs with DB_ENABLED=false, so every database call is a no-op and this tests
 * the buffer logic alone. The day change is forced by moving TZ_OFFSET rather
 * than waiting for midnight.
 *
 *     npm --prefix backend run test:feed-rollover
 */
process.env.DB_ENABLED = "false";

const { config } = await import("../src/config.js");
const { recordPunch, recentPunches } = await import("../src/services/eventHub.js");
const { rolloverIfNeeded, feedDay, bufferedFeed } = await import("../src/services/feedStore.js");
const { localDate } = await import("../src/services/attendanceRules.js");

let failed = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok ? "" : ` — got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`}`);
  if (!ok) failed++;
};

const punch = (pin) =>
  recordPunch({
    id: `SN1-${pin}-${Date.now()}-${Math.random()}`,
    deviceSn: "SN1",
    pin,
    punchTime: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    role: "CHECK_IN",
    roleLabel: "Check In",
  });

/** An offset that lands on a different calendar day from the current one. */
function offsetOnAnotherDay(from) {
  const today = localDate(new Date(), from);
  for (const o of ["+14:00", "+12:00", "+05:30", "+00:00", "-08:00", "-12:00"]) {
    if (localDate(new Date(), o) !== today) return o;
  }
  throw new Error("no offset produced a different day");
}

console.log("startup");
punch("1");
punch("2");
punch("3");
check("three punches buffered", recentPunches.length, 3);

// The bug this guards: the first rollover only learns today's date. If it
// cleared the buffer, every punch received before the first API call would
// vanish — which, when the first call IS a punch, means all of them.
const first = await rolloverIfNeeded();
check("first rollover reports today", first, feedDay());
check("first rollover does NOT clear the buffer", recentPunches.length, 3);
check("buffered feed returns today's punches", bufferedFeed().length, 3);

console.log("same day");
punch("4");
const again = await rolloverIfNeeded();
check("no reset within the same day", again, null);
check("buffer still growing", recentPunches.length, 4);

console.log("crossing midnight");
const original = config.tzOffset;
config.tzOffset = offsetOnAnotherDay(original);
const rolled = await rolloverIfNeeded();
check("rollover fires on a new local day", rolled, feedDay());
check("buffer emptied", recentPunches.length, 0);
check("buffered feed is empty", bufferedFeed().length, 0);

console.log("after the reset");
punch("5");
check("new punches accumulate again", recentPunches.length, 1);
check("second call on the same day is a no-op", await rolloverIfNeeded(), null);
config.tzOffset = original;

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
