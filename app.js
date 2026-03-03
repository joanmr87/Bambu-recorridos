const ROUTE_COLORS = ["#0ea5e9", "#f97316", "#10b981"];
const DEFAULT_DEPOT = { lat: -39.0715, lng: -67.2379 };
const MAX_GMAPS_WAYPOINTS = 8;
const CLIENT_CACHE_TTL_MS = 5 * 60 * 1000;
const CLIENT_CACHE_KEY = "bambu_clients_cache_v1";

const SHEET_SOURCES = [
  {
    key: "sheet-1",
    label: "Clientes Base 1",
    proxyPath: "/data/sheet-1.csv",
    directUrl:
      "https://docs.google.com/spreadsheets/d/1-NyQPkbwJw19hOeLvGoc6Ob3amxfcePBXG_Bki39uq4/gviz/tq?tqx=out:csv",
  },
  {
    key: "sheet-2",
    label: "Clientes Base 2",
    proxyPath: "/data/sheet-2.csv",
    directUrl:
      "https://docs.google.com/spreadsheets/d/1FfQGGBDODbQF9XVI5ylxGAYsSjhWF3WQ98W68xcSas4/gviz/tq?tqx=out:csv",
  },
];

const state = {
  map: null,
  pointsLayer: null,
  routesLayer: null,
  markers: [],
  polylines: [],
  availableClients: [],
  selectedClients: [],
  filteredSuggestions: [],
  loadingSheets: false,
  run: null,
  selectedRouteIndex: 0,
};

const depotLatInput = document.getElementById("depot-lat");
const depotLngInput = document.getElementById("depot-lng");
const returnToDepotInput = document.getElementById("return-to-depot");
const useRoadNetworkInput = document.getElementById("use-road-network");
const optimizeBtn = document.getElementById("optimize-btn");
const statusEl = document.getElementById("status");
const resultsEmptyEl = document.getElementById("results-empty");
const resultsListEl = document.getElementById("results-list");
const routeViewControlsEl = document.getElementById("route-view-controls");
const routeSelectorEl = document.getElementById("route-selector");

const clientSearchBlockEl = document.getElementById("client-search-block");
const clientSearchInput = document.getElementById("client-search");
const clientSuggestionsEl = document.getElementById("client-suggestions");
const selectedClientsListEl = document.getElementById("selected-clients-list");
const selectedCountEl = document.getElementById("selected-count");
const sheetMetaEl = document.getElementById("sheet-meta");
const reloadSheetsBtn = document.getElementById("reload-sheets");
const clearSelectedBtn = document.getElementById("clear-selected");

init();

function init() {
  initMap();
  depotLatInput.value = String(DEFAULT_DEPOT.lat);
  depotLngInput.value = String(DEFAULT_DEPOT.lng);

  optimizeBtn.addEventListener("click", async () => {
    await runOptimization();
  });

  routeSelectorEl.addEventListener("change", () => {
    const index = Number(routeSelectorEl.value);
    selectRoute(index);
  });

  resultsListEl.addEventListener("click", (event) => {
    const copyButton = event.target.closest("[data-copy-url]");
    if (copyButton) {
      event.preventDefault();
      event.stopPropagation();
      copyLinkToClipboard(copyButton.dataset.copyUrl);
      return;
    }

    const copyMessageButton = event.target.closest("[data-copy-route-index]");
    if (copyMessageButton) {
      event.preventDefault();
      event.stopPropagation();
      copyWhatsAppMessage(Number(copyMessageButton.dataset.copyRouteIndex));
      return;
    }

    if (event.target.closest("a,button")) {
      return;
    }

    const card = event.target.closest("[data-route-index]");
    if (!card) {
      return;
    }
    const index = Number(card.dataset.routeIndex);
    selectRoute(index);
  });

  clientSearchInput.addEventListener("input", () => {
    updateSuggestions(clientSearchInput.value);
  });

  clientSearchInput.addEventListener("focus", () => {
    updateSuggestions(clientSearchInput.value);
  });

  clientSearchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    if (state.filteredSuggestions.length === 0) {
      return;
    }
    addClientToSelection(state.filteredSuggestions[0].id);
  });

  clientSuggestionsEl.addEventListener("click", (event) => {
    const option = event.target.closest("[data-client-id]");
    if (!option) {
      return;
    }
    addClientToSelection(option.dataset.clientId);
  });

  selectedClientsListEl.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-remove-client-id]");
    if (!removeButton) {
      return;
    }
    removeClientFromSelection(removeButton.dataset.removeClientId);
  });

  reloadSheetsBtn.addEventListener("click", async () => {
    await loadClientsFromSheets(true);
  });

  clearSelectedBtn.addEventListener("click", () => {
    if (state.selectedClients.length === 0) {
      return;
    }
    state.selectedClients = [];
    renderSelectedClients();
    invalidateComputedRoutes();
    setStatus("Selección limpiada.", "ok");
  });

  document.addEventListener("click", (event) => {
    if (!clientSearchBlockEl.contains(event.target)) {
      hideSuggestions();
    }
  });

  renderSelectedClients();
  setStatus("Sincronizando clientes desde Google Sheets...", "ok");
  loadClientsFromSheets(false);
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

