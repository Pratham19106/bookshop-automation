// Timestamps are stored in UTC ISO format. Reports work in the shop's local calendar days, defined by a fixed
// offset (config.tzOffsetMinutes). These helpers convert between the two.

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

// Local date string (YYYY-MM-DD) for a given instant.
function localDate(instant, tzOffsetMinutes) {
  return new Date(instant.getTime() + tzOffsetMinutes * MIN).toISOString().slice(0, 10);
}

function addDays(dateStr, n) {
  return new Date(Date.parse(dateStr + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
}

// [from, to] inclusive local dates -> [start, end) UTC ISO strings (either may be null for open-ended).
function dayRangeToUtc(from, to, tzOffsetMinutes) {
  const startOf = (d) => new Date(Date.parse(d + 'T00:00:00Z') - tzOffsetMinutes * MIN).toISOString();
  return {
    start: from ? startOf(from) : null,
    end: to ? startOf(addDays(to, 1)) : null,
  };
}

// Monday of the week containing the given local date.
function weekStart(dateStr) {
  const dow = new Date(dateStr + 'T00:00:00Z').getUTCDay(); // 0=Sun
  return addDays(dateStr, -((dow + 6) % 7));
}

module.exports = { localDate, addDays, dayRangeToUtc, weekStart, DAY };
