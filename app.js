const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

let userLat = 19.4326;
let userLon = -99.1332;
let userCity = "Ciudad de México";
let userCountry = "Mexico";

let map = null;
let currentLayer = null;
let baseLayer = null;

let alertConfig = {
  minMagnitude: 4.5,
  maxDistance: 500,
  soundEnabled: true,
  vibrationEnabled: true,
  lockEnabled: true
};

let monitoredQuakeIds = new Set();
let countdownInterval = null;
let sirenInterval = null;
let lockTimerInterval = null;
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
// NAVEGACIÓN
// ==========================================
$$(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    $$(".nav-btn").forEach(b => b.classList.remove("active"));
    $$(".view").forEach(v => v.classList.remove("active"));
    btn.classList.add("active");
    const view = $(`#${btn.dataset.view}`);
    if (view) view.classList.add("active");
    
    if (btn.dataset.view === "mapa" && map) {
      setTimeout(() => map.invalidateSize(), 200);
    }
  });
});

// ==========================================
// SIRENA
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
  
  osc.frequency.setValueAtTime(440, now);
  osc.frequency.linearRampToValueAtTime(880, now + 0.5);
  osc.frequency.linearRampToValueAtTime(440, now + 1);
  osc.frequency.linearRampToValueAtTime(880, now + 1.5);
  osc.frequency.linearRampToValueAtTime(440, now + 2);
  
  osc.start(now);
  osc.stop(now + 2);
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
  if (!alertConfig.vibrationEnabled || !navigator.vibrate) return;
  navigator.vibrate([500, 200, 500, 200, 1000]);
  setTimeout(() => {
    if (!$("#quake-alert-overlay").classList.contains("hidden")) {
      emergencyVibration();
    }
  }, 3000);
}

function stopVibration() {
  if (navigator.vibrate) navigator.vibrate(0);
}

// ==========================================
// ALERTA SÍSMICA
// ==========================================
function triggerQuakeAlert(quake) {
  const [lon, lat, depth] = quake.geometry.coordinates;
  const distance = distanceKm(userLat, userLon, lat, lon);
  const arrivalTime = Math.max(0, Math.round(distance / 3.5));
  
  $("#alert-magnitude").textContent = `M ${quake.properties.mag.toFixed(1)}`;
  $("#alert-location").textContent = quake.properties.place;
  $("#alert-distance").textContent = `${Math.round(distance)} km`;
  $("#alert-depth").textContent = `Profundidad: ${depth ? depth.toFixed(1) : '?'} km`;
  
  $("#quake-alert-overlay").classList.remove("hidden");
  
  let remaining = arrivalTime;
  $("#alert-countdown").textContent = formatTime(remaining);
  $("#countdown-sub").textContent = remaining > 0 ? `Ondas S en camino (${remaining}s)` : "¡Ondas presentes!";
  
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    remaining--;
    $("#alert-countdown").textContent = formatTime(remaining);
    if (remaining <= 10 && remaining > 0) {
      $("#countdown-sub").textContent = "¡PREPÁRATE!";
    }
    if (remaining <= 0) {
      clearInterval(countdownInterval);
      $("#alert-countdown").textContent = "00:00";
      $("#countdown-sub").textContent = "ONDAS PRESENTES";
    }
  }, 1000);
  
  startSiren();
  emergencyVibration();
  
  if (Notification.permission === "granted") {
    new Notification("¡SISMO DETECTADO!", {
      body: `M ${quake.properties.mag.toFixed(1)} - ${Math.round(distance)} km`,
      icon: "icons/icon-192.svg",
      tag: "quake"
    });
  }
}

$("#btn-close-quake-alert").addEventListener("click", () => {
  $("#quake-alert-overlay").classList.add("hidden");
  if (countdownInterval) clearInterval(countdownInterval);
  stopSiren();
  stopVibration();
});

$("#btn-silence-alarm").addEventListener("click", () => {
  stopSiren();
  toast("Alarma silenciada");
});

function formatTime(seconds) {
  if (seconds <= 0) return "00:00";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
}

