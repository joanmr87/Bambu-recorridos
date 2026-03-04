const ROUTE_COLORS = ["#0ea5e9", "#f97316", "#10b981"];
const DEFAULT_DEPOT = { lat: -39.0715, lng: -67.2379 };
const DEFAULT_DEPOT_NAME = "Depósito (Ingeniero Huergo)";
const MAX_GMAPS_WAYPOINTS = 8;
const CLIENT_CACHE_TTL_MS = 5 * 60 * 1000;
const CLIENT_CACHE_KEY = "bambu_clients_cache_v1";
const AVG_SPEED_KMH = 28;
const SERVICE_MINUTES_PER_STOP = 15;

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
  startPointLayer: null,
  startPointMarker: null,
  markers: [],
  polylines: [],
  availableClients: [],
  selectedClients: [],
  filteredSuggestions: [],
  loadingSheets: false,
  run: null,
  selectedRouteIndex: 0,
  driverMode: false,
  routeEditorSortable: null,
  selectedMapStartPoint: null,
  pickingMapStartPoint: false,
};

const startPointModeEl = document.getElementById("start-point-mode");
const startClientGroupEl = document.getElementById("start-client-group");
const startClientSelectEl = document.getElementById("start-client-select");
const startMapGroupEl = document.getElementById("start-map-group");
const pickStartPointBtn = document.getElementById("pick-start-point-btn");
const startMapCoordsEl = document.getElementById("start-map-coords");
const startPointHelpEl = document.getElementById("start-point-help");
const departureTimeInput = document.getElementById("departure-time");
const manualOrderModeInput = document.getElementById("manual-order-mode");
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
const routeEditorPanelEl = document.getElementById("route-editor-panel");
const routeEditorListEl = document.getElementById("route-editor-list");
const routeEditorHelpEl = document.getElementById("route-editor-help");
const resetRouteOrderBtn = document.getElementById("reset-route-order");
const sheetMetaEl = document.getElementById("sheet-meta");
const reloadSheetsBtn = document.getElementById("reload-sheets");
const clearSelectedBtn = document.getElementById("clear-selected");
const appTitleEl = document.querySelector(".app-header h1");
const appSubtitleEl = document.querySelector(".app-header p");

init();

