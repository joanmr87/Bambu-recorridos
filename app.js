const DEMO_DATA = `GREGORIO MARTINEZ 1615, NEUQUEN
-38.938063, -68.081729
JOSE NOGARA 634 CASA 306, NEUQUEN
-38.9614918, -68.0880338
SALTA 434, NEUQUEN
-38.95036467280053, -68.06612225045183
RIO DIAMANTE 291, NEUQUEN
-38.952331, -68.037419
RIO MOCORETA 75, NEUQUEN
-38.952805, -68.032581
CHAJARI 5180, NEUQUEN
-38.947838, -68.13057`;

const ROUTE_COLORS = ["#0ea5e9", "#f97316", "#10b981"];
const DEFAULT_DEPOT = { lat: -39.0715, lng: -67.2379 };

const state = {
  map: null,
  pointsLayer: null,
  routesLayer: null,
  markers: [],
  polylines: [],
  run: null,
  selectedRouteIndex: 0,
};

const clientsInput = document.getElementById("clients-input");
const depotLatInput = document.getElementById("depot-lat");
const depotLngInput = document.getElementById("depot-lng");
const returnToDepotInput = document.getElementById("return-to-depot");
const useRoadNetworkInput = document.getElementById("use-road-network");
const optimizeBtn = document.getElementById("optimize-btn");
const loadDemoBtn = document.getElementById("load-demo");
const statusEl = document.getElementById("status");
const resultsEmptyEl = document.getElementById("results-empty");
const resultsListEl = document.getElementById("results-list");
const routeViewControlsEl = document.getElementById("route-view-controls");
const routeSelectorEl = document.getElementById("route-selector");

init();

function init() {
  initMap();
  clientsInput.value = "";
  depotLatInput.value = String(DEFAULT_DEPOT.lat);
  depotLngInput.value = String(DEFAULT_DEPOT.lng);

  loadDemoBtn.addEventListener("click", () => {
    clientsInput.value = DEMO_DATA;
    setStatus("Se cargó el ejemplo de Neuquén.", "ok");
  });

  optimizeBtn.addEventListener("click", async () => {
    await runOptimization();
  });
  routeSelectorEl.addEventListener("change", () => {
    const index = Number(routeSelectorEl.value);
    selectRoute(index);
  });
  resultsListEl.addEventListener("click", (event) => {
    const card = event.target.closest("[data-route-index]");
    if (!card) {
      return;
    }
    const index = Number(card.dataset.routeIndex);
    selectRoute(index);
  });

  setStatus('Pegá coordenadas y presioná "Calcular 3 recorridos óptimos".', "ok");
}

function initMap() {
  state.map = L.map("map").setView([-38.9516, -68.0591], 12);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(state.map);

  state.pointsLayer = L.layerGroup().addTo(state.map);
  state.routesLayer = L.layerGroup().addTo(state.map);
}

async function runOptimization() {
  state.run = null;
  state.selectedRouteIndex = 0;
  clearMapLayers();
  clearResults();

  const parseResult = parseClientsInput(clientsInput.value);
  if (parseResult.errors.length > 0) {
    setStatus(parseResult.errors[0], "warn");
  }

  const clients = parseResult.clients;
  if (clients.length < 2) {
    setStatus("Necesitás al menos 2 clientes válidos para optimizar recorridos.", "warn");
    return;
  }

  const depot = parseDepot(depotLatInput.value, depotLngInput.value);
  const returnToDepot = Boolean(returnToDepotInput.checked && depot);
  const useRoadNetwork = Boolean(useRoadNetworkInput.checked);

  setStatus("Calculando rutas...", "ok");
  const distanceModel = await buildDistanceModel(clients, depot, returnToDepot, useRoadNetwork);
  const rankedRoutes = buildTopRoutes(distanceModel, 3);
  if (rankedRoutes.length === 0) {
    setStatus("No se pudieron generar rutas. Revisá los datos de entrada.", "warn");
    return;
  }

  state.run = {
    clients,
    rankedRoutes,
    depot,
    returnToDepot,
  };
  state.selectedRouteIndex = 0;

  updateRouteSelector(rankedRoutes.length, state.selectedRouteIndex);
  refreshMapAndResults();

  const depotLabel = depot ? "con depósito" : "sin depósito";
  const distanceModeLabel = distanceModel.source === "road" ? "distancia vial real" : "distancia en línea recta";
  setStatus(
    `Listo: ${rankedRoutes.length} rutas generadas (${clients.length} clientes, ${depotLabel}, ${distanceModeLabel}).`,
    "ok",
  );
}

