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

/** Kurzliste von Werken mit OpenAlex-Thema „Computer science“ für ein Autorenprofil. */
export interface CsWorkSummary {
  id: string;
  title: string;
}

export interface CsWorksPage {
  results: CsWorkSummary[];
  total: number;
  page: number;
  perPage: number;
}

interface OpenAlexWork {
  id: string;
  display_name: string | null;
}

/** Entfernt HTML-Tags und Entitäten, die OpenAlex gelegentlich in Titeln liefert. */
function cleanTitle(raw: string | null | undefined): string {
  if (!raw) return "Ohne Titel";
  const stripped = raw
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length > 0 ? stripped : "Ohne Titel";
}

/**
 * Lädt eine Seite der nach Zitationen sortierten Werke eines Autors,
 * die in OpenAlex dem Konzept „Computer science“ zugeordnet sind.
 *
 * Pages werden in einem einfachen In-Memory-LRU-Cache gehalten, sodass
 * wiederholtes Klicken auf denselben Forscher (oder Blättern nach vorne
 * und zurück) ohne erneute Netzwerk-Anfrage funktioniert.
 */
const csWorksCache = new Map<string, CsWorksPage>();
const CS_WORKS_CACHE_LIMIT = 200;

function csWorksCacheKey(authorId: string, page: number, perPage: number) {
  return `${authorId}|p${page}|pp${perPage}`;
}

