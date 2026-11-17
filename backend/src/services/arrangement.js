const v = require('../lib/validate');
const { badRequest, conflict, notFound } = require('../lib/errors');
const { requireShop } = require('../lib/tenant');

async function listShelves(ctx) {
  return ctx.db.many(`SELECT s.id,s.aisle,s.rack,s.shelf,s.capacity,s.category_hint AS "categoryHint",s.active,
    COALESCE(SUM(ss.qty),0) AS occupied FROM shelves s LEFT JOIN shelf_stock ss ON ss.shelf_id=s.id
    WHERE s.business_id=$1 AND s.shop_id=$2 GROUP BY s.id ORDER BY s.aisle,s.rack,s.shelf`,[ctx.businessId,requireShop(ctx)]);
}
async function createLayout(ctx,input) {
  v.object(input);
  const aisles=v.int(input.aisles,'aisles',{min:1,max:20});
  const racks=v.int(input.racks,'racks',{min:1,max:30});
  const shelves=v.int(input.shelves,'shelves',{min:1,max:30});
  const capacity=v.int(input.capacity,'capacity',{min:1,max:100000});
  if(aisles*racks*shelves>1000) throw badRequest('A layout can contain at most 1000 shelves');
  const shop=requireShop(ctx);
  return ctx.db.tx(async q=>{
    let count=0;
    for(let a=1;a<=aisles;a++) for(let r=1;r<=racks;r++) for(let s=1;s<=shelves;s++) {
      const added=await q.run(`INSERT INTO shelves(business_id,shop_id,aisle,rack,shelf,capacity) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(shop_id,aisle,rack,shelf) DO NOTHING`,[ctx.businessId,shop,`A${a}`,`R${r}`,`S${s}`,capacity]);
      count+=added;
    }
    return {created:count};
  });
}
async function updateShelf(ctx,id,input) {
  v.object(input);
  const capacity=v.int(input.capacity,'capacity',{min:1,max:100000});
  const aisle=v.str(input.aisle,'aisle',{required:true,max:30});
  const rack=v.str(input.rack,'rack',{required:true,max:30});
  const shelf=v.str(input.shelf,'shelf',{required:true,max:30});
  const category=v.str(input.categoryHint,'categoryHint',{max:100});
  if(typeof input.active!=='boolean') throw badRequest('active must be true or false');
  const row=await ctx.db.one(`UPDATE shelves SET aisle=$4,rack=$5,shelf=$6,capacity=$7,category_hint=$8,active=$9
    WHERE id=$1 AND business_id=$2 AND shop_id=$3 RETURNING id`,[id,ctx.businessId,requireShop(ctx),aisle,rack,shelf,capacity,category,input.active]);
  if(!row) throw notFound('Shelf');
  return row;
}
async function shelfContents(ctx,id) {
  const shop=requireShop(ctx);
  if(!await ctx.db.one('SELECT id FROM shelves WHERE id=$1 AND business_id=$2 AND shop_id=$3',[id,ctx.businessId,shop])) throw notFound('Shelf');
  return ctx.db.many(`SELECT b.id,b.title,b.author,b.isbn,ss.qty FROM shelf_stock ss JOIN books b ON b.id=ss.book_id
    WHERE ss.shelf_id=$1 AND ss.qty>0 ORDER BY b.title`,[id]);
}
async function listTasks(ctx) {
  return ctx.db.many(`SELECT t.id,t.book_id AS "bookId",b.title,b.author,t.qty,t.source,t.source_ref AS "sourceRef",t.created_at AS "createdAt",
      t.proposed_shelf_id AS "proposedShelfId",s.aisle,s.rack,s.shelf
    FROM arrangement_tasks t JOIN books b ON b.id=t.book_id LEFT JOIN shelves s ON s.id=t.proposed_shelf_id
    WHERE t.business_id=$1 AND t.shop_id=$2 AND t.status='open' ORDER BY t.created_at,t.id`,[ctx.businessId,requireShop(ctx)]);
}

