export type DiffRow = { kind: "added" | "removed" | "context" | "collapsed"; text: string; hidden?: string[] };

function linesOf(value: string): string[] {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (normalized === "") return [];
  return normalized.split("\n");
}

/** Deterministic line diff. Layout-only line endings are normalized. Case and punctuation stay. */
export function compareLines(before: string, after: string): DiffRow[] {
  const left = linesOf(before);
  const right = linesOf(after);
  const dp = Array.from({ length: left.length + 1 }, () => new Array<number>(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      dp[i]![j] = left[i] === right[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
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
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      rows.push({ kind: "removed", text: left[i]! });
      i += 1;
    } else {
      rows.push({ kind: "added", text: right[j]! });
      j += 1;
    }
  }
  while (i < left.length) rows.push({ kind: "removed", text: left[i++]! });
  while (j < right.length) rows.push({ kind: "added", text: right[j++]! });
  return collapseContext(rows);
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
