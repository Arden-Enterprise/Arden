export type DiffRow = { kind: "added" | "removed" | "context" | "collapsed"; text: string; hidden?: string[] };

function linesOf(value: string): string[] {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (normalized === "") return [];
  return normalized.split("\n");
}

/** Largest changed region compared exactly; beyond it the caller falls back to manual originals. */
export const maximumDiffCells = 4_000_000;

/** Deterministic line diff. Layout-only line endings are normalized. Case and punctuation stay. Null when too large. */
export function compareLines(before: string, after: string): DiffRow[] | null {
  const left = linesOf(before);
  const right = linesOf(after);
  let start = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start += 1;
  let leftEnd = left.length;
  let rightEnd = right.length;
  while (leftEnd > start && rightEnd > start && left[leftEnd - 1] === right[rightEnd - 1]) {
    leftEnd -= 1;
    rightEnd -= 1;
  }
  const rows = (lines: string[]): DiffRow[] => lines.map((text) => ({ kind: "context", text }));
  const changed = middleRows(left.slice(start, leftEnd), right.slice(start, rightEnd));
  if (!changed) return null;
  return collapseContext([...rows(left.slice(0, start)), ...changed, ...rows(left.slice(leftEnd))]);
}

function middleRows(left: string[], right: string[]): DiffRow[] | null {
  const width = right.length + 1;
  if ((left.length + 1) * width > maximumDiffCells) return null;
  const dp = new Uint32Array((left.length + 1) * width);
  const at = (i: number, j: number) => dp[i * width + j]!;
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      dp[i * width + j] = left[i] === right[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      rows.push({ kind: "context", text: left[i]! });
      i += 1;
      j += 1;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      rows.push({ kind: "removed", text: left[i]! });
      i += 1;
    } else {
      rows.push({ kind: "added", text: right[j]! });
      j += 1;
    }
  }
  while (i < left.length) rows.push({ kind: "removed", text: left[i++]! });
  while (j < right.length) rows.push({ kind: "added", text: right[j++]! });
  return rows;
}

function collapseContext(rows: DiffRow[]): DiffRow[] {
  const result: DiffRow[] = [];
  let buffer: DiffRow[] = [];
  const flush = () => {
    if (buffer.length <= 2) result.push(...buffer);
    else {
      result.push(buffer[0]!);
      result.push({ kind: "collapsed", text: "Unchanged context", hidden: buffer.slice(1, -1).map((row) => row.text) });
      result.push(buffer[buffer.length - 1]!);
    }
    buffer = [];
  };
  for (const row of rows) {
    if (row.kind === "context") buffer.push(row);
    else {
      flush();
      result.push(row);
    }
  }
  flush();
  return result;
}
