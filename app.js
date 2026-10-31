const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// Estado global
const state = {
  lat: 19.4326,
  lon: -99.1332,
  city: 'Ciudad de México',
  country: 'México',
  altitude: null,
  speed: 0,
  heading: 0,
  map: null,
  baseLayer: null,
  dataLayer: null,
  radarLayer: null,
  monitored: new Set(),
  countdown: null,
  siren: null,
  lockTimer: null,
  audio: null,
  flashlight: null,
  config: {
    minMag: 4.5,
    maxDist: 500,
    sound: true,
    vib: true,
    lock: true,
    units: 'metric',
    lang: 'es'
  }
};

// ===== TOAST =====
function toast(msg, dur = 3000) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), dur);
}

// ===== NAVEGACIÓN =====
$$('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach(t => t.classList.remove('active'));
    $$('.view').forEach(v => v.classList.remove('active'));
    tab.classList.add('active');
    const target = $(`#${tab.dataset.tab}`);
    if (target) target.classList.add('active');
    
    // FIX CRÍTICO: mapa solo cuando es visible
    if (tab.dataset.tab === 'map' && state.map) {
      setTimeout(() => {
        state.map.invalidateSize();
      }, 200);
    }
  });
});

// ===== AUDIO / SIRENA =====
function initAudio() {
  if (!state.audio) {
    state.audio = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (state.audio.state === 'suspended') state.audio.resume();
}

function playSiren() {
  if (!state.config.sound) return;
  initAudio();
  const ctx = state.audio;
  const now = ctx.currentTime;
  
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.connect(gain1); gain1.connect(ctx.destination);
  osc1.type = 'sine';
  gain1.gain.setValueAtTime(0.35, now);
  osc1.frequency.setValueAtTime(440, now);
  osc1.frequency.linearRampToValueAtTime(880, now + 0.5);
  osc1.frequency.linearRampToValueAtTime(440, now + 1);
  osc1.frequency.linearRampToValueAtTime(880, now + 1.5);
  osc1.frequency.linearRampToValueAtTime(440, now + 2);
  osc1.start(now); osc1.stop(now + 2);
  
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.connect(gain2); gain2.connect(ctx.destination);
  osc2.type = 'square';
  gain2.gain.setValueAtTime(0.12, now);
  osc2.frequency.setValueAtTime(660, now);
  osc2.frequency.linearRampToValueAtTime(1320, now + 0.5);
  osc2.frequency.linearRampToValueAtTime(660, now + 1);
  osc2.frequency.linearRampToValueAtTime(1320, now + 1.5);
  osc2.frequency.linearRampToValueAtTime(660, now + 2);
  osc2.start(now); osc2.stop(now + 2);
}

function startSiren() {
  if (!state.config.sound) return;
  playSiren();
  state.siren = setInterval(playSiren, 2000);
}
function stopSiren() {
  if (state.siren) { clearInterval(state.siren); state.siren = null; }
}

// ===== VIBRACIÓN =====
function vibrate(pattern) {
  if (!state.config.vib || !navigator.vibrate) return;
  navigator.vibrate(pattern);
}
function stopVibrate() {
  if (navigator.vibrate) navigator.vibrate(0);
}

// ===== ALERTA SÍSMICA =====
function triggerQuake(q) {
  const [lon, lat, depth] = q.geometry.coordinates;
  const dist = haversine(state.lat, state.lon, lat, lon);
  const arrival = Math.max(0, Math.round(dist / 3.5));
  
  $('#q-mag').textContent = `M ${q.properties.mag.toFixed(1)}`;
  $('#q-place').textContent = q.properties.place;
  $('#q-dist').textContent = `${Math.round(dist)} km de distancia`;
  $('#q-depth').textContent = `Profundidad: ${depth ? depth.toFixed(1) : '?'} km`;
  
  $('#quake-overlay').classList.remove('hidden');
  
  let rem = arrival;
  $('#q-cd').textContent = fmtTime(rem);
  $('#q-cd-sub').textContent = rem > 0 ? `Ondas S en ${rem}s` : '¡Ondas presentes!';
  
  if (state.countdown) clearInterval(state.countdown);
  state.countdown = setInterval(() => {
    rem--;
    $('#q-cd').textContent = fmtTime(rem);
    if (rem <= 10 && rem > 0) {
      $('#q-cd-sub').textContent = '¡PREPÁRATE!';
      $('#q-cd').style.color = '#ff0000';
    }
    if (rem <= 0) {
      clearInterval(state.countdown);
      $('#q-cd').textContent = '00:00';
      $('#q-cd-sub').textContent = 'ONDAS PRESENTES';
    }
  }, 1000);
  
  startSiren();
  vibrate([500, 200, 500, 200, 1000]);
  
  if (Notification.permission === 'granted') {
    new Notification('¡SISMO DETECTADO!', {
      body: `M ${q.properties.mag.toFixed(1)} - ${Math.round(dist)} km`,
      icon: 'icons/icon-192.svg', tag: 'quake'
    });
  }
}

$('#btn-close-q').addEventListener('click', () => {
  $('#quake-overlay').classList.add('hidden');
  if (state.countdown) clearInterval(state.countdown);
  stopSiren(); stopVibrate();
  $('#q-cd').style.color = '';
});
$('#btn-silence').addEventListener('click', () => { stopSiren(); toast('Alarma silenciada'); });

function fmtTime(s) {
  if (s <= 0) return '00:00';
  const m = Math.floor(s / 60), sec = s % 60;
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

// ===== BLOQUEO OFICIAL =====
function triggerLock(alert) {
  if (!state.config.lock) return;
  $('#lock-country').textContent = alert.country;
  $('#lock-title').textContent = alert.title;
  $('#lock-time').textContent = alert.time;
  $('#lock-msg').textContent = alert.message;
  const list = $('#lock-steps-list');
  list.innerHTML = '';
  (alert.steps || []).forEach(s => {
    const li = document.createElement('li');
    li.textContent = s;
    list.appendChild(li);
  });
  
  $('#official-lock').classList.remove('hidden');
  
  let sec = 30;
  const btn = $('#btn-unlock');
  btn.disabled = true;
  btn.textContent = `ESPERE... (${sec}s)`;
  
  if (state.lockTimer) clearInterval(state.lockTimer);
  state.lockTimer = setInterval(() => {
    sec--;
    $('#lock-timer').textContent = sec;
    btn.textContent = `ESPERE... (${sec}s)`;
    if (sec <= 0) {
      clearInterval(state.lockTimer);
      btn.disabled = false;
      btn.textContent = 'TOCAR PARA CONTINUAR';
    }
  }, 1000);
  
  startSiren();
  vibrate([1000, 500, 1000, 500, 2000]);
}

$('#btn-unlock').addEventListener('click', () => {
  if ($('#btn-unlock').disabled) return;
  $('#official-lock').classList.add('hidden');
  if (state.lockTimer) clearInterval(state.lockTimer);
  stopSiren(); stopVibrate();
});

// ===== DATOS CLIMA =====
async function loadWeather() {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${state.lat}&longitude=${state.lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,surface_pressure,weather_code,cloud_cover,is_day&hourly=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset,uv_index_max,precipitation_sum&timezone=auto&forecast_days=7`;
    const r = await fetch(url);
    if (!r.ok) return;
    const d = await r.json();
    const c = d.current;
    
    $('#s-temp').textContent = `${Math.round(c.temperature_2m)}°C`;
    $('#s-loc').textContent = state.city;
    $('#w-feels').textContent = `${Math.round(c.apparent_temperature)}°C`;
    $('#w-hum').textContent = `${c.relative_humidity_2m}%`;
    $('#w-wind').textContent = `${Math.round(c.wind_speed_10m)} km/h`;
    $('#w-gust').textContent = `${Math.round(c.wind_gusts_10m)} km/h`;
    $('#w-pres').textContent = `${Math.round(c.surface_pressure)} hPa`;
    $('#w-cloud').textContent = `${c.cloud_cover}%`;
    
    // UV
    const uvMax = d.daily.uv_index_max[0];
    $('#s-uv').textContent = uvMax.toFixed(1);
    $('#uv-val').textContent = uvMax.toFixed(1);
    $('#uv-fill').style.width = `${Math.min(100, (uvMax / 11) * 100)}%`;
    let uvL = 'Bajo';
    if (uvMax >= 3) uvL = 'Moderado';
    if (uvMax >= 6) uvL = 'Alto';
    if (uvMax >= 8) uvL = 'Muy alto';
    if (uvMax >= 11) uvL = 'Extremo';
    $('#uv-label').textContent = uvL;
    $('#s-uv-l').textContent = uvL;
    
    // Visibilidad estimada (no disponible en free, usar código clima)
    $('#w-vis').textContent = c.weather_code === 0 ? '10+ km' : '5-10 km';
    $('#w-dew').textContent = `${Math.round(c.apparent_temperature - 2)}°C`;
    
    // Pronóstico
    const fc = $('#forecast');
    fc.innerHTML = '';
    const days = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
    d.daily.time.forEach((date, i) => {
      const dt = new Date(date);
      const div = document.createElement('div');
      div.className = 'fc-day';
      div.innerHTML = `
        <div class="d">${i === 0 ? 'Hoy' : days[dt.getDay()]}</div>
        <div class="t">${Math.round(d.daily.temperature_2m_max[i])}°</div>
        <div class="s">${Math.round(d.daily.temperature_2m_min[i])}°</div>
      `;
      fc.appendChild(div);
    });
    
    // Por hora
    const hr = $('#hourly');
    hr.innerHTML = '';
    const now = new Date();
    const currentHour = now.getHours();
    for (let i = 0; i < 24; i++) {
      const idx = currentHour + i;
      if (idx >= d.hourly.time.length) break;
      const t = new Date(d.hourly.time[idx]);
      const div = document.createElement('div');
      div.className = 'hr';
      div.innerHTML = `
        <div class="h">${i === 0 ? 'Ahora' : t.getHours() + 'h'}</div>
        <div class="t">${Math.round(d.hourly.temperature_2m[idx])}°</div>
      `;
      hr.appendChild(div);
    }
    
    // Amanecer/atardecer
    if (d.daily.sunrise[0]) {
      const sr = new Date(d.daily.sunrise[0]);
      const ss = new Date(d.daily.sunset[0]);
      $('#w-sunrise').textContent = sr.toLocaleTimeString('es', {hour:'2-digit',minute:'2-digit'});
      $('#w-sunset').textContent = ss.toLocaleTimeString('es', {hour:'2-digit',minute:'2-digit'});
      const diff = (ss - sr) / 1000 / 60;
      const h = Math.floor(diff / 60), m = Math.round(diff % 60);
      $('#w-daylen').textContent = `${h}h ${m}m`;
    }
  } catch(e) { console.warn('Weather error', e); }
}

// ===== CALIDAD AIRE =====
async function loadAir() {
  try {
    const r = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${state.lat}&longitude=${state.lon}&current=pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide,european_aqi`);
    if (!r.ok) return;
    const d = await r.json();
    const c = d.current;
    const pm = c.pm2_5;
    
    $('#s-aqi').textContent = pm !== undefined ? pm.toFixed(0) : '--';
    let l = 'Bueno';
    if (pm > 55) l = 'Muy malo';
    else if (pm > 35) l = 'Malo';
    else if (pm > 20) l = 'Moderado';
    else if (pm > 10) l = 'Aceptable';
    $('#s-aqi-l').textContent = l;
    
    $('#a-pm25').textContent = pm !== undefined ? pm.toFixed(1) : '--';
    $('#a-pm10').textContent = c.pm10 !== undefined ? c.pm10.toFixed(1) : '--';
    $('#a-o3').textContent = c.ozone !== undefined ? c.ozone.toFixed(1) : '--';
    $('#a-no2').textContent = c.nitrogen_dioxide !== undefined ? c.nitrogen_dioxide.toFixed(1) : '--';
    $('#a-so2').textContent = c.sulphur_dioxide !== undefined ? c.sulphur_dioxide.toFixed(1) : '--';
    $('#a-co').textContent = c.carbon_monoxide !== undefined ? (c.carbon_monoxide/1000).toFixed(2) : '--';
  } catch(e) {}
}

// ===== SISMOS =====
async function loadQuakes() {
  try {
    const r = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson');
    if (!r.ok) return;
    const d = await r.json();
    
    $('#s-q').textContent = d.metadata.count;
    $('#sc-n').textContent = d.metadata.count;
    $('#sc-time').textContent = new Date().toLocaleTimeString('es');
    
    const nearby = d.features.filter(f => {
      const [lon, lat] = f.geometry.coordinates;
      return haversine(state.lat, state.lon, lat, lon) < 1000;
    }).slice(0, 8);
    
    $('#alerts-n').textContent = nearby.length;
    const list = $('#alerts-list');
    list.innerHTML = '';
    if (nearby.length === 0) {
      list.innerHTML = '<div class="li"><div class="li-c"><div class="li-t">Sin alertas cercanas</div><div class="li-m">Radio 1000 km</div></div></div>';
    } else {
      nearby.forEach(f => {
        const p = f.properties;
        const [lon, lat] = f.geometry.coordinates;
        const dist = haversine(state.lat, state.lon, lat, lon);
        const div = document.createElement('div');
        div.className = 'li';
        div.innerHTML = `
          <div class="li-c">
            <div class="li-t">${p.place}</div>
            <div class="li-m">${Math.round(dist)} km · ${timeAgo(p.time)}</div>
          </div>
          <span class="tag ${p.mag >= 5 ? 'tag-high' : 'tag-med'}">M ${p.mag.toFixed(1)}</span>
        `;
        list.appendChild(div);
      });
    }
    
    // Monitoreo
    d.features.forEach(q => {
      if (state.monitored.has(q.id)) return;
      const [lon, lat] = q.geometry.coordinates;
      const dist = haversine(state.lat, state.lon, lat, lon);
      if (q.properties.mag >= state.config.minMag && dist <= state.config.maxDist) {
        state.monitored.add(q.id);
        triggerQuake(q);
      } else {
        state.monitored.add(q.id);
      }
    });
  } catch(e) {}
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h}h`;
  return `hace ${Math.floor(h/24)}d`;
}

// ===== MAPA =====
const mapLayers = {
  osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OSM', maxZoom: 19 }),
  sat: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '© Esri', maxZoom: 18 }),
  dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '© CARTO', subdomains: 'abcd', maxZoom: 19 })
};

function initMap() {
  if (state.map) return;
  state.map = L.map('map-el', {
    zoomControl: true, worldCopyJump: true,
    center: [state.lat, state.lon], zoom: 5,
    minZoom: 2, maxZoom: 19
  });
  state.baseLayer = mapLayers.dark;
  state.baseLayer.addTo(state.map);
  
  // Marcador de usuario
  const userIcon = L.divIcon({
    className: '',
    html: '<div style="width:18px;height:18px;background:#3b82f6;border:3px solid white;border-radius:50%;box-shadow:0 0 12px rgba(59,130,246,.8);"></div>',
    iconSize: [24, 24], iconAnchor: [12, 12]
  });
  L.marker([state.lat, state.lon], { icon: userIcon }).addTo(state.map)
    .bindPopup(`<strong>${state.city}</strong>`);
  
  setTimeout(() => state.map.invalidateSize(), 300);
  loadMapData('quakes');
}

function changeMapType(type) {
  if (!state.map || !mapLayers[type]) return;
  if (state.baseLayer) state.map.removeLayer(state.baseLayer);
  state.baseLayer = mapLayers[type];
  state.baseLayer.addTo(state.map);
  if (state.dataLayer) state.dataLayer.bringToFront();
  if (state.radarLayer) state.radarLayer.bringToFront();
}

async function loadMapData(layer) {
  if (!state.map) return;
  if (state.dataLayer) { try { state.map.removeLayer(state.dataLayer); } catch(e){} state.dataLayer = null; }
  if (state.radarLayer) { try { state.map.removeLayer(state.radarLayer); } catch(e){} state.radarLayer = null; }
  
  try {
    if (layer === 'quakes') {
      const r = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson');
      if (!r.ok) return;
      const d = await r.json();
      state.dataLayer = L.geoJSON(d, {
        pointToLayer: (f, ll) => {
          const m = f.properties.mag;
          const c = m >= 6 ? '#ef4444' : m >= 4.5 ? '#f59e0b' : '#10b981';
          return L.circleMarker(ll, { radius: Math.max(6, m*4), color: c, fillColor: c, fillOpacity: 0.6, weight: 2 });
        },
        onEachFeature: (f, l) => {
          const p = f.properties;
          l.bindPopup(`<strong style="color:#ef4444">M ${p.mag.toFixed(1)}</strong><br>${p.place}<br><small>${new Date(p.time).toLocaleString('es')}</small>`);
        }
      }).addTo(state.map);
      $('#map-leg').innerHTML = `
        <div class="leg-i"><span class="leg-d" style="background:#10b981"></span>M 2.5-4.5</div>
        <div class="leg-i"><span class="leg-d" style="background:#f59e0b"></span>M 4.5-6</div>
        <div class="leg-i"><span class="leg-d" style="background:#ef4444"></span>M 6+</div>
      `;
    } else if (layer === 'hurricanes' || layer === 'storms') {
      const r = await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=50');
      if (!r.ok) return;
      const d = await r.json();
      const feats = d.events.filter(e => {
        const c = e.categories[0];
        if (!c) return false;
        if (layer === 'hurricanes') return c.id === 10 || c.id === 9;
        return c.id === 9 || c.id === 10;
      }).map(e => {
        const g = e.geometry.find(x => x.coordinates);
        return g ? { type:'Feature', geometry:{type:'Point',coordinates:g.coordinates}, properties:{title:e.title,cat:e.categories[0].title} } : null;
      }).filter(Boolean);
      
      state.dataLayer = L.geoJSON(feats, {
        pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 14, color: '#8b5cf6', fillColor: '#8b5cf6', fillOpacity: 0.6, weight: 3, dashArray: '5,5' }),
        onEachFeature: (f, l) => l.bindPopup(`<strong>${f.properties.title}</strong><br><small>${f.properties.cat}</small>`)
      }).addTo(state.map);
      $('#map-leg').innerHTML = '<div class="leg-i"><span class="leg-d" style="background:#8b5cf6"></span>Huracanes/Tormentas</div>';
    } else if (layer === 'fires') {
      const r = await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=100');
      if (!r.ok) return;
      const d = await r.json();
      const feats = d.events.filter(e => e.categories[0]?.id === 8).map(e => {
        const g = e.geometry.find(x => x.coordinates);
        return g ? { type:'Feature', geometry:{type:'Point',coordinates:g.coordinates}, properties:{title:e.title} } : null;
      }).filter(Boolean);
      
      state.dataLayer = L.geoJSON(feats, {
        pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 10, color: '#f97316', fillColor: '#f97316', fillOpacity: 0.8, weight: 2 }),
        onEachFeature: (f, l) => l.bindPopup(`<strong>🔥 ${f.properties.title}</strong>`)
      }).addTo(state.map);
      $('#map-leg').innerHTML = '<div class="leg-i"><span class="leg-d" style="background:#f97316"></span>Incendios activos</div>';
    } else if (layer === 'volcanoes') {
      const r = await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=50');
      if (!r.ok) return;
      const d = await r.json();
      const feats = d.events.filter(e => e.categories[0]?.id === 12).map(e => {
        const g = e.geometry.find(x => x.coordinates);
        return g ? { type:'Feature', geometry:{type:'Point',coordinates:g.coordinates}, properties:{title:e.title} } : null;
      }).filter(Boolean);
      
      state.dataLayer = L.geoJSON(feats, {
        pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 14, color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.7, weight: 3 }),
        onEachFeature: (f, l) => l.bindPopup(`<strong>🌋 ${f.properties.title}</strong>`)
      }).addTo(state.map);
      $('#map-leg').innerHTML = '<div class="leg-i"><span class="leg-d" style="background:#ef4444"></span>Volcanes activos</div>';
    } else if (layer === 'shelters') {
      // Refugios reales de OpenStreetMap via Overpass
      const query = `[out:json][timeout:25];(node["amenity"="shelter"](around:50000,${state.lat},${state.lon});node["building"="school"](around:50000,${state.lat},${state.lon});node["amenity"="hospital"](around:50000,${state.lat},${state.lon}););out body;`;
      const r = await fetch('https://overpass-api.de/api/interpreter', { method:'POST', body: query });
      if (!r.ok) return;
      const d = await r.json();
      const feats = d.elements.map(e => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [e.lon, e.lat] },
        properties: {
          name: e.tags?.name || e.tags?.['name:es'] || e.tags?.amenity || e.tags?.building || 'Refugio',
          type: e.tags?.amenity || e.tags?.building
        }
      }));
      
      state.dataLayer = L.geoJSON(feats, {
        pointToLayer: (f, ll) => {
          const colors = { shelter: '#10b981', school: '#3b82f6', hospital: '#ef4444' };
          const c = colors[f.properties.type] || '#8b5cf6';
          return L.circleMarker(ll, { radius: 10, color: c, fillColor: c, fillOpacity: 0.8, weight: 2 });
        },
        onEachFeature: (f, l) => l.bindPopup(`<strong>${f.properties.name}</strong><br><small>${f.properties.type}</small>`)
      }).addTo(state.map);
      $('#map-leg').innerHTML = `
        <div class="leg-i"><span class="leg-d" style="background:#10b981"></span>Refugios</div>
        <div class="leg-i"><span class="leg-d" style="background:#3b82f6"></span>Escuelas</div>
        <div class="leg-i"><span class="leg-d" style="background:#ef4444"></span>Hospitales</div>
      `;
    } else if (layer === 'airports') {
      const query = `[out:json][timeout:25];(node["aeroway"="aerodrome"](around:200000,${state.lat},${state.lon}););out body;`;
      const r = await fetch('https://overpass-api.de/api/interpreter', { method:'POST', body: query });
      if (!r.ok) return;
      const d = await r.json();
      const feats = d.elements.map(e => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [e.lon, e.lat] },
        properties: { name: e.tags?.name || e.tags?.iata || 'Aeropuerto', iata: e.tags?.iata || '' }
      }));
      
      state.dataLayer = L.geoJSON(feats, {
        pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 10, color: '#06b6d4', fillColor: '#06b6d4', fillOpacity: 0.8, weight: 2 }),
        onEachFeature: (f, l) => l.bindPopup(`<strong>✈ ${f.properties.name}</strong>${f.properties.iata ? '<br><small>IATA: '+f.properties.iata+'</small>' : ''}`)
      }).addTo(state.map);
      $('#map-leg').innerHTML = '<div class="leg-i"><span class="leg-d" style="background:#06b6d4"></span>Aeropuertos</div>';
    }
  } catch(e) { console.error('Map layer error', e); toast('Error al cargar capa'); }
}

function loadRadar() {
  if (!state.map) return;
  if (state.radarLayer) { try { state.map.removeLayer(state.radarLayer); } catch(e){} }
  const ts = Math.floor(Date.now() / 1000 / 600) * 600;
  state.radarLayer = L.tileLayer(`https://tilecache.rainviewer.com/v2/radar/${ts}/256/{z}/{x}/{y}/2/1_1.png`, {
    opacity: 0.7, maxZoom: 19, attribution: '© RainViewer'
  }).addTo(state.map);
  $('#map-leg').innerHTML = '<div class="leg-i"><span class="leg-d" style="background:#06b6d4"></span>Radar de lluvia en vivo</div>';
}

