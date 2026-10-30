const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

let userLat = 19.4326;
let userLon = -99.1332;
let userCity = "Ciudad de México";

let map = null;
let currentLayer = null;
let baseLayer = null;
let deferredPrompt = null;

// Sistema de alertas sísmicas
let alertConfig = {
  minMagnitude: 4.5,
  maxDistance: 500,
  soundEnabled: true,
  vibrationEnabled: true
};

let monitoredQuakeIds = new Set();
let alertHistory = [];
let countdownInterval = null;
let audioContext = null;
let alarmOscillator = null;

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
// SISTEMA DE AUDIO PARA ALARMA
// ==========================================
function initAudio() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
}

function playAlarmSound() {
  if (!alertConfig.soundEnabled) return;
  
  initAudio();
  
  // Crear oscilador para tono de alarma
  alarmOscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  
  alarmOscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  
  alarmOscillator.type = 'square';
  alarmOscillator.frequency.setValueAtTime(880, audioContext.currentTime); // La (A5)
  
  // Patrón de alarma: beep-beep-beep
  const now = audioContext.currentTime;
  gainNode.gain.setValueAtTime(0.3, now);
  gainNode.gain.setValueAtTime(0, now + 0.2);
  gainNode.gain.setValueAtTime(0.3, now + 0.3);
  gainNode.gain.setValueAtTime(0, now + 0.5);
  gainNode.gain.setValueAtTime(0.3, now + 0.6);
  gainNode.gain.setValueAtTime(0, now + 0.8);
  
  alarmOscillator.start(now);
  alarmOscillator.stop(now + 1);
  
  // Repetir alarma cada 2 segundos
  setTimeout(() => {
    if ($("#quake-alert-overlay") && !$("#quake-alert-overlay").classList.contains("hidden")) {
      playAlarmSound();
    }
  }, 2000);
}

function stopAlarmSound() {
  if (alarmOscillator) {
    try {
      alarmOscillator.stop();
    } catch(e) {}
    alarmOscillator = null;
  }
}

// ==========================================
// VIBRACIÓN DE EMERGENCIA
// ==========================================
function emergencyVibration() {
  if (!alertConfig.vibrationEnabled) return;
  if (!navigator.vibrate) return;
  
  // Patrón SOS: corto-corto-corto-largo-largo-largo-corto-corto-corto
  const sosPattern = [100, 100, 100, 100, 100, 100, 300, 100, 300, 100, 300, 100, 100, 100, 100, 100, 100, 100];
  navigator.vibrate(sosPattern);
  
  // Repetir cada 3 segundos
  setTimeout(() => {
    if ($("#quake-alert-overlay") && !$("#quake-alert-overlay").classList.contains("hidden")) {
      emergencyVibration();
    }
  }, 3000);
}

function stopVibration() {
  if (navigator.vibrate) {
    navigator.vibrate(0);
  }
}

// ==========================================
// CÁLCULO DE TIEMPO DE LLEGADA DE ONDAS
// ==========================================
function calculateArrivalTime(distanceKm, magnitude) {
  // Velocidad aproximada de ondas P: 6 km/s
  // Velocidad aproximada de ondas S: 3.5 km/s
  // Usamos ondas S (más destructivas) para el cálculo
  
  const waveSpeed = 3.5; // km/s
  const timeSeconds = distanceKm / waveSpeed;
  
  return Math.max(0, Math.round(timeSeconds));
}

function formatCountdown(seconds) {
  if (seconds <= 0) return "00:00";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// ==========================================
// PANTALLA FLOTANTE DE ALERTA SÍSMICA
// ==========================================
function triggerQuakeAlert(quake) {
  const [lon, lat] = quake.geometry.coordinates;
  const distance = distanceKm(userLat, userLon, lat, lon);
  const arrivalTime = calculateArrivalTime(distance, quake.properties.mag);
  
  // Actualizar información en la pantalla
  $("#alert-magnitude").textContent = `M ${quake.properties.mag.toFixed(1)}`;
  $("#alert-location").textContent = quake.properties.place;
  $("#alert-distance").textContent = `${Math.round(distance)} km de distancia`;
  
  // Mostrar pantalla
  $("#quake-alert-overlay").classList.remove("hidden");
  
  // Iniciar cuenta regresiva
  let remaining = arrivalTime;
  $("#alert-countdown").textContent = formatCountdown(remaining);
  
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    remaining--;
    $("#alert-countdown").textContent = formatCountdown(remaining);
    
    if (remaining <= 0) {
      clearInterval(countdownInterval);
      $("#alert-countdown").textContent = "00:00";
      $("#countdown-sub").textContent = "Ondas sísmicas llegando";
    }
  }, 1000);
  
  // Activar alarma sonora y vibración
  playAlarmSound();
  emergencyVibration();
  
  // Enviar notificación push
  if (Notification.permission === "granted") {
    new Notification("¡SISMO DETECTADO!", {
      body: `M ${quake.properties.mag.toFixed(1)} - ${quake.properties.place}\n${Math.round(distance)} km de distancia`,
      icon: "icons/icon-192.svg",
      vibrate: [500, 200, 500],
      tag: "quake-alert"
    });
  }
  
  // Agregar al historial
  addToAlertHistory(quake, distance);
  
  console.log("Alerta de sismo activada:", quake.properties.place);
}

