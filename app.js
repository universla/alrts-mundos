const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const state = {
  lat: 19.4326, lon: -99.1332, city: 'Ciudad de México', country: 'México',
  altitude: null, speed: 0, heading: 0,
  map: null, baseLayer: null, layers: {}, issMarker: null,
  monitored: new Set(), countdown: null, siren: null, lockTimer: null,
  audio: null, flashlight: null, morseInterval: null, noiseStream: null,
  survivalTimer: null, survivalSeconds: 0,
  config: { minMag: 4.5, maxDist: 500, sound: true, vib: true, lock: true, units: 'metric' }
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
    
    if (tab.dataset.tab === 'map' && state.map) {
      setTimeout(() => state.map.invalidateSize(), 200);
    }
    if (tab.dataset.tab === 'space') {
      loadISS();
      loadSpaceWeather();
      loadMoon();
    }
  });
});

// ===== AUDIO / SIRENA =====
function initAudio() {
  if (!state.audio) state.audio = new (window.AudioContext || window.webkitAudioContext)();
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
  osc1.type = 'sine'; gain1.gain.setValueAtTime(0.35, now);
  osc1.frequency.setValueAtTime(440, now);
  osc1.frequency.linearRampToValueAtTime(880, now + 0.5);
  osc1.frequency.linearRampToValueAtTime(440, now + 1);
  osc1.frequency.linearRampToValueAtTime(880, now + 1.5);
  osc1.frequency.linearRampToValueAtTime(440, now + 2);
  osc1.start(now); osc1.stop(now + 2);
  
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.connect(gain2); gain2.connect(ctx.destination);
  osc2.type = 'square'; gain2.gain.setValueAtTime(0.12, now);
  osc2.frequency.setValueAtTime(660, now);
  osc2.frequency.linearRampToValueAtTime(1320, now + 0.5);
  osc2.frequency.linearRampToValueAtTime(660, now + 1);
  osc2.frequency.linearRampToValueAtTime(1320, now + 1.5);
  osc2.frequency.linearRampToValueAtTime(660, now + 2);
  osc2.start(now); osc2.stop(now + 2);
}

function startSiren() { if (!state.config.sound) return; playSiren(); state.siren = setInterval(playSiren, 2000); }
function stopSiren() { if (state.siren) { clearInterval(state.siren); state.siren = null; } }

function vibrate(pattern) { if (!state.config.vib || !navigator.vibrate) return; navigator.vibrate(pattern); }
function stopVibrate() { if (navigator.vibrate) navigator.vibrate(0); }

// ===== ALERTA SÍSMICA =====
function triggerQuake(q) {
  const [lon, lat, depth] = q.geometry.coordinates;
  const dist = haversine(state.lat, state.lon, lat, lon);
  const arrival = Math.max(0, Math.round(dist / 3.5));
  
  $('#q-mag').textContent = `M ${q.properties.mag.toFixed(1)}`;
  $('#q-place').textContent = q.properties.place;
  $('#q-dist').textContent = `${Math.round(dist)} km`;
  $('#q-depth').textContent = `Profundidad: ${depth ? depth.toFixed(1) : '?'} km`;
  $('#quake-overlay').classList.remove('hidden');
  
  let rem = arrival;
  $('#q-cd').textContent = fmtTime(rem);
  $('#q-cd-sub').textContent = rem > 0 ? `Ondas S en ${rem}s` : '¡Ondas presentes!';
  
  if (state.countdown) clearInterval(state.countdown);
  state.countdown = setInterval(() => {
    rem--;
    $('#q-cd').textContent = fmtTime(rem);
    if (rem <= 10 && rem > 0) { $('#q-cd-sub').textContent = '¡PREPÁRATE!'; $('#q-cd').style.color = '#ff0000'; }
    if (rem <= 0) { clearInterval(state.countdown); $('#q-cd').textContent = '00:00'; $('#q-cd-sub').textContent = 'ONDAS PRESENTES'; }
  }, 1000);
  
  startSiren(); vibrate([500, 200, 500, 200, 1000]);
  
  if (Notification.permission === 'granted') {
    new Notification('¡SISMO DETECTADO!', { body: `M ${q.properties.mag.toFixed(1)} - ${Math.round(dist)} km`, icon: 'icons/icon-192.svg', tag: 'quake' });
  }
}

$('#btn-close-q').addEventListener('click', () => { $('#quake-overlay').classList.add('hidden'); if (state.countdown) clearInterval(state.countdown); stopSiren(); stopVibrate(); $('#q-cd').style.color = ''; });
$('#btn-silence').addEventListener('click', () => { stopSiren(); toast('Alarma silenciada'); });

