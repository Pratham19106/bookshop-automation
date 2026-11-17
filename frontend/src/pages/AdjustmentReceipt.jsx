import { Link, useParams } from 'react-router-dom';
import { get } from '../lib/api';
import { useCached } from '../lib/hooks';
import { Async } from '../lib/ui';
import PhysicalCashMemo from '../components/PhysicalCashMemo';

export default function AdjustmentReceipt() {
  const { id } = useParams();
  const state = useCached(['bills', 'adjustment', Number(id)], () => get(`/adjustments/${Number(id)}`));
  return <Async state={state}>{adjustment => (
    <div className="max-w-4xl mx-auto py-2">
      <div className="print:hidden mb-3 flex items-center justify-between">
        <Link className="btn btn-sm" to="/bills">← Back to Bills</Link>
        <span className="text-xs text-muted font-mono">Adjustment #{adjustment.adjustmentNo}</span>
      </div>
      <PhysicalCashMemo adjustment={adjustment} />
    </div>
  )}</Async>;
}