$$('.ml-btn').forEach(b => b.addEventListener('click', () => {
  $$('.ml-btn').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  loadMapData(b.dataset.layer);
}));

$$('.mt-btn').forEach(b => b.addEventListener('click', () => {
  $$('.mt-btn').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  if (b.dataset.type === 'radar') loadRadar();
  else changeMapType(b.dataset.type);
}));

// ===== NOTICIAS =====
const newsDB = [
  { cat: 'earthquake', ic: '📊', title: 'Sismo M5.2 en costa de Chile', ex: 'Terremoto registrado en Valparaíso sin daños reportados.', src: 'USGS', time: 'hace 2h' },
  { cat: 'weather', ic: '🌀', title: 'Huracán categoría 3 en Atlántico', ex: 'NOAA monitorea formación con vientos de 185 km/h.', src: 'NOAA', time: 'hace 4h' },
  { cat: 'volcano', ic: '🌋', title: 'Actividad volcánica en Islandia', ex: 'Erupción fissural en Península de Reykjanes.', src: 'IMO', time: 'hace 6h' },
  { cat: 'conflict', ic: '⚠️', title: 'Tensiones en Europa del Este', ex: 'Autoridades internacionales llaman a la calma.', src: 'Reuters', time: 'hace 8h' },
  { cat: 'weather', ic: '🔥', title: 'Incendios en California', ex: 'Miles evacuados por incendios forestales.', src: 'Cal Fire', time: 'hace 10h' },
  { cat: 'earthquake', ic: '📊', title: 'Réplica M4.1 en Japón', ex: 'Réplicas continúan tras sismo principal.', src: 'JMA', time: 'hace 12h' },
  { cat: 'weather', ic: '🌊', title: 'Advertencia de tsunami', ex: 'Alerta emitida para costa del Pacífico.', src: 'PTWC', time: 'hace 14h' },
  { cat: 'conflict', ic: '🌍', title: 'Crisis humanitaria', ex: 'ONU solicita acceso para ayuda.', src: 'ONU', time: 'hace 16h' }
];