// ==========================================
// SISTEMA DE BLOQUEO POR ALERTA OFICIAL
// ==========================================
function triggerOfficialLock(alert) {
  if (!alertConfig.lockEnabled) return;
  
  $("#lock-country").textContent = alert.country;
  $("#lock-title").textContent = alert.title;
  $("#lock-time").textContent = alert.time;
  $("#lock-message").textContent = alert.message;
  
  $("#official-alert-lock").classList.remove("hidden");
  
  let seconds = 30;
  $("#lock-timer").textContent = seconds;
  const btn = $("#btn-acknowledge-alert");
  btn.disabled = true;
  btn.textContent = `HE LEÍDO LA ALERTA (${seconds}s)`;
  
  if (lockTimerInterval) clearInterval(lockTimerInterval);
  lockTimerInterval = setInterval(() => {
    seconds--;
    $("#lock-timer").textContent = seconds;
    btn.textContent = `HE LEÍDO LA ALERTA (${seconds}s)`;
    
    if (seconds <= 0) {
      clearInterval(lockTimerInterval);
      btn.disabled = false;
      btn.textContent = "HE LEÍDO LA ALERTA - TOCA PARA CONTINUAR";
    }
  }, 1000);
  
  if (alertConfig.soundEnabled) startSiren();
  if (alertConfig.vibrationEnabled && navigator.vibrate) {
    navigator.vibrate([1000, 500, 1000, 500, 2000]);
  }
}

$("#btn-acknowledge-alert").addEventListener("click", () => {
  if ($("#btn-acknowledge-alert").disabled) return;
  $("#official-alert-lock").classList.add("hidden");
  if (lockTimerInterval) clearInterval(lockTimerInterval);
  stopSiren();
  stopVibration();
});

// ==========================================
// SIMULACIÓN DE ALERTA OFICIAL
// ==========================================
function simulateOfficialAlert() {
  const alerts = [
    {
      country: "🇲🇽 MÉXICO - Protección Civil",
      title: "ALERTA SÍSMICA NACIONAL",
      time: "Hace 2 minutos",
      message: "Se ha detectado un sismo de magnitud 6.8 con epicentro en la costa de Guerrero. Se recomienda mantener la calma y seguir los protocolos de seguridad. Esté atento a posibles réplicas."
    },
    {
      country: "🇯🇵 JAPÓN - JMA",
      title: "ADVERTENCIA DE TSUNAMI",
      time: "Hace 5 minutos",
      message: "Se ha emitido advertencia de tsunami para la costa este. Se espera oleaje de hasta 3 metros. Evacúe inmediatamente a zonas elevadas."
    },
    {
      country: "🇺🇸 EEUU - NOAA",
      title: "ALERTA DE HURACÁN CATEGORÍA 4",
      time: "Hace 10 minutos",
      message: "El huracán Michael se intensifica a categoría 4 con vientos de 220 km/h. Se espera impacto en 12 horas. Evacúe la zona costera."
    }
  ];
  
  const randomAlert = alerts[Math.floor(Math.random() * alerts.length)];
  triggerOfficialLock(randomAlert);
}

$("#btn-test-official").addEventListener("click", simulateOfficialAlert);

// ==========================================
// NOTICIAS
// ==========================================
const newsData = [
  {
    category: "earthquake",
    icon: "🌍",
    title: "Sismo de magnitud 5.2 sacude la costa de Chile",
    excerpt: "Un terremoto de magnitud 5.2 se registró esta madrugada en la región de Valparaíso, Chile. No se reportan daños materiales ni víctimas.",
    source: "USGS",
    time: "Hace 2 horas"
  },
  {
    category: "weather",
    icon: "🌀",
    title: "Huracán categoría 3 se forma en el Atlántico",
    excerpt: "El Servicio Meteorológico Nacional monitorea la formación de un huracán categoría 3 que podría afectar la costa este en los próximos días.",
    source: "NOAA",
    time: "Hace 4 horas"
  },
  {
    category: "conflict",
    icon: "⚠️",
    title: "Tensiones aumentan en Europa del Este",
    excerpt: "Las autoridades internacionales llaman a la calma mientras aumentan las tensiones militares en la región.",
    source: "Reuters",
    time: "Hace 6 horas"
  },
  {
    category: "earthquake",
    icon: "📊",
    title: "Réplica de magnitud 4.1 tras sismo en Japón",
    excerpt: "Una réplica de magnitud 4.1 se registró tras el sismo principal de ayer. Las autoridades mantienen el estado de alerta.",
    source: "JMA",
    time: "Hace 8 horas"
  },
  {
    category: "weather",
    icon: "🔥",
    title: "Incendios forestales se propagan en California",
    excerpt: "Múltiples incendios forestales continúan activos en el norte de California. Miles de personas han sido evacuadas.",
    source: "Cal Fire",
    time: "Hace 10 horas"
  },
  {
    category: "conflict",
    icon: "🌍",
    title: "Crisis humanitaria en Medio Oriente",
    excerpt: "Organizaciones internacionales solicitan acceso humanitario urgente para ayudar a civiles afectados por el conflicto.",
    source: "ONU",
    time: "Hace 12 horas"
  }
];

