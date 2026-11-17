const crypto = require('node:crypto');
const v = require('../lib/validate');
const { badRequest, conflict, notFound } = require('../lib/errors');
const { computeTotals } = require('../lib/money');
const { originalAllocations, returnPortion, allocateMoney } = require('../lib/adjustment-money');
const { formatNumber } = require('../lib/counters');
const { DAY, dayRangeToUtc } = require('../lib/dates');
const { canSeeCost, requireShop } = require('../lib/tenant');
const { getSettings } = require('./settings');
const { loadSale } = require('./sales');
const { applyStock, loadBook, likeEscape } = require('./inventory');

const METHODS = ['cash', 'card', 'upi', 'other'];
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

async function listAdjustments(ctx, { from, to, q = '', status = '', limit = 100 } = {}) {
  const params = [ctx.businessId, requireShop(ctx)];
  const where = ['a.business_id=$1', 'a.shop_id=$2'];
  const add = value => { params.push(value); return `$${params.length}`; };
  if (status && !['completed', 'voided'].includes(status)) throw badRequest('Invalid status');
  if (status === 'voided') return { items: [], total: 0 };
  const range = dayRangeToUtc(v.date(from, 'from', { required:false }), v.date(to, 'to', { required:false }), ctx.tz);
  if (range.start) where.push(`a.created_at >= ${add(range.start)}`);
  if (range.end) where.push(`a.created_at < ${add(range.end)}`);
  if (q) {
    const like = add(`%${likeEscape(q)}%`);
    where.push(`(a.adj_no ILIKE ${like} OR s.bill_no ILIKE ${like} OR s.customer_name ILIKE ${like} OR EXISTS (SELECT 1 FROM adjustment_items i WHERE i.adjustment_id=a.id AND (i.title ILIKE ${like} OR i.isbn ILIKE ${like})))`);
  }
  const filter = where.join(' AND ');
  const total = (await ctx.db.one(`SELECT COUNT(*) AS c FROM adjustments a JOIN sales s ON s.id=a.original_sale_id WHERE ${filter}`, params)).c;
  const rows = await ctx.db.many(`SELECT a.id,a.adj_no,a.type,a.net_cents,a.payment_method,a.created_at,s.bill_no,s.customer_name,
    (SELECT SUM(quantity) FROM adjustment_items WHERE adjustment_id=a.id AND sign=-1) AS units
    FROM adjustments a JOIN sales s ON s.id=a.original_sale_id WHERE ${filter}
    ORDER BY a.created_at DESC,a.id DESC LIMIT ${Math.min(Math.max(Number(limit)||100,1),200)}`,params);
  return { total, items: rows.map(r=>({ id:r.id, adjustmentNo:r.adj_no, type:r.type, netCents:r.net_cents,
    paymentMethod:r.payment_method, createdAt:r.created_at, billNo:r.bill_no, customerName:r.customer_name, units:r.units })) };
}

async function getAdjustment(ctx, id, q = ctx.db) {
  const row = await q.one(`SELECT a.*, s.bill_no, s.created_at AS sale_created_at, sh.name AS shop_name, sh.code AS shop_code,
    sh.address AS shop_address, sh.city AS shop_city, sh.phone AS shop_phone, u.full_name AS staff_name
    FROM adjustments a JOIN sales s ON s.id=a.original_sale_id JOIN shops sh ON sh.id=a.shop_id
    LEFT JOIN users u ON u.id=a.user_id WHERE a.id=$1 AND a.business_id=$2 AND a.shop_id=ANY($3::bigint[])`, [id, ctx.businessId, ctx.shopIds]);
  if (!row) throw notFound('Adjustment');
  const items = await q.many('SELECT * FROM adjustment_items WHERE adjustment_id=$1 ORDER BY id', [id]);
  return { id: row.id, adjustmentNo: row.adj_no, originalSaleId: row.original_sale_id, billNo: row.bill_no,
    type: row.type, netCents: row.net_cents, paymentMethod: row.payment_method, reason: row.reason, isLegacy: row.legacy_return_id !== null, legacyReturnId: row.legacy_return_id,
    createdAt: row.created_at, originalSaleCreatedAt: row.sale_created_at, staff: row.staff_name, shopId: row.shop_id,
    shopName: row.shop_name, shopCode: row.shop_code, shopAddress: [row.shop_address,row.shop_city].filter(Boolean).join(', '), shopPhone: row.shop_phone,
    items: items.map(i => ({ id:i.id, bookId:i.book_id, title:i.title, author:i.author, isbn:i.isbn, edition:i.edition,
      sign:i.sign, quantity:i.quantity, returnedQty:i.returned_qty, unitPriceCents:i.unit_price_cents,
      ...(canSeeCost(ctx) ? { unitCostCents:i.unit_cost_cents } : {}), lineTotalCents:i.line_total_cents,
      taxCents:i.tax_cents, sourceSaleItemId:i.source_sale_item_id, sourceAdjustmentItemId:i.source_adjustment_item_id })) };
}