function parseClientsInput(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const clients = [];
  const errors = [];
  let pendingName = "";

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const coordCandidate = parseCoordinateLine(line);

    if (coordCandidate) {
      const inlineName = extractNameBeforeCoords(line, coordCandidate.matchIndex);
      const name =
        inlineName ||
        pendingName ||
        `Cliente ${clients.length + 1}`;
      clients.push({
        name,
        lat: coordCandidate.lat,
        lng: coordCandidate.lng,
      });
      pendingName = "";
      continue;
    }

    if (looksLikePossibleCoord(line)) {
      errors.push(`Línea ${i + 1}: coordenadas inválidas -> "${line}"`);
      continue;
    }

    pendingName = line;
  }

  return { clients, errors };
}

function parseCoordinateLine(line) {
  const matches = [...line.matchAll(/-?\d{1,3}\.\d+/g)];
  if (matches.length < 2) {
    return null;
  }

  const lat = Number(matches[0][0]);
  const lng = Number(matches[1][0]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }

  return {
    lat,
    lng,
    matchIndex: matches[0].index ?? 0,
  };
}

function extractNameBeforeCoords(line, firstCoordIndex) {
  const prefix = line.slice(0, firstCoordIndex).replace(/[,;|\s-]+$/, "").trim();
  if (!prefix) {
    return "";
  }
  if (/^-?\d/.test(prefix)) {
    return "";
  }
  return prefix;
}

function looksLikePossibleCoord(line) {
  const decimalMatches = line.match(/-?\d{1,3}\.\d+/g);
  return Array.isArray(decimalMatches) && decimalMatches.length > 0;
}

function parseDepot(latRaw, lngRaw) {
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }
  return { lat, lng, name: "Depósito" };
}

async function buildDistanceModel(clients, depot, returnToDepot, useRoadNetwork) {
  if (useRoadNetwork) {
    try {
      const roadModel = await fetchRoadDistanceModel(clients, depot, returnToDepot);
      if (roadModel) {
        return roadModel;
      }
    } catch (error) {
      console.warn("No se pudo usar OSRM, se aplicará fallback por haversine:", error);
    }
  }

  const matrix = buildDistanceMatrix(clients);
  const depotDistances = depot ? clients.map((c) => haversineKm(depot, c)) : null;
  return { matrix, depotDistances, returnToDepot, source: "haversine" };
}

async function fetchRoadDistanceModel(clients, depot, returnToDepot) {
  const allPoints = depot ? [depot, ...clients] : [...clients];
  const coords = allPoints.map((point) => `${point.lng},${point.lat}`).join(";");
  const url = `https://router.project-osrm.org/table/v1/driving/${coords}?annotations=distance`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const response = await fetch(url, { signal: controller.signal });
  clearTimeout(timer);

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  if (!payload || payload.code !== "Ok" || !Array.isArray(payload.distances)) {
    return null;
  }

  const distances = payload.distances;
  if (depot) {
    if (distances.length !== clients.length + 1) {
      return null;
    }
    const depotDistances = distances[0]
      .slice(1)
      .map((meters, idx) => normalizeDistanceMeters(meters, depot, clients[idx]));
    const matrix = distances
      .slice(1)
      .map((row, i) =>
        row.slice(1).map((meters, j) => normalizeDistanceMeters(meters, clients[i], clients[j])),
      );
    return { matrix, depotDistances, returnToDepot, source: "road" };
  }

  if (distances.length !== clients.length) {
    return null;
  }
  const matrix = distances.map((row, i) =>
    row.map((meters, j) => normalizeDistanceMeters(meters, clients[i], clients[j])),
  );
  return { matrix, depotDistances: null, returnToDepot, source: "road" };
}

function normalizeDistanceMeters(meters, from, to) {
  if (typeof meters === "number" && Number.isFinite(meters) && meters >= 0) {
    return meters / 1000;
  }
  return haversineKm(from, to);
}

