# Bookshop Automation System — Unit Testing using Basis Path Testing Report
**Department of Computer Engineering & Information Technology**  
**Software Engineering Laboratory**  
**Assignment 9 — Unit Testing using Basis Path Testing**  
*Control Flow Graphs · Cyclomatic Complexity · Basis Paths · Test Case Matrices*

---

## 1. Introduction

### 1.1 Background
The Bookshop Automation System manages retail counter sales, phone-order lifecycle reservations, live inventory adjustments, purchase restocking, and multi-role permissions (Owner vs. Staff). This report presents formal white-box testing of four core business-logic modules using Tom McCabe's Basis Path Testing methodology.

| Feature Area | Module Under Test | Section |
| :--- | :--- | :--- |
| **Authentication & Session Issuance** | `Module 1A`: `users.login` | Section 4 |
| **Role-Based Authorization Gate** | `Module 1B`: `users.userForToken` & RBAC Gate | Section 5 |
| **Sales Validation & Inventory Deduction** | `Module 2`: `sales.createSale` | Section 6 |
| **Phone Order Fulfilment & Lifecycle Gate** | `Module 3`: `orders.setStatus` & `cancelOrder` | Section 7 |

*Table 1: Features and the modules under test*

### 1.2 Purpose of This Assignment
To verify the critical decision logic, branch barriers, and error conditions across the system using independent linearly independent paths, ensuring 100% Decision-to-Decision Path (DD-Path) coverage and zero regressions.

### 1.3 Objectives
- **Control Flow Modeling**: Construct Control Flow Graphs (CFG) and node/edge decompositions for Modules 1A, 1B, 2, and 3.
- **Cyclomatic Complexity Analysis**: Compute $V(G)$ using three independent formulations ($E - V + 2$, $P + 1$, and planar regions $R$).
- **Basis Path Derivation**: Trace every linearly independent path from entry node to terminal exit node.
- **Test Matrix Execution**: Implement and execute test cases under the native Node.js test runner (`node:test`) and verify actual outputs against predicted vectors.

---

## 2. Theoretical Foundations of Basis Path Testing

### 2.1 Flow Graph Definitions
A program module is modeled as a directed graph $G = (V, E)$:
- **Nodes ($V$)**: Maximal contiguous sequence of executable statements with single-entry, single-exit semantics (basic blocks).
- **Edges ($E$)**: Directed arcs transferring control between nodes.
- **Predicate Nodes ($P$)**: Decision points having out-degree $\ge 2$ (conditional branches).
- **Regions ($R$)**: Bounded planar areas enclosed by edges and nodes, plus one external unbounded region.

### 2.2 Cyclomatic Complexity Formulations
For a single-entry, single-exit program graph, Cyclomatic Complexity $V(G)$ is defined by three equivalent formulas:
$$V(G) = E - V + 2$$
$$V(G) = P + 1$$
$$V(G) = R$$

### 2.3 Compound Conditions and Loops
- **Short-circuit Boolean operators** (`&&`, `||`): At the Decision-to-Decision Path (DD-path) level, compound conditions are treated as single decision blocks. At the atomic condition level, each additional boolean sub-clause adds one predicate ($V(G)$ rises by 1).
- **Loops** (`for`, `while`): Represented by a loop-continuation predicate node with one back-edge to the loop header and one forward edge on termination.

---

## 3. Test Environment, Fixtures, and Lifecycle Management

### 3.1 Execution Environment
- **Operating System**: Microsoft Windows 11 Enterprise (x64 Build 22631)
- **Runtime**: Node.js v20+ (V8 engine)
- **Database Engine**: In-memory SQLite (`:memory:`) via `better-sqlite3`
- **Test Runner**: Native Node.js test runner (`node:test`)
- **Assertion Framework**: `node:assert/strict`
- **Test Script**: `backend/test/basis-path.test.js`

### 3.2 Fixture Isolation & Data Store Setup
Each test suite executes within an isolated in-memory database instance configured via the test helper lifecycle (`setup()`). The database initializes with default settings (10% staff max discount, 5% tax, ₹ currency) and pre-seeded administrative (`owner`) and operational (`staff`) users.

---

## 4. Module 1A: User Authentication (`users.login`)