async function loadClientsFromSheets(manualRefresh) {
  setSheetsLoading(true);

  if (!manualRefresh) {
    const cached = readClientsCache();
    if (cached && isCacheFresh(cached.timestamp)) {
      applyAvailableClients(cached.clients);
      const stamp = formatTimestamp(cached.timestamp);
      sheetMetaEl.textContent = `Clientes disponibles: ${cached.clients.length}. Cache local vigente (${stamp}).`;
      setStatus("Clientes cargados desde cache local (5 min).", "ok");
      setSheetsLoading(false);
      return;
    }
  }

  sheetMetaEl.textContent = "Sincronizando con Google Sheets...";

  try {
    const sourceClients = await Promise.all(SHEET_SOURCES.map((source) => fetchClientsFromSource(source)));
    const merged = mergeAndNormalizeClients(sourceClients.flat());
    applyAvailableClients(merged);
    saveClientsCache(merged);

    const stamp = formatTimestamp(Date.now());
    sheetMetaEl.textContent = `Clientes disponibles: ${merged.length}. Última actualización en vivo: ${stamp}.`;

    if (manualRefresh) {
      invalidateComputedRoutes();
      setStatus("Clientes actualizados en vivo desde Google Sheets.", "ok");
    } else {
      setStatus("Clientes cargados desde Google Sheets. Buscá por dirección para agregarlos.", "ok");
    }
  } catch (error) {
    console.error(error);
    sheetMetaEl.textContent = "No se pudo sincronizar clientes.";
    setStatus(
      "No se pudieron cargar los Google Sheets. Revisá conexión/permisos o desplegá en Netlify para usar el proxy.",
      "warn",
    );
  } finally {
    setSheetsLoading(false);
  }
}

function setSheetsLoading(isLoading) {
  state.loadingSheets = isLoading;
  reloadSheetsBtn.disabled = isLoading;
  clientSearchInput.disabled = isLoading;
}

function applyAvailableClients(clients) {
  state.availableClients = clients;
  const selectedKeys = new Set(state.selectedClients.map((client) => client.key));
  state.selectedClients = clients.filter((client) => selectedKeys.has(client.key));
  renderSelectedClients();
  updateSuggestions(clientSearchInput.value);
}

function readClientsCache() {
  if (!window.localStorage) {
    return null;
  }

  try {
    const raw = localStorage.getItem(CLIENT_CACHE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.clients) || !Number.isFinite(parsed.timestamp)) {
      return null;
    }

    return {
      timestamp: parsed.timestamp,
      clients: parsed.clients,
    };
  } catch {
    return null;
  }
}