function loadNews(category = "all") {
  const featured = $("#news-featured");
  const list = $("#news-list");
  
  const filtered = category === "all" ? newsData : newsData.filter(n => n.category === category);
  
  if (filtered.length > 0) {
    const featured = filtered[0];
    $("#news-featured").innerHTML = `
      <div class="news-card-featured">
        <div class="news-image">${featured.icon}</div>
        <div class="news-content">
          <div class="news-category">${featured.category}</div>
          <h3 class="news-title">${featured.title}</h3>
          <p class="news-excerpt">${featured.excerpt}</p>
          <div class="news-meta">
            <span>${featured.source}</span>
            <span>${featured.time}</span>
          </div>
        </div>
      </div>
    `;
  }
  
  list.innerHTML = "";
  filtered.slice(1).forEach(news => {
    const card = document.createElement("div");
    card.className = "news-card";
    card.innerHTML = `
      <div class="news-card-icon">${news.icon}</div>
      <div class="news-card-content">
        <h4 class="news-card-title">${news.title}</h4>
        <div class="news-card-meta">${news.source} · ${news.time}</div>
      </div>
    `;
    list.appendChild(card);
  });
}

$$(".news-filter").forEach(btn => {
  btn.addEventListener("click", () => {
    $$(".news-filter").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    loadNews(btn.dataset.category);
  });
});

$("#btn-load-more-news").addEventListener("click", () => {
  toast("No hay más noticias disponibles");
});

// ==========================================
// ALERTAS OFICIALES
// ==========================================
function loadOfficialAlerts() {
  const alerts = [
    {
      country: "🇲🇽 México",
      title: "Sismo M5.2 - Costa de Guerrero",
      time: "Hace 2 horas",
      message: "Se registró un sismo de magnitud 5.2 con epicentro en la costa de Guerrero. No se reportan daños.",
      critical: false
    },
    {
      country: "🇯🇵 Japón",
      title: "Advertencia de Tsunami - Costa Este",
      time: "Hace 5 horas",
      message: "Se emitió advertencia de tsunami para la costa este. Se espera oleaje de hasta 2 metros.",
      critical: true
    },
    {
      country: "🇺🇸 EEUU",
      title: "Huracán categoría 3 - Atlántico",
      time: "Hace 8 horas",
      message: "Huracán en formación con vientos de 180 km/h. Monitoreo constante.",
      critical: false
    }
  ];
  
  const list = $("#official-alerts-list");
  list.innerHTML = "";
  
  alerts.forEach(alert => {
    const card = document.createElement("div");
    card.className = `official-alert-card ${alert.critical ? 'critical' : ''}`;
    card.innerHTML = `
      <div class="official-alert-header">
        <span class="official-alert-country">${alert.country}</span>
        <span class="official-alert-time">${alert.time}</span>
      </div>
      <h3 class="official-alert-title">${alert.title}</h3>
      <p class="official-alert-message">${alert.message}</p>
    `;
    list.appendChild(card);
  });
}

// ==========================================
// MAPA
// ==========================================
const mapLayers = {
  osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OSM', maxZoom: 19 }),
  satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '&copy; Esri', maxZoom: 18 }),
  dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; CARTO', subdomains: 'abcd', maxZoom: 19 })
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
  }
}