function init() {
  initMap();
  startPointModeEl.value = "default";
  manualOrderModeInput.checked = false;
  updateStartPointControls();
  updateOptimizeButtonLabel();
  initRouteEditor();

  optimizeBtn.addEventListener("click", async () => {
    await runOptimization();
  });

  routeSelectorEl.addEventListener("change", () => {
    const index = Number(routeSelectorEl.value);
    selectRoute(index);
  });

  resultsListEl.addEventListener("click", (event) => {
    const copyMapsButton = event.target.closest("[data-copy-maps-route-index]");
    if (copyMapsButton) {
      event.preventDefault();
      event.stopPropagation();
      copyGoogleMapsRoute(Number(copyMapsButton.dataset.copyMapsRouteIndex));
      return;
    }

    const copyDriverUrlButton = event.target.closest("[data-copy-driver-url]");
    if (copyDriverUrlButton) {
      event.preventDefault();
      event.stopPropagation();
      copyTextToClipboard(copyDriverUrlButton.dataset.copyDriverUrl, "URL modo chofer copiada.");
      return;
    }

    const exportButton = event.target.closest("[data-export-route-index]");
    if (exportButton) {
      event.preventDefault();
      event.stopPropagation();
      exportRouteForMyMaps(
        Number(exportButton.dataset.exportRouteIndex),
        exportButton.dataset.exportFormat || "csv",
      );
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
    const moveButton = event.target.closest("[data-move-client-id]");
    if (moveButton) {
      const direction = Number(moveButton.dataset.moveDirection);
      moveClientInSelection(moveButton.dataset.moveClientId, direction);
      return;
    }

    const removeButton = event.target.closest("[data-remove-client-id]");
    if (!removeButton) {
      return;
    }
    removeClientFromSelection(removeButton.dataset.removeClientId);
  });

  startPointModeEl.addEventListener("change", () => {
    updateStartPointControls();
    invalidateComputedRoutes();
  });

  startClientSelectEl.addEventListener("change", () => {
    invalidateComputedRoutes();
  });

  pickStartPointBtn.addEventListener("click", () => {
    beginMapStartPointSelection();
  });

  departureTimeInput.addEventListener("change", () => {
    if (state.run) {
      refreshMapAndResults();
    }
  });

  manualOrderModeInput.addEventListener("change", () => {
    updateOptimizeButtonLabel();
    invalidateComputedRoutes();
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
    populateStartClientSelect();
    invalidateComputedRoutes();
    setStatus("Selección limpiada.", "ok");
  });

  resetRouteOrderBtn.addEventListener("click", () => {
    restoreSuggestedOrder();
  });

  document.addEventListener("click", (event) => {
    if (!clientSearchBlockEl.contains(event.target)) {
      hideSuggestions();
    }
  });

  const sharedRoute = parseSharedRouteFromUrl();
  if (sharedRoute) {
    activateDriverMode(sharedRoute);
    return;
  }

  renderSelectedClients();
  populateStartClientSelect();
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
  state.startPointLayer = L.layerGroup().addTo(state.map);

  state.map.on("click", (event) => {
    if (!state.pickingMapStartPoint || startPointModeEl.value !== "map") {
      return;
    }
    setMapStartPoint(event.latlng.lat, event.latlng.lng);
  });
}

function initRouteEditor() {
  if (!routeEditorListEl) {
    return;
  }

  if (typeof window.Sortable !== "function") {
    routeEditorHelpEl.textContent =
      "Editor de arrastre no disponible en este navegador. Podés usar las flechas del listado.";
    return;
  }

  state.routeEditorSortable = window.Sortable.create(routeEditorListEl, {
    animation: 150,
    handle: ".route-editor-handle",
    ghostClass: "route-editor-ghost",
    chosenClass: "route-editor-chosen",
    dragClass: "route-editor-drag",
    onEnd: () => {
      applyRouteEditorOrder();
    },
  });
}

function beginMapStartPointSelection() {
  if (startPointModeEl.value !== "map") {
    startPointModeEl.value = "map";
    updateStartPointControls();
  }

  state.pickingMapStartPoint = true;
  const mapEl = state.map?.getContainer();
  if (mapEl) {
    mapEl.classList.add("pick-start-point-mode");
  }

  setStatus("Hacé clic en el mapa para fijar el punto de salida.", "ok");
}

function setMapStartPoint(lat, lng) {
  state.selectedMapStartPoint = {
    lat: round6(lat),
    lng: round6(lng),
    name: "Punto elegido en mapa",
  };
  state.pickingMapStartPoint = false;

  const mapEl = state.map?.getContainer();
  if (mapEl) {
    mapEl.classList.remove("pick-start-point-mode");
  }

  renderMapStartPointMarker();
  updateStartPointControls();
  invalidateComputedRoutes();
  setStatus(
    `Punto de salida seleccionado: ${state.selectedMapStartPoint.lat.toFixed(6)}, ${state.selectedMapStartPoint.lng.toFixed(6)}`,
    "ok",
  );
}

function renderMapStartPointMarker() {
  state.startPointLayer.clearLayers();
  state.startPointMarker = null;

  if (startPointModeEl.value !== "map" || !state.selectedMapStartPoint) {
    return;
  }

  const point = state.selectedMapStartPoint;
  const marker = L.circleMarker([point.lat, point.lng], {
    radius: 9,
    color: "#0c4a6e",
    fillColor: "#38bdf8",
    fillOpacity: 0.92,
    weight: 2,
  }).addTo(state.startPointLayer);

  marker.bindPopup(`<b>Punto de salida</b><br>${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`);
  state.startPointMarker = marker;
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
  if (startPointModeEl.value === "client") {
    startClientSelectEl.disabled = isLoading || state.availableClients.length === 0;
  }
}

function applyAvailableClients(clients) {
  state.availableClients = clients;
  const selectedKeys = new Set(state.selectedClients.map((client) => client.key));
  state.selectedClients = clients.filter((client) => selectedKeys.has(client.key));
  renderSelectedClients();
  populateStartClientSelect();
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
  populateStartClientSelect();

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
  populateStartClientSelect();
  invalidateComputedRoutes();
  setStatus("Cliente removido de la selección.", "ok");
}

function moveClientInSelection(clientKey, direction) {
  if (!Number.isInteger(direction) || direction === 0) {
    return;
  }

  const currentIndex = state.selectedClients.findIndex((client) => client.key === clientKey);
  if (currentIndex === -1) {
    return;
  }

  const nextIndex = currentIndex + direction;
  if (nextIndex < 0 || nextIndex >= state.selectedClients.length) {
    return;
  }

  const reordered = [...state.selectedClients];
  [reordered[currentIndex], reordered[nextIndex]] = [reordered[nextIndex], reordered[currentIndex]];
  state.selectedClients = reordered;

  renderSelectedClients();
  populateStartClientSelect();
  invalidateComputedRoutes();
  setStatus("Orden manual actualizado.", "ok");
}

function renderSelectedClients() {
  selectedCountEl.textContent = String(state.selectedClients.length);

  if (state.selectedClients.length === 0) {
    selectedClientsListEl.innerHTML = '<li class="selected-empty">Todavía no seleccionaste clientes.</li>';
    return;
  }

  selectedClientsListEl.innerHTML = state.selectedClients
    .map(
      (client, idx) => `
      <li class="selected-item">
        <div>
          <div class="selected-main">${idx + 1}. ${escapeHtml(client.name)}</div>
          <div class="selected-sub">${escapeHtml(client.city || "Sin ciudad")}</div>
        </div>
        <div class="selected-actions">
          <button
            type="button"
            class="move-selected-btn"
            data-move-client-id="${escapeHtmlAttr(client.key)}"
            data-move-direction="-1"
            ${idx === 0 ? "disabled" : ""}
          >
            ↑
          </button>
          <button
            type="button"
            class="move-selected-btn"
            data-move-client-id="${escapeHtmlAttr(client.key)}"
            data-move-direction="1"
            ${idx === state.selectedClients.length - 1 ? "disabled" : ""}
          >
            ↓
          </button>
          <button type="button" class="remove-selected-btn" data-remove-client-id="${escapeHtmlAttr(client.key)}">Quitar</button>
        </div>
      </li>
    `,
    )
    .join("");
}

function populateStartClientSelect() {
  const previousValue = startClientSelectEl.value;
  const ordered = [];
  const seen = new Set();

  state.selectedClients.forEach((client) => {
    if (seen.has(client.id)) {
      return;
    }
    ordered.push(client);
    seen.add(client.id);
  });

  state.availableClients.forEach((client) => {
    if (seen.has(client.id)) {
      return;
    }
    ordered.push(client);
    seen.add(client.id);
  });

  if (ordered.length === 0) {
    startClientSelectEl.innerHTML = '<option value="">No hay clientes cargados</option>';
    startClientSelectEl.disabled = true;
    updateStartPointControls();
    return;
  }

  startClientSelectEl.disabled = false;
  startClientSelectEl.innerHTML = ordered
    .map((client) => {
      const city = client.city ? ` - ${client.city}` : "";
      return `<option value="${escapeHtmlAttr(client.id)}">${escapeHtml(client.name)}${escapeHtml(city)}</option>`;
    })
    .join("");

  const selectedStillExists = ordered.some((client) => client.id === previousValue);
  startClientSelectEl.value = selectedStillExists ? previousValue : ordered[0].id;
  updateStartPointControls();
}

function updateStartPointControls() {
  const mode = startPointModeEl.value;
  startClientGroupEl.hidden = mode !== "client";
  startMapGroupEl.hidden = mode !== "map";

  if (mode === "none") {
    returnToDepotInput.checked = false;
    returnToDepotInput.disabled = true;
    state.pickingMapStartPoint = false;
    const mapEl = state.map?.getContainer();
    if (mapEl) {
      mapEl.classList.remove("pick-start-point-mode");
    }
    startPointHelpEl.textContent = "La ruta se calcula solamente entre clientes seleccionados.";
    renderMapStartPointMarker();
    return;
  }

  returnToDepotInput.disabled = false;

  if (mode === "default") {
    state.pickingMapStartPoint = false;
    const mapEl = state.map?.getContainer();
    if (mapEl) {
      mapEl.classList.remove("pick-start-point-mode");
    }
    startPointHelpEl.textContent = "Salida y regreso desde Ingeniero Huergo.";
    renderMapStartPointMarker();
    return;
  }

  if (mode === "client") {
    state.pickingMapStartPoint = false;
    const mapEl = state.map?.getContainer();
    if (mapEl) {
      mapEl.classList.remove("pick-start-point-mode");
    }
    if (startClientSelectEl.disabled || !startClientSelectEl.value) {
      startPointHelpEl.textContent = "Primero cargá clientes para poder elegir salida desde cliente.";
    } else {
      const client = state.availableClients.find((item) => item.id === startClientSelectEl.value);
      const clientName = client ? client.name : "cliente seleccionado";
      startPointHelpEl.textContent = `La ruta saldrá desde: ${clientName}.`;
    }
    renderMapStartPointMarker();
    return;
  }

  if (state.selectedMapStartPoint) {
    startMapCoordsEl.textContent = `${state.selectedMapStartPoint.lat.toFixed(6)}, ${state.selectedMapStartPoint.lng.toFixed(6)}`;
  } else {
    startMapCoordsEl.textContent = "Todavía no seleccionaste un punto.";
  }
  startPointHelpEl.textContent = "Usá el botón y luego hacé clic en el mapa para fijar la salida.";
  renderMapStartPointMarker();
}

function updateOptimizeButtonLabel() {
  optimizeBtn.textContent = manualOrderModeInput.checked
    ? "Generar 1 ruta manual"
    : "Calcular 3 recorridos óptimos";
}

function invalidateComputedRoutes() {
  state.run = null;
  state.selectedRouteIndex = 0;
  clearMapLayers();
  clearResults();
  clearRouteEditor();
}

async function runOptimization() {
  clearMapLayers();
  clearResults();

  const clients = [...state.selectedClients];
  const manualOrderMode = Boolean(manualOrderModeInput.checked);
  if (!manualOrderMode && clients.length < 2) {
    setStatus("Seleccioná al menos 2 clientes desde el buscador para optimizar recorridos.", "warn");
    return;
  }
  if (manualOrderMode && clients.length < 1) {
    setStatus("Seleccioná al menos 1 cliente para armar un recorrido manual.", "warn");
    return;
  }

  const depot = resolveStartPoint();
  if (!depot && startPointModeEl.value !== "none") {
    if (startPointModeEl.value === "map") {
      setStatus("Seleccioná un punto en el mapa para usarlo como salida.", "warn");
      return;
    }
    setStatus("Revisá el punto de salida seleccionado antes de calcular.", "warn");
    return;
  }
  const returnToDepot = Boolean(returnToDepotInput.checked && depot);
  const useRoadNetwork = Boolean(useRoadNetworkInput.checked);
  const departureMinutes = parseTimeToMinutes(departureTimeInput.value);

  setStatus("Calculando rutas...", "ok");
  const distanceModel = await buildDistanceModel(clients, depot, returnToDepot, useRoadNetwork);
  const rankedRoutesRaw = manualOrderMode ? buildManualRoute(distanceModel) : buildTopRoutes(distanceModel, 3);
  const rankedRoutes = rankedRoutesRaw.map((route) => ({
    ...route,
    originalOrder: [...route.order],
    userEdited: false,
  }));

  if (rankedRoutes.length === 0) {
    setStatus("No se pudieron generar rutas. Revisá los datos de entrada.", "warn");
    return;
  }

  state.run = {
    clients,
    rankedRoutes,
    depot,
    returnToDepot,
    distanceModel,
    departureMinutes,
    manualOrderMode,
  };
  state.selectedRouteIndex = 0;

  updateRouteSelector(rankedRoutes.length, state.selectedRouteIndex);
  refreshMapAndResults();

  const depotLabel = depot ? `salida desde ${depot.name}` : "sin punto de salida fijo";
  const distanceModeLabel = distanceModel.source === "road" ? "distancia vial real" : "distancia en línea recta";
  const optimizationLabel = manualOrderMode ? "1 ruta manual" : `${rankedRoutes.length} rutas óptimas`;
  setStatus(
    `Listo: ${optimizationLabel} (${clients.length} clientes, ${depotLabel}, ${distanceModeLabel}).`,
    "ok",
  );
}

function resolveStartPoint() {
  const mode = startPointModeEl.value;
  if (mode === "none") {
    return null;
  }

  if (mode === "default") {
    return { ...DEFAULT_DEPOT, name: DEFAULT_DEPOT_NAME };
  }

  if (mode === "client") {
    const clientId = startClientSelectEl.value;
    const client = state.availableClients.find((item) => item.id === clientId);
    if (!client) {
      return null;
    }
    return { lat: client.lat, lng: client.lng, name: `Cliente: ${client.name}` };
  }

  if (!state.selectedMapStartPoint) {
    return null;
  }

  return {
    lat: state.selectedMapStartPoint.lat,
    lng: state.selectedMapStartPoint.lng,
    name: "Punto elegido en mapa",
  };
}

function parseTimeToMinutes(raw) {
  if (!raw) {
    return null;
  }

  const match = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    return null;
  }
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
}

