const fs = require('fs');
const puppeteer = require('puppeteer-core');

function findBrowserExe() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ];
  return candidates.filter(Boolean).find((p) => fs.existsSync(p));
}

// Whole rupees only (amounts are rounded to the nearest rupee).
function fmtMoney(cents, symbol = '₹') {
  const rs = Math.round((cents || 0) / 100);
  return { rs, ps: '', formatted: `${symbol}${rs.toLocaleString('en-IN')}` };
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

/**
 * Builds authentic Indian Bookshop cash memo HTML matching Srinivasa Book Store reference.
 */
function renderBillHtml(sale, settings = {}) {
  const shopName = settings.shopName || 'PRATHAM BOOKSHOP';
  const shopAddress = settings.shopAddress || 'Main Road, 12 College Road, Mumbai - 400 001';
  const shopPhone = settings.shopPhone || 'Ph : 040-6455 5452 / +91 98200 11111';
  const billType = (sale.paymentMethod || 'cash').toUpperCase() + ' - BILL';
  const dateStr = fmtDate(sale.createdAt);
  const custName = sale.customerName || 'Walk-in Customer';
  const billNo = sale.billNo || `INV-${String(sale.id || 1).padStart(6, '0')}`;
  const total = fmtMoney(sale.totalCents || 0);
  const subtotal = fmtMoney(sale.subtotalCents || 0);
  const discount = sale.discountCents ? fmtMoney(sale.discountCents) : null;
  const tax = sale.taxCents ? fmtMoney(sale.taxCents) : null;

  // Stamp details based on payment method
  const method = (sale.paymentMethod || 'cash').toLowerCase();
  let stampText = 'CASH PAID';
  let stampSub = 'OFFICIAL RECEIPT';
  let stampColor = '#2b3a8c'; // classic violet-blue ink
  let stampBg = 'rgba(43, 58, 140, 0.05)';

  if (method === 'upi') {
    stampText = 'UPI PAID';
    stampSub = 'DIGITAL PAYMENT';
    stampColor = '#0c7356'; // emerald teal
    stampBg = 'rgba(12, 115, 86, 0.05)';
  } else if (method === 'card') {
    stampText = 'CARD PAID';
    stampSub = 'POS TRANSACTION';
    stampColor = '#1d4ed8'; // navy
    stampBg = 'rgba(29, 78, 216, 0.05)';
  } else if (method === 'other') {
    stampText = 'PAID';
    stampSub = 'VERIFIED';
    stampColor = '#6b21a8';
    stampBg = 'rgba(107, 33, 168, 0.05)';
  }

  const items = sale.items || [];
  // Ensure table looks realistic with minimum 5 display rows
  const emptyRowsCount = Math.max(0, 5 - items.length);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Cash Memo - ${billNo}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 12mm 15mm;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: #fdfdfd;
      color: #1a1a1a;
      display: flex;
      justify-content: center;
      padding: 10px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .memo-sheet {
      width: 100%;
      max-width: 720px;
      background: #fff;
      border: 2px solid #b91c1c;
      padding: 18px 22px;
      position: relative;
      box-shadow: 0 4px 12px rgba(0,0,0,0.06);
    }
    .top-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: 700;
      font-size: 13px;
      color: #b91c1c;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
    }
    .store-header {
      text-align: center;
      margin-bottom: 12px;
    }
    .logo-title-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
    }
    .book-icon {
      width: 38px;
      height: 38px;
      fill: #b91c1c;
    }
    .shop-title {
      font-family: "Impact", "Arial Black", "Trebuchet MS", sans-serif;
      font-size: 32px;
      font-weight: 900;
      letter-spacing: 2.5px;
      color: #b91c1c;
      text-transform: uppercase;
      line-height: 1.1;
    }
    .shop-addr {
      font-size: 12px;
      font-weight: 600;
      color: #374151;
      margin-top: 4px;
    }
    .shop-tagline {
      font-size: 11px;
      font-weight: 800;
      color: #b91c1c;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      margin-top: 3px;
    }
    .meta-section {
      margin-top: 14px;
      margin-bottom: 12px;
      font-size: 13.5px;
      line-height: 1.7;
    }
    .meta-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 6px;
    }
    .dotted-line {
      border-bottom: 1px dotted #4b5563;
      flex-grow: 1;
      margin-left: 8px;
      min-height: 18px;
      font-family: "Courier New", Courier, monospace;
      font-weight: 600;
      color: #111827;
      padding-left: 4px;
    }
    .bill-no-val {
      color: #b91c1c;
      font-family: "Courier New", Courier, monospace;
      font-weight: 800;
      font-size: 16px;
      letter-spacing: 1px;
    }
    .ledger-table {
      width: 100%;
      border-collapse: collapse;
      border: 2px solid #b91c1c;
      font-size: 13px;
      position: relative;
    }
    .ledger-table th {
      border: 1px solid #b91c1c;
      border-bottom: 2px solid #b91c1c;
      padding: 6px 8px;
      font-weight: 800;
      color: #b91c1c;
      text-transform: uppercase;
      font-size: 12px;
      letter-spacing: 0.5px;
    }
    .ledger-table td {
      border-left: 1px solid #b91c1c;
      border-right: 1px solid #b91c1c;
      padding: 8px;
      vertical-align: top;
    }
    .col-sl { width: 44px; text-align: center; }
    .col-particulars { text-align: left; }
    .col-qty { width: 55px; text-align: center; }
    .col-rate { width: 75px; text-align: right; }
    .col-rs { width: 75px; text-align: right; }
    .col-ps { width: 40px; text-align: center; }
    
    .item-title {
      font-weight: 700;
      color: #111827;
      font-size: 13px;
    }
    .item-sub {
      font-size: 11px;
      color: #4b5563;
      margin-top: 1px;
      font-family: monospace;
    }
    .circle-num {
      display: inline-block;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      border: 1px solid #111827;
      line-height: 18px;
      text-align: center;
      font-size: 11px;
      font-weight: 700;
    }
    .amt-cell {
      font-family: "Courier New", Courier, monospace;
      font-weight: 700;
      font-size: 13.5px;
    }
    .summary-row td {
      border-top: 1px solid #b91c1c;
      padding: 4px 8px;
      font-weight: 600;
      font-size: 12px;
    }
    .total-row td {
      border-top: 2px solid #b91c1c;
      border-bottom: 2px solid #b91c1c;
      padding: 8px;
      font-weight: 900;
      font-size: 15px;
      color: #b91c1c;
    }
    .rubber-stamp {
      position: absolute;
      bottom: 60px;
      left: 120px;
      transform: rotate(-12deg);
      border: 3.5px dashed ${stampColor};
      border-radius: 8px;
      padding: 6px 16px;
      color: ${stampColor};
      background: ${stampBg};
      text-align: center;
      pointer-events: none;
      z-index: 10;
      box-shadow: 0 0 0 2px ${stampColor};
      opacity: 0.92;
    }
    .stamp-text {
      font-family: "Impact", "Arial Black", sans-serif;
      font-size: 26px;
      letter-spacing: 2px;
      line-height: 1;
      text-transform: uppercase;
    }
    .stamp-sub {
      font-size: 9.5px;
      font-weight: 800;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      margin-top: 3px;
      border-top: 1px solid ${stampColor};
      padding-top: 2px;
    }
    .memo-footer {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      margin-top: 16px;
      padding-top: 8px;
      font-size: 12px;
    }
    .disclaimer {
      font-size: 12px;
      font-weight: 600;
      color: #b91c1c;
      font-style: italic;
    }
    .sign-block {
      text-align: right;
    }
    .sign-title {
      font-weight: 800;
      color: #b91c1c;
      text-transform: uppercase;
      font-size: 12.5px;
    }
    .sign-space {
      margin-top: 22px;
      border-top: 1px dashed #6b7280;
      padding-top: 3px;
      font-size: 11px;
      color: #4b5563;
    }
  </style>
