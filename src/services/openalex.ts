import type { Researcher } from "../types/researcher";
import { normalizeResearchers } from "../utils/normalizeOpenAlex";

const OPENALEX_BASE = "https://api.openalex.org";

const POLITE_MAILTO = "ai-researcher-radar-prototype@example.com";

/** OpenAlex „Computer science“ – in `x_concepts` oft als Kurz-ID `41008148`, in URLs `C41008148`. */
const COMPUTER_SCIENCE_CONCEPT_IDS = new Set([
  "41008148",
  "C41008148",
  "https://openalex.org/C41008148",
]);

function authorHasComputerScienceConcept(author: OpenAlexAuthor): boolean {
  for (const c of author.x_concepts ?? []) {
    const id = String(c.id);
    if (COMPUTER_SCIENCE_CONCEPT_IDS.has(id)) return true;
    if (id.endsWith("C41008148")) return true;
  }
  return false;
}

export interface OpenAlexAuthor {
  id: string;
  display_name: string;
  orcid?: string | null;
  works_count?: number;
  cited_by_count?: number;
  summary_stats?: {
    h_index?: number;
    i10_index?: number;
  };
  last_known_institutions?: Array<{
    id: string;
    display_name: string;
    country_code?: string;
  }> | null;
  last_known_institution?: {
    id: string;
    display_name: string;
    country_code?: string;
  } | null;
  x_concepts?: Array<{
    id: string;
    display_name: string;
    score: number;
  }>;
  ids?: {
    openalex?: string;
    orcid?: string;
  };
}

export interface OpenAlexInstitution {
  id: string;
  display_name: string;
  country_code?: string;
  homepage_url?: string;
  geo?: {
    latitude?: number;
    longitude?: number;
    city?: string;
    country?: string;
  };
}

interface OpenAlexListResponse<T> {
  results: T[];
  meta?: {
    count: number;
    page: number;
    per_page: number;
  };
}

function withPolitePool(url: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}mailto=${encodeURIComponent(POLITE_MAILTO)}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(withPolitePool(url));
  if (!response.ok) {
    throw new Error(
      `OpenAlex API Fehler (${response.status} ${response.statusText}) bei ${url}`
    );
  }
  return (await response.json()) as T;
}

export async function fetchTopCsAuthors(
  limit = 50
): Promise<OpenAlexAuthor[]> {
  /**
   * Für `/authors` ist ein zuverlässiger `filter=concepts.id:…`-Treffer in der Praxis
   * eingeschränkt. Daher: global nach Zitationen sortieren, mehrere Seiten laden und
   * clientseitig an `x_concepts` auf „Computer science“ filtern.
   */
  const collected: OpenAlexAuthor[] = [];
  const perPage = 200;
  /** Genug Seiten, um z. B. 500 CS-Autoren aus der globalen Zitationsliste zu sammeln. */
  const maxPages = 80;
  let page = 1;

  while (collected.length < limit && page <= maxPages) {
    const url =
      `${OPENALEX_BASE}/authors` +
      `?sort=cited_by_count:desc` +
      `&per_page=${perPage}` +
      `&page=${page}`;
    const data = await fetchJson<OpenAlexListResponse<OpenAlexAuthor>>(url);
    if (!data.results.length) break;

    for (const author of data.results) {
      if (!authorHasComputerScienceConcept(author)) continue;
      collected.push(author);
      if (collected.length >= limit) break;
    }
    page++;
  }

  return collected.slice(0, limit);
}