function fmtTime(s) { if (s <= 0) return '00:00'; const m = Math.floor(s / 60), sec = s % 60; return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`; }

// ===== BLOQUEO OFICIAL =====
function triggerLock(alert) {
  if (!state.config.lock) return;
  $('#lock-country').textContent = alert.country;
  $('#lock-title').textContent = alert.title;
  $('#lock-time').textContent = alert.time;
  $('#lock-msg').textContent = alert.message;
  const list = $('#lock-steps-list');
  list.innerHTML = '';
  (alert.steps || []).forEach(s => { const li = document.createElement('li'); li.textContent = s; list.appendChild(li); });
  $('#official-lock').classList.remove('hidden');
  
  let sec = 30;
  const btn = $('#btn-unlock');
  btn.disabled = true; btn.textContent = `ESPERE... (${sec}s)`;
  if (state.lockTimer) clearInterval(state.lockTimer);
  state.lockTimer = setInterval(() => {
    sec--; $('#lock-timer').textContent = sec; btn.textContent = `ESPERE... (${sec}s)`;
    if (sec <= 0) { clearInterval(state.lockTimer); btn.disabled = false; btn.textContent = 'TOCAR PARA CONTINUAR'; }
  }, 1000);
  startSiren(); vibrate([1000, 500, 1000, 500, 2000]);
}

$('#btn-unlock').addEventListener('click', () => { if ($('#btn-unlock').disabled) return; $('#official-lock').classList.add('hidden'); if (state.lockTimer) clearInterval(state.lockTimer); stopSiren(); stopVibrate(); });

// ===== DATOS CLIMA =====
async function loadWeather() {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${state.lat}&longitude=${state.lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code,uv_index_max&timezone=auto&forecast_days=7`;
    const r = await fetch(url); if (!r.ok) return;
    const d = await r.json();
    const c = d.current;
    $('#s-temp').textContent = `${Math.round(c.temperature_2m)}°C`;
    $('#s-loc').textContent = state.city;
    
    const uvMax = d.daily.uv_index_max[0];
    $('#s-uv').textContent = uvMax.toFixed(1);
    let uvL = 'Bajo';
    if (uvMax >= 3) uvL = 'Moderado';
    if (uvMax >= 6) uvL = 'Alto';
    if (uvMax >= 8) uvL = 'Muy alto';
    if (uvMax >= 11) uvL = 'Extremo';
    $('#s-uv-l').textContent = uvL;
    
    const fc = $('#forecast'); fc.innerHTML = '';
    const days = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
    d.daily.time.forEach((date, i) => {
      const dt = new Date(date);
      const div = document.createElement('div');
      div.className = 'fc-day';
      div.innerHTML = `<div class="d">${i === 0 ? 'Hoy' : days[dt.getDay()]}</div><div class="t">${Math.round(d.daily.temperature_2m_max[i])}°</div><div class="s">${Math.round(d.daily.temperature_2m_min[i])}°</div>`;
      fc.appendChild(div);
    });
  } catch(e) {}
}