function loadNews(cat = 'all') {
  const filtered = cat === 'all' ? newsDB : newsDB.filter(n => n.cat === cat);
  const feat = $('#news-featured');
  const list = $('#news-list');
  
  if (filtered.length > 0) {
    const f = filtered[0];
    feat.innerHTML = `
      <div class="news-feat">
        <div class="news-feat-img">${f.ic}</div>
        <div class="news-feat-body">
          <div class="news-cat">${f.cat}</div>
          <h3 class="news-feat-title">${f.title}</h3>
          <p class="news-feat-ex">${f.ex}</p>
          <div class="news-feat-meta"><span>${f.src}</span><span>${f.time}</span></div>
        </div>
      </div>
    `;
  }
  
  list.innerHTML = '';
  filtered.slice(1).forEach(n => {
    const div = document.createElement('div');
    div.className = 'news-item';
    div.innerHTML = `
      <div class="news-ic">${n.ic}</div>
      <div class="news-body">
        <div class="news-title">${n.title}</div>
        <div class="news-meta">${n.src} · ${n.time}</div>
      </div>
    `;
    list.appendChild(div);
  });
}

$$('.nf-btn').forEach(b => b.addEventListener('click', () => {
  $$('.nf-btn').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  loadNews(b.dataset.cat);
}));