function buildTopRoutes(model, topN) {
  const n = model.matrix.length;
  const matrix = model.matrix;

  const candidateMap = new Map();
  const maxStarts = Math.min(n, 30);
  for (let start = 0; start < maxStarts; start += 1) {
    const route = nearestNeighborRoute(matrix, start, 0);
    const improved = twoOpt(route, model);
    saveCandidate(candidateMap, improved, model);
  }

  const randomRuns = Math.max(80, n * 8);
  for (let i = 0; i < randomRuns; i += 1) {
    const start = Math.floor(Math.random() * n);
    const randomness = 0.25 + Math.random() * 0.55;
    const route = nearestNeighborRoute(matrix, start, randomness);
    const improved = twoOpt(route, model);
    saveCandidate(candidateMap, improved, model);
  }

  return [...candidateMap.values()]
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, topN);
}

function saveCandidate(store, order, model) {
  const key = order.join("-");
  if (store.has(key)) {
    return;
  }
  store.set(key, {
    order,
    distanceKm: routeDistance(order, model),
  });
}

function nearestNeighborRoute(matrix, start, randomness = 0) {
  const n = matrix.length;
  const unvisited = new Set(Array.from({ length: n }, (_, idx) => idx));
  const order = [start];
  unvisited.delete(start);
  let current = start;

  while (unvisited.size > 0) {
    const sorted = [...unvisited].sort((a, b) => matrix[current][a] - matrix[current][b]);
    let next = sorted[0];
    if (randomness > 0 && sorted.length > 1 && Math.random() < randomness) {
      const topK = sorted.slice(0, Math.min(4, sorted.length));
      next = topK[Math.floor(Math.random() * topK.length)];
    }
    order.push(next);
    unvisited.delete(next);
    current = next;
  }

  return order;
}

function twoOpt(initialOrder, model) {
  const order = [...initialOrder];
  let improved = true;
  let bestDistance = routeDistance(order, model);
  let attempts = 0;
  const maxAttempts = order.length * order.length * 2;

  while (improved && attempts < maxAttempts) {
    improved = false;
    attempts += 1;
    for (let i = 0; i < order.length - 1; i += 1) {
      for (let j = i + 1; j < order.length; j += 1) {
        const candidate = twoOptSwap(order, i, j);
        const candidateDistance = routeDistance(candidate, model);
        if (candidateDistance + 1e-9 < bestDistance) {
          order.splice(0, order.length, ...candidate);
          bestDistance = candidateDistance;
          improved = true;
        }
      }
    }
  }

  return order;
}

function twoOptSwap(route, i, j) {
  return [...route.slice(0, i), ...route.slice(i, j + 1).reverse(), ...route.slice(j + 1)];
}

function routeDistance(order, model) {
  let total = 0;
  for (let i = 0; i < order.length - 1; i += 1) {
    total += model.matrix[order[i]][order[i + 1]];
  }

  if (model.depotDistances) {
    total += model.depotDistances[order[0]];
    if (model.returnToDepot) {
      total += model.depotDistances[order[order.length - 1]];
    }
  }

  return total;
}

function buildDistanceMatrix(points) {
  const n = points.length;
  const matrix = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const dist = haversineKm(points[i], points[j]);
      matrix[i][j] = dist;
      matrix[j][i] = dist;
    }
  }
  return matrix;
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = deg2rad(b.lat - a.lat);
  const dLng = deg2rad(b.lng - a.lng);
  const s1 = Math.sin(dLat / 2) ** 2;
  const s2 = Math.cos(deg2rad(a.lat)) * Math.cos(deg2rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s1 + s2));
}

function deg2rad(degrees) {
  return degrees * (Math.PI / 180);
}

function buildVisitOrderMap(order) {
  const visitOrder = new Map();
  order.forEach((clientIndex, idx) => {
    visitOrder.set(clientIndex, idx + 1);
  });
  return visitOrder;
}

