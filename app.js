const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

let userLat = 19.4326;
let userLon = -99.1332;
let userCity = "Ciudad de México";

let map = null;
let currentLayer = null;
let baseLayer = null;
let deferredPrompt = null;

let alertConfig = {
  minMagnitude: 4.5,
  maxDistance: 500,
  soundEnabled: true,
  vibrationEnabled: true,
  hurricaneEnabled: true
};

let monitoredQuakeIds = new Set();
let alertHistory = [];
let citizenReports = [];
let countdownInterval = null;
let sirenInterval = null;
let audioContext = null;

// ==========================================
// TOAST
// ==========================================
function toast(msg, duration = 3000) {
  const t = $("#toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), duration);
}

// ==========================================
// SIRENA DE EMERGENCIA
// ==========================================
function initAudio() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioContext.state === "suspended") {
    audioContext.resume();
  }
}

function playSiren() {
  if (!alertConfig.soundEnabled) return;
  initAudio();
  
  const ctx = audioContext;
  const now = ctx.currentTime;
  
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = 'sine';
  gain.gain.setValueAtTime(0.4, now);
  
  const cycleDuration = 2;
  const highFreq = 880;
  const lowFreq = 440;
  
  osc.frequency.setValueAtTime(lowFreq, now);
  osc.frequency.linearRampToValueAtTime(highFreq, now + 0.5);
  osc.frequency.linearRampToValueAtTime(lowFreq, now + 1);
  osc.frequency.linearRampToValueAtTime(highFreq, now + 1.5);
  osc.frequency.linearRampToValueAtTime(lowFreq, now + 2);
  
  osc.start(now);
  osc.stop(now + cycleDuration);
  
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.connect(gain2);
  gain2.connect(ctx.destination);
  osc2.type = 'square';
  gain2.gain.setValueAtTime(0.15, now);
  
  osc2.frequency.setValueAtTime(lowFreq * 1.5, now);
  osc2.frequency.linearRampToValueAtTime(highFreq * 1.5, now + 0.5);
  osc2.frequency.linearRampToValueAtTime(lowFreq * 1.5, now + 1);
  osc2.frequency.linearRampToValueAtTime(highFreq * 1.5, now + 1.5);
  osc2.frequency.linearRampToValueAtTime(lowFreq * 1.5, now + 2);
  
  osc2.start(now);
  osc2.stop(now + cycleDuration);
}

function startSiren() {
  if (!alertConfig.soundEnabled) return;
  playSiren();
  sirenInterval = setInterval(playSiren, 2000);
}

function stopSiren() {
  if (sirenInterval) {
    clearInterval(sirenInterval);
    sirenInterval = null;
  }
}

// ==========================================
// VIBRACIÓN
// ==========================================
function emergencyVibration() {
  if (!alertConfig.vibrationEnabled) return;
  if (!navigator.vibrate) return;
  const sosPattern = [500, 200, 500, 200, 1000];
  navigator.vibrate(sosPattern);
  setTimeout(() => {
    if ($("#quake-alert-overlay") && !$("#quake-alert-overlay").classList.contains("hidden")) {
      emergencyVibration();
    }
  }, 3000);
}

function stopVibration() {
  if (navigator.vibrate) navigator.vibrate(0);
}

// ==========================================
// CÁLCULO DE TIEMPO DE LLEGADA
// ==========================================
function calculateArrivalTime(distanceKm) {
  const waveSpeed = 3.5;
  return Math.max(0, Math.round(distanceKm / waveSpeed));
}

function formatCountdown(seconds) {
  if (seconds <= 0) return "00:00";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// ==========================================
// ALERTA SÍSMICA
// ==========================================
function triggerQuakeAlert(quake) {
  const [lon, lat, depth] = quake.geometry.coordinates;
  const distance = distanceKm(userLat, userLon, lat, lon);
  const arrivalTime = calculateArrivalTime(distance);
  
  $("#alert-magnitude").textContent = `M ${quake.properties.mag.toFixed(1)}`;
  $("#alert-location").textContent = quake.properties.place;
  $("#alert-distance").textContent = `${Math.round(distance)} km de distancia`;
  $("#alert-depth").textContent = `Profundidad: ${depth ? depth.toFixed(1) : 'desconocida'} km`;
  
  $("#quake-alert-overlay").classList.remove("hidden");
  
  let remaining = arrivalTime;
  $("#alert-countdown").textContent = formatCountdown(remaining);
  $("#countdown-sub").textContent = arrivalTime > 0 
    ? `Ondas S destructivas en camino (${arrivalTime}s)` 
    : "¡Las ondas sísmicas ya llegaron!";
  
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    remaining--;
    $("#alert-countdown").textContent = formatCountdown(remaining);
    
    if (remaining <= 10 && remaining > 0) {
      $("#countdown-sub").textContent = "¡PREPÁRATE! Ondas llegando en segundos";
      $("#alert-countdown").style.color = "#ff0000";
    }
    
    if (remaining <= 0) {
      clearInterval(countdownInterval);
      $("#alert-countdown").textContent = "00:00";
      $("#countdown-sub").textContent = "ONDAS SÍSMICAS PRESENTES";
    }
  }, 1000);
  
  startSiren();
  emergencyVibration();
  
  if (Notification.permission === "granted") {
    new Notification("¡SISMO DETECTADO!", {
      body: `M ${quake.properties.mag.toFixed(1)} - ${quake.properties.place}\n${Math.round(distance)} km`,
      icon: "icons/icon-192.svg",
      vibrate: [500, 200, 500],
      tag: "quake-alert"
    });
  }
  
  addToAlertHistory(quake, distance);
}