export async function fetchCsWorksForAuthor(
  authorOpenAlexId: string,
  options: { page?: number; perPage?: number } = {}
): Promise<CsWorksPage> {
  const page = Math.max(1, options.page ?? 1);
  const perPage = Math.min(Math.max(1, options.perPage ?? 10), 200);
  const key = csWorksCacheKey(authorOpenAlexId, page, perPage);

  const cached = csWorksCache.get(key);
  if (cached) {
    csWorksCache.delete(key);
    csWorksCache.set(key, cached);
    return cached;
  }

  const filter = `authorships.author.id:${authorOpenAlexId},concepts.id:C41008148`;
  const url =
    `${OPENALEX_BASE}/works` +
    `?filter=${encodeURIComponent(filter)}` +
    `&sort=cited_by_count:desc` +
    `&per_page=${perPage}` +
    `&page=${page}`;
  const data = await fetchJson<OpenAlexListResponse<OpenAlexWork>>(url);
  const results = (data.results ?? []).map((w) => ({
    id: w.id,
    title: cleanTitle(w.display_name),
  }));
  const value: CsWorksPage = {
    results,
    total: data.meta?.count ?? results.length,
    page,
    perPage,
  };

  csWorksCache.set(key, value);
  if (csWorksCache.size > CS_WORKS_CACHE_LIMIT) {
    const oldest = csWorksCache.keys().next().value;
    if (oldest) csWorksCache.delete(oldest);
  }
  return value;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Co-Author-Graph (CS-only, capped)
 *
 * Ziel: Aus der bereits geladenen Forschermenge einen Kollaborations-Graphen
 * aufbauen, ohne die Forschermenge neu zu laden. Pro Forscher werden
 * seitenweise dessen CS-Werke geladen (nur das Feld `authorships`), Kanten
 * entstehen zwischen Co-Autoren, die ebenfalls in der geladenen Menge sind.
 * ────────────────────────────────────────────────────────────────────────── */

export interface CoauthorEdge {
  /** Lexikographisch kleinere OpenAlex-Autor-URL. */
  source: string;
  /** Lexikographisch größere OpenAlex-Autor-URL. */
  target: string;
  /** Anzahl gemeinsamer (CS-)Werke. */
  weight: number;
}

export interface CoauthorGraphProgress {
  processedAuthors: number;
  totalAuthors: number;
  totalEdges: number;
  done: boolean;
}

export interface CoauthorStreamOptions {
  /** Bereits geladene Forscher (Knoten). */
  researchers: Pick<Researcher, "id">[];
  /** Wird vor jedem Schritt geprüft; wenn true, bricht der Stream sauber ab. */
  isCancelled?: () => boolean;
  /** Inkrementelle neue (oder aktualisierte) Kanten. */
  onBatch: (edges: CoauthorEdge[], progress: CoauthorGraphProgress) => void;
  /** Wird einmal am Ende oder bei Abbruch aufgerufen. */
  onDone?: (progress: CoauthorGraphProgress) => void;
  /** Maximale Anzahl Werk-Seiten (à 200) pro Autor. Standard: 3. */
  maxWorksPagesPerAuthor?: number;
  /** Maximale Anzahl paralleler Author-Verarbeitungen. Standard: 4. */
  concurrency?: number;
}

interface OpenAlexWorkWithAuthors {
  id: string;
  authorships?: Array<{ author?: { id?: string } } | null> | null;
}

/** In-Memory-Cache: pro Autor → Map<CoautorenId, Gewicht>. */
const coauthorCache = new Map<string, Map<string, number>>();
const COAUTHOR_CACHE_LIMIT = 2000;

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Lädt für einen einzelnen Forscher den Ego-Graph: Kanten zu seinen
 * Co-Autoren, optional gefiltert auf eine bekannte Knotenmenge (z. B. die
 * geladenen Forscher) und mit Schwellenwert/Limits zur Lesbarkeit.
 */
export async function fetchEgoEdgesForAuthor(
  centerId: string,
  options: {
    knownNodeIds?: Set<string>;
    maxPages?: number;
    minWeight?: number;
    maxNeighbors?: number;
  } = {}
): Promise<CoauthorEdge[]> {
  const maxPages = Math.max(1, options.maxPages ?? 3);
  const minWeight = Math.max(1, options.minWeight ?? 1);
  const maxNeighbors = Math.max(1, options.maxNeighbors ?? 30);
  const known = options.knownNodeIds;

  const counts = await fetchCoauthorsForAuthor(centerId, maxPages);

  const filtered: Array<[string, number]> = [];
  for (const [coId, weight] of counts) {
    if (weight < minWeight) continue;
    if (known && !known.has(coId)) continue;
    filtered.push([coId, weight]);
  }
  filtered.sort((a, b) => b[1] - a[1]);
  const top = filtered.slice(0, maxNeighbors);

  return top.map(([coId, weight]) => ({
    source: centerId < coId ? centerId : coId,
    target: centerId < coId ? coId : centerId,
    weight,
  }));
}

/**
 * Lädt für einen Autor alle (gecappten) Co-Autoren-IDs mit Häufigkeit
 * gemeinsamer CS-Werke. Ergebnis wird im Modul-Cache abgelegt.
 */
async function fetchCoauthorsForAuthor(
  authorId: string,
  maxPages: number
): Promise<Map<string, number>> {
  const cached = coauthorCache.get(authorId);
  if (cached) {
    coauthorCache.delete(authorId);
    coauthorCache.set(authorId, cached);
    return cached;
  }

  const counts = new Map<string, number>();
  const filter = `authorships.author.id:${authorId},concepts.id:C41008148`;
  const perPage = 200;

  for (let page = 1; page <= maxPages; page++) {
    const url =
      `${OPENALEX_BASE}/works` +
      `?filter=${encodeURIComponent(filter)}` +
      `&select=id,authorships` +
      `&per_page=${perPage}` +
      `&page=${page}`;
    let data: OpenAlexListResponse<OpenAlexWorkWithAuthors>;
    try {
      data = await fetchJson<OpenAlexListResponse<OpenAlexWorkWithAuthors>>(url);
    } catch {
      break;
    }
    if (!data.results || data.results.length === 0) break;

    for (const work of data.results) {
      const authorships = work.authorships ?? [];
      for (const a of authorships) {
        const coId = a?.author?.id;
        if (!coId || coId === authorId) continue;
        counts.set(coId, (counts.get(coId) ?? 0) + 1);
      }
    }

    if (data.results.length < perPage) break;
  }

  coauthorCache.set(authorId, counts);
  if (coauthorCache.size > COAUTHOR_CACHE_LIMIT) {
    const oldest = coauthorCache.keys().next().value;
    if (oldest) coauthorCache.delete(oldest);
  }
  return counts;
}

/**
 * Streamt Kanten des Co-Author-Graphen für die übergebene Forschermenge.
 * Es werden nur Kanten zwischen Forschern erzeugt, die ebenfalls in der
 * Menge enthalten sind (Schnittmenge).
 */
export async function streamCoauthorEdges(
  opts: CoauthorStreamOptions
): Promise<void> {
  const isCancelled = opts.isCancelled ?? (() => false);
  const maxPages = Math.max(1, opts.maxWorksPagesPerAuthor ?? 3);
  const concurrency = Math.max(1, Math.min(8, opts.concurrency ?? 4));

  const nodeIds = new Set(opts.researchers.map((r) => r.id));
  const edgeWeights = new Map<string, CoauthorEdge>();

  const queue = [...opts.researchers].map((r) => r.id);
  let processed = 0;
  const totalAuthors = queue.length;

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      if (isCancelled()) return;
      const authorId = queue.shift();
      if (!authorId) return;

      const counts = await fetchCoauthorsForAuthor(authorId, maxPages);
      processed++;

      if (isCancelled()) return;

      const newOrUpdated: CoauthorEdge[] = [];
      for (const [coId, weight] of counts) {
        if (!nodeIds.has(coId)) continue;
        const key = edgeKey(authorId, coId);
        const existing = edgeWeights.get(key);
        if (existing) {
          if (existing.weight < weight) {
            existing.weight = weight;
            newOrUpdated.push(existing);
          }
          continue;
        }
        const edge: CoauthorEdge = {
          source: authorId < coId ? authorId : coId,
          target: authorId < coId ? coId : authorId,
          weight,
        };
        edgeWeights.set(key, edge);
        newOrUpdated.push(edge);
      }

      opts.onBatch(newOrUpdated, {
        processedAuthors: processed,
        totalAuthors,
        totalEdges: edgeWeights.size,
        done: false,
      });
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) workers.push(worker());
  await Promise.all(workers);

  opts.onDone?.({
    processedAuthors: processed,
    totalAuthors,
    totalEdges: edgeWeights.size,
    done: true,
  });
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
  /** Genug Seiten, um viele CS-Kandidaten aus der globalen Zitationsliste zu sammeln. */
  const maxPages = 120;
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
  /** Genug Seiten, um z. B. 1000 CS-Kandidaten aus der globalen Zitationsliste zu sammeln. */
  const maxPages = 120;
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