// ===== CALIDAD AIRE =====
async function loadAir() {
  try {
    const r = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${state.lat}&longitude=${state.lon}&current=pm2_5,european_aqi`);
    if (!r.ok) return;
    const d = await r.json();
    const pm = d.current.pm2_5;
    $('#s-aqi').textContent = pm !== undefined ? pm.toFixed(0) : '--';
    let l = 'Bueno';
    if (pm > 55) l = 'Muy malo'; else if (pm > 35) l = 'Malo'; else if (pm > 20) l = 'Moderado'; else if (pm > 10) l = 'Aceptable';
    $('#s-aqi-l').textContent = l;
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
    const list = $('#alerts-list'); list.innerHTML = '';
    if (nearby.length === 0) {
      list.innerHTML = '<div class="li"><div class="li-c"><div class="li-t">Sin alertas cercanas</div><div class="li-m">Radio 1000 km</div></div></div>';
    } else {
      nearby.forEach(f => {
        const p = f.properties;
        const [lon, lat] = f.geometry.coordinates;
        const dist = haversine(state.lat, state.lon, lat, lon);
        const div = document.createElement('div');
        div.className = 'li';
        div.innerHTML = `<div class="li-c"><div class="li-t">${p.place}</div><div class="li-m">${Math.round(dist)} km · ${timeAgo(p.time)}</div></div><span class="tag ${p.mag >= 5 ? 'tag-high' : 'tag-med'}">M ${p.mag.toFixed(1)}</span>`;
        list.appendChild(div);
      });
    }
    
    d.features.forEach(q => {
      if (state.monitored.has(q.id)) return;
      const [lon, lat] = q.geometry.coordinates;
      const dist = haversine(state.lat, state.lon, lat, lon);
      if (q.properties.mag >= state.config.minMag && dist <= state.config.maxDist) { state.monitored.add(q.id); triggerQuake(q); }
      else { state.monitored.add(q.id); }
    });
  } catch(e) {}
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371; const dLat = (lat2 - lat1) * Math.PI / 180; const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function timeAgo(ts) { const diff = Date.now() - ts; const min = Math.floor(diff / 60000); if (min < 60) return `hace ${min} min`; const h = Math.floor(min / 60); if (h < 24) return `hace ${h}h`; return `hace ${Math.floor(h/24)}d`; }

// ===== MAPA MULTI-CAPA =====
const mapLayers = {
  osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OSM', maxZoom: 19 }),
  sat: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '© Esri', maxZoom: 18 }),
  dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '© CARTO', subdomains: 'abcd', maxZoom: 19 })
};

function initMap() {
  if (state.map) return;
  state.map = L.map('map-el', { zoomControl: true, worldCopyJump: true, center: [state.lat, state.lon], zoom: 5, minZoom: 2, maxZoom: 19 });
  state.baseLayer = mapLayers.dark;
  state.baseLayer.addTo(state.map);
  
  const userIcon = L.divIcon({ className: '', html: '<div style="width:18px;height:18px;background:#3b82f6;border:3px solid white;border-radius:50%;box-shadow:0 0 12px rgba(59,130,246,.8);"></div>', iconSize: [24, 24], iconAnchor: [12, 12] });
  L.marker([state.lat, state.lon], { icon: userIcon }).addTo(state.map).bindPopup(`<strong>${state.city}</strong>`);
  
  setTimeout(() => state.map.invalidateSize(), 300);
  updateMapLayers();
}

function changeMapType(type) {
  if (!state.map || !mapLayers[type]) return;
  if (state.baseLayer) state.map.removeLayer(state.baseLayer);
  state.baseLayer = mapLayers[type];
  state.baseLayer.addTo(state.map);
  Object.values(state.layers).forEach(l => { if (l) l.bringToFront(); });
}

async function loadLayerData(layerName) {
  if (state.layers[layerName]) { try { state.map.removeLayer(state.layers[layerName]); } catch(e){} delete state.layers[layerName]; }
  
  try {
    if (layerName === 'quakes') {
      const r = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson');
      if (!r.ok) return;
      const d = await r.json();
      const cluster = L.markerClusterGroup();
      d.features.forEach(f => {
        const [lon, lat] = f.geometry.coordinates;
        const m = f.properties.mag;
        const c = m >= 6 ? '#ef4444' : m >= 4.5 ? '#f59e0b' : '#10b981';
        const marker = L.circleMarker([lat, lon], { radius: Math.max(6, m*4), color: c, fillColor: c, fillOpacity: 0.7, weight: 2 });
        marker.bindPopup(`<strong style="color:#ef4444">M ${m.toFixed(1)}</strong><br>${f.properties.place}<br><small>${new Date(f.properties.time).toLocaleString('es')}</small>`);
        cluster.addLayer(marker);
      });
      state.layers.quakes = cluster;
      state.map.addLayer(cluster);
    } else if (layerName === 'hurricanes' || layerName === 'storms') {
      const r = await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=50');
      if (!r.ok) return;
      const d = await r.json();
      const feats = d.events.filter(e => { const c = e.categories[0]; return c && (c.id === 10 || c.id === 9); }).map(e => { const g = e.geometry.find(x => x.coordinates); return g ? { type:'Feature', geometry:{type:'Point',coordinates:g.coordinates}, properties:{title:e.title,cat:e.categories[0].title} } : null; }).filter(Boolean);
      state.layers[layerName] = L.geoJSON(feats, { pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 14, color: '#8b5cf6', fillColor: '#8b5cf6', fillOpacity: 0.6, weight: 3, dashArray: '5,5' }), onEachFeature: (f, l) => l.bindPopup(`<strong>${f.properties.title}</strong><br><small>${f.properties.cat}</small>`) }).addTo(state.map);
    } else if (layerName === 'fires') {
      const r = await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=100');
      if (!r.ok) return;
      const d = await r.json();
      const feats = d.events.filter(e => e.categories[0]?.id === 8).map(e => { const g = e.geometry.find(x => x.coordinates); return g ? { type:'Feature', geometry:{type:'Point',coordinates:g.coordinates}, properties:{title:e.title} } : null; }).filter(Boolean);
      state.layers.fires = L.geoJSON(feats, { pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 10, color: '#f97316', fillColor: '#f97316', fillOpacity: 0.8, weight: 2 }), onEachFeature: (f, l) => l.bindPopup(`<strong>🔥 ${f.properties.title}</strong>`) }).addTo(state.map);
    } else if (layerName === 'volcanoes') {
      const r = await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=50');
      if (!r.ok) return;
      const d = await r.json();
      const feats = d.events.filter(e => e.categories[0]?.id === 12).map(e => { const g = e.geometry.find(x => x.coordinates); return g ? { type:'Feature', geometry:{type:'Point',coordinates:g.coordinates}, properties:{title:e.title} } : null; }).filter(Boolean);
      state.layers.volcanoes = L.geoJSON(feats, { pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 14, color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.7, weight: 3 }), onEachFeature: (f, l) => l.bindPopup(`<strong>🌋 ${f.properties.title}</strong>`) }).addTo(state.map);
    } else if (layerName === 'radar') {
      const ts = Math.floor(Date.now() / 1000 / 600) * 600;
      state.layers.radar = L.tileLayer(`https://tilecache.rainviewer.com/v2/radar/${ts}/256/{z}/{x}/{y}/2/1_1.png`, { opacity: 0.7, maxZoom: 19, attribution: '© RainViewer' }).addTo(state.map);
    } else if (layerName === 'shelters') {
      const query = `[out:json][timeout:25];(node["amenity"="shelter"](around:50000,${state.lat},${state.lon});node["building"="school"](around:50000,${state.lat},${state.lon});node["amenity"="hospital"](around:50000,${state.lat},${state.lon}););out body;`;
      const r = await fetch('https://overpass-api.de/api/interpreter', { method:'POST', body: query });
      if (!r.ok) return;
      const d = await r.json();
      const feats = d.elements.map(e => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [e.lon, e.lat] }, properties: { name: e.tags?.name || e.tags?.amenity || 'Refugio', type: e.tags?.amenity || e.tags?.building } }));
      state.layers.shelters = L.geoJSON(feats, { pointToLayer: (f, ll) => { const colors = { shelter: '#10b981', school: '#3b82f6', hospital: '#ef4444' }; const c = colors[f.properties.type] || '#8b5cf6'; return L.circleMarker(ll, { radius: 10, color: c, fillColor: c, fillOpacity: 0.8, weight: 2 }); }, onEachFeature: (f, l) => l.bindPopup(`<strong>${f.properties.name}</strong><br><small>${f.properties.type}</small>`) }).addTo(state.map);
    } else if (layerName === 'airports') {
      const query = `[out:json][timeout:25];(node["aeroway"="aerodrome"](around:200000,${state.lat},${state.lon}););out body;`;
      const r = await fetch('https://overpass-api.de/api/interpreter', { method:'POST', body: query });
      if (!r.ok) return;
      const d = await r.json();
      const feats = d.elements.map(e => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [e.lon, e.lat] }, properties: { name: e.tags?.name || e.tags?.iata || 'Aeropuerto', iata: e.tags?.iata || '' } }));
      state.layers.airports = L.geoJSON(feats, { pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 10, color: '#06b6d4', fillColor: '#06b6d4', fillOpacity: 0.8, weight: 2 }), onEachFeature: (f, l) => l.bindPopup(`<strong>✈ ${f.properties.name}</strong>${f.properties.iata ? '<br><small>IATA: '+f.properties.iata+'</small>' : ''}`) }).addTo(state.map);
    } else if (layerName === 'iss') {
      loadISSMarker();
    }
  } catch(e) { console.error('Layer error', e); }
}

