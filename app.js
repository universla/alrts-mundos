const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

let userLat = null, userLon = null, userCity = "Detectando...";
let map, weatherMap, currentLayer = null, userMarker = null;
let deferredPrompt = null;
let notifEnabled = false;
let radarLayer = null;

// ============ TOAST ============
function toast(msg, duration = 3000) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), duration);
}

// ============ GEOCODING INVERSO (nombre de ciudad) ============
async function reverseGeocode(lat, lon) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1`, {
      headers: { "Accept-Language": "es" }
    });
    const d = await r.json();
    const a = d.address;
    const city = a.city || a.town || a.village || a.county || a.state || "";
    const country = a.country || "";
    return city && country ? `${city}, ${country}` : d.display_name || `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
  } catch (e) {
    return `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
  }
}

// ============ TABS ============
$$(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    $$(".tab").forEach(t => t.classList.remove("active"));
    $$(".view").forEach(v => v.classList.remove("active"));
    tab.classList.add("active");
    $(`#${tab.dataset.tab}`).classList.add("active");
    // Redimensionar mapas al cambiar de pestaña
    setTimeout(() => {
      if (tab.dataset.tab === "mapa" && map) map.invalidateSize();
      if (tab.dataset.tab === "clima" && weatherMap) weatherMap.invalidateSize();
    }, 150);
  });
});

// ============ WEATHER ============
async function loadWeather(lat, lon) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,surface_pressure,weather_code,uv_index&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=7`;
    const r = await fetch(url);
    const d = await r.json();
    const c = d.current;
    const desc = weatherCode(c.weather_code);

    $("#d-temp").textContent = `${Math.round(c.temperature_2m)}°C`;
    $("#d-loc").textContent = `${userCity} · ${desc}`;

    $("#w-temp").textContent = `${Math.round(c.temperature_2m)}°C`;
    $("#w-feels").textContent = `${Math.round(c.apparent_temperature)}°C`;
    $("#w-wind").textContent = `${Math.round(c.wind_speed_10m)} km/h`;
    $("#w-hum").textContent = `${c.relative_humidity_2m}%`;
    $("#w-pres").textContent = `${Math.round(c.surface_pressure)} hPa`;
    $("#w-uv").textContent = c.uv_index !== undefined ? c.uv_index.toFixed(1) : "—";
    $("#w-badge").textContent = desc;

    // Forecast
    const fc = $("#forecast");
    fc.innerHTML = "";
    const days = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
    d.daily.time.forEach((date, i) => {
      const dt = new Date(date);
      const div = document.createElement("div");
      div.className = "forecast-day";
      div.innerHTML = `
        <div class="day">${i === 0 ? "Hoy" : days[dt.getDay()]}</div>
        <div class="temp">${Math.round(d.daily.temperature_2m_max[i])}°</div>
        <div class="desc">${Math.round(d.daily.temperature_2m_min[i])}° · ${weatherCode(d.daily.weather_code[i])}</div>
      `;
      fc.appendChild(div);
    });
  } catch (e) {
    console.error("Weather error", e);
    toast("Error al cargar clima");
  }
}

function weatherCode(code) {
  if (code === 0) return "Despejado";
  if (code <= 3) return "Nublado";
  if (code <= 48) return "Niebla";
  if (code <= 57) return "Llovizna";
  if (code <= 67) return "Lluvia";
  if (code <= 77) return "Nieve";
  if (code <= 82) return "Chubascos";
  if (code <= 86) return "Nevada fuerte";
  if (code <= 99) return "Tormenta";
  return "—";
}

// ============ AIR QUALITY ============
async function loadAirQuality(lat, lon) {
  try {
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone&timezone=auto`;
    const r = await fetch(url);
    const d = await r.json();
    const c = d.current;
    const pm25 = c.pm2_5;

    $("#aqi-pm25").textContent = pm25 !== undefined ? pm25.toFixed(1) : "—";
    $("#aqi-pm10").textContent = c.pm10 !== undefined ? c.pm10.toFixed(1) : "—";
    $("#aqi-o3").textContent = c.ozone !== undefined ? c.ozone.toFixed(1) : "—";
    $("#aqi-no2").textContent = c.nitrogen_dioxide !== undefined ? c.nitrogen_dioxide.toFixed(1) : "—";
    $("#aqi-so2").textContent = c.sulphur_dioxide !== undefined ? c.sulphur_dioxide.toFixed(1) : "—";
    $("#aqi-co").textContent = c.carbon_monoxide !== undefined ? (c.carbon_monoxide/1000).toFixed(2) : "—";

    let level = "Bueno", cls = "tag-low", advice = "El aire es limpio. Puedes hacer actividades al aire libre.";
    if (pm25 > 55) { level = "Muy insalubre"; cls = "tag-critical"; advice = "Evita actividades al aire libre. Usa mascarilla N95."; }
    else if (pm25 > 35) { level = "Insalubre"; cls = "tag-high"; advice = "Limita actividades prolongadas al aire libre."; }
    else if (pm25 > 20) { level = "Moderado"; cls = "tag-med"; advice = "Personas sensibles deben reducir esfuerzo prolongado."; }
    else if (pm25 > 12) { level = "Aceptable"; cls = "tag-low"; }

    $("#d-aqi").textContent = pm25 !== undefined ? pm25.toFixed(0) : "—";
    $("#d-aqi-label").textContent = level;
    $("#aqi-badge").textContent = level;
    $("#aqi-badge").className = `badge item-tag ${cls}`;
    $("#aqi-advice").textContent = advice;
  } catch (e) {
    console.error("AQI error", e);
  }
}

