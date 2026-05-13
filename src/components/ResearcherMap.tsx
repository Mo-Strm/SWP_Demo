import { useMemo } from "react";
import L from "leaflet";
import { MapContainer, Marker, TileLayer, Tooltip } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import type { Researcher } from "../types/researcher";

interface Props {
  researchers: Researcher[];
  selectedId: string | null;
  onSelect: (researcher: Researcher) => void;
}

function buildIcon(selected: boolean): L.DivIcon {
  const size = selected ? 18 : 14;
  return L.divIcon({
    className: `researcher-marker${selected ? " selected" : ""}`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<span class="researcher-marker__dot"></span>`,
  });
}

function clusterIconCreate(cluster: L.MarkerCluster): L.DivIcon {
  const count = cluster.getChildCount();
  let size = 34;
  let bucket = "sm";
  if (count >= 100) {
    size = 56;
    bucket = "xl";
  } else if (count >= 25) {
    size = 46;
    bucket = "lg";
  } else if (count >= 10) {
    size = 40;
    bucket = "md";
  }
  return L.divIcon({
    html: `<div class="cluster-icon cluster-icon--${bucket}"><span>${count}</span></div>`,
    className: "cluster-wrapper",
    iconSize: L.point(size, size, true),
  });
}

export function ResearcherMap({ researchers, selectedId, onSelect }: Props) {
  const defaultIcon = useMemo(() => buildIcon(false), []);
  const selectedIcon = useMemo(() => buildIcon(true), []);

  return (
    <MapContainer
      center={[30, 10]}
      zoom={2}
      minZoom={2}
      worldCopyJump
      scrollWheelZoom
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MarkerClusterGroup
        chunkedLoading
        showCoverageOnHover={false}
        spiderfyOnMaxZoom
        maxClusterRadius={50}
        iconCreateFunction={clusterIconCreate}
      >
        {researchers.map((r) => {
          const isSelected = r.id === selectedId;
          return (
            <Marker
              key={r.id}
              position={[r.lat, r.lon]}
              icon={isSelected ? selectedIcon : defaultIcon}
              eventHandlers={{
                click: () => onSelect(r),
              }}
            >
              <Tooltip
                direction="top"
                offset={[0, -10]}
                opacity={1}
                className="researcher-tooltip"
              >
                <div className="tooltip-name">{r.name}</div>
                <div className="tooltip-institution">{r.institution}</div>
                <div className="tooltip-meta">
                  {r.citedByCount.toLocaleString("de-DE")} Zitationen
                  {typeof r.hIndex === "number" ? ` · h-Index ${r.hIndex}` : ""}
                </div>
                {r.topics.length > 0 && (
                  <div className="tooltip-topics">
                    {r.topics.slice(0, 3).join(" · ")}
                  </div>
                )}
              </Tooltip>
            </Marker>
          );
        })}
      </MarkerClusterGroup>
    </MapContainer>
  );
}