function buildManualRoute(model) {
  const order = Array.from({ length: model.matrix.length }, (_, idx) => idx);
  return [
    {
      order,
      distanceKm: routeDistance(order, model),
      isManual: true,
    },
  ];
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

    const etaMinutes = estimateMinutes(route.distanceKm, route.order.length);
    const timing = buildRouteTiming(route, state.run?.distanceModel, state.run?.departureMinutes);
    const routeStops = formatRouteStops(route.order, clients, timing.arrivalByClientIndex);
    const googleMapsLinks = createGoogleMapsLinks(route.order, clients, depot, returnToDepot);
    const driverModeUrl = buildDriverModeUrl(route, idx, clients);
    const title = route.isManual
      ? "Recorrido manual (orden definido)"
      : idx === 0
        ? "Recorrido #1 (Más óptimo)"
        : `Recorrido #${idx + 1}`;
    const titleWithEdit = route.userEdited ? `${title} (Ajustado manualmente)` : title;
    const distanceLabel = depot
      ? `Distancia total (desde ${depot.name}${returnToDepot ? " y regreso" : ""}):`
      : "Distancia total:";
    const departureMetric = timing.departureLabel
      ? `<span><b>Salida:</b> ${escapeHtml(timing.departureLabel)}</span>`
      : "";
    const finishMetric = timing.finishLabel
      ? `<span><b>Fin estimado:</b> ${escapeHtml(timing.finishLabel)}</span>`
      : "";

    card.innerHTML = `
      <h3><span class="swatch" style="background:${ROUTE_COLORS[idx % ROUTE_COLORS.length]}"></span>${titleWithEdit}</h3>
      <div class="metrics">
        <span><b>${escapeHtml(distanceLabel)}</b> ${route.distanceKm.toFixed(2)} km</span>
        <span><b>Tiempo estimado:</b> ${etaMinutes} min</span>
        <span><b>Paradas:</b> ${route.order.length}</span>
        ${departureMetric}
        ${finishMetric}
      </div>
      <div class="metrics-note">Incluye ${SERVICE_MINUTES_PER_STOP} min por parada de descarga.</div>
      <ol class="stops">
        ${routeStops
          .map(
            (stop) => `
          <li>
            <span>${escapeHtml(stop.name)}</span>
            ${stop.arrivalLabel ? `<span class="stop-arrival">${escapeHtml(stop.arrivalLabel)}</span>` : ""}
          </li>
        `,
          )
          .join("")}
      </ol>
      <div class="gmaps-block">
        <div class="gmaps-title">Navegación para repartidor</div>
        ${
          googleMapsLinks.length > 1
            ? `<small class="gmaps-note">Google Maps requiere ${googleMapsLinks.length} tramos para esta ruta. Se copiarán juntos en orden.</small>`
            : ""
        }
        <div class="gmaps-row">
          <button class="copy-link-btn" type="button" data-copy-maps-route-index="${idx}">
            Copiar ruta Google Maps
          </button>
        </div>
        <div class="gmaps-row">
          <button class="copy-link-btn" type="button" data-copy-driver-url="${escapeHtmlAttr(driverModeUrl)}">
            Copiar URL modo chofer
          </button>
        </div>
        <div class="gmaps-row">
          <button class="copy-link-btn" type="button" data-export-route-index="${idx}" data-export-format="kml">
            Exportar archivo My Maps (KML)
          </button>
        </div>
      </div>
    `;

    resultsListEl.appendChild(card);
  });
}