function updateMapLayers() {
  const active = [];
  ['quakes','hurricanes','fires','volcanoes','storms','radar','shelters','airports','iss'].forEach(name => {
    const cb = $(`#layer-${name}`);
    if (cb && cb.checked) {
      loadLayerData(name);
      active.push(name);
    } else {
      if (state.layers[name]) { try { state.map.removeLayer(state.layers[name]); } catch(e){} delete state.layers[name]; }
    }
  });
  $('#sc-layers').textContent = active.length;
  $('#map-leg').innerHTML = active.map(n => `<div class="leg-i"><span class="leg-d" style="background:var(--accent)"></span>${n}</div>`).join('');
}

$$('.layer-toggle input').forEach(cb => cb.addEventListener('change', updateMapLayers));
$$('.mt-btn').forEach(b => b.addEventListener('click', () => { $$('.mt-btn').forEach(x => x.classList.remove('active')); b.classList.add('active'); changeMapType(b.dataset.type); }));

// ===== ISS =====
async function loadISS() {
  try {
    const r = await fetch('http://api.open-notify.org/iss-now.json');
    if (!r.ok) return;
    const d = await r.json();
    const lat = parseFloat(d.iss_position.latitude);
    const lon = parseFloat(d.iss_position.longitude);
    $('#iss-lat').textContent = lat.toFixed(4);
    $('#iss-lon').textContent = lon.toFixed(4);
    $('#iss-lat2').textContent = lat.toFixed(4);
    $('#iss-lon2').textContent = lon.toFixed(4);
    const dist = haversine(state.lat, state.lon, lat, lon);
    $('#iss-vis').textContent = dist < 2000 ? 'Visible próximamente' : 'No visible ahora';
    $('#iss-vis2').textContent = dist < 2000 ? 'Cercana' : 'Lejana';
  } catch(e) {}
}

