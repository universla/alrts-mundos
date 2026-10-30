const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

let userLat = null, userLon = null, userCity = "Detectando...";
let map, currentLayer = null;
let deferredPrompt = null;
let notifEnabled = localStorage.getItem('ga_notif') === 'true';
let defaultCountry = localStorage.getItem('ga_country') || 'Mexico';

// ============ TOAST ============
function toast(msg, duration = 3000) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), duration);
}

// ============ TABS & MAP FIX ============
$$(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    $$(".tab").forEach(t => t.classList.remove("active"));
    $$(".view").forEach(v => v.classList.remove("active"));
    tab.classList.add("active");
    $(`#${tab.dataset.tab}`).classList.add("active");
    
    // CRUCIAL: Fix map rendering when tab becomes visible
    setTimeout(() => {
      if (tab.dataset.tab === "mapa" && map) {
        map.invalidateSize();
      }
    }, 150);
  });
});

// ============ INIT MAP ============
function initMap() {
  if (map) return; // Prevent re-initialization
  
  map = L.map("map", { zoomControl: true, worldCopyJump: true }).setView([20, 0], 2);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: 'abcd', maxZoom: 19
  }).addTo(map);

  // Custom user marker style
  const style = document.createElement("style");
  style.textContent = `
    .user-marker { position: relative; }
    .pulse-core {
      width: 14px; height: 14px; background: #58a6ff;
      border: 3px solid white; border-radius: 50%;
      box-shadow: 0 0 8px rgba(88,166,255,0.8);
    }
    .pulse-ring {
      position: absolute; width: 40px; height: 40px;
      border: 2px solid #58a6ff; border-radius: 50%;
      top: 50%; left: 50%; transform: translate(-50%, -50%);
      animation: pulseRing 2s infinite;
    }
    @keyframes pulseRing {
      0% { transform: translate(-50%, -50%) scale(0.5); opacity: 1; }
      100% { transform: translate(-50%, -50%) scale(1.5); opacity: 0; }
    }
  `;
  document.head.appendChild(style);

  $$(".map-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      $$(".map-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      loadMapLayer(btn.dataset.layer);
    });
  });

  loadMapLayer("quakes");
}

async function loadMapLayer(type) {
  if (!map) return;
  if (currentLayer) map.removeLayer(currentLayer);

  try {
    if (type === "quakes") {
      const r = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson");
      const d = await r.json();
      currentLayer = L.geoJSON(d, {
        pointToLayer: (f, latlng) => {
          const mag = f.properties.mag;
          const color = mag >= 6 ? "#f85149" : mag >= 4.5 ? "#d29922" : "#3fb950";
          return L.circleMarker(latlng, { radius: Math.max(5, mag * 3), color, fillColor: color, fillOpacity: 0.6, weight: 2 });
        },
        onEachFeature: (f, layer) => {
          const p = f.properties;
          layer.bindPopup(`<strong>M ${p.mag.toFixed(1)}</strong><br>${p.place}<br><small>${new Date(p.time).toLocaleString("es-ES")}</small>`);
        }
      }).addTo(map);
      $("#map-legend").innerHTML = `
        <div class="legend-item"><span class="legend-dot" style="background:#3fb950"></span>M 2.5-4.5</div>
        <div class="legend-item"><span class="legend-dot" style="background:#d29922"></span>M 4.5-6.0</div>
        <div class="legend-item"><span class="legend-dot" style="background:#f85149"></span>M 6.0+</div>
      `;
    } else {
      // NASA Events
      const r = await fetch("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=50");
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
          properties: { title: ev.title, category: cat.title, date: geom.date, id: cat.id }
        });
      });

      currentLayer = L.geoJSON(features, {
        pointToLayer: (f, latlng) => {
          const colors = { 8: "#db6d28", 9: "#58a6ff", 10: "#bc8cff", 12: "#f85149" };
          const color = colors[f.properties.id] || "#58a6ff";
          return L.circleMarker(latlng, { radius: 8, color, fillColor: color, fillOpacity: 0.7, weight: 2 });
        },
        onEachFeature: (f, layer) => {
          layer.bindPopup(`<strong>${f.properties.title}</strong><br><small>${f.properties.category}</small>`);
        }
      }).addTo(map);
      
      const names = { fires: "Incendios", storms: "Tormentas", volcanoes: "Volcanes" };
      $("#map-legend").innerHTML = `<div class="legend-item"><span class="legend-dot" style="background:${type === 'fires' ? '#db6d28' : type === 'storms' ? '#bc8cff' : '#f85149'}"></span>${names[type] || 'Eventos'}</div>`;
    }
  } catch (e) {
    console.error("Map layer error", e);
    toast("Error al cargar capa del mapa");
  }
}

