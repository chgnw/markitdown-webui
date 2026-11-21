// ZIP download, built in the browser with JSZip (classic script → window.JSZip).
import { loadScript } from './util.js';

export function todayStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_markitdown`;
}

export function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function downloadMarkdown(fileName, markdown) {
  saveBlob(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), fileName);
}

/** results: [{ fileName, markdown }] → YYYYMMDD_markitdown.zip with one folder inside. */
export async function downloadZip(results) {
  await loadScript('vendor/jszip.min.js');
  const folderName = todayStamp();
  const zip = new window.JSZip();
  const folder = zip.folder(folderName);
  for (const { fileName, markdown } of results) {
    folder.file(fileName, markdown);
  }
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  saveBlob(blob, `${folderName}.zip`);
}