function formatRouteStops(order, clients, arrivalByClientIndex) {
  return order.map((clientIndex) => {
    const client = clients[clientIndex];
    return {
      name: client.name,
      arrivalLabel: arrivalByClientIndex?.get(clientIndex) || null,
    };
  });
}

function renderRouteEditor(clients, route, routeIndex) {
  if (!route || !routeEditorPanelEl || state.driverMode) {
    clearRouteEditor();
    return;
  }

  routeEditorPanelEl.hidden = false;
  routeEditorHelpEl.textContent = route.userEdited
    ? `Recorrido ${routeIndex + 1}: orden editado manualmente. Arrastrá para ajustar más.`
    : `Recorrido ${routeIndex + 1}: arrastrá las paradas para ajustar el orden sugerido por el algoritmo.`;

  routeEditorListEl.innerHTML = route.order
    .map((clientIndex, idx) => {
      const client = clients[clientIndex];
      if (!client) {
        return "";
      }
      return `
      <li class="route-editor-item" data-client-index="${clientIndex}">
        <span class="route-editor-handle" title="Arrastrar parada" aria-label="Arrastrar parada">⋮⋮</span>
        <span class="route-editor-order">${idx + 1}</span>
        <div class="route-editor-text">
          <div class="route-editor-main">${escapeHtml(client.name)}</div>
          <div class="route-editor-sub">${escapeHtml(client.city || "Sin ciudad")}</div>
        </div>
      </li>
    `;
    })
    .join("");

  resetRouteOrderBtn.disabled = !Array.isArray(route.originalOrder) || route.originalOrder.length === 0;
}