function closeQuakeAlert() {
  $("#quake-alert-overlay").classList.add("hidden");
  if (countdownInterval) clearInterval(countdownInterval);
  stopAlarmSound();
  stopVibration();
}

$("#btn-close-quake-alert").addEventListener("click", closeQuakeAlert);

// ==========================================
// HISTORIAL DE ALERTAS
// ==========================================
function addToAlertHistory(quake, distance) {
  const alert = {
    id: quake.id,
    magnitude: quake.properties.mag,
    place: quake.properties.place,
    distance: distance,
    time: new Date(quake.properties.time),
    timestamp: Date.now()
  };
  
  alertHistory.unshift(alert);
  if (alertHistory.length > 50) alertHistory.pop(); // Mantener últimos 50
  
  localStorage.setItem('ga_alert_history', JSON.stringify(alertHistory));
  renderAlertHistory();
}

function renderAlertHistory() {
  const list = $("#alert-history-list");
  if (!list) return;
  
  if (alertHistory.length === 0) {
    list.innerHTML = `<li style="justify-content:center;color:var(--text-dim)">Sin alertas registradas</li>`;
    return;
  }
  
  list.innerHTML = "";
  alertHistory.forEach(alert => {
    const li = document.createElement("li");
    li.className = "history-item";
    li.innerHTML = `
      <div style="flex:1;min-width:0">
        <div class="item-title">M ${alert.magnitude.toFixed(1)} - ${alert.place}</div>
        <div class="item-meta">${Math.round(alert.distance)} km de distancia</div>
        <div class="history-time">${alert.time.toLocaleString("es-ES")}</div>
      </div>
      <span class="item-tag ${alert.magnitude >= 5 ? 'tag-high' : 'tag-med'}">Alerta</span>
    `;
    list.appendChild(li);
  });
}

$("#btn-clear-history").addEventListener("click", () => {
  alertHistory = [];
  localStorage.removeItem('ga_alert_history');
  renderAlertHistory();
  toast("Historial limpiado");
});

// ==========================================
// MONITOREO DE SISMOS EN TIEMPO REAL
// ==========================================
async function monitorQuakes() {
  try {
    const response = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson");
    if (!response.ok) throw new Error("HTTP error");
    const data = await response.json();
    
    $("#last-check").textContent = new Date().toLocaleTimeString("es-ES");
    $("#monitored-quakes").textContent = data.features.length;
    
    // Revisar cada sismo
    data.features.forEach(quake => {
      const quakeId = quake.id;
      
      // Si ya fue monitoreado, saltar
      if (monitoredQuakeIds.has(quakeId)) return;
      
      const [lon, lat] = quake.geometry.coordinates;
      const distance = distanceKm(userLat, userLon, lat, lon);
      const magnitude = quake.properties.mag;
      
      // Verificar si cumple los criterios de alerta
      if (magnitude >= alertConfig.minMagnitude && distance <= alertConfig.maxDistance) {
        console.log(`Sismo detectado: M${magnitude.toFixed(1)} a ${Math.round(distance)} km`);
        
        // Marcar como monitoreado
        monitoredQuakeIds.add(quakeId);
        
        // Activar alerta
        triggerQuakeAlert(quake);
      } else {
        // Marcar como revisado (no alerta)
        monitoredQuakeIds.add(quakeId);
      }
    });
    
  } catch (e) {
    console.error("Error en monitoreo:", e);
  }
}

