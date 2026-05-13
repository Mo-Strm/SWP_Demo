import { useEffect, useMemo, useState } from "react";
import { SearchBar } from "./components/SearchBar";
import { ResearcherMap } from "./components/ResearcherMap";
import { ResearcherDetailPanel } from "./components/ResearcherDetailPanel";
import { streamResearchers } from "./services/openalex";
import type { Researcher } from "./types/researcher";
import {
  clearResearcherCache,
  formatRelativeTime,
  loadResearcherCache,
  saveResearcherCache,
} from "./utils/researcherCache";

type LoadState = "idle" | "streaming" | "ready" | "error";

const RESEARCHER_LIMIT = 1000;

export default function App() {
  const [researchers, setResearchers] = useState<Researcher[]>([]);
  const [state, setState] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [inspected, setInspected] = useState(0);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [cacheSavedAt, setCacheSavedAt] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (reloadKey === 0) {
      const cached = loadResearcherCache();
      if (cached && cached.researchers.length > 0) {
        setResearchers(cached.researchers);
        setCacheSavedAt(cached.savedAt);
        setFromCache(true);
        setState("ready");
        return () => {
          cancelled = true;
        };
      }
    }

    setFromCache(false);
    setCacheSavedAt(null);

    const accumulator: Researcher[] = [];

    async function run() {
      setState("streaming");
      setErrorMessage(null);
      setResearchers([]);
      setInspected(0);
      try {
        await streamResearchers({
          limit: RESEARCHER_LIMIT,
          isCancelled: () => cancelled,
          onBatch: (batch, progress) => {
            if (cancelled) return;
            setInspected(progress.inspected);
            if (batch.length > 0) {
              accumulator.push(...batch);
              setResearchers((prev) => prev.concat(batch));
            }
          },
          onDone: () => {
            if (cancelled) return;
            const savedAt = saveResearcherCache(accumulator);
            setCacheSavedAt(savedAt);
            setState("ready");
          },
        });
      } catch (error) {
        if (cancelled) return;
        const message =
          error instanceof Error ? error.message : "Unbekannter Fehler";
        setErrorMessage(message);
        setState("error");
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  function refresh() {
    clearResearcherCache();
    setFromCache(false);
    setCacheSavedAt(null);
    setResearchers([]);
    setSelectedId(null);
    setReloadKey((k) => k + 1);
  }

  const filtered = useMemo(() => {
    if (!query.trim()) return researchers;
    const needle = query.trim().toLowerCase();
    return researchers.filter((r) => {
      if (r.name.toLowerCase().includes(needle)) return true;
      if (r.institution.toLowerCase().includes(needle)) return true;
      if (r.country?.toLowerCase().includes(needle)) return true;
      return r.topics.some((t) => t.toLowerCase().includes(needle));
    });
  }, [researchers, query]);

  const selected = useMemo(() => {
    if (!selectedId) return null;
    return researchers.find((r) => r.id === selectedId) ?? null;
  }, [researchers, selectedId]);

  const statusPill = (() => {
    if (state === "streaming") {
      return (
        <span className="status-pill">
          Lade live von OpenAlex... {researchers.length} Forschende
          {inspected > 0 ? ` (von ${inspected} geprüft)` : ""}
        </span>
      );
    }
    if (state === "error") {
      return <span className="status-pill error">API-Fehler</span>;
    }
    if (state === "ready") {
      const ageText =
        cacheSavedAt != null ? ` · ${formatRelativeTime(cacheSavedAt)}` : "";
      const sourceText = fromCache ? "Aus Cache" : "Frisch von OpenAlex";
      return (
        <span className="status-pill ok">
          {researchers.length} Forschende · {sourceText}
          {ageText}
        </span>
      );
    }
    return null;
  })();

  const refreshDisabled = state === "streaming";

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>AI Researcher Radar</h1>
          <div className="subtitle">
            Prototyp – Forschende mit OpenAlex-Thema „Computer science“ (bis zu{" "}
            {RESEARCHER_LIMIT} mit Kartenposition)
          </div>
        </div>
        <SearchBar
          value={query}
          onChange={setQuery}
          resultCount={filtered.length}
        />
        {statusPill}
        <button
          type="button"
          className="refresh-btn"
          onClick={refresh}
          disabled={refreshDisabled}
          title="Cache leeren und Daten neu von OpenAlex laden"
        >
          {state === "streaming" ? "Lädt..." : "Aktualisieren"}
        </button>
      </header>
      <div className="app-body">
        <div className="map-wrapper">
          {state === "streaming" && researchers.length === 0 && (
            <div className="loading-state">
              Lade Forschende von OpenAlex...
            </div>
          )}
          {state === "error" && (
            <div className="error-state">
              Daten konnten nicht geladen werden.
              <br />
              {errorMessage}
            </div>
          )}
          {state === "ready" &&
            filtered.length === 0 &&
            researchers.length === 0 && (
              <div className="empty-state">
                Es konnten keine Forschenden mit gültigen Koordinaten geladen
                werden.
                <br />
                Prüfe die Netzwerkverbindung oder versuche es später erneut.
              </div>
            )}
          {researchers.length > 0 && filtered.length === 0 && (
            <div className="empty-state">Keine Treffer für „{query}“.</div>
          )}
          {(state === "streaming" || state === "ready") &&
            researchers.length > 0 && (
              <ResearcherMap
                researchers={filtered}
                selectedId={selectedId}
                onSelect={(r) => setSelectedId(r.id)}
              />
            )}
          {researchers.length > 0 && (
            <div className="legend">
              Marker = Forschende (verortet über die letzte bekannte
              Institution)
              {state === "streaming" && " · lädt weiter ..."}
            </div>
          )}
        </div>
        <ResearcherDetailPanel researcher={selected} />
      </div>
    </div>
  );
}