function saveClientsCache(clients) {
  if (!window.localStorage) {
    return;
  }

  try {
    const payload = {
      timestamp: Date.now(),
      clients,
    };
    localStorage.setItem(CLIENT_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Si localStorage falla, la app sigue funcionando sin cache.
  }
}

function isCacheFresh(timestamp) {
  return Date.now() - timestamp < CLIENT_CACHE_TTL_MS;
}

function formatTimestamp(timestamp) {
  return new Date(timestamp).toLocaleString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

async function fetchClientsFromSource(source) {
  const csvText = await fetchSheetCsv(source);
  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    return [];
  }

  const headers = rows[0].map((header) => normalizeText(header));
  const addressIndex = findHeaderIndex(headers, ["cliente", "direccion", "dirección", "domicilio"]);
  const cityIndex = findHeaderIndex(headers, ["ciudad", "localidad"]);
  const coordsIndex = findHeaderIndex(headers, ["coordenadas 2", "coordenadas", "coord"]);

  if (addressIndex === -1 || coordsIndex === -1) {
    throw new Error(`No se encontraron columnas esperadas en ${source.label}.`);
  }

  const clients = [];
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const name = (row[addressIndex] || "").trim();
    const city = cityIndex >= 0 ? (row[cityIndex] || "").trim() : "";
    const coordsRaw = (row[coordsIndex] || "").trim();

    if (!name) {
      continue;
    }

    const coords = parseCoordinates(coordsRaw);
    if (!coords) {
      continue;
    }

    clients.push({
      key: `${source.key}-${i}`,
      name,
      city,
      lat: coords.lat,
      lng: coords.lng,
      source: source.label,
    });
  }

  return clients;
}

async function fetchSheetCsv(source) {
  const bust = `t=${Date.now()}`;
  const proxyUrl = `${source.proxyPath}?${bust}`;
  const directUrl = `${source.directUrl}&${bust}`;

  try {
    const response = await fetch(proxyUrl, { cache: "no-store" });
    if (response.ok) {
      return await response.text();
    }
  } catch {
    // Fallback directo
  }

  const response = await fetch(directUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`No se pudo descargar ${source.label}.`);
  }
  return await response.text();
}

function findHeaderIndex(headers, candidates) {
  for (const candidate of candidates) {
    const idx = headers.findIndex((value) => value.includes(candidate));
    if (idx !== -1) {
      return idx;
    }
  }
  return -1;
}

function mergeAndNormalizeClients(clients) {
  const deduped = new Map();

  clients.forEach((client) => {
    const key = `${normalizeText(client.name)}|${client.lat.toFixed(6)}|${client.lng.toFixed(6)}`;
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, {
        ...client,
        key,
        sources: [client.source],
      });
      return;
    }

    if (!existing.sources.includes(client.source)) {
      existing.sources.push(client.source);
    }
  });

  return [...deduped.values()]
    .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }))
    .map((client, idx) => ({
      ...client,
      id: `client-${idx + 1}`,
    }));
}

function parseCsv(csvText) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i += 1) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        value += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        i += 1;
      }
      row.push(value);
      value = "";
      if (row.some((cell) => cell.trim() !== "")) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    value += char;
  }

  if (value !== "" || row.length > 0) {
    row.push(value);
    if (row.some((cell) => cell.trim() !== "")) {
      rows.push(row);
    }
  }

  return rows;
}

function parseCoordinates(raw) {
  if (!raw) {
    return null;
  }

  const matches = [...raw.matchAll(/-?\d{1,3}(?:[\.,]\d+)?/g)];
  if (matches.length < 2) {
    return null;
  }

  const lat = Number(matches[0][0].replace(",", "."));
  const lng = Number(matches[1][0].replace(",", "."));

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }

  return { lat, lng };
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function updateSuggestions(queryRaw) {
  const query = normalizeText(queryRaw);
  if (!query) {
    state.filteredSuggestions = [];
    hideSuggestions();
    return;
  }

  const selectedKeys = new Set(state.selectedClients.map((client) => client.key));
  state.filteredSuggestions = state.availableClients
    .filter((client) => !selectedKeys.has(client.key))
    .filter((client) => {
      const address = normalizeText(client.name);
      const city = normalizeText(client.city);
      return address.includes(query) || city.includes(query);
    })
    .slice(0, 12);

  renderSuggestions(queryRaw);
}

