import { Link, useParams } from 'react-router-dom';
import { get } from '../lib/api';
import { useLoad } from '../lib/hooks';
import { Async } from '../lib/ui';
import PhysicalCashMemo from '../components/PhysicalCashMemo';

export default function Receipt() {
  const { id } = useParams();
  const st = useLoad(() => get(`/sales/${Number(id)}`), [id]);
  return (
    <Async state={st}>
      {(b) => (
        <div className="max-w-4xl mx-auto py-2">
          <div className="print:hidden mb-3 flex items-center justify-between">
            <Link className="btn btn-sm flex items-center gap-1" to="/bills">
              <span>←</span> Back to Bills
            </Link>
            <span className="text-xs text-muted font-mono">
              Cash Memo #{b.billNo} · Created {new Date(b.createdAt).toLocaleDateString()}
            </span>
          </div>
          <PhysicalCashMemo bill={b} />
        </div>
      )}
    </Async>
  );
}