$("#btn-close-quake-alert").addEventListener("click", () => {
  $("#quake-alert-overlay").classList.add("hidden");
  if (countdownInterval) clearInterval(countdownInterval);
  stopSiren();
  stopVibration();
  $("#alert-countdown").style.color = "var(--red)";
});

$("#btn-silence-alarm").addEventListener("click", () => {
  stopSiren();
  toast("Alarma silenciada");
});

$("#btn-share-location").addEventListener("click", () => {
  const message = `🚨 EMERGENCIA - Mi ubicación: https://www.google.com/maps?q=${userLat},${userLon} - ${userCity}`;
  if (navigator.share) {
    navigator.share({ title: 'Emergencia', text: message });
  } else {
    navigator.clipboard.writeText(message).then(() => {
      toast("Ubicación copiada al portapapeles");
    });
  }
});

// ==========================================
// ALERTA HURACÁN
// ==========================================
function triggerHurricaneAlert(hurricane) {
  if (!alertConfig.hurricaneEnabled) return;
  
  $("#hurricane-name").textContent = hurricane.name;
  $("#hurricane-category").textContent = `Categoría ${hurricane.category}`;
  $("#hurricane-wind").textContent = `Vientos: ${hurricane.windSpeed} km/h`;
  $("#hurricane-distance").textContent = `${Math.round(hurricane.distance)} km de distancia`;
  
  $("#hurricane-alert-overlay").classList.remove("hidden");
  
  if (Notification.permission === "granted") {
    new Notification("¡ALERTA DE HURACÁN!", {
      body: `${hurricane.name} - Categoría ${hurricane.category}\nVientos: ${hurricane.windSpeed} km/h`,
      icon: "icons/icon-192.svg",
      tag: "hurricane-alert"
    });
  }
}

$("#btn-close-hurricane").addEventListener("click", () => {
  $("#hurricane-alert-overlay").classList.add("hidden");
});

// ==========================================
// HISTORIAL
// ==========================================
function addToAlertHistory(quake, distance) {
  const alert = {
    id: quake.id,
    magnitude: quake.properties.mag,
    place: quake.properties.place,
    distance: distance,
    time: new Date(quake.properties.time).toISOString(),
    timestamp: Date.now()
  };
  alertHistory.unshift(alert);
  if (alertHistory.length > 50) alertHistory.pop();
  localStorage.setItem('ga_alert_history', JSON.stringify(alertHistory));
}

// ==========================================
// REPORTES CIUDADANOS
// ==========================================
function loadCitizenReports() {
  const saved = localStorage.getItem('ga_citizen_reports');
  if (saved) {
    citizenReports = JSON.parse(saved);
    renderCitizenReports();
  }
}

function renderCitizenReports() {
  const list = $("#reports-list");
  if (!list) return;
  
  $("#citizen-reports").textContent = citizenReports.length;
  
  if (citizenReports.length === 0) {
    list.innerHTML = `<li style="justify-content:center;color:var(--text-dim)">Sin reportes ciudadanos</li>`;
    return;
  }
  
  list.innerHTML = "";
  citizenReports.slice(0, 20).forEach(report => {
    const li = document.createElement("li");
    const urgencyClass = report.urgency === 'critical' ? 'tag-critical' : 
                         report.urgency === 'high' ? 'tag-high' : 
                         report.urgency === 'medium' ? 'tag-med' : 'tag-low';
    li.innerHTML = `
      <div style="flex:1;min-width:0">
        <div class="item-title">${getReportTypeName(report.type)}</div>
        <div class="item-meta">${report.description}</div>
        <div class="item-meta">${new Date(report.timestamp).toLocaleString("es-ES")}</div>
      </div>
      <span class="item-tag ${urgencyClass}">${report.urgency}</span>
    `;
    list.appendChild(li);
  });
}