// ============ DATA LOADING ============
async function loadDashboard() {
  if (userLat === null) return;
  try {
    // Weather
    const w = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${userLat}&longitude=${userLon}&current=temperature_2m,weather_code&timezone=auto`)).json();
    $("#d-temp").textContent = `${Math.round(w.current.temperature_2m)}°C`;
    $("#d-loc").textContent = userCity;

    // AQI
    const aqi = await (await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${userLat}&longitude=${userLon}&current=pm2_5`)).json();
    const pm = aqi.current.pm2_5;
    $("#d-aqi").textContent = pm !== undefined ? pm.toFixed(0) : "--";
    $("#d-aqi-label").textContent = pm > 35 ? "Insalubre" : pm > 15 ? "Moderado" : "Bueno";

    // Quakes count
    const q = await (await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson")).json();
    $("#d-quakes").textContent = q.metadata.count;

    // Events count
    const ev = await (await fetch("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=1")).json();
    $("#d-events").textContent = ev.events.length;

    // Nearby alerts
    const q24 = await (await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson")).json();
    const nearby = q24.features.filter(f => {
      const [lon, lat] = f.geometry.coordinates;
      return distanceKm(userLat, userLon, lat, lon) < 500;
    }).slice(0, 5);
    
    $("#alerts-badge").textContent = `${nearby.length} cercanas`;
    const al = $("#alerts-list");
    al.innerHTML = "";
    if (nearby.length === 0) {
      al.innerHTML = `<li style="justify-content:center;color:var(--text-dim);cursor:default">Sin alertas cercanas (500 km)</li>`;
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

  } catch (e) {
    console.error("Dashboard load error", e);
  }
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ============ ZONE / COUNTRY FILTER ============
async function loadZoneData(country) {
  const qList = $("#zone-quakes-list");
  const eList = $("#zone-events-list");
  qList.innerHTML = `<li class="skeleton"></li><li class="skeleton"></li>`;
  eList.innerHTML = `<li class="skeleton"></li>`;

  try {
    const [qRes, eRes] = await Promise.all([
      fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson"),
      fetch("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=30")
    ]);
    const qData = await qRes.json();
    const eData = await eRes.json();

    qList.innerHTML = "";
    eList.innerHTML = "";

    if (country === "Global") {
      qData.features.slice(0, 10).forEach(f => addQuakeToList(f, qList));
      eData.events.slice(0, 10).forEach(ev => addEventToList(ev, eList));
    } else {
      const filteredQ = qData.features.filter(f => f.properties.place && f.properties.place.toLowerCase().includes(country.toLowerCase()));
      const filteredE = eData.events.filter(ev => ev.title && ev.title.toLowerCase().includes(country.toLowerCase()));

      if (filteredQ.length === 0) qList.innerHTML = `<li style="justify-content:center;color:var(--text-dim);cursor:default">Sin sismos recientes registrados en ${country}</li>`;
      else filteredQ.slice(0, 10).forEach(f => addQuakeToList(f, qList));

      if (filteredE.length === 0) eList.innerHTML = `<li style="justify-content:center;color:var(--text-dim);cursor:default">Sin eventos naturales activos en ${country}</li>`;
      else filteredE.slice(0, 10).forEach(ev => addEventToList(ev, eList));
    }
  } catch (e) {
    qList.innerHTML = `<li style="color:var(--text-dim)">Error al cargar datos de zona</li>`;
  }
}

function addQuakeToList(f, container) {
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
  container.appendChild(li);
}

function addEventToList(ev, container) {
  const cat = ev.categories[0]?.title || "Evento";
  const li = document.createElement("li");
  li.innerHTML = `
    <div style="flex:1;min-width:0">
      <div class="item-title">${ev.title}</div>
      <div class="item-meta">${cat} · ${new Date(ev.geometry[0]?.dateEvent || Date.now()).toLocaleDateString("es-ES")}</div>
    </div>
    <span class="item-tag tag-low">Activo</span>
  `;
  container.appendChild(li);
}

// ============ EMERGENCY MODE ============
function triggerEmergency(message, details) {
  $("#emergency-message").textContent = message || "Se ha detectado un evento critico en tu zona.";
  $("#emergency-details").innerHTML = details || "<p>Busque un lugar seguro inmediatamente.</p><p>Alejese de ventanas y estructuras inestables.</p>";
  $("#emergency-overlay").classList.remove("hidden");
  
  // Vibrate device (mobile)
  if (navigator.vibrate) {
    navigator.vibrate([500, 200, 500, 200, 1000]);
  }
}

$("#btn-exit-emergency").addEventListener("click", () => {
  $("#emergency-overlay").classList.add("hidden");
  if (navigator.vibrate) navigator.vibrate(0); // Stop vibration
});

$("#btn-emergency-trigger").addEventListener("click", () => {
  triggerEmergency("ALERTA MANUAL ACTIVADA", "<p>Esta es una prueba del sistema de emergencia.</p><p>En una situacion real, aqui apareceria la informacion del sismo o desastre.</p>");
});

// ============ SETTINGS ============
function loadSettings() {
  $("#cfg-notif").checked = notifEnabled;
  $("#cfg-location").value = defaultCountry;
}

$("#btn-save-config").addEventListener("click", () => {
  notifEnabled = $("#cfg-notif").checked;
  defaultCountry = $("#cfg-location").value || "Mexico";
  localStorage.setItem('ga_notif', notifEnabled);
  localStorage.setItem('ga_country', defaultCountry);
  
  if (notifEnabled && "Notification" in window) {
    Notification.requestPermission().then(perm => {
      if (perm === "granted") toast("Notificaciones activadas correctamente");
    });
  }
  
  $("#country-filter").value = defaultCountry;
  loadZoneData(defaultCountry);
  toast("Configuracion guardada");
});

$("#btn-test-quake").addEventListener("click", () => {
  toast("Simulando alerta de sismo M 5.4...");
  if (notifEnabled && Notification.permission === "granted") {
    new Notification("ALERTA DE SISMO", { body: "Sismo M 5.4 detectado a 45 km de tu ubicacion.", icon: "icons/icon-192.svg" });
  }
});

$("#btn-test-emergency").addEventListener("click", () => {
  triggerEmergency("PRUEBA DE SISTEMA DE EMERGENCIA", "<p>El sistema de alerta temprana esta funcionando correctamente.</p><p>La vibracion y la interfaz de pantalla completa se han activado.</p>");
});

// ============ NOTIFICATIONS & PWA ============
$("#btn-notif").addEventListener("click", () => {
  if (!("Notification" in window)) {
    toast("Tu navegador no soporta notificaciones");
    return;
  }
  Notification.requestPermission().then(perm => {
    if (perm === "granted") {
      notifEnabled = true;
      localStorage.setItem('ga_notif', 'true');
      $("#cfg-notif").checked = true;
      toast("Notificaciones activadas");
      new Notification("GlobalAlerts Pro", { body: "Sistema de alertas configurado correctamente.", icon: "icons/icon-192.svg" });
    }
  });
});

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  $("#btn-install").classList.remove("hidden");
});