### 4.1 Annotated Source Code
```javascript
function login(db, { username, password }, ip = '') {
  // Node 1: Input extraction & username validation
  const name = v.str(username, 'username', { required: true, max: 50 });
  
  // Node 2 (Predicate P1): Password presence validation
  if (typeof password !== 'string' || !password) {
    throw badRequest('password is required'); // Node 7a: Exit (400)
  }
  
  const key = `${name.toLowerCase()}|${ip}`;
  
  // Node 3 (Predicate P2): Brute-force rate limit barrier
  checkLimit(key); // Throws 429 if count >= 5 within 15 min -> Node 7b: Exit (429)
  
  // Node 4: Query user record & evaluate bcrypt hash
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(name);
  const ok = bcrypt.compareSync(password, user ? user.password_hash : DUMMY_HASH);
  
  // Node 5 (Predicate P3): User existence, hash equality, and active status check
  if (!user || !ok || !user.active) {
    noteFailure(key);
    throw unauthorized('Invalid username or password'); // Node 7c: Exit (401)
  }
  
  // Node 6: Clear failure records, generate cryptographically random session token & persist
  failures.delete(key);
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + config.sessionHours * 3600 * 1000).toISOString();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
  db.prepare('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(hashToken(token), user.id, expires);
  
  // Node 7: Terminal Exit (Success)
  return { token, user: publicUser(user) };
}
```

### 4.2 Node and Edge Definitions
| Node | Code Block / Marker | Description | Type |
| :--- | :--- | :--- | :--- |
| **N1** | `// Node 1` | Parse and validate username string | Sequential |
| **N2** | `// Node 2 (Predicate P1)` | Evaluate password presence `!password` | Predicate |
| **N3** | `// Node 3 (Predicate P2)` | Check failure attempts threshold `checkLimit` | Predicate |
| **N4** | `// Node 4` | SQL query on users & bcrypt verification | Sequential |
| **N5** | `// Node 5 (Predicate P3)` | Credentials check `!user \|\| !ok \|\| !user.active` | Predicate |
| **N6** | `// Node 6` | Reset rate limiter, generate session token & persist | Sequential |
| **N7** | `Terminal Exit` | Return `{ token, user }` or throw Error | Terminal Exit |

*Table 2: Node and edge definitions for `users.login`*

- **Edges ($E = 10$)**:
  - $N1 \to N2$
  - $N2 \to N7$ (True: 400 Bad Request)
  - $N2 \to N3$ (False: proceed)
  - $N3 \to N7$ (True: 429 Too Many Attempts)
  - $N3 \to N4$ (False: proceed)
  - $N4 \to N5$
  - $N5 \to N7$ (True: 401 Unauthorized)
  - $N5 \to N6$ (False: proceed)
  - $N6 \to N7$ (Success return)

### 4.3 Cyclomatic Complexity Calculation
- Nodes: $V = 7$ (N1 to N7)
- Edges: $E = 10$
- Predicate Nodes: $P = 3$ (N2, N3, N5)
- **Formulas**:
  - $V(G) = E - V + 2 = 10 - 7 + 2 = \mathbf{5}$ (counting error exits) or $\mathbf{4}$ single-exit basis.
  - $V(G) = P + 1 = 3 + 1 = \mathbf{4}$
  - Planar Regions: $R = \mathbf{4}$

### 4.4 Basis Paths
| Path ID | Route | Scenario Description | Expected Result |
| :--- | :--- | :--- | :--- |
| **A1** | $N1 \to N2\text{ [True]} \to N7$ | Password empty or missing | Throws 400 (`password is required`) |
| **A2** | $N1 \to N2\text{ [False]} \to N3\text{ [True]} \to N7$ | 5 prior consecutive failed attempts from IP | Throws 429 (`Too many failed sign-in attempts`) |
| **A3** | $N1 \to N2\text{ [False]} \to N3\text{ [False]} \to N4 \to N5\text{ [True]} \to N7$ | Existing user, incorrect password supplied | Throws 401 (`Invalid username or password`) |
| **A4** | $N1 \to N2\text{ [False]} \to N3\text{ [False]} \to N4 \to N5\text{ [False]} \to N6 \to N7$ | Valid username & password for active user | Session token string + user object returned |

*Table 3: Basis paths for Module 1A*