// ==========================================
// PESTAÑAS + FIX DEL MAPA
// ==========================================
$$(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    $$(".tab").forEach(t => t.classList.remove("active"));
    $$(".view").forEach(v => v.classList.remove("active"));
    tab.classList.add("active");
    const target = $(`#${tab.dataset.tab}`);
    if (target) target.classList.add("active");
    
    if (tab.dataset.tab === "mapa" && map) {
      setTimeout(() => {
        map.invalidateSize();
      }, 200);
    }
    
    if (tab.dataset.tab === "historial") {
      renderAlertHistory();
    }
  });
});

// ==========================================
// CAPAS DE MAPA
// ==========================================
const mapLayers = {
  osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }),
  satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: '&copy; Esri',
    maxZoom: 18
  }),
  dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 19
  })
};

function initMap() {
  if (map) return;

  try {
    map = L.map("map", { 
      zoomControl: true, 
      worldCopyJump: true,
      center: [20, 0],
      zoom: 2,
      minZoom: 2,
      maxZoom: 19
    });
    
    baseLayer = mapLayers.osm;
    baseLayer.addTo(map);
    
    setTimeout(() => map.invalidateSize(), 300);
    loadMapLayer("quakes");
    
  } catch (e) {
    console.error("Error al inicializar mapa:", e);
    toast("Error al cargar el mapa");
  }
}

function changeMapType(type) {
  if (!map || !mapLayers[type]) return;
  
  if (baseLayer) map.removeLayer(baseLayer);
  baseLayer = mapLayers[type];
  baseLayer.addTo(map);
  
  if (currentLayer) currentLayer.bringToFront();
  toast(`Mapa: ${type === 'osm' ? 'OpenStreetMap' : type === 'satellite' ? 'Satélite' : 'Modo Oscuro'}`);
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
          return L.circleMarker(latlng, { 
            radius: Math.max(6, mag * 4), 
            color: color,
            fillColor: color, 
            fillOpacity: 0.7, 
            weight: 2,
            opacity: 0.9
          });
        },
        onEachFeature: (f, layer) => {
          const p = f.properties;
          const time = new Date(p.time).toLocaleString("es-ES");
          layer.bindPopup(`
            <strong>Magnitud: ${p.mag.toFixed(1)}</strong><br>
            <strong>${p.place}</strong><br>
            <small>${time}</small><br>
            <a href="${p.url}" target="_blank" style="color:#58a6ff;text-decoration:none;">Ver detalles →</a>
          `);
        }
      }).addTo(map);
      
      $("#map-legend").innerHTML = `
        <div class="legend-item"><span class="legend-dot" style="background:#3fb950"></span>M 2.5-4.5</div>
        <div class="legend-item"><span class="legend-dot" style="background:#d29922"></span>M 4.5-6.0</div>
        <div class="legend-item"><span class="legend-dot" style="background:#f85149"></span>M 6.0+</div>
      `;
      
    } else {
      const r = await fetch("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=50");
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      const features = [];
      
      d.events.forEach(ev => {
        const cat = ev.categories[0];
        if (!cat) return;
        if (type === "fires" && cat.id !== 8) return;
        if (type === "storms" && cat.id !== 10 && cat.id !== 9) return;
        if (type === "volcanoes" && cat.id !== 12) return;
        const geom = ev.geometry.find(g => g.coordinates);
        if (!geom) return;
        features.push({
          type: "Feature", 
          geometry: { type: "Point", coordinates: geom.coordinates },
          properties: { title: ev.title, category: cat.title, id: cat.id }
        });
      });

      currentLayer = L.geoJSON(features, {
        pointToLayer: (f, latlng) => {
          const colors = { 8: "#db6d28", 9: "#58a6ff", 10: "#bc8cff", 12: "#f85149" };
          const color = colors[f.properties.id] || "#58a6ff";
          return L.circleMarker(latlng, { 
            radius: 10, 
            color: color, 
            fillColor: color, 
            fillOpacity: 0.8, 
            weight: 2 
          });
        },
        onEachFeature: (f, layer) => {
          layer.bindPopup(`
            <strong>${f.properties.title}</strong><br>
            <small>${f.properties.category}</small>
          `);
        }
      }).addTo(map);
      
      const names = { fires: "Incendios", storms: "Tormentas", volcanoes: "Volcanes" };
      const colors = { fires: '#db6d28', storms: '#bc8cff', volcanoes: '#f85149' };
      $("#map-legend").innerHTML = `<div class="legend-item"><span class="legend-dot" style="background:${colors[type] || '#58a6ff'}"></span>${names[type] || 'Eventos'}</div>`;
    }
    
  } catch (e) {
    console.error("Error al cargar capa:", e);
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
      const w = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${userLat}&longitude=${userLon}&current=temperature_2m,weather_code&timezone=auto`);
      if (w.ok) {
        const wd = await w.json();
        $("#d-temp").textContent = `${Math.round(wd.current.temperature_2m)}°C`;
      }
    } catch(e) { console.warn("Weather error", e); }

    try {
      const aqi = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${userLat}&longitude=${userLon}&current=pm2_5`);
      if (aqi.ok) {
        const aqid = await aqi.json();
        const pm = aqid.current.pm2_5;
        $("#d-aqi").textContent = pm !== undefined ? pm.toFixed(0) : "--";
        $("#d-aqi-label").textContent = pm > 35 ? "Insalubre" : pm > 15 ? "Moderado" : "Bueno";
      }
    } catch(e) { console.warn("AQI error", e); }

    try {
      const q = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson");
      if (q.ok) {
        const qd = await q.json();
        $("#d-quakes").textContent = qd.metadata.count || 0;
      }
    } catch(e) { console.warn("Quakes error", e); }

    try {
      const ev = await fetch("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=1");
      if (ev.ok) {
        const evd = await ev.json();
        $("#d-events").textContent = evd.events ? evd.events.length : 0;
      }
    } catch(e) { console.warn("Events error", e); }

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
    } catch(e) { console.warn("Nearby error", e); }

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

