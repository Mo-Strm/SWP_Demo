import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import cytoscape from "cytoscape";
import type { Core, ElementDefinition, EventObject } from "cytoscape";
import type { Researcher } from "../types/researcher";
import {
  fetchEgoEdgesForAuthor,
  streamCoauthorEdges,
} from "../services/openalex";

interface Props {
  researchers: Researcher[];
  selectedId: string | null;
  onSelect: (researcher: Researcher) => void;
  onBackToMap: () => void;
}

type GraphMode = "ego" | "global";
type GraphState = "idle" | "loading" | "ready" | "error";

interface GraphProgress {
  processed: number;
  total: number;
  edges: number;
  nodes: number;
}

const MIN_EDGE_WEIGHT_EGO = 1;
const MAX_NEIGHBORS_IN_EGO = 40;
const MIN_EDGE_WEIGHT_GLOBAL = 2;
const MAX_AUTHORS_FOR_GLOBAL_GRAPH = 120;
const MAX_WORKS_PAGES_PER_AUTHOR = 3;
const GRAPH_CONCURRENCY = 4;

function nodeSize(citedByCount: number, isCenter: boolean): number {
  const base = 10 + Math.log10(1 + citedByCount) * 4;
  const clamped = Math.max(10, Math.min(34, base));
  return isCenter ? clamped + 8 : clamped;
}