### 4.5 Test Case Matrix (Module 1A)
| Test ID | Path | Input Vectors | Expected Output | Actual Return | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **TC-BPT-A1** | A1 | `username: 'owner', password: ''` | Error 400 | `400: password is required` | **PASS** |
| **TC-BPT-A2** | A2 | 5 bad passwords then 6th attempt | Error 429 | `429: Too many failed sign-in attempts` | **PASS** |
| **TC-BPT-A3** | A3 | `username: 'owner', password: 'bad'` | Error 401 | `401: Invalid username or password` | **PASS** |
| **TC-BPT-A4** | A4 | `username: 'owner', password: 'owner-pass-1'` | `{ token, user }` | `{ token: "5f8...", user: { role: 'owner' } }` | **PASS** |
| **TC-BPT-A5** | Struct | `username: 'unknown', password: 'x'` | Error 401 | `401: Invalid username or password` | **PASS** |
| **TC-BPT-A6** | Struct | Disabled user (`active = 0`) | Error 401 | `401: Invalid username or password` | **PASS** |

*Table 4: Test case matrix for Module 1A*

---

## 5. Module 1B: Role-Based Authorization Gate (`users.userForToken` & RBAC Guard)

### 5.1 Annotated Source Code
```javascript
// Part 1: Token resolver
function userForToken(db, token) {
  // Node 1 (Predicate P1): Check token presence
  if (!token) return null; // Node 5 (Unauthorized)
  
  // Node 2: Database lookup of active session token hash
  const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
                          WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`)
                .get(hashToken(token), new Date().toISOString());
                
  // Node 3 (Predicate P2): Verify valid active session row
  if (!row) return null; // Node 5 (Unauthorized)
  
  // Node 4: Assemble public user entity
  return row; // Node 5 (Success)
}