</head>
<body>
  <div class="memo-sheet">
    <div class="top-bar">
      <span>${billType}</span>
      <span>${shopPhone}</span>
    </div>

    <div class="store-header">
      <div class="logo-title-row">
        <svg class="book-icon" viewBox="0 0 24 24">
          <path d="M12 3.75c-3.75-2.25-8.25-2-10 0v14.5c1.75-2 6.25-2.25 10 0 3.75-2.25 8.25-2 10 0V3.75c-1.75-2-6.25-2.25-10 0zm0 13c-3-1.8-6.8-1.5-8.5-.2V5.5c1.7-1.3 5.5-1.6 8.5.2v11.05zm8.5-.2c-1.7-1.3-5.5-1.6-8.5.2V5.7c3-1.8 6.8-1.5 8.5-.2v10.75z"/>
        </svg>
        <div class="shop-title">${shopName}</div>
      </div>
      <div class="shop-addr">${shopAddress}</div>
      <div class="shop-tagline">DISTRIBUTORS : ALL TYPES OF BOOKS &amp; STATIONERY · ACADEMIC &amp; LITERATURE</div>
    </div>

    <div class="meta-section">
      <div class="meta-row">
        <div style="display:flex; align-items:baseline; width: 45%;">
          <span style="font-weight:800; color:#b91c1c; font-size:14px;">No.</span>
          <span class="dotted-line bill-no-val">${billNo}</span>
        </div>
        <div style="display:flex; align-items:baseline; width: 45%;">
          <span style="font-weight:800; color:#b91c1c; font-size:13px;">Date :</span>
          <span class="dotted-line">${dateStr}</span>
        </div>
      </div>
      <div class="meta-row" style="margin-top: 6px;">
        <span style="font-weight:700; color:#374151; white-space: nowrap;">Customer Name :</span>
        <span class="dotted-line">${custName}</span>
      </div>
      <div class="meta-row" style="margin-top: 6px;">
        <span style="font-weight:700; color:#374151; white-space: nowrap;">Address :</span>
        <span class="dotted-line">Counter Sale / Walk-in</span>
      </div>
    </div>

    <!-- Ledger Table -->
    <table class="ledger-table">
      <thead>
        <tr>
          <th class="col-sl">Sl.<br>No.</th>
          <th class="col-particulars">PARTICULARS</th>
          <th class="col-qty">QTY.</th>
          <th class="col-rate">RATE</th>
          <th colspan="2" style="text-align:center;">
            Amount<br>
            <span style="font-size:10px; font-weight:normal;">Rs.</span>
          </th>
        </tr>
      </thead>
      <tbody>
        ${items.map((it, idx) => {
          const mRate = fmtMoney(it.unitPriceCents || 0);
          const mLine = fmtMoney(it.lineTotalCents || (it.quantity * it.unitPriceCents) || 0);
          return `
          <tr>
            <td class="col-sl"><span class="circle-num">${idx + 1}</span></td>
            <td class="col-particulars">
              <div class="item-title">${it.title}</div>
              <div class="item-sub">${it.author || ''} ${it.isbn ? '· ISBN: ' + it.isbn : ''}</div>
            </td>
            <td class="col-qty" style="font-weight:700;">${it.quantity}</td>
            <td class="col-rate amt-cell">${mRate.rs}</td>
            <td class="col-rs amt-cell">${mLine.rs}</td>
            <td class="col-ps amt-cell">${mLine.ps}</td>
          </tr>
          `;
        }).join('')}

        ${Array.from({ length: emptyRowsCount }).map(() => `
          <tr style="height: 28px;">
            <td class="col-sl"></td>
            <td class="col-particulars"></td>
            <td class="col-qty"></td>
            <td class="col-rate"></td>
            <td class="col-rs"></td>
            <td class="col-ps"></td>
          </tr>
        `).join('')}

        ${discount ? `
        <tr class="summary-row">
          <td colspan="4" style="text-align:right;">Discount (${sale.discountPercent || 0}%):</td>
          <td class="col-rs amt-cell">-${discount.rs}</td>
          <td class="col-ps amt-cell">${discount.ps}</td>
        </tr>
        ` : ''}

        ${tax ? `
        <tr class="summary-row">
          <td colspan="4" style="text-align:right;">Tax (${sale.taxPercent || 0}%):</td>
          <td class="col-rs amt-cell">${tax.rs}</td>
          <td class="col-ps amt-cell">${tax.ps}</td>
        </tr>
        ` : ''}

        <tr class="total-row">
          <td colspan="4" style="text-align:right; letter-spacing:1px;">TOTAL</td>
          <td class="col-rs amt-cell" style="font-size:16px;">${total.rs}</td>
          <td class="col-ps amt-cell" style="font-size:16px;">${total.ps}</td>
        </tr>
      </tbody>
    </table>

    <!-- Rubber Stamp Overlay -->
    <div class="rubber-stamp">
      <div class="stamp-text">${stampText}</div>
      <div class="stamp-sub">${stampSub} · ${dateStr}</div>
    </div>

    <div class="memo-footer">
      <div class="disclaimer">goods once sold will not taken back.</div>
      <div class="sign-block">
        <div class="sign-title">For ${shopName}</div>
        <div class="sign-space">Authorized Signatory</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Compiles sale HTML and executes Puppeteer to generate high-resolution PDF.
 */
async function generateBillPdf(sale, settings = {}) {
  const exe = findBrowserExe();
  if (!exe) {
    throw new Error('No Chrome or Edge browser binary found on system for PDF generation');
  }

  const html = renderBillHtml(sale, settings);

  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '10mm',
        bottom: '10mm',
        left: '12mm',
        right: '12mm'
      }
    });
    return pdfBuffer;
  } finally {
    await browser.close();
  }
}

module.exports = {
  renderBillHtml,
  generateBillPdf,
  findBrowserExe
};