// ============ QUAKE MAP ============
async function loadQuakeMap() {
  try {
    const r = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson");
    const d = await r.json();
    if (currentLayer) map.removeLayer(currentLayer);
    currentLayer = L.geoJSON(d, {
      pointToLayer: (f, latlng) => {
        const mag = f.properties.mag;
        const color = mag >= 6 ? "#f85149" : mag >= 4.5 ? "#d29922" : "#3fb950";
        return L.circleMarker(latlng, {
          radius: Math.max(5, mag * 3),
          color: color,
          fillColor: color,
          fillOpacity: 0.5,
          weight: 2
        });
      },
      onEachFeature: (f, layer) => {
        const p = f.properties;
        const time = new Date(p.time).toLocaleString("es-ES");
        layer.bindPopup(`
          <strong>M ${p.mag.toFixed(1)}</strong><br>
          ${p.place}<br>
          <small>${time}</small><br>
          <a href="${p.url}" target="_blank" style="color:#58a6ff;">Más detalles</a>
        `);
      }
    }).addTo(map);

    $("#map-legend").innerHTML = `
      <div class="legend-item"><span class="legend-dot" style="background:#3fb950"></span>M 2.5-4.5</div>
      <div class="legend-item"><span class="legend-dot" style="background:#d29922"></span>M 4.5-6.0</div>
      <div class="legend-item"><span class="legend-dot" style="background:#f85149"></span>M 6.0+</div>
    `;
  } catch (e) { console.error(e); toast("Error al cargar sismos en mapa"); }
}

