export interface TextMapping {
  phrase: string;
  abbreviation: string;
}

export function applyMappings(title: string, mappings: TextMapping[]): string {
  if (!mappings.length) return title;
  let result = title;
  for (const m of mappings) {
    const escaped = m.phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(escaped, 'gi'), m.abbreviation);
  }
  return result.trim();
}
