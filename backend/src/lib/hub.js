// In-process event hub for live updates (Server-Sent Events).
//
// After every successful change the API publishes a small event ({ event, businessId, shopId, ... }); every open
// browser of that business receives it on /api/events and refreshes just the affected screens.
// One API process (Render free tier) needs nothing more. If the API is ever scaled to several processes, replace
// publish/subscribe with Postgres LISTEN/NOTIFY so events cross processes; the rest of the code stays the same.

// One hub per app instance (so separate apps in one process, e.g. tests, never see each other's events).
function createHub() {
  const listeners = new Set();
  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    publish(evt) {
      for (const fn of listeners) {
        try { fn(evt); } catch { /* a broken connection must not affect the others */ }
      }
    },
    size: () => listeners.size,
  };
}

// Which event a successful write produces, from its method and path (relative to /api).
// Returns a list because one action can change several things (completing a phone order creates a bill).
const ROUTES = [
  [/^POST \/sales\/?$/, ['sale','arrangement']],
  [/^POST \/sales\/\d+\/(refund|exchange)$/, ['return','arrangement']],
  [/^POST \/sales\/\d+\/adjustments$/, ['return','arrangement']],
  [/^POST \/sales\/\d+\/void$/, ['void','arrangement']],
  [/^POST \/orders\/\d+\/fulfil$/, ['sale', 'orders','arrangement']],
  [/^\w+ \/orders(\/|$)/, ['orders']],
  [/^POST \/purchase-orders\/\d+\/receive$/, ['stock', 'purchasing','arrangement']],
  [/^\w+ \/shelves(\/|$)/, ['layout']],
  [/^POST \/arrangement\/suggest-migration$/, ['arrangement']],
  [/^\w+ \/arrangement(\/|$)/, ['arrangement']],
  [/^POST \/books\/\d+\/adjust$/, ['stock','arrangement']],
  [/^\w+ \/purchase-orders(\/|$)/, ['purchasing']],
  [/^\w+ \/(books|inventory)(\/|$)/, ['books']],
  [/^\w+ \/suppliers(\/|$)/, ['suppliers']],
  [/^\w+ \/expenses(\/|$)/, ['expenses']],
  [/^\w+ \/(shops|users|settings)(\/|$)/, ['admin']],
];

function eventsFor(method, path) {
  const key = `${method} ${path.split('?')[0]}`;
  for (const [re, events] of ROUTES) if (re.test(key)) return events;
  return [];
}

module.exports = { createHub, eventsFor };