function loadISSMarker() {
  if (state.issMarker) { try { state.map.removeLayer(state.issMarker); } catch(e){} }
  const issIcon = L.divIcon({ className: '', html: '<div style="width:20px;height:20px;background:#f59e0b;border:2px solid white;border-radius:50%;box-shadow:0 0 12px rgba(245,158,11,.8);animation:blink 1s infinite;"></div><style>@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}</style>', iconSize: [24, 24], iconAnchor: [12, 12] });
  state.issMarker = L.marker([0, 0], { icon: issIcon }).addTo(state.map).bindPopup('<strong>🛰️ ISS</strong><br>Estación Espacial Internacional');
  setInterval(async () => {
    try {
      const r = await fetch('http://api.open-notify.org/iss-now.json');
      if (!r.ok) return;
      const d = await r.json();
      const lat = parseFloat(d.iss_position.latitude);
      const lon = parseFloat(d.iss_position.longitude);
      state.issMarker.setLatLng([lat, lon]);
    } catch(e) {}
  }, 5000);
}

// ===== CLIMA ESPACIAL =====
async function loadSpaceWeather() {
  try {
    const r = await fetch('https://services.swpc.noaa.gov/json/planetary_k_index_1m.json');
    if (!r.ok) return;
    const d = await r.json();
    const latest = d[d.length - 1];
    if (latest) {
      $('#solar-kp').textContent = latest.kp_index;
      $('#sw-kp').textContent = latest.kp_index;
    }
  } catch(e) {}
  try {
    const r2 = await fetch('https://services.swpc.noaa.gov/json/rt_swpc_ensemble_mag_g16.json');
    if (r2.ok) {
      const d2 = await r2.json();
      if (d2.length > 0) {
        const latest = d2[d2.length - 1];
        $('#solar-wind').textContent = `${latest?.speed || '--'} km/s`;
        $('#sw-wind').textContent = latest?.speed || '--';
        $('#sw-density').textContent = latest?.density || '--';
      }
    }
  } catch(e) {}
  try {
    const r3 = await fetch('https://services.swpc.noaa.gov/json/solar_flux/observed_daily_radio_flux.txt');
    if (r3.ok) {
      const text = await r3.text();
      const lines = text.trim().split('\n');
      const lastLine = lines[lines.length - 2];
      const flux = lastLine?.split(/\s+/)[4];
      if (flux) { $('#solar-flux').textContent = flux; $('#sw-flux').textContent = flux; }
    }
  } catch(e) {}
}

// ===== FASE LUNAR =====
function loadMoon() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  
  // Algoritmo simple de fase lunar
  const c = 365.25 * year;
  const e = 30.6 * month;
  const jd = c + e + day - 694039.09;
  const phase = jd / 29.53058867;
  const phaseDay = (phase - Math.floor(phase)) * 29.53;
  const illumination = Math.round((1 - Math.cos(phaseDay / 29.53 * 2 * Math.PI)) / 2 * 100);
  
  let phaseName = 'Luna Nueva';
  let icon = '🌑';
  if (phaseDay > 1 && phaseDay <= 7) { phaseName = 'Creciente'; icon = '🌒'; }
  else if (phaseDay > 7 && phaseDay <= 14) { phaseName = 'Cuarto Creciente'; icon = '🌓'; }
  else if (phaseDay > 14 && phaseDay <= 21) { phaseName = 'Llena'; icon = '🌕'; }
  else if (phaseDay > 21 && phaseDay <= 28) { phaseName = 'Menguante'; icon = '🌗'; }
  
  $('#moon-icon').textContent = icon;
  $('#moon-phase').textContent = phaseName;
  $('#moon-illum').textContent = `${illumination}% iluminada`;
  $('#moon-big').textContent = icon;
  $('#moon-phase2').textContent = phaseName;
  $('#moon-illum2').textContent = `${illumination}%`;
  $('#moon-age').textContent = phaseDay.toFixed(1);
}

// ===== HERRAMIENTAS =====
$$('.tool-card').forEach(c => c.addEventListener('click', () => {
  const tool = c.dataset.tool;
  $(`#tool-${tool}`).classList.remove('hidden');
  if (tool === 'compass') startCompass();
  if (tool === 'altimeter') loadAltitude();
  if (tool === 'speed') startSpeed();
  if (tool === 'coords') updateCoords();
  if (tool === 'embassies') loadEmbassies();
}));

$$('[data-back]').forEach(b => b.addEventListener('click', () => { b.parentElement.classList.add('hidden'); if (b.parentElement.id === 'tool-compass') stopCompass(); if (b.parentElement.id === 'tool-speed') stopSpeed(); if (b.parentElement.id === 'tool-noise') stopNoise(); if (b.parentElement.id === 'tool-morse') stopMorse(); }));