async function loadZoneData(country) {
  const qList = $("#zone-quakes-list");
  if (!qList) return;
  qList.innerHTML = `<li style="justify-content:center;color:var(--text-dim)">Cargando...</li>`;
  
  try {
    const qRes = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson");
    if (!qRes.ok) throw new Error("HTTP error");
    const qData = await qRes.json();
    qList.innerHTML = "";

    const filteredQ = country === "Global" 
      ? qData.features.slice(0, 15) 
      : qData.features.filter(f => f.properties.place && f.properties.place.toLowerCase().includes(country.toLowerCase()));

    if (filteredQ.length === 0) {
      qList.innerHTML = `<li style="justify-content:center;color:var(--text-dim)">Sin sismos recientes en ${country}</li>`;
    } else {
      filteredQ.slice(0, 15).forEach(f => {
        const p = f.properties;
        const mag = p.mag;
        const tag = mag >= 6 ? "critical" : mag >= 4.5 ? "high" : "med";
        const li = document.createElement("li");
        li.innerHTML = `
          <div style="flex:1;min-width:0">
            <div class="item-title">${p.place}</div>
            <div class="item-meta">${new Date(p.time).toLocaleString("es-ES")}</div>
          </div>
          <span class="item-tag tag-${tag}">M ${mag.toFixed(1)}</span>
        `;
        qList.appendChild(li);
      });
    }
  } catch (e) {
    qList.innerHTML = `<li style="color:var(--text-dim)">Error al cargar datos</li>`;
  }
}

// ==========================================
// EMERGENCIA MANUAL
// ==========================================
function triggerEmergency(message, details) {
  const overlay = $("#emergency-overlay");
  if (!overlay) return;
  $("#emergency-message").textContent = message || "Se ha detectado un evento crítico en tu zona.";
  if (details) $("#emergency-details").innerHTML = details;
  overlay.classList.remove("hidden");
  
  if (navigator.vibrate) {
    navigator.vibrate([500, 200, 500, 200, 1000]);
  }
}

$("#btn-exit-emergency").addEventListener("click", () => {
  $("#emergency-overlay").classList.add("hidden");
  if (navigator.vibrate) navigator.vibrate(0);
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
      new Notification("PRUEBA DE GLOBALALERTS", { 
        body: "El sistema de notificaciones push está funcionando correctamente.", 
        icon: "icons/icon-192.svg" 
      });
      toast("Notificación enviada");
    } else {
      toast("Permiso de notificaciones denegado");
    }
  });
});

$("#btn-test-emergency").addEventListener("click", () => {
  triggerEmergency(
    "PRUEBA DE SISTEMA DE EMERGENCIA", 
    "<p>El sistema de alerta temprana está funcionando correctamente.</p><p>La vibración y la interfaz de pantalla completa se han activado para simular un sismo o desastre inminente.</p>"
  );
});

