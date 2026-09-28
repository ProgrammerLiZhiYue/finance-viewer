import { useEffect, useState } from 'react';
import type { SearchResultItem } from '../types';

const DEBOUNCE_MS = 300;

export function useDebouncedSearch(
  query: string,
  filter?: (items: SearchResultItem[]) => SearchResultItem[],
) {
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const found = await window.electronAPI.search(trimmed);
        setResults(filter ? filter(found) : found);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  return { results, searching };
}