// ============ NASA EVENTS MAP ============
async function loadEventsMap(type = "all") {
  try {
    const url = `https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=50`;
    const r = await fetch(url);
    const d = await r.json();

    const features = [];
    d.events.forEach(ev => {
      const cat = ev.categories[0];
      if (!cat) return;
      if (type !== "all") {
        if (type === "fires" && cat.id !== 8) return;
        if (type === "storms" && cat.id !== 10 && cat.id !== 9) return;
        if (type === "volcanoes" && cat.id !== 12) return;
        if (type === "weather" && cat.id !== 9 && cat.id !== 10) return;
      }
      const geom = ev.geometry.find(g => g.coordinates);
      if (!geom) return;
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: geom.coordinates },
        properties: { title: ev.title, category: cat.title, date: geom.date, id: cat.id }
      });
    });

    if (currentLayer) map.removeLayer(currentLayer);
    currentLayer = L.geoJSON(features, {
      pointToLayer: (f, latlng) => {
        const colors = { 8: "#db6d28", 9: "#58a6ff", 10: "#bc8cff", 12: "#f85149" };
        const color = colors[f.properties.id] || "#58a6ff";
        return L.circleMarker(latlng, {
          radius: 8, color, fillColor: color, fillOpacity: 0.7, weight: 2
        });
      },
      onEachFeature: (f, layer) => {
        layer.bindPopup(`
          <strong>${f.properties.title}</strong><br>
          <small>${f.properties.category}</small><br>
          <small>${new Date(f.properties.date).toLocaleDateString("es-ES")}</small>
        `);
      }
    }).addTo(map);

    const legendColors = {
      fires: '<span class="legend-dot" style="background:#db6d28"></span>Incendios',
      storms: '<span class="legend-dot" style="background:#bc8cff"></span>Tormentas',
      volcanoes: '<span class="legend-dot" style="background:#f85149"></span>Volcanes',
      weather: '<span class="legend-dot" style="background:#58a6ff"></span>Clima extremo',
      all: '<span class="legend-dot" style="background:#58a6ff"></span>Todos los eventos'
    };
    $("#map-legend").innerHTML = `<div class="legend-item">${legendColors[type]}</div>`;
  } catch (e) { console.error(e); toast("Error al cargar eventos"); }
}

// ============ QUAKE LIST ============
async function loadQuakes(filter = "significant_month") {
  try {
    const r = await fetch(`https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${filter}.geojson`);
    const d = await r.json();
    const list = $("#quakes-list");
    list.innerHTML = "";
    $("#d-quakes").textContent = d.metadata.count;

    d.features.slice(0, 20).forEach(q => {
      const p = q.properties;
      const mag = p.mag;
      const time = new Date(p.time).toLocaleString("es-ES");
      const tag = mag >= 6 ? "critical" : mag >= 4.5 ? "high" : mag >= 3 ? "med" : "low";
      const li = document.createElement("li");
      li.innerHTML = `
        <div style="flex:1;min-width:0">
          <div class="item-title">${p.place}</div>
          <div class="item-meta">${time}</div>
        </div>
        <span class="item-tag tag-${tag}">M ${mag.toFixed(1)}</span>
      `;
      li.addEventListener("click", () => {
        $$(".tab")[1].click();
        setTimeout(() => {
          map.setView([q.geometry.coordinates[1], q.geometry.coordinates[0]], 6);
        }, 200);
      });
      list.appendChild(li);
    });

    // Alertas cercanas
    if (userLat !== null) {
      const nearby = d.features.filter(q => {
        const [lon, lat] = q.geometry.coordinates;
        return distanceKm(userLat, userLon, lat, lon) < 500;
      }).slice(0, 5);
      $("#alerts-badge").textContent = `${nearby.length} cercanas`;
      const al = $("#alerts-list");
      al.innerHTML = "";
      if (nearby.length === 0) {
        al.innerHTML = `<li style="cursor:default;justify-content:center;color:var(--text-dim)">Sin alertas cercanas (500 km)</li>`;
      } else {
        nearby.forEach(q => {
          const p = q.properties;
          const dist = distanceKm(userLat, userLon, q.geometry.coordinates[1], q.geometry.coordinates[0]);
          const li = document.createElement("li");
          li.innerHTML = `
            <div style="flex:1;min-width:0">
              <div class="item-title">${p.place}</div>
              <div class="item-meta">${Math.round(dist)} km · ${new Date(p.time).toLocaleString("es-ES")}</div>
            </div>
            <span class="item-tag tag-${p.mag >= 4.5 ? "high" : "med"}">M ${p.mag.toFixed(1)}</span>
          `;
          al.appendChild(li);
        });
      }
    }
  } catch (e) {
    console.error(e);
    $("#quakes-list").innerHTML = `<li style="cursor:default;color:var(--text-dim)">Error al cargar sismos</li>`;
  }
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ============ EVENTS LIST ============
async function loadEvents() {
  try {
    const r = await fetch("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=20");
    const d = await r.json();
    const list = $("#events-list");
    list.innerHTML = "";
    $("#d-events").textContent = d.events.length;
    $("#ev-badge").textContent = `${d.events.length} activos`;

    d.events.forEach(ev => {
      const cat = ev.categories[0]?.title || "Evento";
      const date = new Date(ev.geometry[0]?.dateEvent || Date.now()).toLocaleDateString("es-ES");
      const li = document.createElement("li");
      li.innerHTML = `
        <div style="flex:1;min-width:0">
          <div class="item-title">${ev.title}</div>
          <div class="item-meta">${cat} · ${date}</div>
        </div>
        <a href="${ev.sources[0]?.url || "#"}" target="_blank" rel="noopener" class="item-tag tag-low" style="text-decoration:none">Ver</a>
      `;
      list.appendChild(li);
    });
  } catch (e) { console.error(e); }
}

// ============ RADAR DE LLUVIA ============
function updateRadar() {
  if (!weatherMap) return;
  if (radarLayer) weatherMap.removeLayer(radarLayer);
  // RainViewer actualiza cada 10 min, usa el timestamp más reciente
  const ts = Math.floor(Date.now() / 1000 / 600) * 600;
  radarLayer = L.tileLayer(
    `https://tilecache.rainviewer.com/v2/radar/${ts}/256/{z}/{x}/{y}/2/1_1.png`,
    { opacity: 0.65, maxZoom: 19 }
  ).addTo(weatherMap);
}

// ============ MAP INIT ============
function initMaps() {
  map = L.map("map", { zoomControl: true, worldCopyJump: true }).setView([20, 0], 2);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: 'abcd', maxZoom: 19
  }).addTo(map);

  // Control de geolocalización nativo
  L.control.locate({
    position: "topright",
    strings: { title: "Ir a mi ubicación" },
    locateOptions: { enableHighAccuracy: true, maxZoom: 10 }
  }).addTo(map);

  weatherMap = L.map("weather-map", { zoomControl: true, worldCopyJump: true }).setView([20, 0], 2);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; OSM &copy; CARTO', subdomains: 'abcd', maxZoom: 19
  }).addTo(weatherMap);
  updateRadar();

  $$(".map-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      $$(".map-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const layer = btn.dataset.layer;
      if (layer === "quakes") loadQuakeMap();
      else loadEventsMap(layer);
    });
  });

  loadQuakeMap();
}