// Assign still-unplaced migration tasks without claiming that staff have shelved them.
async function suggestMigrationShelves(ctx) {
  const shop=requireShop(ctx);
  return ctx.db.tx(async q=>{
    const books=await q.many(`SELECT DISTINCT book_id FROM arrangement_tasks WHERE business_id=$1 AND shop_id=$2
      AND source='migration' AND status='open' AND proposed_shelf_id IS NULL ORDER BY book_id`,[ctx.businessId,shop]);
    for(const book of books) await q.query('SELECT 1 FROM shop_stock WHERE business_id=$1 AND shop_id=$2 AND book_id=$3 FOR UPDATE',[ctx.businessId,shop,book.book_id]);
    const lockedShelves=await q.many('SELECT id FROM shelves WHERE business_id=$1 AND shop_id=$2 AND active ORDER BY id FOR UPDATE',[ctx.businessId,shop]);
    const shelves=await q.many(`SELECT s.id,s.capacity,
      COALESCE((SELECT SUM(x.qty) FROM shelf_stock x WHERE x.shelf_id=s.id),0) occupied,
      COALESCE((SELECT SUM(t.qty) FROM arrangement_tasks t WHERE t.proposed_shelf_id=s.id AND t.status='open'),0) pending
      FROM shelves s WHERE s.business_id=$1 AND s.shop_id=$2 AND s.active AND s.id=ANY($3::bigint[]) ORDER BY s.id`,[ctx.businessId,shop,lockedShelves.map(s=>s.id)]);
    const tasks=await q.many(`SELECT * FROM arrangement_tasks WHERE business_id=$1 AND shop_id=$2
      AND source='migration' AND status='open' AND proposed_shelf_id IS NULL AND book_id=ANY($3::bigint[]) ORDER BY book_id,id FOR UPDATE`,[ctx.businessId,shop,books.map(b=>b.book_id)]);
    for(const shelf of shelves) shelf.free=Math.max(0,shelf.capacity-shelf.occupied-shelf.pending);
    let assigned=0, remaining=0;
    for(const task of tasks) {
      const candidates=shelves.filter(s=>s.free>0).map(s=>({s,tie:Math.random()})).sort((a,b)=>a.tie-b.tie);
      const parts=[]; let left=task.qty;
      for(const {s} of candidates) { const n=Math.min(left,s.free); if(n) { parts.push({shelf:s.id,qty:n}); s.free-=n; left-=n; } if(!left) break; }
      if(!parts.length) { remaining+=left; continue; }
      await q.query('UPDATE arrangement_tasks SET proposed_shelf_id=$2,qty=$3 WHERE id=$1',[task.id,parts[0].shelf,parts[0].qty]);
      for(const part of parts.slice(1)) await q.query(`INSERT INTO arrangement_tasks(business_id,shop_id,book_id,proposed_shelf_id,qty,source,source_ref,created_by,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[ctx.businessId,shop,task.book_id,part.shelf,part.qty,task.source,task.source_ref,task.created_by,task.created_at]);
      if(left) await q.query(`INSERT INTO arrangement_tasks(business_id,shop_id,book_id,qty,source,source_ref,created_by,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[ctx.businessId,shop,task.book_id,left,task.source,task.source_ref,task.created_by,task.created_at]);
      assigned+=task.qty-left; remaining+=left;
    }
    return {assigned,remaining};
  });
}

// Caller holds the book stock row. Shelf locks serialize competing proposals and confirmations.
async function propose(q,ctx,bookId,qty,source,refId=null) {
  const shop=requireShop(ctx);
  const book=await q.one('SELECT id FROM books WHERE id=$1 AND business_id=$2',[bookId,ctx.businessId]);
  if(!book) throw notFound('Book');
  const shelves=await q.many(`SELECT s.*,COALESCE((SELECT SUM(x.qty) FROM shelf_stock x WHERE x.shelf_id=s.id),0) occupied,
    COALESCE((SELECT SUM(t.qty) FROM arrangement_tasks t WHERE t.proposed_shelf_id=s.id AND t.status='open'),0) pending,
    EXISTS(SELECT 1 FROM shelf_stock x WHERE x.shelf_id=s.id AND x.book_id=$3 AND x.qty>0) holds
    FROM shelves s WHERE s.business_id=$1 AND s.shop_id=$2 AND s.active ORDER BY s.id FOR UPDATE OF s`,[ctx.businessId,shop,bookId]);
  for(const shelf of shelves) shelf.free=Math.max(0,shelf.capacity-shelf.occupied-shelf.pending);
  // Assign available spaces randomly, while reserving space already proposed to other tasks.
  for(const shelf of shelves) shelf.tie=Math.random();
  shelves.sort((a,b)=>a.tie-b.tie);
  let remaining=qty;
  for(const shelf of shelves) {
    const n=Math.min(remaining,shelf.free); if(!n) continue;
    await q.query('INSERT INTO arrangement_tasks(business_id,shop_id,book_id,proposed_shelf_id,qty,source,source_ref,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[ctx.businessId,shop,bookId,shelf.id,n,source,refId,ctx.user.id]);
    remaining-=n; if(!remaining) break;
  }
  if(remaining) await q.query('INSERT INTO arrangement_tasks(business_id,shop_id,book_id,qty,source,source_ref,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[ctx.businessId,shop,bookId,remaining,source,refId,ctx.user.id]);
}

// Remove copies from physical shelves before lowering stock and trim excess open proposals.
async function consume(q,ctx,bookId,qty,reason) {
  const shop=requireShop(ctx);
  const stock=await q.one('SELECT stock_qty FROM shop_stock WHERE shop_id=$1 AND book_id=$2 FOR UPDATE',[shop,bookId]);
  if(!stock) return;
  const refs=await q.many('SELECT shelf_id FROM shelf_stock WHERE shop_id=$1 AND book_id=$2 AND qty>0 ORDER BY shelf_id',[shop,bookId]);
  for(const row of refs) await q.query('SELECT 1 FROM shelves WHERE id=$1 FOR UPDATE',[row.shelf_id]);
  const placed=await q.many('SELECT shelf_id,qty FROM shelf_stock WHERE shop_id=$1 AND book_id=$2 AND qty>0 ORDER BY shelf_id FOR UPDATE',[shop,bookId]);
  placed.sort((a,b)=>b.qty-a.qty || a.shelf_id-b.shelf_id);
  const total=placed.reduce((n,r)=>n+r.qty,0), unassigned=stock.stock_qty-total;
  let take=reason==='adjustment' ? Math.max(0,qty-unassigned) : Math.min(qty,total);
  for(const row of placed) { const n=Math.min(take,row.qty); if(n) { await q.query('UPDATE shelf_stock SET qty=qty-$3 WHERE shelf_id=$1 AND book_id=$2',[row.shelf_id,bookId,n]); take-=n; } }
  const removedPlaced=(reason==='adjustment' ? Math.max(0,qty-unassigned) : Math.min(qty,total))-take;
  const newUnassigned=Math.max(0,unassigned-(qty-removedPlaced));
  const tasks=await q.many("SELECT id,qty FROM arrangement_tasks WHERE shop_id=$1 AND book_id=$2 AND status='open' ORDER BY id DESC FOR UPDATE",[shop,bookId]);
  let excess=tasks.reduce((n,t)=>n+t.qty,0)-newUnassigned;
  for(const task of tasks) { if(excess<=0) break; const n=Math.min(excess,task.qty); if(n===task.qty) await q.query("UPDATE arrangement_tasks SET status='cancelled' WHERE id=$1",[task.id]); else await q.query('UPDATE arrangement_tasks SET qty=qty-$2 WHERE id=$1',[task.id,n]); excess-=n; }
}
async function confirmTasks(ctx,input) {
  v.object(input);
  const requested=v.array(input.items,'items',{max:500});
  const shop=requireShop(ctx), seen=new Set();
  const lines=requested.map(x=>{ v.object(x); const id=v.int(x.id,'id',{min:1}); if(seen.has(id)) throw badRequest('Duplicate task'); seen.add(id); return {id,shelfId:v.int(x.shelfId,'shelfId',{min:1}),qty:v.int(x.quantity,'quantity',{min:1,max:100000})}; });
  return ctx.db.tx(async q=>{
    let confirmed=0, skipped=0;
    // Discover book ids, then lock stock, shelves and tasks in that order.
    const snapshot=await q.many('SELECT id,book_id FROM arrangement_tasks WHERE business_id=$1 AND shop_id=$2 AND id=ANY($3::bigint[])',[ctx.businessId,shop,lines.map(x=>x.id)]);
    if(snapshot.length!==lines.length) throw notFound('Arrangement task');
    for(const bookId of [...new Set(snapshot.map(t=>t.book_id))].sort((a,b)=>a-b)) await q.query('SELECT 1 FROM shop_stock WHERE shop_id=$1 AND book_id=$2 FOR UPDATE',[shop,bookId]);
    for(const shelfId of [...new Set(lines.map(x=>x.shelfId))].sort((a,b)=>a-b)) await q.query('SELECT 1 FROM shelves WHERE id=$1 AND business_id=$2 AND shop_id=$3 FOR UPDATE',[shelfId,ctx.businessId,shop]);
    const tasks=await q.many('SELECT * FROM arrangement_tasks WHERE business_id=$1 AND shop_id=$2 AND id=ANY($3::bigint[]) ORDER BY id FOR UPDATE',[ctx.businessId,shop,lines.map(x=>x.id)]);
    const active=tasks.filter(t=>t.status==='open'); skipped=tasks.length-active.length;
    for(const task of active) {
      const line=lines.find(x=>x.id===task.id);
      if(line.qty>task.qty) throw badRequest('Quantity exceeds the open task');
      const shelf=await q.one(`SELECT s.id,s.capacity-COALESCE((SELECT SUM(x.qty) FROM shelf_stock x WHERE x.shelf_id=s.id),0)
        -COALESCE((SELECT SUM(t.qty) FROM arrangement_tasks t WHERE t.proposed_shelf_id=s.id AND t.status='open' AND t.id<>$4),0) AS free
        FROM shelves s WHERE s.id=$1 AND s.business_id=$2 AND s.shop_id=$3 AND s.active`,[line.shelfId,ctx.businessId,shop,task.id]);
      if(!shelf) throw notFound('Active shelf');
      if(line.qty>shelf.free) throw conflict('The selected shelf no longer has enough free space; choose another shelf');
      await q.query(`INSERT INTO shelf_stock(business_id,shop_id,shelf_id,book_id,qty) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(shelf_id,book_id) DO UPDATE SET qty=shelf_stock.qty+EXCLUDED.qty`,[ctx.businessId,shop,line.shelfId,task.book_id,line.qty]);
      if(line.qty<task.qty) await q.query(`INSERT INTO arrangement_tasks(business_id,shop_id,book_id,proposed_shelf_id,qty,source,source_ref,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[ctx.businessId,shop,task.book_id,task.proposed_shelf_id,task.qty-line.qty,task.source,task.source_ref,task.created_by]);
      await q.query("UPDATE arrangement_tasks SET qty=$2,proposed_shelf_id=$3,status='done',done_by=$4,done_at=now() WHERE id=$1",[task.id,line.qty,line.shelfId,ctx.user.id]);
      confirmed++;
    }
    return {confirmed,skipped};
  });
}
module.exports={listShelves,createLayout,updateShelf,shelfContents,listTasks,confirmTasks,propose,consume,suggestMigrationShelves};
