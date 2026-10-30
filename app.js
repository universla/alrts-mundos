const $ = (s) => document.querySelector(s);

// ---------- CLIMA (Open-Meteo) ----------
async function loadWeather(lat, lon) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code`;
    const r = await fetch(url);
    const d = await r.json();
    const c = d.current;
    $("#temp").textContent = `${Math.round(c.temperature_2m)}°C`;
    $("#feels").textContent = `${Math.round(c.apparent_temperature)}°C`;
    $("#wind").textContent = `${Math.round(c.wind_speed_10m)} km/h`;
    $("#humidity").textContent = `${c.relative_humidity_2m}%`;
    $("#clima-badge").textContent = weatherCode(c.weather_code);
    $("#clima-location").textContent = `Coordenadas: ${lat.toFixed(2)}, ${lon.toFixed(2)}`;
  } catch (e) {
    $("#clima-location").textContent = "Error al cargar clima";
  }
}

function weatherCode(code) {
  if (code === 0) return "Despejado";
  if (code <= 3) return "Nublado";
  if (code <= 48) return "Niebla";
  if (code <= 67) return "Lluvia";
  if (code <= 77) return "Nieve";
  if (code <= 82) return "Chubascos";
  if (code <= 99) return "Tormenta";
  return "—";
}

// ---------- SISMOS (USGS) ----------
async function loadQuakes() {
  try {
    const r = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson");
    const d = await r.json();
    const list = $("#sismos-list");
    list.innerHTML = "";
    $("#sismos-badge").textContent = `${d.metadata.count} eventos`;

    d.features.slice(0, 10).forEach(q => {
      const mag = q.properties.mag;
      const place = q.properties.place;
      const time = new Date(q.properties.time).toLocaleString("es-ES");
      const tag = mag >= 6 ? "high" : mag >= 4.5 ? "med" : "low";
      const li = document.createElement("li");
      li.innerHTML = `
        <div>
          <div class="item-title">${place}</div>
          <div class="item-meta">${time}</div>
        </div>
        <span class="item-tag tag-${tag}">M ${mag.toFixed(1)}</span>
      `;
      list.appendChild(li);
    });
  } catch (e) {
    $("#sismos-list").innerHTML = `<li>Error al cargar sismos</li>`;
  }
}

// ---------- EVENTOS NASA EONET ----------
async function loadEvents() {
  try {
    const r = await fetch("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=12");
    const d = await r.json();
    const list = $("#eventos-list");
    list.innerHTML = "";
    $("#eventos-badge").textContent = `${d.events.length} activos`;

    d.events.forEach(ev => {
      const cat = ev.categories[0]?.title || "Evento";
      const date = new Date(ev.geometry[0]?.dateEvent || ev.sources[0]?.date).toLocaleDateString("es-ES");
      const li = document.createElement("li");
      li.innerHTML = `
        <div>
          <div class="item-title">${ev.title}</div>
          <div class="item-meta">${cat} · ${date}</div>
        </div>
        <a href="${ev.sources[0]?.url || "#"}" target="_blank" rel="noopener" style="color:var(--accent);font-size:12px;text-decoration:none;">Ver</a>
      `;
      list.appendChild(li);
    });
  } catch (e) {
    $("#eventos-list").innerHTML = `<li>Error al cargar eventos</li>`;
  }
}

// ---------- INIT ----------
async function init() {
  loadQuakes();
  loadEvents();

  if ("geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        loadWeather(pos.coords.latitude, pos.coords.longitude);
        $("#status").textContent = "Ubicación detectada";
      },
      () => {
        // Fallback: Madrid
        loadWeather(40.4168, -3.7038);
        $("#status").textContent = "Usando ubicación por defecto";
      }
    );
  } else {
    loadWeather(40.4168, -3.7038);
  }
}

init();
setInterval(() => { loadQuakes(); loadEvents(); }, 5 * 60 * 1000);
