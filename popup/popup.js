"use strict";

// ---------------------------------------------------------------------------
// The popup is a thin UI layer. All download logic runs in the service worker
// so it persists when the popup is closed. State is stored in
// chrome.storage.local; completed PDFs are stored in IndexedDB.
// ---------------------------------------------------------------------------

const el = (id) => document.getElementById(id);

function setStatus(msg, type = "") {
  const s = el("status");
  s.textContent = msg;
  s.className = "status" + (type ? ` ${type}` : "");
}

function setProgress(done, total) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  el("progress-fill").style.width = `${pct}%`;
  el("progress-text").textContent = `${done} / ${total} pages`;
}

function show(...ids) {
  ids.forEach((id) => el(id)?.classList.remove("hidden"));
}

function hide(...ids) {
  ids.forEach((id) => el(id)?.classList.add("hidden"));
}

// ---------------------------------------------------------------------------
// IndexedDB — popup reads the completed PDF written by the service worker
// ---------------------------------------------------------------------------

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("gbdl", 1);
    req.onupgradeneeded = (e) => e.target.result.createObjectStore("pdfs");
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadPdfFromDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pdfs", "readonly");
    const req = tx.objectStore("pdfs").get("current");
    req.onsuccess = () => { db.close(); resolve(req.result ?? null); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

// ---------------------------------------------------------------------------
// Render: update the popup UI to match a given state object
// ---------------------------------------------------------------------------

function renderState(state) {
  // Reset all dynamic sections
  hide("progress-container", "download-btn", "save-btn", "reset-btn");
  el("book-id").textContent = state.bookId || "—";

  switch (state.status) {
    case "downloading": {
      const done = state.completed ?? 0;
      const total = state.total ?? 0;
      setProgress(done, total);
      show("progress-container");
      setStatus(`Downloading page ${done} of ${total}…`);
      show("reset-btn");
      break;
    }

    case "assembling": {
      setProgress(state.total, state.total);
      show("progress-container");
      setStatus("Assembling PDF…");
      break;
    }

    case "complete": {
      setProgress(state.total, state.total);
      show("progress-container", "save-btn", "reset-btn");
      setStatus("Download ready — click Save PDF.", "success");
      break;
    }

    case "error": {
      setStatus(`Error: ${state.error}`, "error");
      show("reset-btn");
      break;
    }

    default: {
      // idle or unknown
      setStatus("Open a Google Books or Google News Archive page, then click Download.");
      show("download-btn");
      el("download-btn").disabled = true;
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // --- 1. Detect the active tab first so we can give accurate status messages ---
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let bookId = null;
  let booksOrigin = null;

  if (tab?.url) {
    try {
      const tabUrl = new URL(tab.url);
      const rawId =
        tabUrl.searchParams.get("id") || tabUrl.searchParams.get("nid");
      const isBooks = tabUrl.hostname.startsWith("books.google.");
      const isNews = tabUrl.hostname === "news.google.com";

      if (rawId && (isBooks || isNews)) {
        bookId = rawId;
        booksOrigin = isBooks ? tabUrl.origin : "https://books.google.com";
        el("book-id").textContent = bookId;
      }
    } catch {
      // ignore unparseable URLs
    }
  }

  // --- 2. Read saved state and render ---
  const { dlState: savedState } = await chrome.storage.local.get("dlState");
  const state = savedState || { status: "idle" };
  show("book-info");
  renderState(state);

  // For the idle state, we now know the tab so we can give the right message
  if (state.status === "idle") {
    if (bookId) {
      el("download-btn").disabled = false;
      setStatus("Ready — click Download to start.");
    } else {
      el("download-btn").disabled = true;
      setStatus(
        tab?.url
          ? "This page is not a Google Books or Google News Archive newspaper."
          : "Open a Google Books or Google News Archive newspaper, then click the extension."
      );
    }
  }

  // --- 3. Live updates: re-render whenever storage changes ---
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.dlState) {
      renderState(changes.dlState.newValue || { status: "idle" });
    }
  });

  // --- 4. Download button: fetch page list then hand off to service worker ---
  el("download-btn").addEventListener("click", async () => {
    if (!bookId) return;
    el("download-btn").disabled = true;
    setStatus("Fetching page list…");

    try {
      const firstPage = await fetch(
        `${booksOrigin}/books?id=${bookId}&pg=PA1&jscmd=click3`,
        { credentials: "include" }
      ).then((r) => r.json());

      if (!firstPage?.page?.length) {
        setStatus("No pages found — is this a Google News Archive newspaper?", "error");
        el("download-btn").disabled = false;
        return;
      }

      const pageList = firstPage.page.map((p) => p.pid.substring(2));
      el("page-count").textContent = `${pageList.length}`;

      chrome.runtime.sendMessage({
        type: "START_DOWNLOAD",
        bookId,
        booksOrigin,
        pageList,
      });
      // renderState will be triggered by storage.onChanged as soon as the SW
      // sets its first state update
    } catch (err) {
      setStatus(`Failed to load page list: ${err.message}`, "error");
      el("download-btn").disabled = false;
    }
  });

  // --- 5. Save PDF button: read bytes from IndexedDB, create blob, download ---
  el("save-btn").addEventListener("click", async () => {
    el("save-btn").disabled = true;
    setStatus("Reading PDF from storage…");

    try {
      const bytes = await loadPdfFromDB();
      if (!bytes) {
        setStatus("PDF no longer in storage — please download again.", "error");
        show("reset-btn");
        return;
      }

      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `google-books-${state.bookId || bookId || "download"}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      setStatus("Saved!", "success");
    } catch (err) {
      setStatus(`Save failed: ${err.message}`, "error");
    } finally {
      el("save-btn").disabled = false;
    }
  });

  // --- 6. Reset button: clear state so user can start a fresh download ---
  el("reset-btn").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "RESET" });
    renderState({ status: "idle" });
    if (bookId) {
      el("download-btn").disabled = false;
      setStatus("Ready — click Download to start.");
    }
    show("download-btn");
  });
}

document.addEventListener("DOMContentLoaded", main);
