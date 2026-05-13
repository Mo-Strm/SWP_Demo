import type { Researcher } from "../types/researcher";

const CACHE_KEY = "ai-researcher-radar:researchers:v1";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CachePayload {
  version: 1;
  savedAt: number;
  researchers: Researcher[];
}

export interface ResearcherCacheEntry {
  researchers: Researcher[];
  savedAt: number;
}

export function loadResearcherCache(): ResearcherCacheEntry | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachePayload;
    if (parsed.version !== 1) return null;
    if (!Array.isArray(parsed.researchers)) return null;
    if (typeof parsed.savedAt !== "number") return null;
    if (Date.now() - parsed.savedAt > CACHE_TTL_MS) return null;
    return { researchers: parsed.researchers, savedAt: parsed.savedAt };
  } catch {
    return null;
  }
}

export function saveResearcherCache(researchers: Researcher[]): number | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const savedAt = Date.now();
    const payload: CachePayload = {
      version: 1,
      savedAt,
      researchers,
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    return savedAt;
  } catch {
    return null;
  }
}

export function clearResearcherCache(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignorieren */
  }
}

export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const diff = Math.max(0, now - timestamp);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "gerade eben";
  const min = Math.floor(sec / 60);
  if (min < 60) return `vor ${min} Min`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `vor ${hours} h`;
  const days = Math.floor(hours / 24);
  return `vor ${days} Tag${days === 1 ? "" : "en"}`;
}