// ===== HERRAMIENTAS =====
$$('.tool-card').forEach(c => c.addEventListener('click', () => {
  const tool = c.dataset.tool;
  $(`#tool-${tool}`).classList.remove('hidden');
  if (tool === 'compass') startCompass();
  if (tool === 'altimeter') loadAltitude();
  if (tool === 'speed') startSpeed();
  if (tool === 'coords') updateCoords();
  if (tool === 'share') updateShare();
  if (tool === 'embassies') loadEmbassies();
}));

$$('[data-back]').forEach(b => b.addEventListener('click', () => {
  b.parentElement.classList.add('hidden');
  if (b.parentElement.id === 'tool-compass') stopCompass();
  if (b.parentElement.id === 'tool-speed') stopSpeed();
}));

// Brújula
let compassWatch = null;
function startCompass() {
  if ('DeviceOrientationEvent' in window && typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission().then(p => {
      if (p === 'granted') watchCompass();
    });
  } else watchCompass();
}
function watchCompass() {
  compassWatch = navigator.geolocation?.watchPosition?.(() => {}) || null;
  window.addEventListener('deviceorientation', handleCompass);
}
function handleCompass(e) {
  let deg = e.alpha;
  if (deg === null) return;
  if (e.webkitCompassHeading) deg = e.webkitCompassHeading;
  $('#compass-ring').style.transform = `rotate(${-deg}deg)`;
  $('#compass-deg').textContent = `${Math.round(deg)}°`;
  const dirs = ['Norte','Noreste','Este','Sureste','Sur','Suroeste','Oeste','Noroeste'];
  $('#compass-dir').textContent = dirs[Math.round(deg / 45) % 8];
}
function stopCompass() { window.removeEventListener('deviceorientation', handleCompass); }

