export type PreferenceValue = string | number | boolean | string[] | null;
export type PreferenceValues = Record<string, PreferenceValue>;
export type CompatibilityPreference = {
  key: string;
  title: string;
  summary?: string;
  kind: 'boolean' | 'select' | 'multi-select' | 'text';
  secret: boolean;
  value?: PreferenceValue;
  choices?: Array<{ label: string; value: string | number }>;
};

export function preferenceSchema(raw: unknown): CompatibilityPreference[] {
  if (!Array.isArray(raw) || raw.length > 128) throw new Error('compatibility_preferences_invalid');
  const keys = new Set<string>();
  return raw.flatMap((row) => {
    if (!row || typeof row.key !== 'string' || row.key.length > 256 || keys.has(row.key))
      throw new Error('compatibility_preferences_invalid');
    keys.add(row.key);
    const input = row.editTextPreference ?? row.switchPreferenceCompat ?? row.listPreference ?? row.multiSelectListPreference;
    if (!input) return [];
    if (typeof input.title !== 'string' || input.title.length > 512)
      throw new Error('compatibility_preferences_invalid');
    const kind = row.switchPreferenceCompat ? 'boolean' : row.listPreference ? 'select' : row.multiSelectListPreference ? 'multi-select' : 'text';
    const choices = ['select', 'multi-select'].includes(kind) && Array.isArray(input.entries) && Array.isArray(input.entryValues)
      ? input.entries.slice(0, 128).map((label: unknown, index: number) => ({ label: String(label).slice(0, 512), value: input.entryValues[index] }))
      : undefined;
    if (choices?.some((choice: { value: unknown }) => !['string', 'number'].includes(typeof choice.value)))
      throw new Error('compatibility_preferences_invalid');
    const defaultValue = kind === 'multi-select' ? [...(input.values ?? [])]
      : kind === 'select' ? (input.valueIndex === undefined ? (input.value ?? choices?.[0]?.value) : choices?.[input.valueIndex]?.value)
      : input.value;
    return [{
      key: row.key,
      title: input.title,
      summary: typeof input.summary === 'string' ? input.summary.slice(0, 2000) : undefined,
      kind,
      secret: /(?:secret|password|token|access.?key|api.?key|credential|접속.?키|비밀번호)/i.test(row.key + ' ' + input.title),
      ...(['string', 'boolean', 'number'].includes(typeof defaultValue) || Array.isArray(defaultValue) ? { value: defaultValue } : {}),
      ...(choices ? { choices } : {})
    } as CompatibilityPreference];
  });
}

export function validatePreferenceState(value: unknown): asserts value is PreferenceValues {
  validatePreferences(value, 2 * 1024 * 1024, 8192, 'source_storage_limit');
}

function validatePreferences(value: unknown, maximumBytes: number, maximumKeys: number, limitError: string) {
  if (value && typeof value === 'object' && !Array.isArray(value) &&
      (Object.keys(value).length > maximumKeys || new TextEncoder().encode(JSON.stringify(value)).length > maximumBytes))
    throw new Error(limitError);
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.entries(value).some(([key, item]) =>
    key.length > 256 || ['__proto__', 'constructor', 'prototype'].includes(key) ||
    (item !== null && !['string', 'number', 'boolean'].includes(typeof item) &&
      !(Array.isArray(item) && item.length <= 128 &&
        item.every((part) => typeof part === 'string' && part.length <= 2048) && new Set(item).size === item.length)) ||
    (typeof item === 'number' && !Number.isFinite(item))))
    throw new Error('compatibility_preferences_invalid');
}
