# Google Books Downloader

A Chrome extension that downloads Google Books and Google News Archive newspapers as PDF files, entirely client-side with no external servers.

## How It Works

Google Books and Google News Archive serve page images as a grid of small 256 × 256 pixel tiles rather than full-page images. This extension reverse-engineers that tile layout, fetches all tiles using your authenticated browser session, stitches them into full pages, and assembles a valid PDF — all inside the browser.

### Pipeline

```
Active tab URL
     │
     ▼
1. Detect book/newspaper ID from URL query params (?id= or ?nid=)
     │
     ▼
2. Fetch page list via Google Books JSON API (jscmd=click3)
     │
     ▼
3. For each page (up to 3 pages concurrently):
   a. Fetch per-page tile metadata (zoom levels, dimensions)
   b. Fetch all tiles in parallel (up to 8 tiles at once)
   c. Stitch tiles onto an OffscreenCanvas using the reverse-engineered
      3×3 super-block tiling sequence
   d. Export canvas as JPEG
     │
     ▼
4. Assemble all page JPEGs into a self-contained PDF 1.4 file
     │
     ▼
5. Store PDF bytes in IndexedDB (no size limit, survives popup close)
     │
     ▼
6. User clicks "Save PDF" → blob download triggers
```

### Tile Layout Algorithm

Google Books tiles are **not** in simple row-major order. They are arranged in 3 × 3 super-blocks. Within each super-block tiles are numbered sequentially (left-to-right, top-to-bottom), then the next super-block continues the sequence. `lib/tiling.js` implements this reverse-engineered algorithm so tiles are drawn onto the canvas in the correct positions.

### PDF Generation

`lib/pdf.js` is a zero-dependency PDF 1.4 writer. Each page is stored as a raw JPEG stream decoded by the PDF reader via `DCTDecode`. No re-encoding or compression library is needed.

## Project Structure

```
├── manifest.json               Chrome extension manifest (MV3)
├── background/
│   └── service-worker.js       Download orchestration, tile fetching,
│                               PDF assembly, IndexedDB persistence,
│                               icon rendering, message handling
├── popup/
│   ├── popup.html              Extension popup UI
│   ├── popup.js                UI layer — reads state, triggers download
│   └── popup.css               Popup styles
├── lib/
│   ├── tiling.js               Reverse-engineered tile sequencing algorithm
│   └── pdf.js                  Minimal PDF 1.4 generator (JPEG pages)
└── icons/
    ├── icon{16,48,128}.png     Coloured icon (active on valid pages)
    └── icon{16,48,128}_grey.png Grey icon (default / inactive)
```

## Supported Sites

| Domain | Notes |
|---|---|
| `books.google.com` | Primary domain |
| `books.google.co.in` | India |
| `books.google.co.uk` | United Kingdom |
| `books.google.de` | Germany |
| `books.google.fr` | France |
| `books.google.lu` | Luxembourg |
| `books.google.com.au` | Australia |
| `news.google.com` | Google News Archive (newspaper scans) |

## Usage

1. Navigate to a Google Books or Google News Archive newspaper page that has a book/newspaper ID in the URL (`?id=` or `?nid=`).
2. The extension icon turns green when a downloadable page is detected.
3. Click the extension icon → **Download PDF**.
4. Progress is shown in the popup. You can close and reopen the popup — the download continues in the background service worker.
5. When complete, click **Save PDF** to download the file.
6. Click **Start New** to reset and download a different book.

## Permissions

### `activeTab`

Required to read the URL of the currently active tab when the popup opens. The popup calls `chrome.tabs.query({ active: true, currentWindow: true })` to extract the book/newspaper ID and origin from the tab's URL so it knows which book to download. Without this, the extension cannot determine what page the user is on.

### `tabs`

Required to listen to `chrome.tabs.onActivated` and `chrome.tabs.onUpdated` events in the background service worker. These events are used to update the extension's toolbar icon in real time — turning it green on valid Google Books/News Archive pages and grey everywhere else. The `tabs` permission is needed because these events expose tab URLs, which are a protected piece of information in Chrome's permission model.

### `storage`

Required to persist lightweight download progress state (`chrome.storage.local`) so the popup can display accurate progress even if the user closes and reopens it mid-download. The service worker writes `{ status, completed, total, bookId, … }` to storage; the popup reads it on open and listens for live changes via `chrome.storage.onChanged`. Without this, closing the popup would lose all progress information.

### Host Permissions (`*://books.google.*/*`, `*://news.google.com/*`)

Required so the background service worker can make credentialed `fetch()` requests to Google's tile and metadata APIs (`/books/content`, `/books?jscmd=click3`). Without host permissions, the browser would block cross-origin requests from the extension. The `credentials: "include"` option is essential — Google's APIs check the user's login session to authorise access to books they are permitted to view. Requests are scoped strictly to the Google Books and Google News Archive domains; no other sites are accessed.

## Privacy

- No data leaves your browser to any third-party server. All processing happens locally.
- The extension only contacts `books.google.*` and `news.google.com` using your existing browser cookies.
- Downloaded PDF bytes are stored temporarily in the browser's own IndexedDB and deleted when you click **Start New**.

## Technical Notes

- **OffscreenCanvas** is used in the service worker for tile stitching and icon rendering — no DOM access required.
- **IndexedDB** is used for PDF storage because `chrome.storage.local` has a ~5 MB quota, which is too small for multi-page PDFs.
- Max concurrent requests: `PAGE_CONCURRENCY (3) × TILE_CONCURRENCY (8) = 24` simultaneous tile fetches.
- The extension icon is drawn programmatically via Canvas API — no separate icon PNGs needed for the dynamic coloured state.
