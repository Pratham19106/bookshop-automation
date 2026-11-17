import { useMemo, useState } from 'react';
import { get, post, put, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmt } from '../lib/format';
import { useCached } from '../lib/hooks';
import { broadcastEvent } from '../lib/events';
import { confirmBox, fail, toast } from '../lib/overlays';
import { BookPicker, PageTitle } from '../lib/ui';
import { MapPin, BookOpen } from 'lucide-react';

const DEFAULT_SHELVES = ['Shelf 4 (Top)', 'Shelf 3', 'Shelf 2', 'Shelf 1 (Bottom)'];

export default function Shelves() {
  const { isManager: isOwner } = useAuth(); // managers and owners place books on shelves
  const [filterAisle, setFilterAisle] = useState('ALL');
  const [selectedAisle, setSelectedAisle] = useState('');
  const [selectedRack, setSelectedRack] = useState('');
  const [activeTarget, setActiveTarget] = useState({ aisle: 'Aisle 01', rack: 'R-01', shelf: 'Shelf 3' });
  const [relocateBook, setRelocateBook] = useState(null);

  // Titles with this shop's locations; refreshed live when any device moves a book or changes stock.
  const booksState = useCached(['books', 'shelves'], async () => {
    const res = await get('/books' + qs({ limit: 500 }));
    return res.items || [];
  });

  const books = booksState.data || [];
  const changed = () => { booksState.reload(); broadcastEvent('books'); };

  // Group books by physical hierarchy: Aisle -> Rack -> Shelf
  const { topology, unmappedBooks, allAisles } = useMemo(() => {
    const topo = {};
    const unmapped = [];
    const aislesSet = new Set(['Aisle 01', 'Aisle 02']);

    for (const b of books) {
      const a = (b.aisle || '').trim();
      const r = (b.rack || '').trim();
      const s = (b.shelf || '').trim();

      if (!a && !r && !s) {
        unmapped.push(b);
        continue;
      }

      const aisleName = a || 'Unassigned Aisle';
      const rackName = r || 'R-01';
      const shelfName = s || 'Shelf 1';

      aislesSet.add(aisleName);
      if (!topo[aisleName]) topo[aisleName] = {};
      if (!topo[aisleName][rackName]) topo[aisleName][rackName] = {};
      if (!topo[aisleName][rackName][shelfName]) topo[aisleName][rackName][shelfName] = [];

      topo[aisleName][rackName][shelfName].push(b);
    }

    return { topology: topo, unmappedBooks: unmapped, allAisles: Array.from(aislesSet).sort() };
  }, [books]);

  // Set default selection when data loads
  const currentAisle = selectedAisle || allAisles[0] || 'Aisle 01';
  const currentRacks = topology[currentAisle] ? Object.keys(topology[currentAisle]).sort() : ['R-01', 'R-02'];
  const currentRack = selectedRack || currentRacks[0] || 'R-01';

  const assignToActive = async (book) => {
    try {
      await put(`/books/${book.id}/location`, {
        aisle: activeTarget.aisle,
        rack: activeTarget.rack,
        shelf: activeTarget.shelf,
      });
      toast(`“${book.title}” placed on ${activeTarget.aisle} · ${activeTarget.rack} · ${activeTarget.shelf}`);
      changed();
    } catch (e) {
      fail(e);
    }
  };

  const removeLocation = async (book) => {
    const ok = await confirmBox(`Remove physical location for “${book.title}”? It will be marked as unplaced.`);
    if (!ok) return;
    try {
      await put(`/books/${book.id}/location`, { aisle: '', rack: '', shelf: '' });
      toast(`Location cleared for “${book.title}”`);
      changed();
    } catch (e) {
      fail(e);
    }
  };

  return (
    <div>
      <PageTitle>
        Floor & Shelves
      </PageTitle>

      {/* Unmapped Books Notice */}
      {unmappedBooks.length > 0 && (
        <div className="notice notice-warn flex items-center justify-between flex-wrap gap-2 mb-3">
          <div>
            <strong>{unmappedBooks.length}</strong> title{unmappedBooks.length === 1 ? ' has' : 's have'} no shelf yet.
          </div>
        </div>
      )}

      {/* Main Split Grid */}
      <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr] items-start">
        
        {/* LEFT COLUMN: Top-Down Store Blueprint */}
        <section className="card space-y-3">
          <div className="flex justify-between items-center border-b border-ink pb-1.5">
            <h2>Shop floor</h2>
            <div className="flex items-center gap-1.5 text-[.82rem]">
              <span className="text-muted uppercase text-[.7rem] tracking-wider">Aisle:</span>
              <select
                className="input py-0.5 text-xs font-mono"
                value={filterAisle}
                onChange={(e) => {
                  setFilterAisle(e.target.value);
                  if (e.target.value !== 'ALL') setSelectedAisle(e.target.value);
                }}
              >
                <option value="ALL">All Aisles</option>
                {allAisles.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Racks Grid */}
          <div className="space-y-3">
            {allAisles
              .filter((a) => filterAisle === 'ALL' || filterAisle === a)
              .map((aisleName) => {
                const racks = topology[aisleName] ? Object.keys(topology[aisleName]).sort() : ['R-01'];
                return (
                  <div key={aisleName} className="p-2 border border-hair bg-paper">
                    <div className="flex justify-between items-center mb-1.5 text-xs font-bold font-serif text-ink">
                      <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-[#4F46E5]" /> {aisleName}</span>
                      <span className="text-[.75rem] font-mono text-muted">{racks.length} rack{racks.length === 1 ? '' : 's'}</span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {racks.map((rId) => {
                        const isSelected = currentAisle === aisleName && currentRack === rId;
                        const shelvesOnRack = topology[aisleName]?.[rId] || {};
                        const booksOnRack = Object.values(shelvesOnRack).flat();

                        return (
                          <div
                            key={rId}
                            onClick={() => {
                              setSelectedAisle(aisleName);
                              setSelectedRack(rId);
                            }}
                            className={`p-2 border cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-sheet border-ink shadow-hard-sm'
                                : 'bg-sheet border-hair hover:border-ink'
                            }`}
                          >
                            <div className="flex justify-between items-center text-xs">
                              <strong className="font-serif">{rId}</strong>
                              <span className="font-mono text-[.75rem] text-muted">
                                {Object.keys(shelvesOnRack).length} shelves
                              </span>
                            </div>
                            <div className="text-[.78rem] font-mono text-muted mt-1">
                              {booksOnRack.length} book{booksOnRack.length === 1 ? '' : 's'}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
          </div>
        </section>

        {/* RIGHT COLUMN: Rack Elevation & Shelf Inspector */}
        <section className="card space-y-3">
          <div className="flex justify-between items-center border-b border-ink pb-1.5">
            <div>
              <h2>Rack {currentRack}</h2>
              <div className="text-[.8rem] text-muted font-mono">{currentAisle} · {currentRack}</div>
            </div>
            <button
              className="btn btn-sm"
              onClick={() => {
                const newShelf = prompt('Enter new shelf name (e.g. Shelf 5):');
                if (newShelf) {
                  setActiveTarget({ aisle: currentAisle, rack: currentRack, shelf: newShelf });
                  toast(`${newShelf} selected`);
                }
              }}
            >
              + Add Shelf
            </button>
          </div>

          {/* Shelves Vertical Stack (Top to Bottom) */}
          <div className="space-y-2">
            {DEFAULT_SHELVES.map((shelfLabel) => {
              const shelfKey = shelfLabel.split(' ')[0] + ' ' + shelfLabel.split(' ')[1]?.replace(/[^0-9]/g, '');
              const matchingShelf = Object.keys(topology[currentAisle]?.[currentRack] || {}).find(
                (k) => k.toLowerCase() === shelfLabel.toLowerCase() || k.toLowerCase().startsWith(shelfKey.toLowerCase())
              );
              const shelfBooks = matchingShelf ? topology[currentAisle][currentRack][matchingShelf] || [] : [];
              const isTarget =
                activeTarget.aisle === currentAisle &&
                activeTarget.rack === currentRack &&
                (activeTarget.shelf === shelfLabel || activeTarget.shelf === matchingShelf);

              return (
                <div
                  key={shelfLabel}
                  className={`p-2 border transition-colors ${
                    isTarget ? 'border-ink bg-tint border-l-4' : 'border-hair bg-sheet'
                  }`}
                >
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-bold font-serif flex items-center gap-1.5">
                      <BookOpen className="w-3.5 h-3.5 text-[#4F46E5]" /> {shelfLabel}
                      {isTarget && <span className="badge badge-ok">Selected</span>}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[.75rem] text-muted">
                        {shelfBooks.length} title{shelfBooks.length === 1 ? '' : 's'}
                      </span>
                      {!isTarget && (
                        <button
                          className="btn btn-sm text-[.75rem]"
                          onClick={() =>
                            setActiveTarget({
                              aisle: currentAisle,
                              rack: currentRack,
                              shelf: matchingShelf || shelfLabel,
                            })
                          }
                        >
                          Select
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Books on this shelf */}
                  {shelfBooks.length > 0 ? (
                    <div className="mt-2 border-t border-hair pt-1.5 text-[.82rem] space-y-1">
                      {shelfBooks.slice(0, 6).map((b) => (
                        <div key={b.id} className="flex justify-between items-center gap-2 font-mono text-[.78rem]">
                          <span className="truncate" title={b.title}>
                            <strong>{b.title}</strong>{' '}
                            <span className="text-muted">({b.stockQty} in stock)</span>
                          </span>
                          <button
                            className="btn btn-sm text-brick hover:bg-brick hover:text-white"
                            title="Remove from this shelf"
                            onClick={() => removeLocation(b)}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      {shelfBooks.length > 6 && (
                        <div className="text-[.75rem] text-muted font-mono italic">
                          + {shelfBooks.length - 6} more titles on this shelf
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-[.78rem] text-muted italic mt-1 font-mono">
                      Empty
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

      </div>

      {/* BOTTOM DOCK: Rapid Barcode / ISBN Ingestion Dock */}
      <section className="card mt-3 border-2 border-ink bg-sheet">
        <div className="flex flex-wrap justify-between items-center gap-2 mb-2 pb-1.5 border-b border-ink">
          <div className="flex items-center gap-2">
            <span className="font-serif font-bold text-base">Place books on the selected shelf</span>
            <span className="text-muted text-[.8rem]">
              Selected: <strong className="font-mono text-ink">{activeTarget.aisle} · {activeTarget.rack} · {activeTarget.shelf}</strong>
            </span>
          </div>
        </div>

        <div className="max-w-xl">
          <BookPicker
            onPick={assignToActive}
            placeholder="Scan the ISBN or search by title"
            autoFocus
          />
        </div>
      </section>

    </div>
  );
}


