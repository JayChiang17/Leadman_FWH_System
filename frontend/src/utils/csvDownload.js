/**
 * Shared CSV download utility.
 * Escapes cells and triggers a browser download with BOM for Excel.
 */

export function csvEscape(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function downloadCSV(rows, filename) {
  const bom = "\uFEFF";
  const csv = rows
    .map((r) => r.map(csvEscape).join(","))
    .join("\n");
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
