import { compatibilityHttp } from '../network/http.js';
import type { MangayomiEntry } from '../contracts.js';

export type CatalogResult = { repositoryUrl: string; sources: MangayomiEntry[]; skipped: number };

export function parseMangayomiIndex(input: unknown, repositoryUrl: string): Omit<CatalogResult, 'repositoryUrl'> {
  if (!Array.isArray(input) || input.length > 10000) throw new Error('compatibility_repository_invalid');
  let skipped = 0;
  const ids = new Set<string>();
  const sources: MangayomiEntry[] = [];
  for (const row of input) {
    try {
      if (!row || typeof row !== 'object') throw new Error();
      const item = row as Record<string, unknown>;
      if (typeof item.id === 'number' && !Number.isSafeInteger(item.id)) throw new Error();
      const id = String(item.id);
      if (!/^\d{1,19}$/.test(id) || ids.has(id) || item.sourceCodeLanguage !== 1 ||
          ![undefined, 0, 2].includes(item.itemType as 0 | 2 | undefined) ||
          (item.itemType !== 2 && item.isManga === false)) throw new Error();
      const strings = ['name', 'lang', 'version', 'baseUrl', 'sourceCodeUrl'] as const;
      if (strings.some((key) => typeof item[key] !== 'string' || !(item[key] as string).length || (item[key] as string).length > 2048)) throw new Error();
      const code = new URL(item.sourceCodeUrl as string, repositoryUrl);
      const site = new URL(item.baseUrl as string);
      if (code.protocol !== 'https:' || code.username || code.password || code.hash ||
          !['https:', 'http:'].includes(site.protocol) || site.username || site.password) throw new Error();
      if (item.additionalParams !== undefined && (typeof item.additionalParams !== 'string' || item.additionalParams.length > 16384)) throw new Error();
      ids.add(id);
      sources.push({
        id, name: item.name as string, lang: item.lang as string, version: item.version as string,
        baseUrl: site.href.replace(/\/$/, ''), itemType: item.itemType === 2 ? 2 : 0,
        sourceCodeUrl: code.href, format: 'mangayomi-js', isNsfw: item.isNsfw === true,
        hasCloudflare: item.hasCloudflare === true,
        ...(typeof item.apiUrl === 'string' ? { apiUrl: item.apiUrl } : {}),
        ...(typeof item.additionalParams === 'string' ? { additionalParams: item.additionalParams } : {})
      });
    } catch { skipped++; }
  }
  if (!sources.length) throw new Error('compatibility_repository_mismatch');
  return { sources, skipped };
}

export class CatalogService {
  private cache = new Map<string, { expiresAt: number; result: CatalogResult }>();
  constructor(private readonly outboundProxy?: string) {}

  normalize(value: unknown) {
    const raw = value;
    if (typeof raw !== 'string' || raw.length > 2048) throw new Error('compatibility_repository_invalid');
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search)
      throw new Error('compatibility_repository_invalid');
    if (!url.pathname.endsWith('.json')) url.pathname = url.pathname.replace(/\/$/, '') + '/index.min.json';
    return url.href;
  }

  async read(value?: unknown, signal = new AbortController().signal): Promise<CatalogResult> {
    const repositoryUrl = this.normalize(value);
    const cached = this.cache.get(repositoryUrl);
    if (cached && cached.expiresAt > Date.now()) return cached.result;
    const response = await compatibilityHttp({ url: repositoryUrl }, signal, [], 2 * 1024 * 1024, this.outboundProxy);
    if (response.statusCode !== 200) throw new Error('compatibility_repository_unavailable');
    let input: unknown;
    try { input = JSON.parse(new TextDecoder().decode(response.bytes)); }
    catch { throw new Error('compatibility_repository_invalid'); }
    const result = { repositoryUrl, ...parseMangayomiIndex(input, repositoryUrl) };
    if (!this.cache.has(repositoryUrl) && this.cache.size >= 20) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(repositoryUrl, { expiresAt: Date.now() + 10 * 60_000, result });
    return result;
  }

  async resolve(repositoryUrl: unknown, sourceId: unknown, signal: AbortSignal) {
    const catalog = await this.read(repositoryUrl, signal);
    const id = String(sourceId);
    const entry = catalog.sources.find((source) => source.id === id);
    if (!entry) throw new Error('compatibility_source_not_found');
    return { entry, repositoryUrl: catalog.repositoryUrl };
  }
}
