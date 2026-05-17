importScripts("../lib/tiling.js", "../lib/pdf.js");

const ZOOM = 6;
const TILE_SIZE = 256;
const TILE_CONCURRENCY = 8;  // parallel tile requests per page
const PAGE_CONCURRENCY = 3;  // parallel pages processed at once

// ---------------------------------------------------------------------------
// State helpers — lightweight progress stored in chrome.storage.local so the
// popup can read and display it even after being closed and reopened.
// Completed PDF bytes are kept in IndexedDB (no size limit) so the popup can
// retrieve them without us having to pass megabytes through message channels.
// ---------------------------------------------------------------------------

async function setState(patch) {
  const { dlState = {} } = await chrome.storage.local.get("dlState");
  await chrome.storage.local.set({ dlState: { ...dlState, ...patch } });
}

async function getState() {
  const { dlState } = await chrome.storage.local.get("dlState");
  return dlState || { status: "idle" };
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("gbdl", 1);
    req.onupgradeneeded = (e) => e.target.result.createObjectStore("pdfs");
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

async function savePdfToDB(bytes) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pdfs", "readwrite");
    tx.objectStore("pdfs").put(bytes, "current");
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function clearPdfFromDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pdfs", "readwrite");
    tx.objectStore("pdfs").delete("current");
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

async function fetchJSON(url) {
  const resp = await fetch(url, { credentials: "include" });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

// ---------------------------------------------------------------------------
// Tile download + stitching (runs in the service worker via OffscreenCanvas)
// ---------------------------------------------------------------------------

async function stitchPage(booksOrigin, bookId, pg, tileres) {
  const zoom6 = tileres.find((t) => t.z === ZOOM);
  if (!zoom6) throw new Error("Zoom level 6 not found in tile metadata");

  const cols = Math.ceil(zoom6.w / TILE_SIZE);
  const rows = Math.ceil(zoom6.h / TILE_SIZE);
  const totalTiles = rows * cols;
  const sequence = generateTilingSequence(rows, cols);

  // Fetch tiles with bounded concurrency
  const tileImages = new Array(totalTiles);
  for (let start = 0; start < totalTiles; start += TILE_CONCURRENCY) {
    const batch = Array.from(
      { length: Math.min(TILE_CONCURRENCY, totalTiles - start) },
      (_, j) => start + j
    );
    await Promise.all(
      batch.map(async (idx) => {
        const url =
          `${booksOrigin}/books/content` +
          `?id=${bookId}&pg=0,${pg}&img=1&zoom=${ZOOM}&tid=${idx}`;
        const resp = await fetch(url, { credentials: "include" });
        if (!resp.ok) throw new Error(`Tile ${idx}: HTTP ${resp.status}`);
        tileImages[idx] = await createImageBitmap(await resp.blob());
      })
    );
  }

  // Stitch using OffscreenCanvas (available in Chrome service workers)
  const canvas = new OffscreenCanvas(zoom6.w, zoom6.h);
  const ctx = canvas.getContext("2d");

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const img = tileImages[sequence[r][c]];
      if (img) {
        ctx.drawImage(img, c * TILE_SIZE, r * TILE_SIZE);
        img.close();
      }
    }
  }

  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
  const buf = await blob.arrayBuffer();
  return { bytes: new Uint8Array(buf), width: zoom6.w, height: zoom6.h };
}

async function processOnePage(booksOrigin, bookId, pageParam) {
  const pageData = await fetchJSON(
    `${booksOrigin}/books?id=${bookId}&pg=PA${pageParam}&jscmd=click3`
  );
  const info = pageData?.page?.[0]?.additional_info?.["[NewspaperJSONPageInfo]"];
  if (!info) return null;
  return stitchPage(booksOrigin, bookId, info.page_scanjob_coordinates.y, info.tileres);
}

// ---------------------------------------------------------------------------
// Main download orchestration
// ---------------------------------------------------------------------------