export async function fetchInstitutionsByIds(
  institutionIds: string[]
): Promise<Map<string, OpenAlexInstitution>> {
  const result = new Map<string, OpenAlexInstitution>();
  if (institutionIds.length === 0) return result;

  /** Institution-IDs sind `https://openalex.org/I…`, nicht unter api.openalex.org. */
  const shortIds = institutionIds.map((id) =>
    id.replace(/^https:\/\/api\.openalex\.org\//, "").replace(/^https:\/\/openalex\.org\//, "")
  );
  const chunkSize = 40;
  for (let i = 0; i < shortIds.length; i += chunkSize) {
    const chunk = shortIds.slice(i, i + chunkSize);
    const filter = `ids.openalex:${chunk.join("|")}`;
    const url =
      `${OPENALEX_BASE}/institutions` +
      `?filter=${filter}` +
      `&per_page=${chunkSize}`;
    const data = await fetchJson<OpenAlexListResponse<OpenAlexInstitution>>(url);
    for (const inst of data.results) {
      result.set(inst.id, inst);
    }
  }
  return result;
}

export interface StreamProgress {
  /** Anzahl bisher emittierter Forschender (kumuliert). */
  loaded: number;
  /** Anzahl bereits inspizierter OpenAlex-Autoren (kumuliert). */
  inspected: number;
  /** Aktuelle OpenAlex-Authors-Seite (1-basiert). */
  page: number;
  /** Wahr, sobald keine weiteren Seiten/Autoren mehr verarbeitet werden. */
  done: boolean;
}

export interface StreamOptions {
  /** Obere Schranke für Forschende auf der Karte. */
  limit: number;
  /** Wird vor jedem Schritt geprüft; wenn true, bricht der Stream sauber ab. */
  isCancelled?: () => boolean;
  /** Pro OpenAlex-Authors-Seite ein Batch frisch georeferenzierter Forschender. */
  onBatch: (batch: Researcher[], progress: StreamProgress) => void;
  /** Wird einmal am Ende oder bei Abbruch aufgerufen. */
  onDone?: (progress: StreamProgress) => void;
}

/**
 * Lädt Forschende inkrementell: pro Authors-Seite werden direkt die Institutionen
 * der CS-Autoren geholt, normalisiert und über `onBatch` ausgeliefert. Dadurch
 * erscheinen Marker auf der Karte, während weitere Seiten im Hintergrund laden.
 */
export async function streamResearchers(opts: StreamOptions): Promise<void> {
  const { limit, onBatch, onDone } = opts;
  const isCancelled = opts.isCancelled ?? (() => false);

  const perPage = 200;
  const maxPages = 80;
  const seenKey = new Set<string>();

  let page = 1;
  let loaded = 0;
  let inspected = 0;

  while (loaded < limit && page <= maxPages) {
    if (isCancelled()) break;

    const authorsUrl =
      `${OPENALEX_BASE}/authors` +
      `?sort=cited_by_count:desc` +
      `&per_page=${perPage}` +
      `&page=${page}`;
    const authorsPage = await fetchJson<OpenAlexListResponse<OpenAlexAuthor>>(
      authorsUrl
    );
    if (!authorsPage.results.length) break;

    const csAuthors: OpenAlexAuthor[] = [];
    for (const author of authorsPage.results) {
      inspected++;
      if (authorHasComputerScienceConcept(author)) csAuthors.push(author);
    }

    if (csAuthors.length === 0) {
      page++;
      onBatch([], { loaded, inspected, page, done: false });
      continue;
    }

    const institutionIds = new Set<string>();
    for (const author of csAuthors) {
      const insts =
        author.last_known_institutions ??
        (author.last_known_institution ? [author.last_known_institution] : []);
      for (const inst of insts) {
        if (inst?.id) institutionIds.add(inst.id);
      }
    }

    if (isCancelled()) break;

    const institutions = await fetchInstitutionsByIds(
      Array.from(institutionIds)
    );

    const normalized = normalizeResearchers(csAuthors, institutions);

    const batch: Researcher[] = [];
    for (const r of normalized) {
      const key = `${r.name.toLowerCase().trim()}|${r.institution
        .toLowerCase()
        .trim()}`;
      if (seenKey.has(key)) continue;
      seenKey.add(key);
      batch.push(r);
      if (loaded + batch.length >= limit) break;
    }

    loaded += batch.length;
    onBatch(batch, { loaded, inspected, page, done: false });

    page++;
  }

  onDone?.({ loaded, inspected, page, done: true });
}