function renderSuggestions(queryRaw) {
  if (!queryRaw.trim()) {
    hideSuggestions();
    return;
  }

  if (state.filteredSuggestions.length === 0) {
    clientSuggestionsEl.innerHTML = '<div class="suggestion-empty">Sin resultados para esa búsqueda.</div>';
    clientSuggestionsEl.hidden = false;
    return;
  }

  clientSuggestionsEl.innerHTML = state.filteredSuggestions
    .map(
      (client) => `
      <button type="button" class="suggestion-item" data-client-id="${client.id}">
        <span class="suggestion-main">${escapeHtml(client.name)}</span>
        <span class="suggestion-sub">${escapeHtml(client.city || "Sin ciudad")}</span>
      </button>
    `,
    )
    .join("");

  clientSuggestionsEl.hidden = false;
}

function hideSuggestions() {
  clientSuggestionsEl.hidden = true;
}

function addClientToSelection(clientId) {
  const client = state.availableClients.find((item) => item.id === clientId);
  if (!client) {
    return;
  }

  if (state.selectedClients.some((item) => item.key === client.key)) {
    setStatus("Ese cliente ya está agregado al recorrido.", "warn");
    return;
  }

  state.selectedClients.push(client);
  renderSelectedClients();

  clientSearchInput.value = "";
  state.filteredSuggestions = [];
  hideSuggestions();

  invalidateComputedRoutes();
  setStatus(`Cliente agregado: ${client.name}`, "ok");
}

function removeClientFromSelection(clientKey) {
  const before = state.selectedClients.length;
  state.selectedClients = state.selectedClients.filter((client) => client.key !== clientKey);
  if (state.selectedClients.length === before) {
    return;
  }

  renderSelectedClients();
  invalidateComputedRoutes();
  setStatus("Cliente removido de la selección.", "ok");
}

function renderSelectedClients() {
  selectedCountEl.textContent = String(state.selectedClients.length);

  if (state.selectedClients.length === 0) {
    selectedClientsListEl.innerHTML = '<li class="selected-empty">Todavía no seleccionaste clientes.</li>';
    return;
  }

  selectedClientsListEl.innerHTML = state.selectedClients
    .map(
      (client) => `
      <li class="selected-item">
        <div>
          <div class="selected-main">${escapeHtml(client.name)}</div>
          <div class="selected-sub">${escapeHtml(client.city || "Sin ciudad")}</div>
        </div>
        <button type="button" class="remove-selected-btn" data-remove-client-id="${escapeHtmlAttr(client.key)}">Quitar</button>
      </li>
    `,
    )
    .join("");
}

function invalidateComputedRoutes() {
  state.run = null;
  state.selectedRouteIndex = 0;
  clearMapLayers();
  clearResults();
}

