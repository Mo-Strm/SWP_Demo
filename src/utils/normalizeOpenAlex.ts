import type {
  OpenAlexAuthor,
  OpenAlexInstitution,
} from "../services/openalex";
import type { Researcher } from "../types/researcher";

function jitter(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return ((hash % 1000) / 1000) * 0.15 - 0.075;
}

export function normalizeResearchers(
  authors: OpenAlexAuthor[],
  institutions: Map<string, OpenAlexInstitution>
): Researcher[] {
  const result: Researcher[] = [];

  for (const author of authors) {
    const candidateInstitutions =
      author.last_known_institutions ??
      (author.last_known_institution ? [author.last_known_institution] : []);

    const inst = candidateInstitutions.find((i) => institutions.has(i.id));
    if (!inst) continue;

    const fullInst = institutions.get(inst.id);
    const lat = fullInst?.geo?.latitude;
    const lon = fullInst?.geo?.longitude;
    if (typeof lat !== "number" || typeof lon !== "number") continue;

    const topics = (author.x_concepts ?? [])
      .filter((c) => c.score >= 20)
      .slice(0, 5)
      .map((c) => c.display_name);

    result.push({
      id: author.id,
      name: author.display_name,
      institution: fullInst?.display_name ?? inst.display_name,
      country: fullInst?.geo?.country ?? inst.country_code,
      lat: lat + jitter(author.id),
      lon: lon + jitter(author.id + "_lon"),
      worksCount: author.works_count ?? 0,
      citedByCount: author.cited_by_count ?? 0,
      hIndex: author.summary_stats?.h_index,
      topics,
      openalexUrl: author.id,
      homepage: fullInst?.homepage_url,
      orcid: author.orcid ?? author.ids?.orcid ?? undefined,
    });
  }

  return result;
}