// ============ MARCADOR DE USUARIO ============
function placeUserMarker(lat, lon, label) {
  // Icono personalizado con pulso
  const pulseIcon = L.divIcon({
    className: "user-marker",
    html: `
      <div class="pulse-ring"></div>
      <div class="pulse-core"></div>
    `,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
  if (userMarker) map.removeLayer(userMarker);
  userMarker = L.marker([lat, lon], { icon: pulseIcon })
    .addTo(map)
    .bindPopup(`<strong>Tu ubicación</strong><br>${label}`);
}

// ============ NOTIFICATIONS ============
async function requestNotifications() {
  if (!("Notification" in window)) {
    toast("Tu navegador no soporta notificaciones");
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm === "granted") {
    notifEnabled = true;
    toast("Notificaciones activadas");
    new Notification("GlobalAlerts Pro", {
      body: "Recibirás alertas de sismos y eventos cercanos",
      icon: "icons/icon-192.svg"
    });
  } else {
    toast("Permiso de notificaciones denegado");
  }
}

function sendAlertNotification(title, body, tag) {
  if (!notifEnabled) return;
  if (Notification.permission !== "granted") return;
  new Notification(title, {
    body,
    icon: "icons/icon-192.svg",
    badge: "icons/icon-192.svg",
    tag: tag || "alert",
    vibrate: [200, 100, 200]
  });
}

$("#btn-notif").addEventListener("click", requestNotifications);

// ============ PWA INSTALL ============
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  $("#btn-install").classList.remove("hidden");
});

