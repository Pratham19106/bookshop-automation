// Placeholder book covers, generated from the title and author so every book gets a stable, distinct cover
// until real cover art is available. Drawn as a physical object (see .cover in index.css).

const TONES = ['#5E7253', '#B0553A', '#4F5D68', '#8A6A1F', '#6B4E5A', '#3E5C5A', '#7A5C3E', '#7C766A'];

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function BookCover({ book, w = 84, className = '' }) {
  const seed = hash(`${book.title}|${book.author || ''}`);
  const tone = TONES[seed % TONES.length];
  const variant = (seed >>> 4) % 3;
  const fs = Math.max(6, w / 9);
  const initial = book.title.replace(/^(the|a|an)\s+/i, '')[0]?.toUpperCase() || '?';
  const style = { width: w, background: tone };

  // too small to read a title: just the monogram
  if (w < 36) {
    return <div className={`cover ${className}`} style={style} aria-hidden="true"><span className="absolute inset-0 grid place-items-center font-serif" style={{ fontSize: w * 0.5 }}>{initial}</span></div>;
  }
  return (
    <div className={`cover ${className}`} style={style} role="img" aria-label={`Cover of ${book.title}`}>
      {variant === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center" style={{ padding: `${w * 0.14}px ${w * 0.16}px ${w * 0.14}px ${w * 0.22}px` }}>
          <div className="bg-paper/60" style={{ width: '40%', height: 1, marginBottom: w * 0.07 }} />
          <div className="font-serif leading-tight" style={{ fontSize: fs * 1.15 }}>{book.title}</div>
          <div className="bg-paper/60" style={{ width: '40%', height: 1, margin: `${w * 0.07}px 0` }} />
          <div className="uppercase tracking-[.16em] opacity-80" style={{ fontSize: fs * 0.62 }}>{book.author}</div>
        </div>
      )}
      {variant === 1 && (
        <>
          <div className="absolute left-0 right-0 top-0" style={{ height: '46%', background: 'rgba(250,247,240,.16)' }} />
          <div className="absolute font-serif italic leading-none opacity-90" style={{ left: w * 0.22, top: w * 0.1, fontSize: w * 0.62 }}>{initial}</div>
          <div className="absolute bottom-0 left-0 right-0" style={{ padding: `${w * 0.1}px ${w * 0.1}px ${w * 0.12}px ${w * 0.22}px` }}>
            <div className="font-serif leading-tight" style={{ fontSize: fs * 1.05 }}>{book.title}</div>
            <div className="uppercase tracking-[.14em] opacity-80" style={{ fontSize: fs * 0.58, marginTop: w * 0.04 }}>{book.author}</div>
          </div>
        </>
      )}
      {variant === 2 && (
        <>
          <div className="absolute rounded-full border border-paper/50" style={{ width: w * 0.5, height: w * 0.5, right: w * 0.12, top: w * 0.14 }} />
          <div className="absolute rounded-full bg-paper/20" style={{ width: w * 0.26, height: w * 0.26, right: w * 0.24, top: w * 0.26 }} />
          <div className="absolute bottom-0 left-0 right-0" style={{ padding: `${w * 0.1}px ${w * 0.12}px ${w * 0.14}px ${w * 0.22}px` }}>
            <div className="font-serif leading-tight" style={{ fontSize: fs * 1.12 }}>{book.title}</div>
            <div className="bg-paper/60" style={{ width: '28%', height: 1, margin: `${w * 0.05}px 0` }} />
            <div className="uppercase tracking-[.14em] opacity-80" style={{ fontSize: fs * 0.58 }}>{book.author}</div>
          </div>
        </>
      )}
    </div>
  );
}
