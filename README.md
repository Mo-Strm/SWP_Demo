# AI Researcher Radar – Basic-Prototyp

Sehr einfacher Frontend-Prototyp zum Pflichtenheft *AI Researcher Radar*. Dieser Prototyp prüft die zwei zentralen Bausteine des Projekts:

1. **API-Pull** direkt aus der öffentlichen [OpenAlex-API](https://docs.openalex.org/) – ohne eigenes Backend und ohne Datenbank.
2. **Interaktive Kartendarstellung** der Forschenden auf einer Weltkarte (Leaflet + OpenStreetMap).

> Hinweis: Es handelt sich bewusst um einen Wegwerf-Prototyp, der nur die Machbarkeit demonstrieren soll. Für die finale Software werden laut Pflichtenheft Backend (FastAPI/Flask), PostgreSQL und ein Daten-Pipeline-Layer ergänzt.

## Funktionsumfang

- Lädt beim Start die Top-AI-Forschenden (nach Zitationen) aus OpenAlex.
- Verortet jeden Forschenden über die Koordinaten seiner zuletzt bekannten Institution.
- Interaktive Weltkarte mit Zoom/Pan und Markern.
- Klick auf einen Marker öffnet ein Detailpanel mit:
  - Name, Institution, Land
  - Publikationen, Zitationen, h-Index
  - Top-Forschungsthemen aus OpenAlex
  - Links zu OpenAlex, ORCID und Institutionswebseite
- Client-seitige Suche über Name, Institution, Land oder Thema.
- Loading-, Error- und Empty-Status-Behandlung.

## Tech-Stack

- React 18 + TypeScript
- Vite als Build-Tool und Dev-Server
- Leaflet + react-leaflet für die Karte
- Daten: OpenAlex-API (öffentlich, kein API-Key nötig)

## Projektstruktur

```
src/
  App.tsx                          // Hauptansicht und Datenfluss
  main.tsx                         // Einstiegspunkt
  styles.css                       // Globales Styling
  components/
    ResearcherMap.tsx              // Leaflet-Karte mit Markern
    SearchBar.tsx                  // Suchfeld mit Trefferzaehler
    ResearcherDetailPanel.tsx      // Detailpanel rechts
  services/
    openalex.ts                    // OpenAlex API-Calls
  utils/
    normalizeOpenAlex.ts           // Mapping API -> Frontend-Modell
  types/
    researcher.ts                  // Einheitliches Forschenden-Modell
```

## Voraussetzungen

- Node.js >= 18
- npm

## Starten

```bash
npm install
npm run dev
```

Die App öffnet sich automatisch unter `http://localhost:5173`.

## Build / Preview

```bash
npm run build
npm run preview
```

## Bekannte Grenzen des Prototyps

- **Keine Persistenz**: Daten werden bei jedem Reload neu aus OpenAlex geladen.
- **Nur georeferenzierbare Forschende werden angezeigt**: Wenn OpenAlex zur zuletzt bekannten Institution keine Koordinaten liefert, wird der Datensatz ausgelassen.
- **Mehrere Forschende derselben Institution** werden mit leichtem Jitter auf der Karte versetzt, damit sie sich nicht vollständig überdecken.
- **Kein DBLP-Integration** und keine Deduplikation über mehrere Quellen – das ist Teil des späteren Backend-Aufgabenbereichs.
- **Rate-Limits von OpenAlex**: Die App nutzt den "polite pool" via `mailto`-Parameter. Bei Fehlern erscheint eine verständliche Fehlermeldung im UI.

## Was demonstriert dieser Prototyp aus dem Pflichtenheft?

| Pflichtenheft-Anforderung | Im Prototyp umgesetzt? |
|---|---|
| Web application for searching and visualizing AI researchers | Ja |
| Interactive world map of researchers | Ja |
| Researcher profiles with name, institution, research areas, publications, and citation metrics | Ja |
| Search and filtering functionality | Ja (Client-Suche) |
| Functional data retrieval from OpenAlex API | Ja |
| Visualization of co-authorship and collaboration networks | Nicht im Prototyp |
| Local database combining OpenAlex and DBLP data | Nicht im Prototyp |
| REST backend for data processing | Nicht im Prototyp |