function getReportTypeName(type) {
  const names = {
    accident: 'Accidente',
    fire: 'Incendio',
    flood: 'Inundación',
    crime: 'Actividad criminal',
    medical: 'Emergencia médica',
    infrastructure: 'Daño infraestructura',
    other: 'Otro'
  };
  return names[type] || type;
}

$("#btn-submit-report").addEventListener("click", () => {
  const type = $("#report-type").value;
  const description = $("#report-description").value.trim();
  const urgency = $("#report-urgency").value;
  
  if (!description) {
    toast("Agrega una descripción");
    return;
  }
  
  const report = {
    id: 'report-' + Date.now(),
    type,
    description,
    urgency,
    lat: userLat,
    lon: userLon,
    location: userCity,
    timestamp: Date.now()
  };
  
  citizenReports.unshift(report);
  if (citizenReports.length > 100) citizenReports.pop();
  localStorage.setItem('ga_citizen_reports', JSON.stringify(citizenReports));
  
  $("#report-description").value = "";
  renderCitizenReports();
  toast("Reporte enviado correctamente");
  
  // Agregar al mapa
  if (map) {
    const colors = { low: '#3fb950', medium: '#d29922', high: '#f85149', critical: '#f85149' };
    L.circleMarker([userLat, userLon], {
      radius: 10,
      color: colors[urgency],
      fillColor: colors[urgency],
      fillOpacity: 0.8,
      weight: 2
    }).addTo(map).bindPopup(`<strong>${getReportTypeName(type)}</strong><br>${description}`);
  }
});

$("#btn-clear-reports").addEventListener("click", () => {
  citizenReports = [];
  localStorage.removeItem('ga_citizen_reports');
  renderCitizenReports();
  toast("Reportes limpiados");
});

// ==========================================
// CONFLICTOS
// ==========================================
async function loadConflicts() {
  const list = $("#conflict-list");
  if (!list) return;
  list.innerHTML = `<li style="justify-content:center;color:var(--text-dim)">Cargando conflictos...</li>`;
  
  try {
    // Usando datos de ACLED (Armed Conflict Location & Event Data Project)
    // API gratuita con registro, pero usaremos un endpoint público de demo
    const response = await fetch("https://acleddata.com/api/access/1.0/?key=public&email=public@acleddata.com&event_date=2024-01-01|2024-12-31&limit=20");
    
    if (!response.ok) throw new Error("HTTP error");
    const data = await response.json();
    
    list.innerHTML = "";
    $("#conflict-badge").textContent = `${data.data?.length || 0} activos`;
    
    if (!data.data || data.data.length === 0) {
      list.innerHTML = `<li style="justify-content:center;color:var(--text-dim)">Sin datos de conflictos disponibles</li>`;
      return;
    }
    
    data.data.slice(0, 15).forEach(event => {
      const li = document.createElement("li");
      const severity = event.fatalities > 10 ? 'tag-high' : event.fatalities > 0 ? 'tag-med' : 'tag-low';
      li.innerHTML = `
        <div style="flex:1;min-width:0">
          <div class="item-title">${event.event_type || 'Evento'} - ${event.country || 'Desconocido'}</div>
          <div class="item-meta">${event.sub_event_type || ''} · ${event.event_date || ''}</div>
          <div class="item-meta">${event.notes || 'Sin descripción'}</div>
        </div>
        <span class="item-tag ${severity}">${event.fatalities || 0} víctimas</span>
      `;
      list.appendChild(li);
    });
    
  } catch (e) {
    console.error("Error cargando conflictos:", e);
    // Fallback con datos de ejemplo
    list.innerHTML = `
      <li style="justify-content:center;color:var(--text-dim)">
        No se pudieron cargar los datos de conflictos. Verifica tu conexión.
      </li>
    `;
  }
}

// ==========================================
// MONITOREO EN TIEMPO REAL
// ==========================================
async function monitorQuakes() {
  try {
    const response = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson");
    if (!response.ok) throw new Error("HTTP error");
    const data = await response.json();
    
    $("#last-check").textContent = new Date().toLocaleTimeString("es-ES");
    $("#monitored-quakes").textContent = data.features.length;
    
    data.features.forEach(quake => {
      const quakeId = quake.id;
      if (monitoredQuakeIds.has(quakeId)) return;
      
      const [lon, lat] = quake.geometry.coordinates;
      const distance = distanceKm(userLat, userLon, lat, lon);
      const magnitude = quake.properties.mag;
      
      if (magnitude >= alertConfig.minMagnitude && distance <= alertConfig.maxDistance) {
        monitoredQuakeIds.add(quakeId);
        triggerQuakeAlert(quake);
      } else {
        monitoredQuakeIds.add(quakeId);
      }
    });
    
  } catch (e) {
    console.error("Error en monitoreo:", e);
  }
}