function changeMapType(type) {
  if (!map || !mapLayers[type]) return;
  if (baseLayer) map.removeLayer(baseLayer);
  baseLayer = mapLayers[type];
  baseLayer.addTo(map);
  if (currentLayer) currentLayer.bringToFront();
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
      if (!r.ok) throw new Error("HTTP error");
      const d = await r.json();
      
      currentLayer = L.geoJSON(d, {
        pointToLayer: (f, latlng) => {
          const mag = f.properties.mag;
          const color = mag >= 6 ? "#ef4444" : mag >= 4.5 ? "#f59e0b" : "#10b981";
          return L.circleMarker(latlng, { radius: Math.max(8, mag * 5), color, fillColor: color, fillOpacity: 0.6, weight: 2 });
        },
        onEachFeature: (f, layer) => {
          const p = f.properties;
          layer.bindPopup(`<strong>M ${p.mag.toFixed(1)}</strong><br>${p.place}`);
        }
      }).addTo(map);
      
      $("#map-legend").innerHTML = `
        <div class="legend-item"><span class="legend-dot" style="background:#10b981"></span>M 2.5-4.5</div>
        <div class="legend-item"><span class="legend-dot" style="background:#f59e0b"></span>M 4.5-6.0</div>
        <div class="legend-item"><span class="legend-dot" style="background:#ef4444"></span>M 6.0+</div>
      `;
    } else {
      const r = await fetch("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=50");
      if (!r.ok) throw new Error("HTTP error");
      const d = await r.json();
      const features = [];
      
      d.events.forEach(ev => {
        const cat = ev.categories[0];
        if (!cat) return;
        if (type === "hurricanes" && cat.id !== 10 && cat.id !== 9) return;
        if (type === "fires" && cat.id !== 8) return;
        if (type === "volcanoes" && cat.id !== 12) return;
        if (type === "storms" && cat.id !== 9 && cat.id !== 10) return;
        const geom = ev.geometry.find(g => g.coordinates);
        if (!geom) return;
        features.push({ type: "Feature", geometry: { type: "Point", coordinates: geom.coordinates }, properties: { title: ev.title, category: cat.title } });
      });

      const colors = { hurricanes: "#8b5cf6", fires: "#f97316", volcanoes: "#ef4444", storms: "#3b82f6" };
      currentLayer = L.geoJSON(features, {
        pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 12, color: colors[type], fillColor: colors[type], fillOpacity: 0.7, weight: 2 }),
        onEachFeature: (f, layer) => layer.bindPopup(`<strong>${f.properties.title}</strong><br><small>${f.properties.category}</small>`)
      }).addTo(map);
      
      const names = { hurricanes: "Huracanes", fires: "Incendios", volcanoes: "Volcanes", storms: "Tormentas" };
      $("#map-legend").innerHTML = `<div class="legend-item"><span class="legend-dot" style="background:${colors[type]}"></span>${names[type]}</div>`;
    }
  } catch (e) {
    console.error("Error capa:", e);
  }
}

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
// DASHBOARD
// ==========================================
async function loadDashboard() {
  try {
    $("#status").textContent = userCity;
    
    const w = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${userLat}&longitude=${userLon}&current=temperature_2m&timezone=auto`);
    if (w.ok) {
      const wd = await w.json();
      $("#d-temp").textContent = `${Math.round(wd.current.temperature_2m)}°C`;
    }

    const aqi = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${userLat}&longitude=${userLon}&current=pm2_5`);
    if (aqi.ok) {
      const aqid = await aqi.json();
      const pm = aqid.current.pm2_5;
      $("#d-aqi").textContent = pm !== undefined ? pm.toFixed(0) : "--";
      $("#d-aqi-label").textContent = pm > 35 ? "Insalubre" : pm > 15 ? "Moderado" : "Bueno";
    }

    const q = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson");
    if (q.ok) {
      const qd = await q.json();
      $("#d-quakes").textContent = qd.metadata.count || 0;
    }

    const ev = await fetch("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=1");
    if (ev.ok) {
      const evd = await ev.json();
      $("#d-events").textContent = evd.events ? evd.events.length : 0;
    }

    const q24 = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson");
    if (q24.ok) {
      const q24d = await q24.json();
      const nearby = q24d.features.filter(f => {
        const [lon, lat] = f.geometry.coordinates;
        return distanceKm(userLat, userLon, lat, lon) < 1000;
      }).slice(0, 5);
      
      $("#alerts-badge").textContent = `${nearby.length}`;
      const al = $("#alerts-list");
      al.innerHTML = "";
      if (nearby.length === 0) {
        al.innerHTML = `<div class="list-item"><div class="list-item-content"><div class="list-item-title">Sin alertas cercanas</div><div class="list-item-meta">Radio de 1000 km</div></div></div>`;
      } else {
        nearby.forEach(f => {
          const p = f.properties;
          const dist = distanceKm(userLat, userLon, f.geometry.coordinates[1], f.geometry.coordinates[0]);
          const item = document.createElement("div");
          item.className = "list-item";
          item.innerHTML = `
            <div class="list-item-content">
              <div class="list-item-title">${p.place}</div>
              <div class="list-item-meta">${Math.round(dist)} km · ${new Date(p.time).toLocaleString("es-ES")}</div>
            </div>
            <span class="tag ${p.mag >= 4.5 ? 'tag-high' : 'tag-med'}">M ${p.mag.toFixed(1)}</span>
          `;
          al.appendChild(item);
        });
      }
    }

    $("#last-check").textContent = new Date().toLocaleTimeString("es-ES");
    $("#monitored-quakes").textContent = "Activo";

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
// MONITOREO
// ==========================================
async function monitorQuakes() {
  try {
    const response = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson");
    if (!response.ok) throw new Error("HTTP error");
    const data = await response.json();
    
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
    console.error("Error monitoreo:", e);
  }
}

// ==========================================
// BOTONES DE PRUEBA
// ==========================================
$("#btn-test-notif").addEventListener("click", () => {
  if (!("Notification" in window)) {
    toast("Navegador no soporta notificaciones");
    return;
  }
  Notification.requestPermission().then(perm => {
    if (perm === "granted") {
      new Notification("GlobalAlerts Pro", { body: "Notificaciones activadas correctamente", icon: "icons/icon-192.svg" });
      toast("Notificación enviada");
    } else {
      toast("Permiso denegado");
    }
  });
});

$("#btn-test-quake").addEventListener("click", () => {
  const testQuake = {
    id: "test-" + Date.now(),
    geometry: { coordinates: [userLon + 0.5, userLat + 0.5, 10] },
    properties: { mag: 6.5, place: "Zona de prueba", time: Date.now() }
  };
  triggerQuakeAlert(testQuake);
});

$("#btn-test-siren").addEventListener("click", () => {
  if (alertConfig.soundEnabled) {
    startSiren();
    toast("Sirena activada (5s)");
    setTimeout(stopSiren, 5000);
  } else {
    toast("Activa el sonido en configuración");
  }
});

// ==========================================
// CONFIGURACIÓN
// ==========================================
function loadConfig() {
  const saved = localStorage.getItem('ga_config');
  if (saved) {
    alertConfig = JSON.parse(saved);
    $("#cfg-magnitude").value = alertConfig.minMagnitude;
    $("#cfg-distance").value = alertConfig.maxDistance;
    $("#cfg-sound").checked = alertConfig.soundEnabled;
    $("#cfg-vibration").checked = alertConfig.vibrationEnabled;
    $("#cfg-lock").checked = alertConfig.lockEnabled;
  }
  
  const country = localStorage.getItem('ga_country') || 'Mexico';
  $("#cfg-country").value = country;
  userCountry = country;
}

$("#btn-save-config").addEventListener("click", () => {
  alertConfig.minMagnitude = parseFloat($("#cfg-magnitude").value);
  alertConfig.maxDistance = parseInt($("#cfg-distance").value);
  alertConfig.soundEnabled = $("#cfg-sound").checked;
  alertConfig.vibrationEnabled = $("#cfg-vibration").checked;
  alertConfig.lockEnabled = $("#cfg-lock").checked;
  
  localStorage.setItem('ga_config', JSON.stringify(alertConfig));
  localStorage.setItem('ga_country', $("#cfg-country").value);
  userCountry = $("#cfg-country").value;
  
  toast("Configuración guardada");
});

// ==========================================
// INIT
// ==========================================
async function init() {
  console.log("=== GlobalAlerts Pro ===");
  
  loadConfig();
  initMap();
  loadNews();
  loadOfficialAlerts();
  await loadDashboard();
  
  toast("Sistema activado");

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
        
        if (map) {
          map.setView([userLat, userLon], 6);
          L.marker([userLat, userLon]).addTo(map).bindPopup(`<strong>${userCity}</strong>`);
        }
        
        await loadDashboard();
      },
      (err) => {
        console.warn("Geoloc error:", err.message);
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

setInterval(loadDashboard, 5 * 60 * 1000);