// Brújula
let compassWatch = null;
function startCompass() {
  if ('DeviceOrientationEvent' in window && typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission().then(p => { if (p === 'granted') watchCompass(); });
  } else watchCompass();
}
function watchCompass() { window.addEventListener('deviceorientation', handleCompass); }
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
  if (state.altitude !== null) { $('#alt-val').textContent = Math.round(state.altitude); $('#alt-sub').textContent = 'Sobre el nivel del mar'; return; }
  $('#alt-sub').textContent = 'Esperando GPS...';
  navigator.geolocation.getCurrentPosition(pos => {
    if (pos.coords.altitude !== null) { state.altitude = pos.coords.altitude; $('#alt-val').textContent = Math.round(state.altitude); $('#alt-sub').textContent = 'Sobre el nivel del mar'; }
    else $('#alt-sub').textContent = 'Altitud no disponible';
  }, () => $('#alt-sub').textContent = 'GPS no disponible', { enableHighAccuracy: true });
}

// Velocímetro
let speedWatch = null;
function startSpeed() {
  $('#speed-sub').textContent = 'Esperando movimiento...';
  speedWatch = navigator.geolocation.watchPosition(pos => {
    const spd = pos.coords.speed;
    if (spd !== null && spd >= 0) { const kmh = spd * 3.6; state.speed = kmh; $('#speed-val').textContent = Math.round(kmh); $('#speed-sub').textContent = kmh > 1 ? 'En movimiento' : 'Detenido'; }
  }, () => $('#speed-sub').textContent = 'GPS no disponible', { enableHighAccuracy: true });
}
function stopSpeed() { if (speedWatch) navigator.geolocation.clearWatch(speedWatch); }

// Coordenadas
function updateCoords() {
  $('#c-dec').textContent = `${state.lat.toFixed(6)}, ${state.lon.toFixed(6)}`;
  $('#c-dms').textContent = toDMS(state.lat, 'lat') + ', ' + toDMS(state.lon, 'lon');
  const zone = Math.floor((state.lon + 180) / 6) + 1;
  $('#c-utm').textContent = `${zone}${state.lat >= 0 ? 'N' : 'S'}`;
}
function toDMS(deg, type) {
  const d = Math.floor(Math.abs(deg)); const m = Math.floor((Math.abs(deg) - d) * 60); const s = ((Math.abs(deg) - d) * 60 - m) * 60;
  const dir = type === 'lat' ? (deg >= 0 ? 'N' : 'S') : (deg >= 0 ? 'E' : 'O');
  return `${d}°${m}'${s.toFixed(1)}" ${dir}`;
}
$('#btn-copy-coords').addEventListener('click', () => { navigator.clipboard.writeText(`${state.lat}, ${state.lon}`).then(() => toast('Coordenadas copiadas')); });

// Medidor de Ruido
$('#btn-noise-start').addEventListener('click', async () => {
  try {
    state.noiseStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(state.noiseStream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    
    const measure = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      const db = Math.round(20 * Math.log10(avg / 255) + 94);
      $('#noise-val').textContent = db;
      $('#noise-fill').style.width = `${Math.min(100, db)}%`;
      let label = 'Silencio';
      if (db > 30) label = 'Tranquilo';
      if (db > 50) label = 'Normal';
      if (db > 70) label = 'Ruidoso';
      if (db > 90) label = 'Muy ruidoso';
      if (db > 110) label = '¡Peligroso!';
      $('#noise-label').textContent = label;
      if (!state.noiseStream) return;
      requestAnimationFrame(measure);
    };
    measure();
    toast('Medición iniciada');
  } catch(e) { toast('No se pudo acceder al micrófono'); }
});
function stopNoise() { if (state.noiseStream) { state.noiseStream.getTracks().forEach(t => t.stop()); state.noiseStream = null; } }

// Código Morse
$('#btn-morse-start').addEventListener('click', () => {
  const sos = [1,1,1,0,0,0,1,1,1]; // corto, corto, corto, pausa, pausa, pausa, largo, largo, largo
  let i = 0;
  state.morseInterval = setInterval(() => {
    const signal = sos[i % sos.length];
    $('#morse-signal').textContent = signal ? '●' : '○';
    $('#morse-signal').style.color = signal ? 'var(--danger)' : 'var(--text3)';
    if (signal && state.config.sound) {
      initAudio();
      const ctx = state.audio;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine'; osc.frequency.value = 800;
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.setValueAtTime(0, now + 0.1);
      osc.start(now); osc.stop(now + 0.1);
    }
    i++;
  }, 200);
  toast('SOS enviado');
});
$('#btn-morse-stop').addEventListener('click', stopMorse);
function stopMorse() { if (state.morseInterval) { clearInterval(state.morseInterval); state.morseInterval = null; } $('#morse-signal').textContent = '...'; $('#morse-signal').style.color = 'var(--accent)'; }

