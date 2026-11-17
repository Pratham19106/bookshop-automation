import { QueryClient } from '@tanstack/react-query';
import { subscribeToActivity } from './events';

// Every data screen is cached here and refreshed only when something it shows has changed.
// Changes are announced by the server to every open device of the business (lib/realtime.js) and by this browser's
// own actions (lib/events.js). Dashboard queries also refresh periodically as a fallback for missed events.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      gcTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: 1,
    },
  },
});

// Query keys start with a group name. Which groups each event makes stale:
//   bills      bills register, bill details          books      titles, stock, movements, genres
//   catalog    ISBN catalogue search                 inventory  stock overview, shelves, restocking
//   dashboard  dashboard, sales report, statement    orders     phone orders
//   purchasing purchase orders, suppliers            expenses   expenses
//   admin      shops, people, settings
const STALE = {
  sale: ['bills', 'books', 'inventory', 'dashboard'],
  return: ['bills', 'books', 'inventory', 'dashboard'],
  void: ['bills', 'books', 'inventory', 'dashboard'],
  orders: ['orders', 'books', 'inventory', 'dashboard'],
  books: ['books', 'catalog', 'inventory', 'dashboard'],
  stock: ['books', 'inventory', 'dashboard', 'purchasing'],
  purchasing: ['purchasing', 'inventory', 'dashboard'],
  suppliers: ['purchasing', 'dashboard'],
  expenses: ['expenses', 'dashboard'],
  admin: ['admin', 'dashboard'],
  layout: ['layout', 'arrangement', 'books', 'inventory'],
  arrangement: ['arrangement', 'layout', 'books', 'inventory'],
};

export function markStale(event) {
  for (const group of STALE[event] || []) queryClient.invalidateQueries({ queryKey: [group] });
}

subscribeToActivity(({ event }) => markStale(event));