function applyRouteEditorOrder() {
  if (!state.run) {
    return;
  }
  const route = state.run.rankedRoutes[state.selectedRouteIndex];
  if (!route) {
    return;
  }

  const newOrder = Array.from(routeEditorListEl.querySelectorAll("[data-client-index]"))
    .map((item) => Number(item.dataset.clientIndex))
    .filter((value) => Number.isInteger(value));

  if (newOrder.length !== route.order.length) {
    return;
  }

  const changed = newOrder.some((clientIndex, idx) => clientIndex !== route.order[idx]);
  if (!changed) {
    return;
  }

  route.order = newOrder;
  route.userEdited = true;
  if (!Array.isArray(route.originalOrder) || route.originalOrder.length === 0) {
    route.originalOrder = [...newOrder];
  }

  if (state.run.distanceModel) {
    route.distanceKm = routeDistance(newOrder, state.run.distanceModel);
  }

  refreshMapAndResults();
  setStatus("Orden del recorrido actualizado manualmente.", "ok");
}

function restoreSuggestedOrder() {
  if (!state.run) {
    return;
  }
  const route = state.run.rankedRoutes[state.selectedRouteIndex];
  if (!route || !Array.isArray(route.originalOrder) || route.originalOrder.length === 0) {
    return;
  }

  route.order = [...route.originalOrder];
  route.userEdited = false;
  if (state.run.distanceModel) {
    route.distanceKm = routeDistance(route.order, state.run.distanceModel);
  }

  refreshMapAndResults();
  setStatus("Se restauró el orden sugerido por el algoritmo.", "ok");
}

