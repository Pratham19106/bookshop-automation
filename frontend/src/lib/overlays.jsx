import { useEffect, useRef, useState } from 'react';

// Imperative toast() / confirmBox() usable from anywhere; <Overlays/> renders them once at the app root.
const bus = new EventTarget();
let toastId = 0;

export const toast = (message, kind = 'ok') => bus.dispatchEvent(new CustomEvent('toast', { detail: { id: ++toastId, message, kind } }));
export const fail = (e) => toast(e?.message || 'Something went wrong', 'bad');
export const confirmBox = (message) => new Promise((resolve) => bus.dispatchEvent(new CustomEvent('confirm', { detail: { message, resolve } })));

export function Overlays() {
  const [toasts, setToasts] = useState([]);
  const [ask, setAsk] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    const onToast = (e) => {
      const t = e.detail;
      setToasts((l) => [...l, t]);
      setTimeout(() => setToasts((l) => l.filter((x) => x.id !== t.id)), t.kind === 'bad' ? 7000 : 3500);
    };
    const onConfirm = (e) => setAsk(e.detail);
    bus.addEventListener('toast', onToast);
    bus.addEventListener('confirm', onConfirm);
    return () => { bus.removeEventListener('toast', onToast); bus.removeEventListener('confirm', onConfirm); };
  }, []);

  useEffect(() => { if (ask && ref.current && !ref.current.open) ref.current.showModal(); }, [ask]);
  const answer = (v) => { ask.resolve(v); setAsk(null); ref.current?.close(); };

  return (
    <>
      <div className="fixed right-3 bottom-3 z-[100] flex flex-col gap-1.5 max-w-[min(420px,92vw)]" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`px-3 py-2 text-paper border shadow-paper ${t.kind === 'bad' ? 'bg-brick border-brick' : 'bg-ink border-line'}`}>{t.message}</div>
        ))}
      </div>
      <dialog ref={ref} onCancel={() => ask && answer(false)} className="border border-line bg-sheet p-0 w-[min(420px,94vw)] shadow-dialog backdrop:bg-ink/50">
        {ask && (
          <div className="p-3">
            <p className="mb-3">{ask.message}</p>
            <div className="flex justify-end gap-1.5">
              <button className="btn" onClick={() => answer(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => answer(true)} autoFocus>Confirm</button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