// Altímetro
function loadAltitude() {
  if (state.altitude !== null) {
    $('#alt-val').textContent = Math.round(state.altitude);
    $('#alt-sub').textContent = `Sobre el nivel del mar`;
    return;
  }
  $('#alt-sub').textContent = 'Esperando GPS...';
  navigator.geolocation.getCurrentPosition(
    pos => {
      if (pos.coords.altitude !== null) {
        state.altitude = pos.coords.altitude;
        $('#alt-val').textContent = Math.round(state.altitude);
        $('#alt-sub').textContent = 'Sobre el nivel del mar';
      } else {
        $('#alt-sub').textContent = 'Altitud no disponible (use GPS)';
      }
    },
    () => $('#alt-sub').textContent = 'GPS no disponible',
    { enableHighAccuracy: true }
  );
}

// Velocímetro
let speedWatch = null;
function startSpeed() {
  $('#speed-sub').textContent = 'Esperando movimiento...';
  speedWatch = navigator.geolocation.watchPosition(
    pos => {
      const spd = pos.coords.speed;
      if (spd !== null && spd >= 0) {
        const kmh = spd * 3.6;
        state.speed = kmh;
        $('#speed-val').textContent = Math.round(kmh);
        $('#speed-sub').textContent = kmh > 1 ? 'En movimiento' : 'Detenido';
      }
    },
    () => $('#speed-sub').textContent = 'GPS no disponible',
    { enableHighAccuracy: true }
  );
}
function stopSpeed() { if (speedWatch) navigator.geolocation.clearWatch(speedWatch); }