function estimateMinutes(distanceKm, stopCount = 0) {
  return Math.round(distanceToMinutes(distanceKm) + serviceStopMinutes(stopCount));
}

function distanceToMinutes(distanceKm) {
  return (distanceKm / AVG_SPEED_KMH) * 60;
}

function serviceStopMinutes(stopCount) {
  const safeStopCount = Number.isFinite(stopCount) ? Math.max(0, stopCount) : 0;
  return safeStopCount * SERVICE_MINUTES_PER_STOP;
}

function buildRouteTiming(route, model, departureMinutes) {
  const result = {
    arrivalByClientIndex: new Map(),
    departureLabel: null,
    finishLabel: null,
  };

  if (!model || !Number.isFinite(departureMinutes) || !Array.isArray(route.order) || route.order.length === 0) {
    return result;
  }

  result.departureLabel = formatClockTime(departureMinutes);

  let cumulative = 0;
  if (model.depotDistances && route.order.length > 0) {
    cumulative += distanceToMinutes(model.depotDistances[route.order[0]] || 0);
  }

  route.order.forEach((clientIndex, idx) => {
    result.arrivalByClientIndex.set(clientIndex, formatClockTime(departureMinutes + cumulative));
    cumulative += SERVICE_MINUTES_PER_STOP;
    if (idx < route.order.length - 1) {
      const nextClientIndex = route.order[idx + 1];
      cumulative += distanceToMinutes(model.matrix[clientIndex][nextClientIndex] || 0);
    }
  });

  if (model.depotDistances && model.returnToDepot && route.order.length > 0) {
    cumulative += distanceToMinutes(model.depotDistances[route.order[route.order.length - 1]] || 0);
  }

  result.finishLabel = formatClockTime(departureMinutes + cumulative);
  return result;
}