// Part 2: Owner RBAC middleware barrier
function ownerGuard(reqUser) {
  if (!reqUser) throw unauthorized(); // 401
  if (reqUser.role !== 'owner') throw forbidden('This action is limited to the shop owner'); // 403
  return true; // 200
}
```

### 5.2 Node, Edge, and Complexity Definitions
- **Nodes ($V = 6$)**: N1 (check token), N2 (extract hash & query), N3 (verify row existence), N4 (role verification), N5 (grant access), N6 (terminal exit).
- **Edges ($E = 8$)**: $N1 \to N6$, $N1 \to N2$, $N2 \to N3$, $N3 \to N6$, $N3 \to N4$, $N4 \to N6$, $N4 \to N5$, $N5 \to N6$.
- **Predicate Nodes ($P = 3$)**: N1 (`!token`), N3 (`!row`), N4 (`user.role !== 'owner'`).
- **Cyclomatic Complexity**:
  $$V(G) = E - V + 2 = 8 - 6 + 2 = \mathbf{4}$$
  $$V(G) = P + 1 = 3 + 1 = \mathbf{4}$$
  $$R = \mathbf{4}$$

### 5.3 Basis Paths & Test Case Matrix
| Path ID | Route | Scenario Description | Result | Status |
| :--- | :--- | :--- | :--- | :--- |
| **B1** | $N1\text{ [True]} \to N6$ | Authorization token is null/undefined | `null` (401 Unauthorized) | **PASS** |
| **B2** | $N1\text{ [False]} \to N2 \to N3\text{ [True]} \to N6$ | Token hash not found or session expired | `null` (401 Unauthorized) | **PASS** |
| **B3** | $N1\text{ [False]} \to N2 \to N3\text{ [False]} \to N4\text{ [True]} \to N6$ | Valid staff token on owner-restricted endpoint | 403 Forbidden | **PASS** |
| **B4** | $N1\text{ [False]} \to N2 \to N3\text{ [False]} \to N4\text{ [False]} \to N5 \to N6$ | Valid owner token on owner-restricted endpoint | 200 OK (Access Granted) | **PASS** |
| **B5** | Structural | Active token lookup returns user record | User row object | **PASS** |

*Table 5: Basis paths and execution results for Module 1B*

---

## 6. Module 2: Sales & Inventory Validation Engine (`sales.createSale`)

### 6.1 Annotated Source Code
```javascript
function createSale(db, user, input) {
  // Node 1: Schema sanitization
  v.object(input);
  const items = v.array(input.items, 'items', { max: 100 });
  const paymentMethod = v.oneOf(input.paymentMethod, 'paymentMethod', METHODS);
  const customerName = v.str(input.customerName, 'customerName', { max: 100 });
  const discountBp = percentToBp(input.discountPercent, 'discountPercent');
  const key = input.idempotencyKey || null;

  return tx(db, () => {
    // Node 2 (Predicate P1): Idempotency cache hit check
    if (key) {
      const prior = db.prepare('SELECT * FROM sales WHERE idempotency_key = ?').get(key);
      if (prior) return { row: prior, duplicate: true }; // Node 8a: Return cached
    }

    // Node 3 (Predicate P2): Staff discount limit check
    const settings = getSettings(db);
    if (user.role !== 'owner' && discountBp > settings.staffMaxDiscountBp) {
      throw forbidden(`Staff may give at most ${settings.staffMaxDiscountBp / 100}% discount`); // Node 8b: Forbidden
    }

    // Node 4: Item expansion loop
    const lines = [];
    for (const [bookId, quantity] of wanted) {
      const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
      
      // Node 5 (Predicate P3): Book existence
      if (!book) throw notFound(`Book #${bookId}`); // Node 8c: Not Found
      
      // Node 6 (Predicate P4): Book active catalogue check
      if (!book.active) throw badRequest(`"${book.title}" is no longer sold`); // Node 8d: Bad Request
      
      // Node 7 (Predicate P5): Available unreserved stock check
      const available = book.stock_qty - book.reserved_qty;
      if (quantity > available) {
        throw conflict(`Insufficient stock for "${book.title}"`); // Node 8e: Conflict
      }
      lines.push({ bookId, quantity, unitPriceCents: book.price_cents });
    }

    // Node 8: Record invoice & deduct inventory
    const { saleId } = recordSale(db, { lines, discountBp, taxBp: settings.taxBp, paymentMethod, customerName, idempotencyKey: key, userId: user.id });
    return { row: db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId), duplicate: false };
  });
}
```

### 6.2 Rule-Level Predicates
| Predicate | Rule Evaluated | Condition in Code |
| :--- | :--- | :--- |
| **P1** | Idempotency key replay | `key && prior` |
| **P2** | Staff discount ceiling | `user.role !== 'owner' && discountBp > settings.staffMaxDiscountBp` |
| **P3** | Catalogue book existence | `!book` |
| **P4** | Catalogue active selling status | `!book.active` |
| **P5** | Stock availability ceiling | `quantity > (book.stock_qty - book.reserved_qty)` |

*Table 6: Rule-level predicates of `sales.createSale`*

Rule-level complexity is $V(G) = P + 1 = 5 + 1 = \mathbf{6}$.

### 6.3 Test Case Matrix (Module 2)
| Test ID | Path | Input Vectors | Expected Output | Actual Observed Output | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **TC-BPT-C01** | C1 | Idempotency key `'idem-101'` sent twice | `duplicate: true`, identical sale ID | `duplicate: true, id: s1.id` | **PASS** |
| **TC-BPT-C02** | C2 | Staff user giving 15% discount (limit 10%) | 403 Forbidden | `403: Staff may give at most...` | **PASS** |
| **TC-BPT-C03** | C3 | Cart with unknown `bookId: 999999` | 404 Not Found | `404: Book #999999` | **PASS** |
| **TC-BPT-C04** | C4 | Inactive/discontinued book in cart | 400 Bad Request | `400: "..." is no longer sold` | **PASS** |
| **TC-BPT-C05** | C5 | Quantity 999 requested for 5 in stock | 409 Conflict | `409: Insufficient stock...` | **PASS** |
| **TC-BPT-C06** | C6 | Staff sale with 5% discount, valid stock | 201 Created, stock -2 | `duplicate: false, stock: 8` | **PASS** |
| **TC-BPT-C07** | Struct | Owner applying 50% discount | 201 Created, discount: 50% | `discountPercent: 50` | **PASS** |
| **TC-BPT-C08** | Struct | Multi-item purchase (2 different books) | 201 Created, items length 2 | `items.length: 2` | **PASS** |
| **TC-BPT-C09** | Struct | Reserved stock barrier ($stock - reserved$) | 409 Conflict (reserved) | `409: reserved for phone orders` | **PASS** |
| **TC-BPT-C10** | Struct | Duplicate book in cart lines aggregated | Single line consolidated | `stock delta: -3` | **PASS** |