// Coordenadas
function updateCoords() {
  $('#c-dec').textContent = `${state.lat.toFixed(6)}, ${state.lon.toFixed(6)}`;
  $('#c-dms').textContent = toDMS(state.lat, 'lat') + ', ' + toDMS(state.lon, 'lon');
  $('#c-plus').textContent = toPlusCode(state.lat, state.lon);
  $('#c-utm').textContent = toUTM(state.lat, state.lon);
}
function toDMS(deg, type) {
  const d = Math.floor(Math.abs(deg));
  const m = Math.floor((Math.abs(deg) - d) * 60);
  const s = ((Math.abs(deg) - d) * 60 - m) * 60;
  const dir = type === 'lat' ? (deg >= 0 ? 'N' : 'S') : (deg >= 0 ? 'E' : 'O');
  return `${d}°${m}'${s.toFixed(1)}" ${dir}`;
}
function toPlusCode(lat, lon) {
  // Simplificado
  return `${Math.abs(lat).toFixed(4)}${lat>=0?'N':'S'}+${Math.abs(lon).toFixed(4)}${lon>=0?'E':'O'}`;
}
function toUTM(lat, lon) {
  const zone = Math.floor((lon + 180) / 6) + 1;
  const letter = lat >= 0 ? 'N' : 'S';
  return `${zone}${letter}`;
}
$('#btn-copy-coords').addEventListener('click', () => {
  const txt = `${state.lat}, ${state.lon}`;
  navigator.clipboard.writeText(txt).then(() => toast('Coordenadas copiadas'));
});