// Linterna SOS
$('#btn-flash').addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const track = stream.getVideoTracks()[0];
    const caps = track.getCapabilities();
    if (!caps.torch) { toast('Linterna no disponible'); track.stop(); return; }
    if (state.flashlight) {
      await track.applyConstraints({ advanced: [{ torch: false }] });
      track.stop(); state.flashlight = null;
      $('#btn-flash').textContent = 'ENCENDER SOS';
      $('#btn-flash').classList.remove('on');
      $('#flash-status').textContent = 'Linterna apagada';
    } else {
      await track.applyConstraints({ advanced: [{ torch: true }] });
      state.flashlight = track;
      $('#btn-flash').textContent = 'APAGAR';
      $('#btn-flash').classList.add('on');
      $('#flash-status').textContent = 'Linterna encendida';
      // Modo SOS: parpadeo
      let sosOn = true;
      state.morseInterval = setInterval(async () => {
        try { await track.applyConstraints({ advanced: [{ torch: sosOn }] }); sosOn = !sosOn; } catch(e){}
      }, 500);
    }
  } catch(e) { toast('No se pudo acceder a la linterna'); }
});

// Calculadora Suministros
$('#btn-calc-sup').addEventListener('click', () => {
  const people = parseInt($('#sup-people').value) || 1;
  const days = parseInt($('#sup-days').value) || 1;
  $('#sup-water').textContent = `${people * 4 * days}L`;
  $('#sup-food').textContent = `${people * 2 * days}kg`;
  $('#sup-batt').textContent = `${Math.ceil(days / 2)} sets`;
});

// Distancia a Epicentro
$('#btn-calc-dist').addEventListener('click', () => {
  const lat = parseFloat($('#dist-lat').value);
  const lon = parseFloat($('#dist-lon').value);
  if (isNaN(lat) || isNaN(lon)) { toast('Ingresa coordenadas válidas'); return; }
  const dist = haversine(state.lat, state.lon, lat, lon);
  const pTime = dist / 6;
  const sTime = dist / 3.5;
  $('#dist-result').textContent = `${dist.toFixed(1)} km`;
  $('#dist-p').textContent = `${pTime.toFixed(0)}s`;
  $('#dist-s').textContent = `${sTime.toFixed(0)}s`;
  $('#dist-diff').textContent = `${(sTime - pTime).toFixed(0)}s`;
});

// Conversor
$('#btn-convert').addEventListener('click', () => {
  const type = $('#conv-type').value;
  const val = parseFloat($('#conv-val').value);
  if (isNaN(val)) { toast('Ingresa un valor'); return; }
  let result = '';
  if (type === 'temp') result = `${val}°C = ${(val * 9/5 + 32).toFixed(1)}°F`;
  else if (type === 'dist') result = `${val} km = ${(val * 0.621371).toFixed(2)} mi`;
  else if (type === 'pressure') result = `${val} hPa = ${(val * 0.02953).toFixed(2)} inHg`;
  $('#conv-result').textContent = result;
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
  const list = $('#emb-list'); list.innerHTML = '';
  embs.forEach(e => { const div = document.createElement('div'); div.className = 'emb-item'; div.innerHTML = `<h4>${e.country}</h4><p>📞 ${e.phone}</p><a href="${e.web}" target="_blank">Sitio web →</a>`; list.appendChild(div); });
}

// ===== BOTÓN PÁNICO =====
$('#btn-panic').addEventListener('click', () => {
  const msg = `🚨 EMERGENCIA - Mi ubicación: https://www.google.com/maps?q=${state.lat},${state.lon} - ${state.city}`;
  if (navigator.share) navigator.share({ title: 'EMERGENCIA', text: msg });
  else navigator.clipboard.writeText(msg).then(() => toast('Ubicación copiada'));
  vibrate([500, 200, 500]);
});

// ===== SUPERVIVENCIA =====
$$('.check-item input').forEach(cb => cb.addEventListener('change', () => {
  const checked = $$('.check-item input:checked').length;
  $('#check-count').textContent = checked;
  $('#progress-fill').style.width = `${(checked / 15) * 100}%`;
  localStorage.setItem('ga_checklist', JSON.stringify(Array.from($$('.check-item input:checked')).map(c => c.dataset.item)));
}));

function loadChecklist() {
  const saved = localStorage.getItem('ga_checklist');
  if (saved) {
    try {
      const checked = JSON.parse(saved);
      $$('.check-item input').forEach(cb => { if (checked.includes(cb.dataset.item)) cb.checked = true; });
      const count = checked.length;
      $('#check-count').textContent = count;
      $('#progress-fill').style.width = `${(count / 15) * 100}%`;
    } catch(e){}
  }
}

$('#btn-save-plan').addEventListener('click', () => {
  const plan = { meeting: $('#plan-meeting').value, contact: $('#plan-contact').value, route: $('#plan-route').value };
  localStorage.setItem('ga_plan', JSON.stringify(plan));
  toast('Plan guardado');
});

function loadPlan() {
  const saved = localStorage.getItem('ga_plan');
  if (saved) {
    try {
      const plan = JSON.parse(saved);
      $('#plan-meeting').value = plan.meeting || '';
      $('#plan-contact').value = plan.contact || '';
      $('#plan-route').value = plan.route || '';
    } catch(e){}
  }
}

$('#btn-timer-start').addEventListener('click', () => {
  if (state.survivalTimer) return;
  state.survivalTimer = setInterval(() => {
    state.survivalSeconds++;
    const h = Math.floor(state.survivalSeconds / 3600);
    const m = Math.floor((state.survivalSeconds % 3600) / 60);
    const s = state.survivalSeconds % 60;
    $('#survival-timer').textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }, 1000);
});
$('#btn-timer-stop').addEventListener('click', () => { if (state.survivalTimer) { clearInterval(state.survivalTimer); state.survivalTimer = null; } });
$('#btn-timer-reset').addEventListener('click', () => { if (state.survivalTimer) { clearInterval(state.survivalTimer); state.survivalTimer = null; } state.survivalSeconds = 0; $('#survival-timer').textContent = '00:00:00'; });

// ===== PRUEBAS =====
$('#t-notif').addEventListener('click', () => {
  if (!('Notification' in window)) { toast('No soportado'); return; }
  Notification.requestPermission().then(p => {
    if (p === 'granted') { new Notification('GlobalAlerts Pro', { body: 'Notificaciones funcionando', icon: 'icons/icon-192.svg' }); toast('Notificación enviada'); }
    else toast('Permiso denegado');
  });
});
$('#t-quake').addEventListener('click', () => { triggerQuake({ id: 'test-' + Date.now(), geometry: { coordinates: [state.lon + 0.3, state.lat + 0.3, 10] }, properties: { mag: 6.5, place: 'Zona de prueba - 35 km', time: Date.now() } }); });
$('#t-lock').addEventListener('click', () => { triggerLock({ country: '🇲🇽 MÉXICO - Protección Civil', title: 'ALERTA SÍSMICA NACIONAL', time: 'Hace 1 minuto', message: 'Sismo M6.8 detectado en costa de Guerrero. Mantenga la calma.', steps: ['Aléjese de ventanas', 'No use elevadores', 'Diríjase a zona segura', 'Espere instrucciones'] }); });
$('#t-siren').addEventListener('click', () => { if (state.config.sound) { startSiren(); toast('Sirena 5s'); setTimeout(stopSiren, 5000); } else toast('Activa el sonido'); });
$('#t-map').addEventListener('click', () => { if (state.map) { state.map.invalidateSize(); updateMapLayers(); toast('Mapa recargado'); } });

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
  localStorage.setItem('ga_config', JSON.stringify(state.config));
  toast('Configuración guardada');
});