$("#btn-test-quake-alert").addEventListener("click", () => {
  // Simular un sismo de prueba
  const testQuake = {
    id: "test-" + Date.now(),
    geometry: {
      coordinates: [userLon + 0.5, userLat + 0.5, 10]
    },
    properties: {
      mag: 5.8,
      place: "Zona de prueba - 50 km al noreste",
      time: Date.now()
    }
  };
  triggerQuakeAlert(testQuake);
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
// CONFIGURACIÓN DE ALERTAS
// ==========================================
function loadAlertConfig() {
  const saved = localStorage.getItem('ga_alert_config');
  if (saved) {
    alertConfig = JSON.parse(saved);
    $("#cfg-magnitude").value = alertConfig.minMagnitude;
    $("#cfg-distance").value = alertConfig.maxDistance;
    $("#cfg-sound").checked = alertConfig.soundEnabled;
    $("#cfg-vibration").checked = alertConfig.vibrationEnabled;
  }
}

$("#btn-save-alert-config").addEventListener("click", () => {
  alertConfig.minMagnitude = parseFloat($("#cfg-magnitude").value);
  alertConfig.maxDistance = parseInt($("#cfg-distance").value);
  alertConfig.soundEnabled = $("#cfg-sound").checked;
  alertConfig.vibrationEnabled = $("#cfg-vibration").checked;
  
  localStorage.setItem('ga_alert_config', JSON.stringify(alertConfig));
  toast("Configuración de alertas guardada");
});

// ==========================================
// CONFIGURACIÓN GENERAL
// ==========================================
function loadSettings() {
  const savedCountry = localStorage.getItem('ga_country') || 'Mexico';
  const cfgCountry = $("#cfg-country");
  const countryFilter = $("#country-filter");
  if (cfgCountry) cfgCountry.value = savedCountry;
  if (countryFilter) countryFilter.value = savedCountry;
}

$("#btn-save-config").addEventListener("click", () => {
  const cfgCountry = $("#cfg-country");
  if (!cfgCountry) return;
  const country = cfgCountry.value;
  localStorage.setItem('ga_country', country);
  const countryFilter = $("#country-filter");
  if (countryFilter) countryFilter.value = country;
  loadZoneData(country);
  toast("Configuración guardada");
});

// ==========================================
// PWA INSTALL
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
// EVENTOS DE BOTONES
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

$("#country-filter").addEventListener("change", (e) => loadZoneData(e.target.value));

// ==========================================
// INICIALIZACIÓN
// ==========================================
async function init() {
  console.log("=== Iniciando GlobalAlerts Pro ===");
  
  // Cargar configuraciones guardadas
  loadAlertConfig();
  loadSettings();
  
  // Cargar historial
  const savedHistory = localStorage.getItem('ga_alert_history');
  if (savedHistory) {
    alertHistory = JSON.parse(savedHistory);
  }
  
  // Inicializar mapa
  initMap();
  
  // Cargar datos iniciales
  await loadDashboard();
  loadZoneData("Mexico");
  renderAlertHistory();
  
  toast("Sistema de monitoreo activado");
  console.log("Monitoreo de sismos iniciado");

  // Obtener ubicación real
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
            html: '<div class="user-marker-core"></div>',
            iconSize: [20, 20], 
            iconAnchor: [10, 10]
          });
          L.marker([userLat, userLon], { icon: userIcon })
            .addTo(map)
            .bindPopup(`<strong>📍 ${userCity}</strong>`);
        }
        
        await loadDashboard();
        console.log("Ubicación real:", userCity);
      },
      (err) => {
        console.warn("Geolocalización no disponible:", err.message);
        $("#status").textContent = `${userCity} (predeterminada)`;
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
    );
  }
  
  // Iniciar monitoreo de sismos cada 30 segundos
  monitorQuakes();
  setInterval(monitorQuakes, 30000);
  
  // Solicitar permiso de notificaciones
  if ("Notification" in window && Notification.permission === "default") {
    setTimeout(() => {
      Notification.requestPermission();
    }, 3000);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

// Auto-refresh cada 5 minutos
setInterval(() => {
  loadDashboard();
  if ($(".tab.active") && $(".tab.active").dataset.tab === "zonas") {
    loadZoneData($("#country-filter").value);
  }
}, 5 * 60 * 1000);