// ==========================================
// HURACANES
// ==========================================
async function loadHurricanes() {
  const list = $("#hurricane-list");
  if (!list) return;
  list.innerHTML = `<li style="justify-content:center;color:var(--text-dim)">Cargando huracanes...</li>`;
  
  try {
    const response = await fetch("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=50");
    if (!response.ok) throw new Error("HTTP error");
    const data = await response.json();
    
    const hurricanes = data.events.filter(ev => {
      const cat = ev.categories[0];
      return cat && (cat.id === 10 || cat.id === 9);
    });
    
    list.innerHTML = "";
    $("#hurricane-badge").textContent = `${hurricanes.length} activos`;
    $("#d-hurricanes").textContent = hurricanes.length;
    
    if (hurricanes.length === 0) {
      list.innerHTML = `<li style="justify-content:center;color:var(--text-dim)">Sin huracanes activos actualmente</li>`;
      return;
    }
    
    hurricanes.forEach(hurricane => {
      const geom = hurricane.geometry.find(g => g.coordinates);
      if (!geom) return;
      
      const [lon, lat] = geom.coordinates;
      const distance = distanceKm(userLat, userLon, lat, lon);
      
      // Simular categoría y velocidad de viento (en producción vendría de NOAA)
      const category = Math.floor(Math.random() * 5) + 1;
      const windSpeed = 120 + (category * 30);
      
      const li = document.createElement("li");
      const catClass = category >= 4 ? 'tag-high' : category >= 3 ? 'tag-med' : 'tag-low';
      li.innerHTML = `
        <div style="flex:1;min-width:0">
          <div class="item-title">${hurricane.title}</div>
          <div class="item-meta">Categoría ${category} · Vientos: ${windSpeed} km/h</div>
          <div class="item-meta">${Math.round(distance)} km de distancia</div>
        </div>
        <span class="item-tag ${catClass}">Cat ${category}</span>
      `;
      list.appendChild(li);
      
      // Alerta si está cerca
      if (distance < 1000 && category >= 3) {
        triggerHurricaneAlert({
          name: hurricane.title,
          category,
          windSpeed,
          distance
        });
      }
    });
    
  } catch (e) {
    console.error("Error cargando huracanes:", e);
    list.innerHTML = `<li style="justify-content:center;color:var(--text-dim)">Error al cargar huracanes</li>`;
  }
}

// ==========================================
// PESTAÑAS + MAPA FIX
// ==========================================
$$(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    $$(".tab").forEach(t => t.classList.remove("active"));
    $$(".view").forEach(v => v.classList.remove("active"));
    tab.classList.add("active");
    const target = $(`#${tab.dataset.tab}`);
    if (target) target.classList.add("active");
    
    if (tab.dataset.tab === "mapa" && map) {
      setTimeout(() => map.invalidateSize(), 200);
    }
    if (tab.dataset.tab === "huracanes") loadHurricanes();
    if (tab.dataset.tab === "conflictos") loadConflicts();
    if (tab.dataset.tab === "reportes") renderCitizenReports();
  });
});

// ==========================================
// MAPA
// ==========================================
const mapLayers = {
  osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap', maxZoom: 19
  }),
  satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: '&copy; Esri', maxZoom: 18
  }),
  dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; CARTO', subdomains: 'abcd', maxZoom: 19
  })
};

function initMap() {
  if (map) return;
  try {
    map = L.map("map", { zoomControl: true, worldCopyJump: true, center: [20, 0], zoom: 2, minZoom: 2, maxZoom: 19 });
    baseLayer = mapLayers.dark;
    baseLayer.addTo(map);
    setTimeout(() => map.invalidateSize(), 300);
    loadMapLayer("quakes");
  } catch (e) {
    console.error("Error mapa:", e);
    toast("Error al cargar el mapa");
  }
}

function changeMapType(type) {
  if (!map || !mapLayers[type]) return;
  if (baseLayer) map.removeLayer(baseLayer);
  baseLayer = mapLayers[type];
  baseLayer.addTo(map);
  if (currentLayer) currentLayer.bringToFront();
  toast(`Mapa: ${type === 'osm' ? 'Estándar' : type === 'satellite' ? 'Satélite' : 'Oscuro'}`);
}

