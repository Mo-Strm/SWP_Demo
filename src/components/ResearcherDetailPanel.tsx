import { useEffect, useState } from "react";
import type { CsWorkSummary } from "../services/openalex";
import { fetchCsWorksForAuthor } from "../services/openalex";
import type { Researcher } from "../types/researcher";

interface Props {
  researcher: Researcher | null;
  viewMode: "map" | "graph";
  onClose: () => void;
  onOpenGraph: () => void;
}

const PAPERS_PER_PAGE = 10;

function formatNumber(value: number): string {
  return new Intl.NumberFormat("de-DE").format(value);
}

export function ResearcherDetailPanel({
  researcher,
  viewMode,
  onClose,
  onOpenGraph,
}: Props) {
  const [csWorks, setCsWorks] = useState<CsWorkSummary[]>([]);
  const [worksState, setWorksState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [page, setPage] = useState(1);
  const [totalWorks, setTotalWorks] = useState(0);

  useEffect(() => {
    setPage(1);
  }, [researcher?.id]);

  useEffect(() => {
    if (!researcher) {
      setCsWorks([]);
      setWorksState("idle");
      setTotalWorks(0);
      return;
    }

    let cancelled = false;
    setWorksState("loading");

    void fetchCsWorksForAuthor(researcher.id, {
      page,
      perPage: PAPERS_PER_PAGE,
    })
      .then((res) => {
        if (cancelled) return;
        setCsWorks(res.results);
        setTotalWorks(res.total);
        setWorksState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setCsWorks([]);
        setWorksState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [researcher?.id, page]);

  const totalPages =
    totalWorks > 0 ? Math.ceil(totalWorks / PAPERS_PER_PAGE) : 0;
  const hasPrev = page > 1;
  const hasNext = page < totalPages;
  const firstIndex = (page - 1) * PAPERS_PER_PAGE;

  if (!researcher) return null;

  return (
    <aside className="detail-panel">
      <button
        type="button"
        className="detail-panel__close"
        onClick={onClose}
        aria-label="Detailansicht schließen"
        title="Detailansicht schließen"
      >
        ×
      </button>
      <h2>{researcher.name}</h2>
      <p>{researcher.institution}</p>
      {researcher.country && <p style={{ color: "#94a3b8" }}>{researcher.country}</p>}

      <button
        type="button"
        className="open-graph-btn"
        onClick={onOpenGraph}
        title="Kollaborations-Graph dieses Forschers anzeigen"
      >
        {viewMode === "graph"
          ? "Diesen Forscher im Graph fokussieren"
          : "Co-Author-Graph öffnen"}
      </button>

      <h3>Kennzahlen</h3>
      <div className="metric-grid">
        <div className="metric">
          <div className="label">Publikationen</div>
          <div className="value">{formatNumber(researcher.worksCount)}</div>
        </div>
        <div className="metric">
          <div className="label">Zitationen</div>
          <div className="value">{formatNumber(researcher.citedByCount)}</div>
        </div>
        {typeof researcher.hIndex === "number" && (
          <div className="metric">
            <div className="label">h-Index</div>
            <div className="value">{researcher.hIndex}</div>
          </div>
        )}
      </div>

      {researcher.topics.length > 0 && (
        <>
          <h3>Forschungsthemen</h3>
          <ul>
            {researcher.topics.map((topic) => (
              <li key={topic}>{topic}</li>
            ))}
          </ul>
        </>
      )}

      <h3>
        Publikationen (Computer Science)
        {totalWorks > 0 && (
          <span className="papers-count"> · {formatNumber(totalWorks)}</span>
        )}
      </h3>
      {worksState === "loading" && csWorks.length === 0 && (
        <p className="papers-hint">Lade passende Paper von OpenAlex…</p>
      )}
      {worksState === "error" && (
        <p className="papers-hint papers-hint--error">
          Paper konnten nicht geladen werden.
        </p>
      )}
      {worksState === "ready" && csWorks.length === 0 && (
        <p className="papers-hint">
          Keine CS-getaggten Werke in OpenAlex für diese Person gefunden.
        </p>
      )}
      {csWorks.length > 0 && (
        <ol className="paper-list" start={firstIndex + 1}>
          {csWorks.map((w) => (
            <li key={w.id} className="paper-item">
              <a
                className="paper-title-link"
                href={w.id}
                target="_blank"
                rel="noreferrer"
                title={w.title}
              >
                {w.title}
              </a>
            </li>
          ))}
        </ol>
      )}
      {totalPages > 1 && (
        <div className="papers-pagination">
          <button
            type="button"
            className="page-btn"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={!hasPrev || worksState === "loading"}
          >
            Zurück
          </button>
          <span className="page-info">
            Seite {page} / {totalPages}
            {worksState === "loading" ? " · lädt…" : ""}
          </span>
          <button
            type="button"
            className="page-btn"
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasNext || worksState === "loading"}
          >
            Weiter
          </button>
        </div>
      )}

      <h3>Quellen</h3>
      <p>
        <a href={researcher.openalexUrl} target="_blank" rel="noreferrer">
          OpenAlex-Profil öffnen
        </a>
      </p>
      {researcher.orcid && (
        <p>
          <a href={researcher.orcid} target="_blank" rel="noreferrer">
            ORCID
          </a>
        </p>
      )}
      {researcher.homepage && (
        <p>
          <a href={researcher.homepage} target="_blank" rel="noreferrer">
            Institution-Webseite
          </a>
        </p>
      )}
    </aside>
  );
}