$("#btn-install").addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  if (outcome === "accepted") toast("App instalada correctamente");
  deferredPrompt = null;
  $("#btn-install").classList.add("hidden");
});

window.addEventListener("appinstalled", () => {
  toast("App instalada. Búscala en tu pantalla de inicio");
  $("#btn-install").classList.add("hidden");
});

// ============ SERVICE WORKER ============
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("sw.js");
      console.log("SW registrado", reg);
    } catch (e) {
      console.error("SW error", e);
    }
  });
}

// ============ INIT ============
async function init() {
  $("#status").textContent = "Detectando ubicación...";
  initMaps();

  // Agregar estilos dinámicos para el marcador de usuario
  const style = document.createElement("style");
  style.textContent = `
    .user-marker { position: relative; }
    .pulse-core {
      position: absolute;
      width: 14px; height: 14px;
      background: #58a6ff;
      border: 3px solid white;
      border-radius: 50%;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      box-shadow: 0 0 8px rgba(88,166,255,0.8);
      z-index: 2;
    }
    .pulse-ring {
      position: absolute;
      width: 40px; height: 40px;
      border: 2px solid #58a6ff;
      border-radius: 50%;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      animation: pulseRing 2s infinite;
      z-index: 1;
    }
    @keyframes pulseRing {
      0% { transform: translate(-50%, -50%) scale(0.5); opacity: 1; }
      100% { transform: translate(-50%, -50%) scale(1.5); opacity: 0; }
    }
  `;
  document.head.appendChild(style);

  if ("geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        userLat = pos.coords.latitude;
        userLon = pos.coords.longitude;

        // Geocoding inverso para obtener nombre real
        userCity = await reverseGeocode(userLat, userLon);
        $("#status").textContent = userCity;

        map.setView([userLat, userLon], 6);
        weatherMap.setView([userLat, userLon], 6);
        placeUserMarker(userLat, userLon, userCity);

        await Promise.all([
          loadWeather(userLat, userLon),
          loadAirQuality(userLat, userLon),
          loadQuakes("significant_month"),
          loadEvents()
        ]);

        if (notifEnabled) {
          setTimeout(() => {
            const strong = document.querySelectorAll("#alerts-list .tag-high, #alerts-list .tag-critical");
            if (strong.length > 0) {
              sendAlertNotification(
                "Sismo cercano detectado",
                `${strong.length} sismo(s) significativo(s) cerca de ${userCity}`,
                "quake-alert"
              );
            }
          }, 2000);
        }
      },
      async (err) => {
        console.warn("Geoloc error", err);
        userLat = 40.4168; userLon = -3.7038;
        userCity = await reverseGeocode(userLat, userLon);
        $("#status").textContent = `${userCity} (por defecto)`;
        toast("Usando ubicación por defecto. Permite geolocalización para tu zona.");
        map.setView([userLat, userLon], 5);
        weatherMap.setView([userLat, userLon], 5);
        placeUserMarker(userLat, userLon, userCity);
        loadWeather(userLat, userLon);
        loadAirQuality(userLat, userLon);
        loadQuakes("significant_month");
        loadEvents();
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  } else {
    userLat = 40.4168; userLon = -3.7038;
    userCity = "Madrid, España";
    loadWeather(userLat, userLon);
    loadAirQuality(userLat, userLon);
    loadQuakes("significant_month");
    loadEvents();
  }

  $("#quake-filter").addEventListener("change", (e) => loadQuakes(e.target.value));
}

init();

// Auto-refresh cada 5 min
setInterval(() => {
  if (userLat !== null) {
    loadWeather(userLat, userLon);
    loadAirQuality(userLat, userLon);
  }
  loadQuakes($("#quake-filter").value);
  loadEvents();
  updateRadar();
  if ($(".tab.active").dataset.tab === "mapa") {
    const active = $(".map-btn.active");
    if (active.dataset.layer === "quakes") loadQuakeMap();
    else loadEventsMap(active.dataset.layer);
  }
}, 5 * 60 * 1000);