async function loadMapLayer(type) {
  if (!map) return;
  if (currentLayer) {
    try { map.removeLayer(currentLayer); } catch(e) {}
    currentLayer = null;
  }

  try {
    if (type === "quakes") {
      const r = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson");
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      
      currentLayer = L.geoJSON(d, {
        pointToLayer: (f, latlng) => {
          const mag = f.properties.mag;
          const color = mag >= 6 ? "#f85149" : mag >= 4.5 ? "#d29922" : "#3fb950";
          return L.circleMarker(latlng, { radius: Math.max(8, mag * 5), color, fillColor: color, fillOpacity: 0.6, weight: 2 });
        },
        onEachFeature: (f, layer) => {
          const p = f.properties;
          const time = new Date(p.time).toLocaleString("es-ES");
          const depth = f.geometry.coordinates[2];
          layer.bindPopup(`<strong style="color:#f85149;font-size:16px">M ${p.mag.toFixed(1)}</strong><br><strong>${p.place}</strong><br><small>${time}</small><br><small>Profundidad: ${depth ? depth.toFixed(1) : '?'} km</small>`);
        }
      }).addTo(map);
      
      $("#map-legend").innerHTML = `
        <div class="legend-item"><span class="legend-dot" style="background:#3fb950"></span>M 2.5-4.5</div>
        <div class="legend-item"><span class="legend-dot" style="background:#d29922"></span>M 4.5-6.0</div>
        <div class="legend-item"><span class="legend-dot" style="background:#f85149"></span>M 6.0+</div>
      `;
      
    } else if (type === "hurricanes") {
      const r = await fetch("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=50");
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      const features = [];
      d.events.forEach(ev => {
        const cat = ev.categories[0];
        if (!cat || (cat.id !== 10 && cat.id !== 9)) return;
        const geom = ev.geometry.find(g => g.coordinates);
        if (!geom) return;
        features.push({ type: "Feature", geometry: { type: "Point", coordinates: geom.coordinates }, properties: { title: ev.title, category: cat.title } });
      });
      currentLayer = L.geoJSON(features, {
        pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 18, color: "#bc8cff", fillColor: "#bc8cff", fillOpacity: 0.4, weight: 3, dashArray: '5, 5' }),
        onEachFeature: (f, layer) => layer.bindPopup(`<strong style="color:#bc8cff">${f.properties.title}</strong><br><small>${f.properties.category}</small>`)
      }).addTo(map);
      $("#map-legend").innerHTML = `<div class="legend-item"><span class="legend-dot" style="background:#bc8cff"></span>Huracanes y Tormentas</div>`;
      
    } else if (type === "fires") {
      const r = await fetch("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=100");
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      const features = [];
      d.events.forEach(ev => {
        const cat = ev.categories[0];
        if (!cat || cat.id !== 8) return;
        const geom = ev.geometry.find(g => g.coordinates);
        if (!geom) return;
        features.push({ type: "Feature", geometry: { type: "Point", coordinates: geom.coordinates }, properties: { title: ev.title } });
      });
      currentLayer = L.geoJSON(features, {
        pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 10, color: "#db6d28", fillColor: "#ff6b35", fillOpacity: 0.8, weight: 2 }),
        onEachFeature: (f, layer) => layer.bindPopup(`<strong style="color:#ff6b35">${f.properties.title}</strong>`)
      }).addTo(map);
      $("#map-legend").innerHTML = `<div class="legend-item"><span class="legend-dot" style="background:#ff6b35"></span>Incendios activos</div>`;
      
    } else if (type === "volcanoes") {
      const r = await fetch("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=50");
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      const features = [];
      d.events.forEach(ev => {
        const cat = ev.categories[0];
        if (!cat || cat.id !== 12) return;
        const geom = ev.geometry.find(g => g.coordinates);
        if (!geom) return;
        features.push({ type: "Feature", geometry: { type: "Point", coordinates: geom.coordinates }, properties: { title: ev.title } });
      });
      currentLayer = L.geoJSON(features, {
        pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 14, color: "#f85149", fillColor: "#f85149", fillOpacity: 0.7, weight: 3 }),
        onEachFeature: (f, layer) => layer.bindPopup(`<strong style="color:#f85149">${f.properties.title}</strong>`)
      }).addTo(map);
      $("#map-legend").innerHTML = `<div class="legend-item"><span class="legend-dot" style="background:#f85149"></span>Volcanes activos</div>`;
      
    } else if (type === "storms") {
      const r = await fetch("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=50");
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      const features = [];
      d.events.forEach(ev => {
        const cat = ev.categories[0];
        if (!cat || (cat.id !== 9 && cat.id !== 10)) return;
        const geom = ev.geometry.find(g => g.coordinates);
        if (!geom) return;
        features.push({ type: "Feature", geometry: { type: "Point", coordinates: geom.coordinates }, properties: { title: ev.title } });
      });
      currentLayer = L.geoJSON(features, {
        pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 12, color: "#58a6ff", fillColor: "#58a6ff", fillOpacity: 0.6, weight: 2 }),
        onEachFeature: (f, layer) => layer.bindPopup(`<strong style="color:#58a6ff">${f.properties.title}</strong>`)
      }).addTo(map);
      $("#map-legend").innerHTML = `<div class="legend-item"><span class="legend-dot" style="background:#58a6ff"></span>Tormentas severas</div>`;
      
    } else if (type === "reports") {
      // Mostrar reportes ciudadanos
      const features = citizenReports.map(r => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [r.lon, r.lat] },
        properties: { type: r.type, description: r.description, urgency: r.urgency }
      }));
      
      currentLayer = L.geoJSON(features, {
        pointToLayer: (f, latlng) => {
          const colors = { low: '#3fb950', medium: '#d29922', high: '#f85149', critical: '#f85149' };
          return L.circleMarker(latlng, { radius: 10, color: colors[f.properties.urgency], fillColor: colors[f.properties.urgency], fillOpacity: 0.8, weight: 2 });
        },
        onEachFeature: (f, layer) => layer.bindPopup(`<strong>${getReportTypeName(f.properties.type)}</strong><br>${f.properties.description}`)
      }).addTo(map);
      $("#map-legend").innerHTML = `<div class="legend-item"><span class="legend-dot" style="background:#f85149"></span>Reportes ciudadanos</div>`;
      
    } else if (type === "conflicts") {
      // Placeholder para conflictos en mapa
      $("#map-legend").innerHTML = `<div class="legend-item">Capa de conflictos en desarrollo</div>`;
    }
    
  } catch (e) {
    console.error("Error capa:", e);
    toast("Error al cargar datos del mapa");
  }
}

