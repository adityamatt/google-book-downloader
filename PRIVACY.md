# Privacy Policy

**Extension:** Google Books Downloader  
**Last updated:** 2026-05-17

---

## Summary

Google Books Downloader does not collect, transmit, or share any personal data. All processing happens entirely inside your browser. No information ever leaves your device to any server operated by this extension.

---

## What the Extension Does

Google Books Downloader reads the URL of the Google Books or Google News Archive page you are viewing, fetches page tile images from Google's servers using your existing browser session, assembles those images into a PDF, and saves the PDF file to your device.

## Data the Extension Accesses

| Data | Purpose | Shared with third parties? |
|---|---|---|
| Active tab URL | Detect the book/newspaper ID to download | No |
| Tab URL change events | Update the toolbar icon in real time | No |
| Google Books tile images | Assemble the PDF pages | No |
| Download progress state | Show progress in the popup across opens/closes | No |
| Assembled PDF bytes | Allow you to save the file | No |

## Data Storage

- **`chrome.storage.local`** — Stores lightweight download progress (status, page count, book ID). This data never leaves your browser and is deleted when you click **Start New** or uninstall the extension.
- **IndexedDB (`gbdl` database)** — Stores the assembled PDF bytes temporarily so you can save the file. This data is stored only in your browser's local database, is never transmitted anywhere, and is deleted when you click **Start New**.

No data is written to any remote server, cloud service, or analytics platform by this extension.

## Network Requests

The extension makes network requests exclusively to Google's own domains (`books.google.*` and `news.google.com`) to fetch page metadata and tile images. These requests are made using your existing browser cookies — the same credentials your browser already uses when you view those pages normally. The extension does not create accounts, send credentials to any other party, or intercept traffic.

## Permissions and Why They Are Needed

| Permission | Why it is needed |
|---|---|
| `activeTab` | Read the current tab's URL to identify which book to download |
| `tabs` | Listen for tab navigation events to update the toolbar icon |
| `storage` | Persist download progress so it survives closing and reopening the popup |
| Host access to `books.google.*` and `news.google.com` | Fetch tile images and page metadata directly from Google using your session |

No permission is used for any purpose beyond what is described above.

## Data We Do Not Collect

- No personal information (name, email, account details)
- No browsing history beyond the current active tab URL
- No analytics or usage telemetry
- No crash reports sent to external services
- No advertising identifiers

## Third Parties

This extension does not integrate with any third-party analytics, advertising, or data-collection services. The only external network contact is with Google's own servers, which you are already communicating with by visiting Google Books.

## Children's Privacy

This extension does not knowingly collect any data from anyone, including children under the age of 13.

## Changes to This Policy

If this policy is updated, the **Last updated** date at the top of this document will reflect the change. Continued use of the extension after any change constitutes acceptance of the updated policy.

## Contact

If you have questions about this privacy policy, please open an issue in the project's GitHub repository.
