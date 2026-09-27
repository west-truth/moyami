export type MangayomiEntry = {
  id: string;
  name: string;
  lang: string;
  version: string;
  baseUrl: string;
  apiUrl?: string;
  additionalParams?: string;
  itemType: 0 | 2;
  sourceCodeUrl: string;
  format: 'mangayomi-js';
  isNsfw: boolean;
  hasCloudflare: boolean;
};

export type SourceWebViewRequest = {
  url: string;
  script: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  waitUntil?: 'load' | 'domcontentloaded';
};

export function validSourceWebViewRequest(input: unknown): input is SourceWebViewRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const row = input as Record<string, unknown>;
  return (
    Object.keys(row).every((key) => ['url', 'script', 'headers', 'timeoutMs', 'waitUntil'].includes(key)) &&
    (row.waitUntil === undefined || row.waitUntil === 'load' || row.waitUntil === 'domcontentloaded') &&
    typeof row.url === 'string' && row.url.length <= 8192 &&
    typeof row.script === 'string' && row.script.length > 0 && row.script.length <= 128 * 1024 &&
    (row.timeoutMs === undefined ||
      (Number.isInteger(row.timeoutMs) && Number(row.timeoutMs) >= 100 && Number(row.timeoutMs) <= 90000)) &&
    (row.headers === undefined || validHeaders(row.headers))
  );
}

function validHeaders(value: unknown): value is Record<string, string> {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.entries(value).length <= 32 &&
    Object.entries(value).every(([key, item]) =>
      /^[a-zA-Z0-9-]{1,80}$/.test(key) &&
      !/^(host|connection|content-length|transfer-encoding|proxy-.*)$/i.test(key) &&
      typeof item === 'string' && item.length <= 8192 && !/[\r\n]/.test(item));
}