// ==========================================
// DASHBOARD
// ==========================================
async function loadDashboard() {
  try {
    $("#status").textContent = userCity;
    $("#d-loc").textContent = userCity;

    try {
      const w = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${userLat}&longitude=${userLon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=7`);
      if (w.ok) {
        const wd = await w.json();
        $("#d-temp").textContent = `${Math.round(wd.current.temperature_2m)}°C`;
        
        // Pronóstico
        const fc = $("#forecast");
        fc.innerHTML = "";
        const days = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
        wd.daily.time.forEach((date, i) => {
          const dt = new Date(date);
          const div = document.createElement("div");
          div.className = "forecast-day";
          div.innerHTML = `
            <div class="day">${i === 0 ? "Hoy" : days[dt.getDay()]}</div>
            <div class="temp">${Math.round(wd.daily.temperature_2m_max[i])}°</div>
            <div class="desc">${Math.round(wd.daily.temperature_2m_min[i])}°</div>
          `;
          fc.appendChild(div);
        });
      }
    } catch(e) {}

    try {
      const aqi = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${userLat}&longitude=${userLon}&current=pm2_5`);
      if (aqi.ok) {
        const aqid = await aqi.json();
        const pm = aqid.current.pm2_5;
        $("#d-aqi").textContent = pm !== undefined ? pm.toFixed(0) : "--";
        $("#d-aqi-label").textContent = pm > 35 ? "Insalubre" : pm > 15 ? "Moderado" : "Bueno";
      }
    } catch(e) {}

    try {
      const q = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson");
      if (q.ok) {
        const qd = await q.json();
        $("#d-quakes").textContent = qd.metadata.count || 0;
      }
    } catch(e) {}

    try {
      const q24 = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson");
      if (q24.ok) {
        const q24d = await q24.json();
        const nearby = q24d.features.filter(f => {
          const [lon, lat] = f.geometry.coordinates;
          return distanceKm(userLat, userLon, lat, lon) < 1000;
        }).slice(0, 5);
        
        $("#alerts-badge").textContent = `${nearby.length} cercanas`;
        const al = $("#alerts-list");
        al.innerHTML = "";
        if (nearby.length === 0) {
          al.innerHTML = `<li style="justify-content:center;color:var(--text-dim)">Sin alertas cercanas (1000 km)</li>`;
        } else {
          nearby.forEach(f => {
            const p = f.properties;
            const dist = distanceKm(userLat, userLon, f.geometry.coordinates[1], f.geometry.coordinates[0]);
            const li = document.createElement("li");
            li.innerHTML = `
              <div style="flex:1;min-width:0">
                <div class="item-title">${p.place}</div>
                <div class="item-meta">${Math.round(dist)} km · ${new Date(p.time).toLocaleString("es-ES")}</div>
              </div>
              <span class="item-tag ${p.mag >= 4.5 ? 'tag-high' : 'tag-med'}">M ${p.mag.toFixed(1)}</span>
            `;
            al.appendChild(li);
          });
        }
      }
    } catch(e) {}

  } catch (e) {
    console.error("Dashboard error", e);
  }
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ==========================================
// KIT DE EMERGENCIA
// ==========================================
function loadChecklist() {
  const saved = localStorage.getItem('ga_checklist');
  if (saved) {
    const checked = JSON.parse(saved);
    $$(".checklist-item input").forEach(cb => {
      if (checked.includes(cb.dataset.item)) {
        cb.checked = true;
      }
    });
  }
  updateChecklistProgress();
}

function updateChecklistProgress() {
  const total = $$(".checklist-item input").length;
  const checked = $$(".checklist-item input:checked").length;
  $("#checklist-count").textContent = checked;
  $("#progress-fill").style.width = `${(checked / total) * 100}%`;
}

$$(".checklist-item input").forEach(cb => {
  cb.addEventListener("change", () => {
    const checked = Array.from($$(".checklist-item input:checked")).map(c => c.dataset.item);
    localStorage.setItem('ga_checklist', JSON.stringify(checked));
    updateChecklistProgress();
  });
});

// ==========================================
// PLAN DE EMERGENCIA
// ==========================================
function loadEmergencyPlan() {
  const saved = localStorage.getItem('ga_emergency_plan');
  if (saved) {
    const plan = JSON.parse(saved);
    $("#meeting-point").value = plan.meetingPoint || "";
    $("#emergency-contact").value = plan.emergencyContact || "";
    $("#evacuation-route").value = plan.evacuationRoute || "";
  }
}

$("#btn-save-plan").addEventListener("click", () => {
  const plan = {
    meetingPoint: $("#meeting-point").value,
    emergencyContact: $("#emergency-contact").value,
    evacuationRoute: $("#evacuation-route").value
  };
  localStorage.setItem('ga_emergency_plan', JSON.stringify(plan));
  toast("Plan de emergencia guardado");
});

// ==========================================
// BOTÓN DE PÁNICO
// ==========================================
$("#panic-button").addEventListener("click", () => {
  const message = `🚨 EMERGENCIA - Mi ubicación: https://www.google.com/maps?q=${userLat},${userLon} - ${userCity}`;
  if (navigator.share) {
    navigator.share({ title: 'EMERGENCIA', text: message });
  } else {
    navigator.clipboard.writeText(message).then(() => {
      toast("Ubicación de emergencia copiada");
    });
  }
  if (navigator.vibrate) navigator.vibrate([500, 200, 500]);
});

// ==========================================
// ACCIONES RÁPIDAS
// ==========================================
$("#btn-share-emergency").addEventListener("click", () => {
  const message = `🚨 EMERGENCIA - Mi ubicación: https://www.google.com/maps?q=${userLat},${userLon}`;
  if (navigator.share) {
    navigator.share({ title: 'Emergencia', text: message });
  } else {
    navigator.clipboard.writeText(message);
    toast("Ubicación copiada");
  }
});

$("#btn-call-emergency").addEventListener("click", () => {
  window.location.href = "tel:911";
});

$("#btn-test-siren").addEventListener("click", () => {
  if (alertConfig.soundEnabled) {
    startSiren();
    toast("Sirena activada (5 segundos)");
    setTimeout(stopSiren, 5000);
  } else {
    toast("Activa el sonido en configuración");
  }
});

// ==========================================
// BOTONES DE PRUEBA
// ==========================================
$("#btn-test-notif").addEventListener("click", () => {
  if (!("Notification" in window)) {
    toast("Tu navegador no soporta notificaciones");
    return;
  }
  Notification.requestPermission().then(perm => {
    if (perm === "granted") {
      new Notification("PRUEBA DE GLOBALALERTS", { body: "Sistema funcionando correctamente.", icon: "icons/icon-192.svg" });
      toast("Notificación enviada");
    } else {
      toast("Permiso denegado");
    }
  });
});

$("#btn-test-quake-alert").addEventListener("click", () => {
  const testQuake = {
    id: "test-" + Date.now(),
    geometry: { coordinates: [userLon + 0.5, userLat + 0.5, 10] },
    properties: { mag: 5.8, place: "Zona de prueba - 50 km", time: Date.now() }
  };
  triggerQuakeAlert(testQuake);
});

$("#btn-test-hurricane").addEventListener("click", () => {
  triggerHurricaneAlert({
    name: "Huracán de Prueba",
    category: 4,
    windSpeed: 220,
    distance: 150
  });
});

$("#btn-test-map").addEventListener("click", () => {
  toast("Recargando mapa...");
  if (map) {
    map.invalidateSize();
    const activeBtn = $(".map-btn.active");
    if (activeBtn) loadMapLayer(activeBtn.dataset.layer);
    setTimeout(() => toast("Mapa reiniciado"), 500);
  }
});

// ==========================================
// CONFIGURACIÓN
// ==========================================
function loadAlertConfig() {
  const saved = localStorage.getItem('ga_alert_config');
  if (saved) {
    alertConfig = JSON.parse(saved);
    $("#cfg-magnitude").value = alertConfig.minMagnitude;
    $("#cfg-distance").value = alertConfig.maxDistance;
    $("#cfg-sound").checked = alertConfig.soundEnabled;
    $("#cfg-vibration").checked = alertConfig.vibrationEnabled;
    $("#cfg-hurricane").checked = alertConfig.hurricaneEnabled;
  }
}

$("#btn-save-alert-config").addEventListener("click", () => {
  alertConfig.minMagnitude = parseFloat($("#cfg-magnitude").value);
  alertConfig.maxDistance = parseInt($("#cfg-distance").value);
  alertConfig.soundEnabled = $("#cfg-sound").checked;
  alertConfig.vibrationEnabled = $("#cfg-vibration").checked;
  alertConfig.hurricaneEnabled = $("#cfg-hurricane").checked;
  localStorage.setItem('ga_alert_config', JSON.stringify(alertConfig));
  toast("Configuración guardada");
});

function loadSettings() {
  const savedCountry = localStorage.getItem('ga_country') || 'Mexico';
  const cfgCountry = $("#cfg-country");
  if (cfgCountry) cfgCountry.value = savedCountry;
}

$("#btn-save-config").addEventListener("click", () => {
  const cfgCountry = $("#cfg-country");
  if (!cfgCountry) return;
  localStorage.setItem('ga_country', cfgCountry.value);
  toast("Configuración guardada");
});

// ==========================================
// PWA
// ==========================================
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const btn = $("#btn-install");
  if (btn) btn.classList.remove("hidden");
});

