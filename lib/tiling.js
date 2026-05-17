/**
 * Reverse-engineered Google Books tile layout algorithm.
 *
 * Tiles are NOT in simple row-major order. They're arranged in 3×3 super-blocks:
 * process rows 3 at a time, and within each row-block process columns 3 at a time.
 * Each super-block's tiles are numbered sequentially left-to-right, top-to-bottom
 * within that block, then the next super-block picks up where the last left off.
 *
 * Example for a 4×4 grid:
 *   0  1  2  | 9
 *   3  4  5  | 10
 *   6  7  8  | 11
 *   ----------
 *  12 13 14  | 15
 */
function generateTilingSequence(numRows, numCols) {
  const output = [];
  let last = 0;
  let row = 0;

  while (row < numRows) {
    const availableRow = Math.min(3, numRows - row);
    const blockRow = Array.from({ length: availableRow }, () => []);

    let col = 0;
    while (col < numCols) {
      const availableCol = Math.min(3, numCols - col);
      for (let r = 0; r < availableRow; r++) {
        for (let c = 0; c < availableCol; c++) {
          blockRow[r].push(last + r * availableCol + c);
        }
      }
      last += availableRow * availableCol;
      col += availableCol;
    }

    for (const bRow of blockRow) {
      output.push(bRow);
    }
    row += availableRow;
  }

  return output;
}

/**
 * Extract width and height for a given zoom level from the page metadata tileres array.
 */
function getTileResolution(pageData, zoom) {
  const tileres =
    pageData.page[0].additional_info["[NewspaperJSONPageInfo]"].tileres;
  const entry = tileres.find((t) => t.z === zoom);
  if (!entry) throw new Error(`Zoom level ${zoom} not found in tile metadata`);
  return { w: entry.w, h: entry.h };
}