function plotPoints(clients, visitOrder) {
  clients.forEach((client, clientIndex) => {
    const visitNumber = visitOrder.get(clientIndex) ?? clientIndex + 1;
    const marker = L.marker([client.lat, client.lng], {
      title: `${visitNumber}. ${client.name}`,
      icon: L.divIcon({
        className: "visit-marker",
        html: `<span>${visitNumber}</span>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      }),
    }).addTo(state.pointsLayer);
    marker.bindPopup(
      `<b>${visitNumber}. ${escapeHtml(client.name)}</b><br>${client.lat.toFixed(6)}, ${client.lng.toFixed(6)}`,
    );
    state.markers.push(marker);
  });
  fitMapToPoints(clients);
}

function drawRoutes(clients, rankedRoutes, depot, returnToDepot) {
  rankedRoutes.forEach((route, idx) => {
    const isActive = idx === state.selectedRouteIndex;
    const color = ROUTE_COLORS[idx % ROUTE_COLORS.length];
    const latLngs = routeToLatLngs(route.order, clients);
    const polyline = L.polyline(latLngs, {
      color,
      weight: isActive ? 6 : 3,
      opacity: isActive ? 0.95 : 0.28,
      dashArray: isActive ? null : "8 8",
    }).addTo(state.routesLayer);
    polyline.bindTooltip(`Recorrido #${idx + 1}`, { sticky: true });
    state.polylines.push(polyline);
  });
}

function routeToLatLngs(order, clients) {
  return order.map((clientIndex) => {
    const point = clients[clientIndex];
    return [point.lat, point.lng];
  });
}

function renderResults(clients, rankedRoutes, depot, returnToDepot) {
  resultsEmptyEl.style.display = "none";
  resultsListEl.innerHTML = "";

  rankedRoutes.forEach((route, idx) => {
    const card = document.createElement("article");
    card.className = idx === state.selectedRouteIndex ? "route-card is-active" : "route-card";
    card.dataset.routeIndex = String(idx);
    card.style.borderLeftColor = ROUTE_COLORS[idx % ROUTE_COLORS.length];

    const etaMinutes = estimateMinutes(route.distanceKm);
    const routeStops = formatRouteStops(route.order, clients);
    const title = idx === 0 ? "Recorrido #1 (Más óptimo)" : `Recorrido #${idx + 1}`;
    const distanceLabel = depot
      ? "Distancia total (incluye viaje desde/hacia Ingeniero Huergo):"
      : "Distancia total:";

    card.innerHTML = `
      <h3><span class="swatch" style="background:${ROUTE_COLORS[idx % ROUTE_COLORS.length]}"></span>${title}</h3>
      <div class="metrics">
        <span><b>${distanceLabel}</b> ${route.distanceKm.toFixed(2)} km</span>
        <span><b>Tiempo estimado:</b> ${etaMinutes} min</span>
        <span><b>Paradas:</b> ${route.order.length}</span>
      </div>
      <ol class="stops">
        ${routeStops.map((stop) => `<li>${escapeHtml(stop)}</li>`).join("")}
      </ol>
    `;

    resultsListEl.appendChild(card);
  });
}

function formatRouteStops(order, clients) {
  return order.map((clientIndex, idx) => {
    const client = clients[clientIndex];
    return `${idx + 1}. ${client.name}`;
  });
}

function estimateMinutes(distanceKm) {
  const avgSpeedKmH = 28;
  return Math.round((distanceKm / avgSpeedKmH) * 60);
}

function fitMapToPoints(clients) {
  const latLngs = clients.map((c) => [c.lat, c.lng]);

  if (latLngs.length === 0) {
    return;
  }

  const bounds = L.latLngBounds(latLngs);
  state.map.fitBounds(bounds.pad(0.25));
}

function clearMapLayers() {
  state.pointsLayer.clearLayers();
  state.routesLayer.clearLayers();
  state.markers = [];
  state.polylines = [];
}

function clearResults() {
  resultsListEl.innerHTML = "";
  resultsEmptyEl.style.display = "block";
  routeViewControlsEl.hidden = true;
}

function setStatus(message, type = "ok") {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function updateRouteSelector(routeCount, selectedIndex) {
  routeSelectorEl.innerHTML = "";
  for (let idx = 0; idx < routeCount; idx += 1) {
    const option = document.createElement("option");
    option.value = String(idx);
    option.textContent = `Recorrido #${idx + 1}`;
    routeSelectorEl.appendChild(option);
  }
  routeSelectorEl.value = String(selectedIndex);
  routeViewControlsEl.hidden = routeCount === 0;
}

function selectRoute(index) {
  if (!state.run) {
    return;
  }
  if (!Number.isInteger(index) || index < 0 || index >= state.run.rankedRoutes.length) {
    return;
  }
  state.selectedRouteIndex = index;
  routeSelectorEl.value = String(index);
  refreshMapAndResults();
}

function refreshMapAndResults() {
  if (!state.run) {
    return;
  }

  clearMapLayers();
  const { clients, rankedRoutes, depot, returnToDepot } = state.run;
  const selectedRoute = rankedRoutes[state.selectedRouteIndex];
  const visitOrder = buildVisitOrderMap(selectedRoute.order);

  plotPoints(clients, visitOrder);
  drawRoutes(clients, rankedRoutes, depot, returnToDepot);
  renderResults(clients, rankedRoutes, depot, returnToDepot);
}