function formatClockTime(totalMinutes) {
  const rounded = Math.round(totalMinutes);
  const dayOffset = Math.floor(rounded / (24 * 60));
  const dayMinutes = ((rounded % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours = Math.floor(dayMinutes / 60);
  const minutes = dayMinutes % 60;
  const base = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  if (dayOffset <= 0) {
    return base;
  }
  return `${base} (+${dayOffset}d)`;
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

function clearRouteEditor() {
  routeEditorPanelEl.hidden = true;
  routeEditorListEl.innerHTML = "";
  resetRouteOrderBtn.disabled = true;
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

function buildDriverModeUrl(route, routeIndex, clients) {
  const orderedStops = route.order.map((clientIndex, stopIndex) => {
    const client = clients[clientIndex];
    return {
      label: stopIndex + 1,
      name: client.name,
      lat: round6(client.lat),
      lng: round6(client.lng),
    };
  });

  const payload = {
    v: 1,
    routeIndex: routeIndex + 1,
    distanceKm: round2(route.distanceKm),
    stops: orderedStops,
  };

  const encoded = encodeSharedPayload(payload);
  const baseUrl = `${window.location.origin}${window.location.pathname}`;
  return `${baseUrl}?driver=1&route=${encoded}`;
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

function parseSharedRouteFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("driver") !== "1") {
    return null;
  }

  const encoded = params.get("route");
  if (!encoded) {
    return null;
  }

  try {
    const decoded = decodeSharedPayload(encoded);
    if (!decoded || !Array.isArray(decoded.stops)) {
      return null;
    }

    const normalizedStops = decoded.stops
      .map((stop, idx) => ({
        label: Number.isFinite(stop.label) ? stop.label : idx + 1,
        name: String(stop.name || `Parada ${idx + 1}`),
        lat: Number(stop.lat),
        lng: Number(stop.lng),
      }))
      .filter((stop) => Number.isFinite(stop.lat) && Number.isFinite(stop.lng))
      .filter((stop) => Math.abs(stop.lat) <= 90 && Math.abs(stop.lng) <= 180);

    if (normalizedStops.length < 2) {
      return null;
    }

    return {
      routeIndex: Number(decoded.routeIndex) || 1,
      distanceKm: Number(decoded.distanceKm) || 0,
      stops: normalizedStops,
    };
  } catch (error) {
    console.warn("No se pudo parsear el enlace compartido de modo chofer:", error);
    return null;
  }
}

function activateDriverMode(sharedRoute) {
  state.driverMode = true;
  document.body.classList.add("driver-mode");

  if (appTitleEl) {
    appTitleEl.textContent = `Bambú - Modo Chofer`;
  }
  if (appSubtitleEl) {
    appSubtitleEl.textContent = `Recorrido #${sharedRoute.routeIndex}`;
  }

  const clients = sharedRoute.stops.map((stop) => ({
    name: stop.name,
    lat: stop.lat,
    lng: stop.lng,
  }));
  const rankedRoutes = [
    {
      order: clients.map((_, idx) => idx),
      distanceKm: sharedRoute.distanceKm,
      originalOrder: clients.map((_, idx) => idx),
      userEdited: false,
    },
  ];

  state.run = {
    clients,
    rankedRoutes,
    depot: null,
    returnToDepot: false,
    distanceModel: null,
    departureMinutes: null,
    manualOrderMode: false,
  };
  state.selectedRouteIndex = 0;

  updateRouteSelector(1, 0);
  clearMapLayers();
  clearResults();
  clearRouteEditor();
  refreshMapAndResults();
  setStatus("Modo chofer activo. Seguí los puntos numerados en orden.", "ok");
}

function encodeSharedPayload(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeSharedPayload(encoded) {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const text = new TextDecoder().decode(bytes);
  return JSON.parse(text);
}

function round6(value) {
  return Number(Number(value).toFixed(6));
}

function round2(value) {
  return Number(Number(value).toFixed(2));
}

async function copyLinkToClipboard(url) {
  await copyTextToClipboard(url, "Link de Google Maps copiado.");
}

async function copyGoogleMapsRoute(routeIndex) {
  if (!state.run) {
    return;
  }

  const route = state.run.rankedRoutes[routeIndex];
  if (!route) {
    return;
  }

  const links = createGoogleMapsLinks(route.order, state.run.clients, state.run.depot, state.run.returnToDepot);
  if (links.length === 0) {
    setStatus("No se pudo generar la ruta de Google Maps.", "warn");
    return;
  }

  if (links.length === 1) {
    await copyLinkToClipboard(links[0].url);
    return;
  }

  const message = links.map((segment, idx) => `Tramo ${idx + 1}: ${segment.url}`).join("\n");
  await copyTextToClipboard(message, `Se copiaron ${links.length} tramos de Google Maps en orden.`);
}

function exportRouteForMyMaps(routeIndex, format) {
  if (!state.run) {
    return;
  }

  const route = state.run.rankedRoutes[routeIndex];
  if (!route) {
    return;
  }

  const stops = buildRouteStopsForExport(route, state.run.clients, state.run.depot, state.run.returnToDepot);
  if (stops.length === 0) {
    setStatus("No hay paradas para exportar.", "warn");
    return;
  }

  const safeFormat = format === "kml" ? "kml" : "csv";
  const routeName = `Recorrido ${routeIndex + 1}`;
  const fileBase = `bambu-ruta-${routeIndex + 1}-${Date.now()}`;

  if (safeFormat === "csv") {
    const csvContent = buildMyMapsCsv(stops, routeName);
    downloadTextFile(`${fileBase}.csv`, csvContent, "text/csv;charset=utf-8;");
    setStatus("CSV para Google My Maps descargado.", "ok");
    return;
  }

  const kmlContent = buildMyMapsKml(stops, routeName);
  downloadTextFile(`${fileBase}.kml`, kmlContent, "application/vnd.google-earth.kml+xml;charset=utf-8;");
  setStatus("KML para Google My Maps descargado.", "ok");
}

function buildRouteStopsForExport(route, clients, depot, returnToDepot) {
  const stops = [];

  if (depot) {
    stops.push({
      label: toAlphaLabel(stops.length),
      name: `${depot.name} (inicio)`,
      lat: depot.lat,
      lng: depot.lng,
    });
  }

  route.order.forEach((clientIndex) => {
    const client = clients[clientIndex];
    stops.push({
      label: toAlphaLabel(stops.length),
      name: client.name,
      lat: client.lat,
      lng: client.lng,
    });
  });

  if (depot && returnToDepot) {
    stops.push({
      label: toAlphaLabel(stops.length),
      name: `${depot.name} (regreso)`,
      lat: depot.lat,
      lng: depot.lng,
    });
  }

  return stops;
}

function buildMyMapsCsv(stops, routeName) {
  const header = "Name,Description,Latitude,Longitude,Address,Order";
  const rows = stops.map((stop, idx) => {
    const name = stop.label;
    const desc = `${routeName} - ${stop.name}`;
    return [
      csvEscape(name),
      csvEscape(desc),
      stop.lat.toFixed(6),
      stop.lng.toFixed(6),
      csvEscape(stop.name),
      String(idx + 1),
    ].join(",");
  });

  return [header, ...rows].join("\n");
}

function buildMyMapsKml(stops, routeName) {
  const firstStop = stops[0];
  const lastStop = stops[stops.length - 1];
  const directionsName = `Indicaciones de ${firstStop.name} a ${lastStop.name}`;
  const placemarks = stops
    .map(
      (stop, idx) => `
      <Placemark>
        <name>${xmlEscape(stop.name)}</name>
        <description><![CDATA[Orden: ${stop.label} (${idx + 1})]]></description>
        <styleUrl>#icon-1899-DB4436-nodesc</styleUrl>
        <Point>
          <coordinates>
            ${stop.lng.toFixed(6)},${stop.lat.toFixed(6)},0
          </coordinates>
        </Point>
      </Placemark>`,
    )
    .join("");

  const lineCoordinates = stops.map((stop) => `${stop.lng.toFixed(6)},${stop.lat.toFixed(6)},0`).join("\n            ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${xmlEscape(routeName)}</name>
    <description/>
    <Style id="icon-1899-DB4436-nodesc-normal">
      <IconStyle>
        <color>ff3644db</color>
        <scale>1</scale>
        <Icon>
          <href>https://www.gstatic.com/mapspro/images/stock/503-wht-blank_maps.png</href>
        </Icon>
        <hotSpot x="32" xunits="pixels" y="64" yunits="insetPixels"/>
      </IconStyle>
      <LabelStyle>
        <scale>1</scale>
      </LabelStyle>
      <BalloonStyle>
        <text><![CDATA[<h3>$[name]</h3><div>$[description]</div>]]></text>
      </BalloonStyle>
    </Style>
    <Style id="icon-1899-DB4436-nodesc-highlight">
      <IconStyle>
        <color>ff3644db</color>
        <scale>1</scale>
        <Icon>
          <href>https://www.gstatic.com/mapspro/images/stock/503-wht-blank_maps.png</href>
        </Icon>
        <hotSpot x="32" xunits="pixels" y="64" yunits="insetPixels"/>
      </IconStyle>
      <LabelStyle>
        <scale>1</scale>
      </LabelStyle>
      <BalloonStyle>
        <text><![CDATA[<h3>$[name]</h3><div>$[description]</div>]]></text>
      </BalloonStyle>
    </Style>
    <StyleMap id="icon-1899-DB4436-nodesc">
      <Pair>
        <key>normal</key>
        <styleUrl>#icon-1899-DB4436-nodesc-normal</styleUrl>
      </Pair>
      <Pair>
        <key>highlight</key>
        <styleUrl>#icon-1899-DB4436-nodesc-highlight</styleUrl>
      </Pair>
    </StyleMap>
    <Style id="line-1267FF-5000-nodesc-normal">
      <LineStyle>
        <color>ffff6712</color>
        <width>5</width>
      </LineStyle>
    </Style>
    <Style id="line-1267FF-5000-nodesc-highlight">
      <LineStyle>
        <color>ffff6712</color>
        <width>7.5</width>
      </LineStyle>
    </Style>
    <StyleMap id="line-1267FF-5000-nodesc">
      <Pair>
        <key>normal</key>
        <styleUrl>#line-1267FF-5000-nodesc-normal</styleUrl>
      </Pair>
      <Pair>
        <key>highlight</key>
        <styleUrl>#line-1267FF-5000-nodesc-highlight</styleUrl>
      </Pair>
    </StyleMap>
    <Folder>
      <name>${xmlEscape(directionsName)}</name>
      <Placemark>
        <name>${xmlEscape(directionsName)}</name>
        <styleUrl>#line-1267FF-5000-nodesc</styleUrl>
        <LineString>
          <tessellate>1</tessellate>
          <coordinates>
            ${lineCoordinates}
          </coordinates>
        </LineString>
      </Placemark>
      ${placemarks}
    </Folder>
  </Document>
</kml>`;
}

function downloadTextFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function xmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function toAlphaLabel(index) {
  let n = index + 1;
  let label = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
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
  const routes = state.run?.rankedRoutes || [];

  for (let idx = 0; idx < routeCount; idx += 1) {
    const option = document.createElement("option");
    option.value = String(idx);
    const baseLabel = routes[idx]?.isManual ? "Recorrido manual" : `Recorrido #${idx + 1}`;
    option.textContent = routes[idx]?.userEdited ? `${baseLabel} (editado)` : baseLabel;
    routeSelectorEl.appendChild(option);
  }

  routeSelectorEl.value = String(selectedIndex);
  routeViewControlsEl.hidden = routeCount <= 1;
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
  renderRouteEditor(clients, selectedRoute, state.selectedRouteIndex);
}