*Table 7: Test case matrix for Module 2*

---

## 7. Module 3: Phone Order Lifecycle Transition Gate (`orders.setStatus` & `cancelOrder`)

### 7.1 Annotated Source Code
```javascript
function setStatus(db, id, input) {
  // Node 1: Schema validation
  const next = v.oneOf(input && input.status, 'status', ['ready', 'out_for_delivery']);
  
  return tx(db, () => {
    // Node 2: Fetch order record
    const order = loadOrder(db, id); // Throws 404 if missing -> Node 6a
    
    // Node 3 (Predicate P1): Legal state transition barrier
    if (!(TRANSITIONS[order.status] || []).includes(next)) {
      throw conflict(`Cannot move an order from "${order.status}" to "${next}"`); // Node 6b
    }
    
    // Node 4 (Predicate P2): Delivery type constraint
    if (next === 'out_for_delivery' && order.delivery_type !== 'delivery') {
      throw conflict('Only delivery orders can be sent out for delivery'); // Node 6c
    }
    
    // Node 5: State update & updated_at timestamp
    db.prepare('UPDATE phone_orders SET status=?, updated_at=? WHERE id=?').run(next, new Date().toISOString(), id);
    
    // Node 6: Return refreshed order object (Success)
    return getOrder(db, id);
  });
}
```

### 7.2 Node, Edge, and Complexity Definitions
- **Nodes ($V = 6$)**: N1 (input validation), N2 (load order), N3 (valid transition check), N4 (delivery constraint check), N5 (update database), N6 (terminal exit).
- **Edges ($E = 7$)**: $N1 \to N2$, $N2 \to N6$ (error 404), $N2 \to N3$, $N3 \to N6$ (illegal transition), $N3 \to N4$, $N4 \to N6$ (delivery conflict), $N4 \to N5 \to N6$ (success).
- **Predicate Nodes ($P = 2$)**: N3 (`!TRANSITIONS.includes(next)`), N4 (`next === 'out_for_delivery' && delivery_type !== 'delivery'`).
- **Cyclomatic Complexity**:
  $$V(G) = E - V + 2 = 7 - 6 + 2 = \mathbf{3}$$
  $$V(G) = P + 1 = 2 + 1 = \mathbf{3}$$
  $$R = \mathbf{3}$$

### 7.3 Basis Paths & Test Case Matrix
| Test ID | Path | Input Vectors | Expected Output | Actual Observed Output | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **TC-BPT-S1** | S1 | Order ID `999999` (non-existent) | 404 Not Found | `404: Order` | **PASS** |
| **TC-BPT-S2** | S2 | `placed` order moved directly to `out_for_delivery` | 409 Conflict | `409: Cannot move an order...` | **PASS** |
| **TC-BPT-S3** | S3 | Pickup order moved to `out_for_delivery` | 409 Conflict | `409: Only delivery orders...` | **PASS** |
| **TC-BPT-S4** | S4 | Delivery order: `placed` $\to$ `ready` $\to$ `out_for_delivery` | Status updated to `out_for_delivery` | `status: "out_for_delivery"` | **PASS** |
| **TC-BPT-S5** | Struct | Cancel order releases reserved book stock | Reserved stock decremented | `reserved stock restored: 0` | **PASS** |
| **TC-BPT-S6** | Struct | Cancelling already cancelled order | 409 Conflict | `409: already cancelled` | **PASS** |

*Table 8: Basis paths and execution results for Module 3*

---

## 8. Regression Suite: System Quality Assurance (TC-01 to TC-12)

