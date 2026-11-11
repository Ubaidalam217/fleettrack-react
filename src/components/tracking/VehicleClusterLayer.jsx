import { useEffect, useMemo, useState } from 'react'
import L from 'leaflet'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import { LeafletContext, extendContext, useLeafletContext } from '@react-leaflet/core'

/**
 * Groups the Live Map's vehicle markers into count bubbles when zoomed out
 * (client requirement 15.2), using Leaflet.markercluster 1.5.3.
 *
 * Not a react-leaflet plugin: every <VehicleMarker> inside is still an ordinary
 * react-leaflet Marker. This component only swaps the layer they add
 * themselves to — the cluster group instead of the map — which is how they keep
 * their status ring, photo art, heading and popup unchanged.
 *
 * Each bubble shows the count on the theme accent, inside a ring split by the
 * status colours of the vehicles in it, so a cluster with a stopped or offline
 * vehicle still says so before it is opened. Clicking a bubble zooms into it;
 * at the closest zoom the vehicles that share a spot fan out instead.
 *
 * `version` changes whenever the vehicles do, and redraws the bubbles' rings:
 * the plugin only redraws a bubble by itself when a vehicle joins, leaves or
 * moves, not when one changes status in place.
 */

export const VEHICLE_CLUSTER_CSS = `
  .veh-cluster { background: none; border: none; }
  .veh-cluster-ring {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    padding: 3px;
    box-sizing: border-box;
    box-shadow: 0 3px 10px rgba(0,0,0,0.35);
    transition: transform 0.15s ease;
  }
  .veh-cluster:hover .veh-cluster-ring { transform: scale(1.08); }
  .veh-cluster-core {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--ft-accent);
    color: var(--ft-accent-contrast, #fff);
    border: 2px solid var(--c-card);
    box-sizing: border-box;
    font: 800 13px/1 system-ui, sans-serif;
    letter-spacing: -0.02em;
  }
`

function sizeFor(n) {
  if (n < 10) return 38
  if (n < 50) return 44
  if (n < 200) return 50
  return 56
}

function clusterIcon(cluster) {
  const markers = cluster.getAllChildMarkers()
  const counts = new Map()
  for (const m of markers) {
    const c = m.options.icon?.options?.vehColor || '#94a3b8'
    counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  // The status mix as a conic ring, biggest share first.
  let at = 0
  const stops = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([color, n]) => {
      const from = at
      at += (n / markers.length) * 360
      return `${color} ${from}deg ${at}deg`
    })
  const px = sizeFor(markers.length)
  return L.divIcon({
    className: 'veh-cluster',
    html: `<div class="veh-cluster-ring" style="background:conic-gradient(${stops.join(',')})"><div class="veh-cluster-core">${markers.length}</div></div>`,
    iconSize: [px, px],
    iconAnchor: [px / 2, px / 2],
  })
}

export default function VehicleClusterLayer({ version, children }) {
  const ctx = useLeafletContext()
  const [group] = useState(() => L.markerClusterGroup({
    iconCreateFunction: clusterIcon,
    showCoverageOnHover: false,
    // Street level and closer: every vehicle on its own.
    disableClusteringAtZoom: 16,
    maxClusterRadius: 60,
    spiderfyOnMaxZoom: true,
    chunkedLoading: true,
  }))

  useEffect(() => {
    ctx.map.addLayer(group)
    return () => { ctx.map.removeLayer(group) }
  }, [ctx.map, group])

  useEffect(() => {
    // Not before the group is on the map: it has no bubbles to redraw yet.
    if (group._map) group.refreshClusters()
  }, [group, version])

  const inner = useMemo(() => extendContext(ctx, { layerContainer: group }), [ctx, group])
  return <LeafletContext.Provider value={inner}>{children}</LeafletContext.Provider>
}