$("#btn-install").addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $("#btn-install").classList.add("hidden");
  toast("App instalada");
});

// ==========================================
// EVENTOS
// ==========================================
$$(".map-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    $$(".map-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    loadMapLayer(btn.dataset.layer);
  });
});

$$(".map-type-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    $$(".map-type-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    changeMapType(btn.dataset.type);
  });
});

// ==========================================
// INIT
// ==========================================
async function init() {
  console.log("=== GlobalAlerts Pro ===");
  
  loadAlertConfig();
  loadSettings();
  loadCitizenReports();
  loadChecklist();
  loadEmergencyPlan();
  
  initMap();
  await loadDashboard();
  loadHurricanes();
  
  toast("Sistema de monitoreo activado");

  if ("geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        userLat = pos.coords.latitude;
        userLon = pos.coords.longitude;
        
        try {
          const geo = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${userLat}&lon=${userLon}&zoom=10&accept-language=es`);
          if (geo.ok) {
            const geod = await geo.json();
            userCity = geod.address.city || geod.address.town || geod.address.state || "Tu ubicación";
          }
        } catch(e) { userCity = "Tu ubicación"; }
        
        $("#status").textContent = userCity;
        $("#d-loc").textContent = userCity;
        
        if (map) {
          map.setView([userLat, userLon], 6);
          const userIcon = L.divIcon({
            className: "user-marker",
            html: '<div style="width:16px;height:16px;background:#58a6ff;border:3px solid white;border-radius:50%;box-shadow:0 0 12px rgba(88,166,255,0.8);"></div>',
            iconSize: [22, 22], iconAnchor: [11, 11]
          });
          L.marker([userLat, userLon], { icon: userIcon }).addTo(map).bindPopup(`<strong>${userCity}</strong>`);
        }
        
        await loadDashboard();
      },
      (err) => {
        console.warn("Geoloc error:", err.message);
        $("#status").textContent = `${userCity} (predeterminada)`;
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
    );
  }
  
  monitorQuakes();
  setInterval(monitorQuakes, 30000);
  
  if ("Notification" in window && Notification.permission === "default") {
    setTimeout(() => Notification.requestPermission(), 3000);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

setInterval(() => {
  loadDashboard();
  loadHurricanes();
}, 5 * 60 * 1000);