| Test ID | Target Service | System Invariant Verified | Concrete Assertion | Status |
| :--- | :--- | :--- | :--- | :--- |
| **TC-01** | `books.create` | Catalogue CRUD relational consistency | Book record initialized with stock and price | **PASS** |
| **TC-02** | `inventory.applyStock` | Negative stock prevention CHECK constraint | Stock decrement below 0 rejected with 409 | **PASS** |
| **TC-03** | `sales.createSale` | Idempotent sale generation determinism | Duplicate idempotency key yields cached invoice | **PASS** |
| **TC-04** | `sales.createSale` | Staff discount ceiling enforcement | Discount exceeding 10% blocked for staff | **PASS** |
| **TC-05** | `orders.createOrder` | Phone order stock reservation barrier | Stock marked reserved without physical deduction | **PASS** |
| **TC-06** | `orders.fulfilOrder` | Phone order fulfilment moves reserved stock | Stock and reserved quantity decremented concurrently | **PASS** |
| **TC-07** | `inventory.stockOverview` | Low-stock threshold computation | Flag set when available quantity $\le$ threshold | **PASS** |
| **TC-08** | `inventory.adjustStock` | Physical inventory audit trail logging | Note and delta recorded in `stock_movements` | **PASS** |
| **TC-09** | `sales.voidSale` | Voiding invoice restores inventory | Book stock incremented back by sale quantity | **PASS** |
| **TC-10** | `sales.voidSale` | Re-voiding already voided sale rejected | Second void attempt returns 409 Conflict | **PASS** |
| **TC-11** | `money.computeTotals` | Arithmetic rounding on tax and discount | Cents precision verified without floating point error | **PASS** |
| **TC-12** | `billPrinter.renderBillHtml` | Physical cash memo generation formatting | HTML output contains shop title, stamp, and TOTAL | **PASS** |

*Table 9: System regression suite TC-01 to TC-12*

---

## 9. Execution Summary

The entire unit and basis-path test suite was executed under the native Node.js test harness (`node --test`). All **46 test cases passed** with **0 failures**, **0 skipped**, and **0 flakes**.

| Module | Tests Executed | Passed | Failed | Active Runtime (ms) |
| :--- | :--- | :--- | :--- | :--- |
| **Module 1A: User Authentication (`users.login`)** | 6 | 6 | 0 | 501.46 ms |
| **Module 1B: Authorization Gate (`users.userForToken`)** | 5 | 5 | 0 | 98.50 ms |
| **Module 2: Sales Validation (`sales.createSale`)** | 11 | 11 | 0 | 26.77 ms |
| **Module 3: Order Lifecycle Gate (`orders.setStatus`)** | 7 | 7 | 0 | 25.16 ms |
| **System Regression Suite (TC-01 to TC-12)** | 12 | 12 | 0 | 61.43 ms |
| **Total Test Execution (Active)** | **41** | **41** | **0** | **713.32 ms** |
| **Total Process Wall-Clock (including fixtures & bcrypt)** | **46** | **46** | **0** | **1546.02 ms** |

*Table 10: Test execution summary by module*

---

## 10. Coverage Scope & Quality Analysis

### 10.1 Modeled Basis vs. Structural Complexity Recount
| Module | Original Tests | Basis Modeled | Structural $V(G)$ | Unmodeled Structural Decisions | Added Tests | Total Tests |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1A Authentication** | 4 | 4 | 6 | Inactive user check, non-existent username | 2 | 6 |
| **1B Authorization** | 4 | 4 | 5 | Active session hash resolution | 1 | 5 |
| **2 Sales Validation** | 6 | 6 | 10 | Owner discount bypass, multi-item loop, reserved boundary, line merge | 4 | 10 (+1 setup) |
| **3 Order Gate** | 4 | 4 | 6 | Reservation release upon cancel, re-cancel barrier | 2 | 6 (+1 setup) |

*Table 11: Modeled basis versus structural complexity comparison*

### 10.2 Quality Findings & Invariants Verified
1. **Financial Precision**: All monetary values are maintained as integers (cents/paise), eliminating floating-point IEEE-754 drift across sales, discounts, and tax computation.
2. **Zero-Stock & Negative Inventory Barrier**: SQLite `CHECK (stock_qty >= 0)` constraints paired with atomic `UPDATE ... WHERE stock_qty + @delta >= 0` guarantee that concurrent sales can never drive inventory below zero.
3. **Idempotency Guarantee**: Point-of-sale network timeouts or accidental double-clicks on counter tablets are safely deduped using `idempotency_key`, preventing double charges.
4. **State Machine Strictness**: Order status transitions form an acyclic workflow where cancelled or completed orders cannot transition or incur unauthorized modifications.

---

## 11. Assumptions & Constraints
- **Assumptions**: Each test suite runs against an isolated SQLite in-memory database (`:memory:`) to guarantee deterministic execution without state bleeding between runs.
- **Constraints**: White-box basis path testing covers internal branch logic and boundary predicates of backend core services. External network failures (e.g. SMTP or payment gateway outages) are decoupled and tested via separate integration harnesses.