async function createAdjustment(ctx, saleId, input) {
  v.object(input);
  const returns = v.array(input.returns, 'returns', { max: 100 }).map((line, n) => {
    v.object(line, `returns[${n}]`);
    const saleItemId = line.saleItemId == null ? null : v.int(line.saleItemId, 'saleItemId', { min:1 });
    const adjustmentItemId = line.adjustmentItemId == null ? null : v.int(line.adjustmentItemId, 'adjustmentItemId', { min:1 });
    if (!!saleItemId === !!adjustmentItemId) throw badRequest('Choose exactly one source for each returned item');
    return { saleItemId, adjustmentItemId, quantity:v.int(line.quantity, 'quantity', { min:1, max:100000 }) };
  });
  const replacements = (input.replacements == null ? [] : v.array(input.replacements, 'replacements', { max:100, min:0 })).map((line, n) => {
    v.object(line, `replacements[${n}]`);
    return { bookId:v.int(line.bookId, 'bookId', { min:1 }), quantity:v.int(line.quantity, 'quantity', { min:1, max:100000 }) };
  });
  if (!returns.length) throw badRequest('Select at least one item to return');
  const ids = returns.map(r => r.saleItemId ? `s${r.saleItemId}` : `a${r.adjustmentItemId}`);
  if (new Set(ids).size !== ids.length || new Set(replacements.map(r => r.bookId)).size !== replacements.length) throw badRequest('Each item may appear only once');
  const reason = v.str(input.reason, 'reason', { max:300 });
  const key = v.str(input.idempotencyKey, 'idempotencyKey', { required:true, max:100 });
  const method = input.paymentMethod ? v.oneOf(input.paymentMethod, 'paymentMethod', METHODS) : null;
  const hash = crypto.createHash('sha256').update(JSON.stringify({ saleId, returns, replacements, reason, method })).digest('hex');
  let result;
  try { result = await ctx.db.tx(async q => {
    const sale = await loadSale(q, ctx, saleId, { lock:true });
    const prior = await q.one('SELECT id,request_hash FROM adjustments WHERE shop_id=$1 AND idempotency_key=$2', [sale.shop_id,key]);
    if (prior) { if (prior.request_hash !== hash) throw conflict('This idempotency key was already used for a different adjustment'); return { id:prior.id, duplicate:true }; }
    if (sale.status !== 'completed') throw conflict('Cannot adjust a voided bill');
    const settings = await getSettings(q,ctx.businessId);
    if (Date.now() - new Date(sale.created_at).getTime() > settings.returnWindowDays * DAY) throw badRequest('Return window has expired');
    const saleItems = await q.many('SELECT * FROM sale_items WHERE sale_id=$1 ORDER BY id FOR UPDATE', [saleId]);
    const allocations = originalAllocations(saleItems.map(i => ({ quantity:i.quantity, unitPriceCents:i.unit_price_cents })),sale.discount_cents,sale.tax_cents);
    const lines = [];
    for (const requested of returns) {
      let item, portion;
      if (requested.saleItemId) {
        const index = saleItems.findIndex(i => i.id === requested.saleItemId);
        if (index < 0) throw notFound('Sale item');
        item = saleItems[index];
        portion = returnPortion(allocations[index], item.returned_qty, requested.quantity);
        await q.query('UPDATE sale_items SET returned_qty=returned_qty+$2 WHERE id=$1', [item.id,requested.quantity]);
      } else {
        item = await q.one(`SELECT i.*, a.legacy_return_id FROM adjustment_items i JOIN adjustments a ON a.id=i.adjustment_id
          WHERE i.id=$1 AND i.sign=1 AND a.original_sale_id=$2 AND a.business_id=$3 AND a.shop_id=$4 FOR UPDATE OF i`,
        [requested.adjustmentItemId,saleId,ctx.businessId,sale.shop_id]);
        if (!item) throw notFound('Replacement item');
        if (item.legacy_return_id !== null) throw conflict('This historic exchange lacks its original replacement price');
        portion = returnPortion({ net:allocateMoney(item.line_total_cents,Array(item.quantity).fill(1)), tax:allocateMoney(item.tax_cents,Array(item.quantity).fill(1)) },item.returned_qty,requested.quantity);
        await q.query('UPDATE adjustment_items SET returned_qty=returned_qty+$2 WHERE id=$1', [item.id,requested.quantity]);
      }
      lines.push({ item, sign:-1, quantity:requested.quantity, ...portion, sourceSaleItemId:requested.saleItemId, sourceAdjustmentItemId:requested.adjustmentItemId });
    }
    const sctx = { ...ctx, shopId:sale.shop_id };
    const bookIds = [...new Set([...lines.map(l => l.item.book_id),...replacements.map(l => l.bookId)])].sort((a,b)=>a-b);
    for (const bookId of bookIds) await q.query('SELECT 1 FROM shop_stock WHERE shop_id=$1 AND book_id=$2 FOR UPDATE', [sale.shop_id,bookId]);
    const repItems = [];
    for (const replacement of replacements) {
      const book = await loadBook(q,sctx,replacement.bookId);
      if (!book.active) throw badRequest(`"${book.title}" is no longer active`);
      const returned = sum(lines.filter(l => l.item.book_id === book.id).map(l=>l.quantity));
      if (book.stock_qty-book.reserved_qty+returned < replacement.quantity) throw conflict(`Insufficient stock for "${book.title}"`);
      repItems.push({ book, quantity:replacement.quantity });
    }
    const totals = computeTotals(repItems.map(x=>({ unitPriceCents:x.book.price_cents, quantity:x.quantity })),sale.discount_bp,sale.tax_bp);
    const allocationsNew = originalAllocations(repItems.map(x=>({unitPriceCents:x.book.price_cents,quantity:x.quantity})),totals.discountCents,totals.taxCents);
    repItems.forEach((x,i)=>lines.push({item:x.book,sign:1,quantity:x.quantity,netCents:sum(allocationsNew[i].net),taxCents:sum(allocationsNew[i].tax)}));
    const net = sum(lines.map(l=>l.sign*(l.netCents+l.taxCents)));
    if (net !== 0 && !method) throw badRequest('Choose a payment method for the settlement');
    const adjNo = await formatNumber(q,sale.shop_id,'adjustment','ADJ',5);
    const created = await q.one(`INSERT INTO adjustments(business_id,shop_id,original_sale_id,adj_no,type,net_cents,payment_method,user_id,reason,idempotency_key,request_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`, [ctx.businessId,sale.shop_id,saleId,adjNo,replacements.length ? 'exchange':'refund',net,method,ctx.user.id,reason,key,hash]);
    for (const line of lines) {
      const i=line.item;
      await q.query(`INSERT INTO adjustment_items(adjustment_id,book_id,title,author,isbn,edition,sign,quantity,unit_price_cents,unit_cost_cents,line_total_cents,tax_cents,source_sale_item_id,source_adjustment_item_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [created.id, i.book_id || i.id, i.title, i.author || '', i.isbn, i.edition || '',line.sign,line.quantity,
        line.sign < 0 ? i.unit_price_cents : i.price_cents, line.sign < 0 ? i.unit_cost_cents : (i.cost_cents || null),line.netCents,line.taxCents,line.sourceSaleItemId || null,line.sourceAdjustmentItemId || null]);
    }
    for (const line of [...lines].sort((a,b)=>(a.item.book_id || a.item.id)-(b.item.book_id || b.item.id) || a.sign-b.sign))
      await applyStock(q,sctx,{ bookId:line.item.book_id || line.item.id, stockDelta:-line.sign*line.quantity, reason:line.sign<0?'refund':'exchange', refType:'adjustment', refId:created.id, note:adjNo });
    return { id:created.id, duplicate:false };
  }); } catch (error) {
    if (error.code !== '23505') throw error;
    const sale = await loadSale(ctx.db,ctx,saleId);
    const prior = await ctx.db.one('SELECT id,request_hash FROM adjustments WHERE shop_id=$1 AND idempotency_key=$2',[sale.shop_id,key]);
    if (!prior) throw error;
    if (prior.request_hash !== hash) throw conflict('This idempotency key was already used for a different adjustment');
    result = { id:prior.id, duplicate:true };
  }
  return { adjustment:await getAdjustment(ctx,result.id), duplicate:result.duplicate };
}

module.exports = { createAdjustment, getAdjustment, listAdjustments };