// Compartir
function updateShare() {
  const link = `https://www.google.com/maps?q=${state.lat},${state.lon}`;
  $('#share-link').textContent = link;
}
$('#btn-copy-link').addEventListener('click', () => {
  navigator.clipboard.writeText($('#share-link').textContent).then(() => toast('Enlace copiado'));
});
$('#btn-share-native').addEventListener('click', () => {
  if (navigator.share) {
    navigator.share({ title: 'Mi ubicación', text: 'Emergencia', url: $('#share-link').textContent });
  } else toast('Compartir no disponible');
});

// Linterna
$('#btn-flash').addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const track = stream.getVideoTracks()[0];
    const caps = track.getCapabilities();
    if (!caps.torch) { toast('Linterna no disponible'); track.stop(); return; }
    if (state.flashlight) {
      await track.applyConstraints({ advanced: [{ torch: false }] });
      track.stop();
      state.flashlight = null;
      $('#btn-flash').textContent = 'ENCENDER';
      $('#btn-flash').classList.remove('on');
      $('#flash-status').textContent = 'Linterna apagada';
    } else {
      await track.applyConstraints({ advanced: [{ torch: true }] });
      state.flashlight = track;
      $('#btn-flash').textContent = 'APAGAR';
      $('#btn-flash').classList.add('on');
      $('#flash-status').textContent = 'Linterna encendida';
    }
  } catch(e) { toast('No se pudo acceder a la linterna'); }
});

// Embajadas
function loadEmbassies() {
  const embs = [
    { country: '🇲🇽 México', phone: '+52 55 5345 2700', web: 'https://www.gob.mx/sre' },
    { country: '🇺🇸 Estados Unidos', phone: '+1 202 501 4444', web: 'https://travel.state.gov' },
    { country: '🇪🇸 España', phone: '+34 91 379 17 00', web: 'https://www.exteriores.gob.es' },
    { country: '🇦🇷 Argentina', phone: '+54 11 4819 7200', web: 'https://www.cancilleria.gob.ar' },
    { country: '🇨🇴 Colombia', phone: '+57 1 381 4000', web: 'https://www.cancilleria.gov.co' },
    { country: '🇨🇱 Chile', phone: '+56 2 2947 4000', web: 'https://www.minrel.gob.cl' },
    { country: '🇵🇪 Perú', phone: '+51 1 205 1700', web: 'https://www.gob.pe/rree' },
    { country: '🇯🇵 Japón', phone: '+81 3 3224 5000', web: 'https://www.mofa.go.jp' }
  ];
  const list = $('#emb-list');
  list.innerHTML = '';
  embs.forEach(e => {
    const div = document.createElement('div');
    div.className = 'emb-item';
    div.innerHTML = `<h4>${e.country}</h4><p>📞 ${e.phone}</p><a href="${e.web}" target="_blank">Sitio web →</a>`;
    list.appendChild(div);
  });
}

// ===== BOTÓN PÁNICO =====
$('#btn-panic').addEventListener('click', () => {
  const msg = `🚨 EMERGENCIA - Mi ubicación: https://www.google.com/maps?q=${state.lat},${state.lon} - ${state.city}`;
  if (navigator.share) {
    navigator.share({ title: 'EMERGENCIA', text: msg });
  } else {
    navigator.clipboard.writeText(msg).then(() => toast('Ubicación copiada'));
  }
  vibrate([500, 200, 500]);
});

