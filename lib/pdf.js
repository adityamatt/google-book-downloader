/**
 * Minimal PDF generator that embeds JPEG images as pages.
 * No external dependencies. Produces a valid PDF 1.4 file.
 *
 * Object layout per page (3 objects each):
 *   pageObjNum    = 3 + i*3   → Page dictionary
 *   imgObjNum     = 4 + i*3   → Image XObject (raw JPEG via DCTDecode)
 *   contentObjNum = 5 + i*3   → Content stream (draws the image)
 * Plus objects 1 (Catalog) and 2 (Pages collection).
 */
class SimplePDF {
  constructor() {
    this.pages = []; // { jpegBytes: Uint8Array, width: number, height: number }
  }

  addPage(jpegBytes, width, height) {
    this.pages.push({ jpegBytes, width, height });
  }

  generate() {
    const enc = new TextEncoder();
    const parts = [];
    let offset = 0;
    const objOffsets = {};

    const write = (str) => {
      const bytes = enc.encode(str);
      parts.push(bytes);
      offset += bytes.length;
    };

    const writeBytes = (bytes) => {
      parts.push(bytes);
      offset += bytes.length;
    };

    const markObj = (num) => {
      objOffsets[num] = offset;
    };

    // PDF header + binary-content marker (4 high bytes signals binary file)
    write("%PDF-1.4\n");
    writeBytes(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

    const n = this.pages.length;

    // Object 1: Document catalog
    markObj(1);
    write("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

    // Object 2: Pages collection
    const pageRefs = Array.from({ length: n }, (_, i) => `${3 + i * 3} 0 R`).join(" ");
    markObj(2);
    write(`2 0 obj\n<< /Type /Pages /Kids [${pageRefs}] /Count ${n} >>\nendobj\n`);

    for (let i = 0; i < n; i++) {
      const { jpegBytes, width, height } = this.pages[i];
      const pageObjNum = 3 + i * 3;
      const imgObjNum = 4 + i * 3;
      const contentObjNum = 5 + i * 3;

      // Content stream: scale image to fill the page
      const contentStr = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q\n`;

      markObj(contentObjNum);
      write(
        `${contentObjNum} 0 obj\n<< /Length ${contentStr.length} >>\nstream\n${contentStr}endstream\nendobj\n`
      );

      // Image XObject: raw JPEG bytes decoded by the PDF reader via DCTDecode
      markObj(imgObjNum);
      write(
        `${imgObjNum} 0 obj\n` +
          `<< /Type /XObject /Subtype /Image` +
          ` /Width ${width} /Height ${height}` +
          ` /ColorSpace /DeviceRGB /BitsPerComponent 8` +
          ` /Filter /DCTDecode /Length ${jpegBytes.length} >>\n` +
          `stream\n`
      );
      writeBytes(jpegBytes);
      write(`\nendstream\nendobj\n`);

      // Page dictionary
      markObj(pageObjNum);
      write(
        `${pageObjNum} 0 obj\n` +
          `<< /Type /Page /Parent 2 0 R` +
          ` /MediaBox [0 0 ${width} ${height}]` +
          ` /Resources << /XObject << /Im0 ${imgObjNum} 0 R >> >>` +
          ` /Contents ${contentObjNum} 0 R >>\n` +
          `endobj\n`
      );
    }

    // Cross-reference table
    const totalObjs = 2 + 3 * n;
    const xrefOffset = offset;
    write(`xref\n0 ${totalObjs + 1}\n`);
    write(`0000000000 65535 f \n`);
    for (let i = 1; i <= totalObjs; i++) {
      write(`${String(objOffsets[i] ?? 0).padStart(10, "0")} 00000 n \n`);
    }

    write(`trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

    // Concatenate all parts into a single Uint8Array
    const totalLen = parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(totalLen);
    let pos = 0;
    for (const p of parts) {
      out.set(p, pos);
      pos += p.length;
    }
    return out;
  }
}