$('#btn-reset').addEventListener('click', () => { if (confirm('¿Borrar todos los datos?')) { localStorage.clear(); location.reload(); } });

// ===== GEOLOCALIZACIÓN =====
async function getLocation() {
  if (!('geolocation' in navigator)) return;
  try {
    const pos = await new Promise((res, rej) => { navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 10000 }); });
    state.lat = pos.coords.latitude;
    state.lon = pos.coords.longitude;
    if (pos.coords.altitude !== null) state.altitude = pos.coords.altitude;
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${state.lat}&lon=${state.lon}&zoom=10&accept-language=es`);
      if (r.ok) { const d = await r.json(); state.city = d.address?.city || d.address?.town || d.address?.village || d.address?.state || 'Tu ubicación'; state.country = d.address?.country || ''; }
    } catch(e){}
    $('#loc-badge').textContent = state.city;
    if (state.map) {
      state.map.setView([state.lat, state.lon], 10);
      const userIcon = L.divIcon({ className: '', html: '<div style="width:18px;height:18px;background:#3b82f6;border:3px solid white;border-radius:50%;box-shadow:0 0 12px rgba(59,130,246,.8);"></div>', iconSize: [24, 24], iconAnchor: [12, 12] });
      L.marker([state.lat, state.lon], { icon: userIcon }).addTo(state.map).bindPopup(`<strong>${state.city}</strong>`).openPopup();
    }
  } catch(e) { $('#loc-badge').textContent = state.city + ' (default)'; }
}

// ===== INIT =====
async function init() {
  console.log('=== GlobalAlerts Pro Ultimate ===');
  loadConfig();
  loadChecklist();
  loadPlan();
  initMap();
  await getLocation();
  await Promise.all([loadWeather(), loadAir(), loadQuakes()]);
  loadISS();
  loadSpaceWeather();
  loadMoon();
  toast('Sistema activado');
  setInterval(loadQuakes, 30000);
  setInterval(() => { loadWeather(); loadAir(); }, 5 * 60 * 1000);
  setInterval(loadISS, 10000);
  if ('Notification' in window && Notification.permission === 'default') setTimeout(() => Notification.requestPermission(), 3000);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