async function runDownload(bookId, booksOrigin, pageList) {
  const total = pageList.length;
  let completed = 0;
  const pageResults = new Array(total);

  await setState({ status: "downloading", bookId, booksOrigin, pageList, total, completed: 0, error: null });

  // Process PAGE_CONCURRENCY pages at a time; within each page tiles are
  // already fetched with TILE_CONCURRENCY — so max concurrent requests:
  // PAGE_CONCURRENCY × TILE_CONCURRENCY = 3 × 8 = 24
  for (let start = 0; start < total; start += PAGE_CONCURRENCY) {
    const indices = Array.from(
      { length: Math.min(PAGE_CONCURRENCY, total - start) },
      (_, j) => start + j
    );
    await Promise.all(
      indices.map(async (i) => {
        try {
          pageResults[i] = await processOnePage(booksOrigin, bookId, pageList[i]);
        } catch (err) {
          console.error(`Page ${pageList[i]} failed:`, err);
          pageResults[i] = null;
        }
        completed++;
        await setState({ completed });
      })
    );
  }

  await setState({ status: "assembling" });

  const pdf = new SimplePDF();
  for (const page of pageResults) {
    if (page) pdf.addPage(page.bytes, page.width, page.height);
  }
  const pdfBytes = pdf.generate();

  // Persist to IndexedDB so the popup can retrieve it without a huge message
  await savePdfToDB(pdfBytes);
  await setState({ status: "complete", completed: total });
}

// ---------------------------------------------------------------------------
// Icon — drawn programmatically so no PNG files are needed.
// Green = valid Google Books/News Archive page with a downloadable book ID.
// Grey  = everything else.
// ---------------------------------------------------------------------------

function isValidGoogleBooksUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    const hasId = u.searchParams.get("id") || u.searchParams.get("nid");
    const isBooks = u.hostname.startsWith("books.google.");
    const isNews = u.hostname === "news.google.com";
    return !!(hasId && (isBooks || isNews));
  } catch {
    return false;
  }
}

function makeIconImageData(isValid) {
  const color = isValid ? "#22c55e" : "#9ca3af";
  const imageData = {};

  for (const size of [16, 32, 48, 128]) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");
    const s = size;
    const r = s * 0.22;

    // Rounded-square background
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(s - r, 0);
    ctx.arcTo(s, 0, s, r, r);
    ctx.lineTo(s, s - r);
    ctx.arcTo(s, s, s - r, s, r);
    ctx.lineTo(r, s);
    ctx.arcTo(0, s, 0, s - r, r);
    ctx.lineTo(0, r);
    ctx.arcTo(0, 0, r, 0, r);
    ctx.closePath();
    ctx.fill();

    // White "G" centred in the icon
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.font = `bold ${Math.round(s * 0.62)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("G", s / 2, s / 2 + s * 0.03);

    imageData[size] = ctx.getImageData(0, 0, s, s);
  }

  return imageData;
}

async function updateTabIcon(tabId, url) {
  try {
    await chrome.action.setIcon({
      imageData: makeIconImageData(isValidGoogleBooksUrl(url)),
      tabId,
    });
  } catch {
    // Tab may have been closed between the event and this call — ignore.
  }
}

// Update icon when the user switches tabs
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await updateTabIcon(tabId, tab.url);
  } catch {
    // ignore
  }
});

// Update icon when the URL of any tab changes (navigation, hash changes, etc.)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url !== undefined) {
    await updateTabIcon(tabId, changeInfo.url);
  }
});

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "GET_STATE") {
    getState().then((state) => sendResponse({ state }));
    return true;
  }

  if (msg.type === "START_DOWNLOAD") {
    const { bookId, booksOrigin, pageList } = msg;
    runDownload(bookId, booksOrigin, pageList).catch(async (err) => {
      await setState({ status: "error", error: err.message });
    });
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === "RESET") {
    clearPdfFromDB().catch(console.error);
    chrome.storage.local.remove("dlState");
    sendResponse({ ok: true });
    return false;
  }
});