async function runOptimization() {
  clearMapLayers();
  clearResults();

  const clients = [...state.selectedClients];
  if (clients.length < 2) {
    setStatus("Seleccioná al menos 2 clientes desde el buscador para optimizar recorridos.", "warn");
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

function drawRoutes(clients, rankedRoutes) {
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
    const googleMapsLinks = createGoogleMapsLinks(route.order, clients, depot, returnToDepot);
    const whatsappMessage = buildWhatsAppMessage(route, idx, googleMapsLinks);
    const whatsappShareUrl = createWhatsAppShareUrl(whatsappMessage);
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
      <div class="gmaps-block">
        <div class="gmaps-title">Navegación para repartidor</div>
        ${googleMapsLinks
          .map(
            (segment) => `
            <div class="gmaps-row">
              <a class="gmaps-link" href="${escapeHtmlAttr(segment.url)}" target="_blank" rel="noopener noreferrer">
                Abrir ${escapeHtml(segment.label)}
              </a>
              <button class="copy-link-btn" type="button" data-copy-url="${escapeHtmlAttr(segment.url)}">
                Copiar ${escapeHtml(segment.label)}
              </button>
            </div>
          `,
          )
          .join("")}
        ${
          googleMapsLinks.length > 1
            ? `<small class="gmaps-note">Se generaron ${googleMapsLinks.length} tramos por límite de puntos de Google Maps.</small>`
            : ""
        }
        <div class="gmaps-row">
          <button class="copy-link-btn" type="button" data-copy-route-index="${idx}">
            Copiar mensaje WhatsApp
          </button>
          <a class="gmaps-link" href="${escapeHtmlAttr(whatsappShareUrl)}" target="_blank" rel="noopener noreferrer">
            Abrir WhatsApp con mensaje
          </a>
        </div>
      </div>
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

function escapeHtmlAttr(value) {
  return escapeHtml(value);
}

function createGoogleMapsLinks(order, clients, depot, returnToDepot) {
  const points = [];
  if (depot) {
    points.push({ lat: depot.lat, lng: depot.lng });
  }

  order.forEach((clientIndex) => {
    const client = clients[clientIndex];
    points.push({ lat: client.lat, lng: client.lng });
  });

  if (depot && returnToDepot) {
    points.push({ lat: depot.lat, lng: depot.lng });
  }

  if (points.length < 2) {
    return [];
  }

  const segments = splitPointsForGoogleMaps(points, MAX_GMAPS_WAYPOINTS);
  return segments.map((segment, idx) => ({
    label: segments.length === 1 ? "ruta completa" : `tramo ${idx + 1}`,
    url: buildGoogleMapsDirectionsUrl(segment),
  }));
}

function createWhatsAppShareUrl(message) {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

function buildWhatsAppMessage(route, routeIndex, googleMapsLinks) {
  const lines = [
    `Bambú - Recorrido #${routeIndex + 1}`,
    `Paradas: ${route.order.length}`,
    `Distancia estimada: ${route.distanceKm.toFixed(2)} km`,
    "",
    "Navegación Google Maps:",
  ];

  googleMapsLinks.forEach((segment) => {
    lines.push(`- ${formatSegmentLabel(segment.label)}: ${segment.url}`);
  });

  if (googleMapsLinks.length > 1) {
    lines.push("", "Nota: abrir los tramos en orden.");
  }

  return lines.join("\n");
}

function formatSegmentLabel(label) {
  if (!label) {
    return "Ruta";
  }
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function splitPointsForGoogleMaps(points, maxWaypoints) {
  const segments = [];
  let startIndex = 0;

  while (startIndex < points.length - 1) {
    const endIndex = Math.min(startIndex + maxWaypoints + 1, points.length - 1);
    segments.push(points.slice(startIndex, endIndex + 1));
    startIndex = endIndex;
  }

  return segments;
}

function buildGoogleMapsDirectionsUrl(points) {
  const sequence = points.map(toLatLng).join("/");
  return `https://www.google.com/maps/dir/${encodeURI(sequence)}/?travelmode=driving`;
}

function toLatLng(point) {
  return `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
}

async function copyLinkToClipboard(url) {
  await copyTextToClipboard(url, "Link de Google Maps copiado.");
}

async function copyWhatsAppMessage(routeIndex) {
  if (!state.run) {
    return;
  }

  const route = state.run.rankedRoutes[routeIndex];
  if (!route) {
    return;
  }

  const links = createGoogleMapsLinks(route.order, state.run.clients, state.run.depot, state.run.returnToDepot);
  const message = buildWhatsAppMessage(route, routeIndex, links);
  await copyTextToClipboard(message, "Mensaje para WhatsApp copiado.");
}

async function copyTextToClipboard(text, successMessage) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
    }

    setStatus(successMessage, "ok");
  } catch {
    setStatus("No se pudo copiar el contenido automáticamente.", "warn");
  }
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
  drawRoutes(clients, rankedRoutes);
  renderResults(clients, rankedRoutes, depot, returnToDepot);
}
