const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// Ubicación por defecto (Ciudad de México) - SIEMPRE carga datos
let userLat = 19.4326;
let userLon = -99.1332;
let userCity = "Ciudad de México";

let map = null;
let currentLayer = null;
let deferredPrompt = null;

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
      setTimeout(() => map.invalidateSize(), 150);
    }
  });
});

// ==========================================
// MAPA
// ==========================================
function initMap() {
  if (map) return;

  try {
    map = L.map("map", { 
      zoomControl: true, 
      worldCopyJump: true,
      center: [20, 0],
      zoom: 2
    });
    
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      subdomains: 'abcd', 
      maxZoom: 19
    }).addTo(map);

    // Forzar renderizado
    setTimeout(() => map.invalidateSize(), 300);
    
    loadMapLayer("quakes");
    console.log("Mapa inicializado correctamente");
  } catch (e) {
    console.error("Error al inicializar mapa:", e);
    toast("Error al cargar el mapa");
  }
}

async function loadMapLayer(type) {
  if (!map) return;
  if (currentLayer) {
    try { map.removeLayer(currentLayer); } catch(e) {}
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
            radius: Math.max(5, mag * 3), 
            color, fillColor: color, fillOpacity: 0.6, weight: 2 
          });
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
          return L.circleMarker(latlng, { radius: 8, color, fillColor: color, fillOpacity: 0.7, weight: 2 });
        },
        onEachFeature: (f, layer) => {
          layer.bindPopup(`<strong>${f.properties.title}</strong><br><small>${f.properties.category}</small>`);
        }
      }).addTo(map);
      
      const names = { fires: "Incendios", storms: "Tormentas", volcanoes: "Volcanes" };
      const colors = { fires: '#db6d28', storms: '#bc8cff', volcanoes: '#f85149' };
      $("#map-legend").innerHTML = `<div class="legend-item"><span class="legend-dot" style="background:${colors[type] || '#58a6ff'}"></span>${names[type] || 'Eventos'}</div>`;
    }
  } catch (e) {
    console.error("Error capa mapa:", e);
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

    // Temperatura
    try {
      const w = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${userLat}&longitude=${userLon}&current=temperature_2m,weather_code&timezone=auto`);
      if (w.ok) {
        const wd = await w.json();
        $("#d-temp").textContent = `${Math.round(wd.current.temperature_2m)}°C`;
      }
    } catch(e) { console.warn("Weather error", e); }

    // Calidad aire
    try {
      const aqi = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${userLat}&longitude=${userLon}&current=pm2_5`);
      if (aqi.ok) {
        const aqid = await aqi.json();
        const pm = aqid.current.pm2_5;
        $("#d-aqi").textContent = pm !== undefined ? pm.toFixed(0) : "--";
        $("#d-aqi-label").textContent = pm > 35 ? "Insalubre" : pm > 15 ? "Moderado" : "Bueno";
      }
    } catch(e) { console.warn("AQI error", e); }

    // Sismos
    try {
      const q = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson");
      if (q.ok) {
        const qd = await q.json();
        $("#d-quakes").textContent = qd.metadata.count || 0;
      }
    } catch(e) { console.warn("Quakes error", e); }

    // Eventos NASA
    try {
      const ev = await fetch("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=1");
      if (ev.ok) {
        const evd = await ev.json();
        $("#d-events").textContent = evd.events ? evd.events.length : 0;
      }
    } catch(e) { console.warn("Events error", e); }

    // Alertas cercanas
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

// ==========================================
// ZONAS / PAÍS
// ==========================================
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
// EMERGENCIA
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
// BOTONES DEL MAPA
// ==========================================
$$(".map-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    $$(".map-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    loadMapLayer(btn.dataset.layer);
  });
});

$("#country-filter").addEventListener("change", (e) => loadZoneData(e.target.value));

// ==========================================
// INICIALIZACIÓN - CARGA INMEDIATA
// ==========================================
async function init() {
  console.log("Iniciando GlobalAlerts...");
  
  // 1. Inicializar mapa inmediatamente
  initMap();
  
  // 2. Cargar datos inmediatamente con ubicación por defecto
  await loadDashboard();
  loadZoneData("Mexico");
  loadSettings();
  
  toast("Datos cargados correctamente");

  // 3. Intentar obtener ubicación real (sin bloquear la app)
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
            html: '<div style="width:14px;height:14px;background:#58a6ff;border:3px solid white;border-radius:50%;box-shadow:0 0 8px rgba(88,166,255,0.8);"></div>',
            iconSize: [20, 20], iconAnchor: [10, 10]
          });
          L.marker([userLat, userLon], { icon: userIcon }).addTo(map).bindPopup(`<strong>${userCity}</strong>`);
        }
        
        // Recargar datos con ubicación real
        await loadDashboard();
        console.log("Ubicación real detectada:", userCity);
      },
      (err) => {
        console.warn("Geolocalización no disponible:", err.message);
        $("#status").textContent = `${userCity} (predeterminada)`;
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
    );
  }
}

// Ejecutar init cuando el DOM esté listo
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