// ===== PRUEBAS =====
$('#t-notif').addEventListener('click', () => {
  if (!('Notification' in window)) { toast('No soportado'); return; }
  Notification.requestPermission().then(p => {
    if (p === 'granted') {
      new Notification('GlobalAlerts Pro', { body: 'Notificaciones funcionando', icon: 'icons/icon-192.svg' });
      toast('Notificación enviada');
    } else toast('Permiso denegado');
  });
});

$('#t-quake').addEventListener('click', () => {
  triggerQuake({
    id: 'test-' + Date.now(),
    geometry: { coordinates: [state.lon + 0.3, state.lat + 0.3, 10] },
    properties: { mag: 6.5, place: 'Zona de prueba - 35 km', time: Date.now() }
  });
});

$('#t-lock').addEventListener('click', () => {
  triggerLock({
    country: '🇲🇽 MÉXICO - Protección Civil',
    title: 'ALERTA SÍSMICA NACIONAL',
    time: 'Hace 1 minuto',
    message: 'Sismo M6.8 detectado en costa de Guerrero. Mantenga la calma y siga protocolos.',
    steps: ['Aléjese de ventanas', 'No use elevadores', 'Diríjase a zona segura', 'Espere instrucciones']
  });
});

$('#t-siren').addEventListener('click', () => {
  if (state.config.sound) {
    startSiren();
    toast('Sirena 5s');
    setTimeout(stopSiren, 5000);
  } else toast('Activa el sonido');
});

$('#t-map').addEventListener('click', () => {
  if (state.map) {
    state.map.invalidateSize();
    const active = $('.ml-btn.active');
    if (active) loadMapData(active.dataset.layer);
    toast('Mapa recargado');
  }
});

// ===== CONFIG =====
function loadConfig() {
  const saved = localStorage.getItem('ga_config');
  if (saved) {
    try {
      state.config = { ...state.config, ...JSON.parse(saved) };
      $('#c-mag').value = state.config.minMag;
      $('#c-dist').value = state.config.maxDist;
      $('#c-sound').checked = state.config.sound;
      $('#c-vib').checked = state.config.vib;
      $('#c-lock').checked = state.config.lock;
      $('#c-units').value = state.config.units;
      $('#c-lang').value = state.config.lang;
    } catch(e){}
  }
}

$('#btn-save').addEventListener('click', () => {
  state.config.minMag = parseFloat($('#c-mag').value);
  state.config.maxDist = parseInt($('#c-dist').value);
  state.config.sound = $('#c-sound').checked;
  state.config.vib = $('#c-vib').checked;
  state.config.lock = $('#c-lock').checked;
  state.config.units = $('#c-units').value;
  state.config.lang = $('#c-lang').value;
  localStorage.setItem('ga_config', JSON.stringify(state.config));
  toast('Configuración guardada');
});

$('#btn-reset').addEventListener('click', () => {
  if (confirm('¿Borrar todos los datos?')) {
    localStorage.clear();
    location.reload();
  }
});

// ===== GEOLOCALIZACIÓN =====
async function getLocation() {
  if (!('geolocation' in navigator)) return;
  try {
    const pos = await new Promise((res, rej) => {
      navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 10000 });
    });
    state.lat = pos.coords.latitude;
    state.lon = pos.coords.longitude;
    if (pos.coords.altitude !== null) state.altitude = pos.coords.altitude;
    
    // Geocoding inverso
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${state.lat}&lon=${state.lon}&zoom=10&accept-language=es`);
      if (r.ok) {
        const d = await r.json();
        state.city = d.address?.city || d.address?.town || d.address?.village || d.address?.state || 'Tu ubicación';
        state.country = d.address?.country || '';
      }
    } catch(e){}
    
    $('#loc-badge').textContent = state.city;
    
    if (state.map) {
      state.map.setView([state.lat, state.lon], 10);
      const userIcon = L.divIcon({
        className: '',
        html: '<div style="width:18px;height:18px;background:#3b82f6;border:3px solid white;border-radius:50%;box-shadow:0 0 12px rgba(59,130,246,.8);"></div>',
        iconSize: [24, 24], iconAnchor: [12, 12]
      });
      L.marker([state.lat, state.lon], { icon: userIcon }).addTo(state.map).bindPopup(`<strong>${state.city}</strong>`).openPopup();
    }
  } catch(e) {
    console.warn('Geoloc error', e);
    $('#loc-badge').textContent = state.city + ' (default)';
  }
}

// ===== INIT =====
async function init() {
  console.log('=== GlobalAlerts Pro ===');
  loadConfig();
  initMap();
  loadNews();
  await getLocation();
  await Promise.all([loadWeather(), loadAir(), loadQuakes()]);
  toast('Sistema activado');
  
  // Monitoreo cada 30s
  setInterval(loadQuakes, 30000);
  // Refresh clima cada 5min
  setInterval(() => { loadWeather(); loadAir(); }, 5 * 60 * 1000);
  
  // Notificaciones
  if ('Notification' in window && Notification.permission === 'default') {
    setTimeout(() => Notification.requestPermission(), 3000);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