export function ResearcherGraph({
  researchers,
  selectedId,
  onSelect,
  onBackToMap,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);

  const [mode, setMode] = useState<GraphMode>("ego");
  const [state, setState] = useState<GraphState>("idle");
  const [progress, setProgress] = useState<GraphProgress>({
    processed: 0,
    total: 0,
    edges: 0,
    nodes: 0,
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const researchersById = useMemo(() => {
    const m = new Map<string, Researcher>();
    for (const r of researchers) m.set(r.id, r);
    return m;
  }, [researchers]);

  const knownIds = useMemo(
    () => new Set(researchers.map((r) => r.id)),
    [researchers]
  );

  const researchersRef = useRef(researchers);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    researchersRef.current = researchers;
  }, [researchers]);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!containerRef.current) return;
    const cy = cytoscape({
      container: containerRef.current,
      wheelSensitivity: 0.7,
      minZoom: 0.1,
      maxZoom: 6,
      style: [
        {
          selector: "node",
          style: {
            "background-color": "#38bdf8",
            "border-color": "#0f172a",
            "border-width": 1.5,
            label: "data(label)",
            color: "#e2e8f0",
            "font-size": 11,
            "text-valign": "bottom",
            "text-halign": "center",
            "text-margin-y": 4,
            "text-outline-color": "#0f172a",
            "text-outline-width": 2,
            "min-zoomed-font-size": 8,
            width: "data(size)",
            height: "data(size)",
          },
        },
        {
          selector: "node.center",
          style: {
            "background-color": "#facc15",
            "border-color": "#fef3c7",
            "border-width": 3,
            "font-size": 13,
            "min-zoomed-font-size": 6,
          },
        },
        {
          selector: "node.selected",
          style: {
            "background-color": "#facc15",
            "border-color": "#fef3c7",
            "border-width": 3,
            "font-size": 13,
            "min-zoomed-font-size": 6,
          },
        },
        {
          selector: "node.hovered",
          style: {
            "border-color": "#7dd3fc",
            "border-width": 2.5,
            "min-zoomed-font-size": 6,
          },
        },
        {
          selector: "edge",
          style: {
            "line-color": "rgba(148, 163, 184, 0.55)",
            width: "mapData(weight, 1, 10, 1.2, 5)",
            "curve-style": "bezier",
            opacity: 0.75,
          },
        },
        {
          selector: "edge.highlight",
          style: {
            "line-color": "#facc15",
            opacity: 1,
            width: "mapData(weight, 1, 10, 2, 6)",
          },
        },
      ],
      layout: { name: "preset" },
    });

    cyRef.current = cy;

    cy.on("tap", "node", (evt: EventObject) => {
      const id = evt.target.id();
      const r = researchersRef.current.find((x) => x.id === id);
      if (r) onSelectRef.current(r);
    });
    cy.on("mouseover", "node", (evt: EventObject) => {
      evt.target.addClass("hovered");
    });
    cy.on("mouseout", "node", (evt: EventObject) => {
      evt.target.removeClass("hovered");
    });

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, []);

  const buildEgoGraph = useCallback(
    async (cancelledRef: { current: boolean }) => {
      const cy = cyRef.current;
      if (!cy) return;
      if (!selectedId) {
        cy.batch(() => cy.elements().remove());
        setState("ready");
        setProgress({ processed: 0, total: 0, edges: 0, nodes: 0 });
        return;
      }
      const center = researchersById.get(selectedId);
      if (!center) {
        cy.batch(() => cy.elements().remove());
        setState("ready");
        return;
      }

      setState("loading");
      setErrorMessage(null);
      setProgress({ processed: 0, total: 1, edges: 0, nodes: 0 });

      try {
        const edges = await fetchEgoEdgesForAuthor(center.id, {
          knownNodeIds: knownIds,
          maxPages: MAX_WORKS_PAGES_PER_AUTHOR,
          minWeight: MIN_EDGE_WEIGHT_EGO,
          maxNeighbors: MAX_NEIGHBORS_IN_EGO,
        });
        if (cancelledRef.current) return;

        const neighborIds = new Set<string>();
        for (const e of edges) {
          if (e.source !== center.id) neighborIds.add(e.source);
          if (e.target !== center.id) neighborIds.add(e.target);
        }

        const nodes: ElementDefinition[] = [];
        nodes.push({
          group: "nodes",
          classes: "center",
          data: {
            id: center.id,
            label: center.name,
            size: nodeSize(center.citedByCount, true),
            level: 2,
          },
        });
        for (const nid of neighborIds) {
          const r = researchersById.get(nid);
          if (!r) continue;
          nodes.push({
            group: "nodes",
            data: {
              id: r.id,
              label: r.name,
              size: nodeSize(r.citedByCount, false),
              level: 1,
            },
          });
        }
        const edgeEls: ElementDefinition[] = edges
          .filter(
            (e) =>
              (e.source === center.id || neighborIds.has(e.source)) &&
              (e.target === center.id || neighborIds.has(e.target))
          )
          .map((e) => ({
            group: "edges",
            data: {
              id: `e:${e.source}|${e.target}`,
              source: e.source,
              target: e.target,
              weight: e.weight,
            },
          }));

        cy.batch(() => {
          cy.elements().remove();
          cy.add(nodes);
          cy.add(edgeEls);
        });

        cy.layout({
          name: "concentric",
          concentric: (n: cytoscape.NodeSingular) =>
            (n.data("level") as number) ?? 1,
          levelWidth: () => 1,
          minNodeSpacing: 60,
          spacingFactor: 1.1,
          animate: false,
        } as cytoscape.LayoutOptions).run();

        cy.fit(undefined, 40);
        setProgress({
          processed: 1,
          total: 1,
          edges: edgeEls.length,
          nodes: nodes.length,
        });
        setState("ready");
      } catch (err) {
        if (cancelledRef.current) return;
        setErrorMessage(
          err instanceof Error ? err.message : "Unbekannter Fehler"
        );
        setState("error");
      }
    },
    [selectedId, researchersById, knownIds]
  );

  const buildGlobalGraph = useCallback(
    async (cancelledRef: { current: boolean }) => {
      const cy = cyRef.current;
      if (!cy) return;
      const subset = researchers.slice(0, MAX_AUTHORS_FOR_GLOBAL_GRAPH);
      const subsetById = new Map<string, Researcher>(
        subset.map((r) => [r.id, r])
      );

      cy.batch(() => {
        cy.elements().remove();
      });

      setProgress({
        processed: 0,
        total: subset.length,
        edges: 0,
        nodes: 0,
      });

      if (subset.length === 0) {
        setState("ready");
        return;
      }

      setState("loading");
      setErrorMessage(null);

      function ensureNode(cy2: Core, id: string): boolean {
        if (cy2.getElementById(id).length > 0) return true;
        const r = subsetById.get(id);
        if (!r) return false;
        cy2.add({
          group: "nodes",
          data: {
            id: r.id,
            label: r.name,
            size: nodeSize(r.citedByCount, false),
          },
        });
        return true;
      }

      try {
        await streamCoauthorEdges({
          researchers: subset,
          isCancelled: () => cancelledRef.current,
          maxWorksPagesPerAuthor: MAX_WORKS_PAGES_PER_AUTHOR,
          concurrency: GRAPH_CONCURRENCY,
          onBatch: (batch, prog) => {
            if (cancelledRef.current) return;
            const cy2 = cyRef.current;
            if (!cy2) return;
            cy2.batch(() => {
              for (const e of batch) {
                if (e.weight < MIN_EDGE_WEIGHT_GLOBAL) continue;
                if (!subsetById.has(e.source) || !subsetById.has(e.target)) {
                  continue;
                }
                if (!ensureNode(cy2, e.source)) continue;
                if (!ensureNode(cy2, e.target)) continue;
                const id = `e:${e.source}|${e.target}`;
                const existing = cy2.getElementById(id);
                if (existing && existing.length > 0) {
                  existing.data("weight", e.weight);
                  continue;
                }
                cy2.add({
                  group: "edges",
                  data: {
                    id,
                    source: e.source,
                    target: e.target,
                    weight: e.weight,
                  },
                });
              }
            });
            setProgress({
              processed: prog.processedAuthors,
              total: prog.totalAuthors,
              edges: cy2.edges().length,
              nodes: cy2.nodes().length,
            });
          },
          onDone: (prog) => {
            if (cancelledRef.current) return;
            const cy2 = cyRef.current;
            if (cy2) {
              cy2.batch(() => {
                cy2.nodes().forEach((n) => {
                  if (n.degree(false) === 0) n.remove();
                });
              });
              cy2
                .layout({
                  name: "cose",
                  animate: false,
                  idealEdgeLength: () => 100,
                  nodeRepulsion: () => 12000,
                  gravity: 0.15,
                } as cytoscape.LayoutOptions)
                .run();
              cy2.fit(undefined, 30);
            }
            setProgress({
              processed: prog.processedAuthors,
              total: prog.totalAuthors,
              edges: cy2 ? cy2.edges().length : 0,
              nodes: cy2 ? cy2.nodes().length : 0,
            });
            setState("ready");
          },
        });
      } catch (err) {
        if (cancelledRef.current) return;
        setErrorMessage(
          err instanceof Error ? err.message : "Unbekannter Fehler"
        );
        setState("error");
      }
    },
    [researchers]
  );

  useEffect(() => {
    const cancelledRef = { current: false };
    if (mode === "ego") {
      void buildEgoGraph(cancelledRef);
    } else {
      void buildGlobalGraph(cancelledRef);
    }
    return () => {
      cancelledRef.current = true;
    };
  }, [mode, buildEgoGraph, buildGlobalGraph]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.nodes().removeClass("selected");
      cy.edges().removeClass("highlight");
      if (selectedId) {
        const node = cy.getElementById(selectedId);
        if (node && node.length > 0) {
          node.addClass("selected");
          node.connectedEdges().addClass("highlight");
        }
      }
    });
  }, [selectedId, progress.edges]);

  function handleFit() {
    cyRef.current?.fit(undefined, 30);
  }

  function handleRelayout() {
    const cy = cyRef.current;
    if (!cy) return;
    cy.layout(
      mode === "ego"
        ? ({
            name: "concentric",
            concentric: (n: cytoscape.NodeSingular) =>
              (n.data("level") as number) ?? 1,
            levelWidth: () => 1,
            minNodeSpacing: 60,
            spacingFactor: 1.1,
            animate: false,
          } as cytoscape.LayoutOptions)
        : ({
            name: "cose",
            animate: false,
            idealEdgeLength: () => 100,
            nodeRepulsion: () => 12000,
            gravity: 0.15,
          } as cytoscape.LayoutOptions)
    ).run();
    cy.fit(undefined, 30);
  }

  const centerResearcher =
    mode === "ego" && selectedId ? researchersById.get(selectedId) : null;

  return (
    <div className="graph-wrapper">
      <div className="graph-toolbar">
        <button
          type="button"
          className="graph-btn"
          onClick={onBackToMap}
          title="Zurück zur Kartenansicht"
        >
          ← Zur Karte
        </button>
        <div
          className="graph-toggle"
          role="tablist"
          aria-label="Graph-Ansicht"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "ego"}
            className={
              mode === "ego"
                ? "graph-toggle__btn graph-toggle__btn--active"
                : "graph-toggle__btn"
            }
            onClick={() => setMode("ego")}
          >
            Ego-Graph
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "global"}
            className={
              mode === "global"
                ? "graph-toggle__btn graph-toggle__btn--active"
                : "graph-toggle__btn"
            }
            onClick={() => setMode("global")}
          >
            Gesamtgraph
          </button>
        </div>
        <button
          type="button"
          className="graph-btn"
          onClick={handleFit}
          title="Ansicht zentrieren"
        >
          Zentrieren
        </button>
        <button
          type="button"
          className="graph-btn"
          onClick={handleRelayout}
          title="Layout neu berechnen"
        >
          Layout
        </button>
      </div>
      <div ref={containerRef} className="graph-canvas" />
      <div className="graph-status">
        {mode === "ego" && !selectedId && (
          <span>
            Wähle einen Forscher (z. B. über die Karte oder Suche), um seinen
            Ego-Graph zu sehen.
          </span>
        )}
        {mode === "ego" && centerResearcher && state === "loading" && (
          <span>
            Lade Co-Autoren für {centerResearcher.name}…
          </span>
        )}
        {mode === "ego" && centerResearcher && state === "ready" && (
          <span>
            {centerResearcher.name} · {progress.edges} direkte Verbindungen
            {progress.edges >= MAX_NEIGHBORS_IN_EGO && (
              <> (Top {MAX_NEIGHBORS_IN_EGO})</>
            )}
          </span>
        )}
        {mode === "global" && state === "loading" && (
          <span>
            Gesamtgraph lädt… {progress.processed}/{progress.total} Forschende
            geprüft · {progress.nodes} verbundene Knoten · {progress.edges}{" "}
            Kanten (≥ {MIN_EDGE_WEIGHT_GLOBAL} gem. Papers)
          </span>
        )}
        {mode === "global" && state === "ready" && (
          <span>
            {progress.nodes} verbundene Knoten · {progress.edges} Kanten (≥{" "}
            {MIN_EDGE_WEIGHT_GLOBAL} gem. Papers) · isolierte Forscher
            ausgeblendet
            {researchers.length > MAX_AUTHORS_FOR_GLOBAL_GRAPH && (
              <>
                {" "}· Auswahl auf Top {MAX_AUTHORS_FOR_GLOBAL_GRAPH} nach
                Zitationen
              </>
            )}
          </span>
        )}
        {state === "error" && (
          <span className="graph-status--error">
            Fehler beim Laden: {errorMessage}
          </span>
        )}
      </div>
    </div>
  );
}