$("#btn-install").addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $("#btn-install").classList.add("hidden");
  toast("App instalada en tu pantalla de inicio");
});

// ============ INIT ============
async function init() {
  $("#status").textContent = "Iniciando sistemas...";
  initMap();
  loadSettings();

  if ("geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        userLat = pos.coords.latitude;
        userLon = pos.coords.longitude;
        
        try {
          const geo = await (await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${userLat}&lon=${userLon}&zoom=10`)).json();
          userCity = geo.address.city || geo.address.town || geo.address.state || "Ubicacion actual";
        } catch(e) { userCity = "Ubicacion actual"; }
        
        $("#status").textContent = userCity;
        
        const userIcon = L.divIcon({
          className: "user-marker",
          html: '<div class="pulse-ring"></div><div class="pulse-core"></div>',
          iconSize: [24, 24], iconAnchor: [12, 12]
        });
        L.marker([userLat, userLon], { icon: userIcon }).addTo(map).bindPopup(`<strong>${userCity}</strong>`);
        map.setView([userLat, userLon], 6);

        loadDashboard();
      },
      () => {
        $("#status").textContent = "Ubicacion por defecto";
        userLat = 19.4326; userLon = -99.1332; userCity = "Ciudad de Mexico";
        map.setView([userLat, userLon], 5);
        loadDashboard();
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  $("#country-filter").value = defaultCountry;
  loadZoneData(defaultCountry);
  
  $("#country-filter").addEventListener("change", (e) => loadZoneData(e.target.value));
}

init();

// Auto-refresh
setInterval(() => {
  loadDashboard();
  if ($(".tab.active").dataset.tab === "zonas") {
    loadZoneData($("#country-filter").value);
  }
}, 5 * 60 * 1000);
