import type { Researcher } from "../types/researcher";

interface Props {
  researcher: Researcher | null;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("de-DE").format(value);
}

export function ResearcherDetailPanel({ researcher }: Props) {
  if (!researcher) {
    return (
      <aside className="detail-panel">
        <div className="empty-state">
          <p>Wähle einen Marker auf der Karte aus,</p>
          <p>um Details zu einem Forschenden zu sehen.</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="detail-panel">
      <h2>{researcher.name}</h2>
      <p>{researcher.institution}</p>
      {researcher.country && <p style={{ color: "#94a3b8" }}>{researcher.country}</p>}

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
