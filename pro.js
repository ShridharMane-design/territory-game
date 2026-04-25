import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, onValue, onDisconnect } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// ── Firebase ────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyA49GTlnp4jDpiGEhXcnFzZYq0l710pcPM",
  authDomain: "territory-game-be63b.firebaseapp.com",
  databaseURL: "https://territory-game-be63b-default-rtdb.firebaseio.com",
  projectId: "territory-game-be63b",
  storageBucket: "territory-game-be63b.firebasestorage.app",
  messagingSenderId: "550730239747",
  appId: "1:550730239747:web:53bd1c6678efd8822d6336"
};

const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

// ── Player ID & Color ────────────────────────────────────
const playerId = localStorage.getItem('playerId') || 'P_' + Math.floor(Math.random() * 9000 + 1000);
localStorage.setItem('playerId', playerId);

const COLORS = ['#2979ff', '#ff1744', '#00e676', '#ff9100'];
const colorIndex = parseInt(playerId.replace(/\D/g,'')) % COLORS.length;
let playerColor = COLORS[colorIndex];

const playerRef = ref(db, `players/${playerId}`);
onDisconnect(playerRef).remove();

// ── Map ──────────────────────────────────────────────────
const map = L.map('map', { zoomControl: true }).setView([0, 0], 18);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap'
}).addTo(map);

// ── State ────────────────────────────────────────────────
const GRID_SIZE = 0.0001;
let capturedCells = {};
let score = 0;
let streak = 0;
let lastCellKey = null;
let markers = {};
let polylines = {};
let trailCoords = [];
let playerLastSeen = {};
let sessionStart = Date.now();

// ── BPM & Stamina ────────────────────────────────────────
let currentBPM = 0;
let fingerDetected = false;
let lastFingerTime = Date.now();
let captureMultiplier = 1.0;
let staminaLevel = 100;
let lastCaptureTime = 0;
const BASE_CAPTURE_COOLDOWN = 500;

// ── DOM refs ─────────────────────────────────────────────
const scoreValEl      = document.getElementById('score-val');
const scoreBarFill    = document.getElementById('score-bar-fill');
const msRank          = document.getElementById('ms-rank');
const msPct           = document.getElementById('ms-pct');
const msStreak        = document.getElementById('ms-streak');
const badgeId         = document.getElementById('badge-id');
const badgeBar        = document.getElementById('badge-bar');
const statusPip       = document.getElementById('status-pip');
const statusLabel     = document.getElementById('status-label');
const sessionTimeEl   = document.getElementById('session-time');
const livePlayerCount = document.getElementById('live-player-count');
const lbList          = document.getElementById('lb-list');
const lbTotal         = document.getElementById('lb-total');
const lbPanel         = document.getElementById('lb-panel');
const lbToggle        = document.getElementById('lb-toggle');
const popupLayer      = document.getElementById('popup-layer');
const bpmVal          = document.getElementById('bpm-val');
const bpmStatus       = document.getElementById('bpm-status');
const staminaFill     = document.getElementById('stamina-fill');
const staminaLabel    = document.getElementById('stamina-label');
const bpmWidget       = document.getElementById('bpm-widget');

// ── Init ──────────────────────────────────────────────────
badgeId.textContent = playerId;
badgeBar.style.background = playerColor;
badgeBar.style.boxShadow  = `0 0 10px ${playerColor}`;
lbToggle.addEventListener('click', () => lbPanel.classList.toggle('collapsed'));

// ── Session timer ─────────────────────────────────────────
setInterval(() => {
  const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
  const m = String(Math.floor(elapsed / 60)).padStart(2,'0');
  const s = String(elapsed % 60).padStart(2,'0');
  sessionTimeEl.textContent = `${m}:${s}`;
}, 1000);

// ── BPM from Firebase ─────────────────────────────────────
onValue(ref(db, 'bpm'), (snapshot) => {
  const data = snapshot.val();
  if (!data) return;
  currentBPM     = data.current || 0;
  fingerDetected = data.finger === 1;
  if (fingerDetected) lastFingerTime = Date.now();
  updateBPMWidget();
  updateStamina();
});

// ── BPM Widget ───────────────────────────────────────────
function updateBPMWidget() {
  if (!bpmVal) return;
  bpmVal.textContent = currentBPM > 0 ? currentBPM : '--';

  if (!fingerDetected) {
    if (bpmWidget) bpmWidget.setAttribute('data-state', 'no-sensor');
    if (bpmStatus) bpmStatus.textContent = 'NO SENSOR';
    if (bpmVal) bpmVal.style.color = '#ff3232';
  } else if (currentBPM >= 100) {
    if (bpmWidget) bpmWidget.setAttribute('data-state', 'exhausted');
    if (bpmStatus) bpmStatus.textContent = '😓 EXHAUSTED';
    if (bpmVal) bpmVal.style.color = '#ff9100';
  } else if (currentBPM >= 80) {
    if (bpmWidget) bpmWidget.setAttribute('data-state', 'boost');
    if (bpmStatus) bpmStatus.textContent = '⚡ BOOST';
    if (bpmVal) bpmVal.style.color = '#00ff88';
  } else if (currentBPM < 60 && currentBPM > 0) {
    if (bpmWidget) bpmWidget.setAttribute('data-state', 'resting');
    if (bpmStatus) bpmStatus.textContent = '🐢 RESTING';
    if (bpmVal) bpmVal.style.color = '#00c8ff';
  } else {
    if (bpmWidget) bpmWidget.setAttribute('data-state', 'normal');
    if (bpmStatus) bpmStatus.textContent = '✅ NORMAL';
    if (bpmVal) bpmVal.style.color = '#00c8ff';
  }
}

// ── Stamina Logic ─────────────────────────────────────────
function updateStamina() {
  const noSensorDuration = (Date.now() - lastFingerTime) / 1000;

  if (!fingerDetected) {
    if (noSensorDuration > 60) {
      captureMultiplier = 0; staminaLevel = 0;
    } else if (noSensorDuration > 30) {
      captureMultiplier = 0.2; staminaLevel = 20;
    } else {
      captureMultiplier = 1.0; staminaLevel = 100;
    }
  } else {
    if (currentBPM >= 80 && currentBPM < 100) {
      captureMultiplier = 1.5; staminaLevel = 100;
    } else if (currentBPM >= 100) {
      captureMultiplier = 0.5; staminaLevel = 30;
    } else if (currentBPM < 60 && currentBPM > 0) {
      captureMultiplier = 0.7; staminaLevel = 60;
    } else {
      captureMultiplier = 1.0; staminaLevel = 80;
    }
  }

  if (staminaFill) {
    staminaFill.style.width = staminaLevel + '%';
    staminaFill.style.background =
      staminaLevel > 70 ? '#00ff88' :
      staminaLevel > 30 ? '#ff9100' : '#ff3232';
  }
  if (staminaLabel) {
    staminaLabel.textContent =
      captureMultiplier === 0  ? 'BLOCKED' :
      captureMultiplier >= 1.5 ? 'BOOSTED' :
      captureMultiplier <= 0.3 ? 'PENALTY' : 'STAMINA';
  }
}

setInterval(updateStamina, 1000);

// ── Helpers ───────────────────────────────────────────────
function getCellKey(lat, lng) {
  return `${Math.floor(lat / GRID_SIZE)}_${Math.floor(lng / GRID_SIZE)}`;
}
function getCellBounds(key) {
  const [row, col] = key.split('_').map(Number);
  return [[row * GRID_SIZE, col * GRID_SIZE], [(row+1)*GRID_SIZE, (col+1)*GRID_SIZE]];
}
function animateScore(from, to) {
  const diff = to - from; const steps = 20; let i = 0;
  const interval = setInterval(() => {
    i++;
    scoreValEl.textContent = Math.round(from + (diff * i / steps));
    if (i >= steps) { clearInterval(interval); scoreValEl.textContent = to; }
  }, 18);
}
function spawnPopup(text, isSteal = false, isBlocked = false) {
  const el = document.createElement('div');
  el.className = 'score-popup' + (isSteal ? ' steal' : '') + (isBlocked ? ' blocked' : '');
  el.textContent = text;
  el.style.left = (40 + Math.random() * 140) + 'px';
  el.style.bottom = '95px';
  popupLayer.appendChild(el);
  setTimeout(() => el.remove(), 1300);
}
function getMaxScore() {
  let max = 1;
  lbData.forEach(p => { if (p.score > max) max = p.score; });
  return max;
}
function updateScoreUI() {
  animateScore(parseInt(scoreValEl.textContent) || 0, score);
  const pct = getMaxScore() > 0 ? Math.min(100, (score / getMaxScore()) * 100) : 0;
  scoreBarFill.style.width = pct + '%';
  msStreak.textContent = streak;
}

// ── Cell Capture with Stamina ─────────────────────────────
function captureCell(key) {
  if (captureMultiplier === 0) {
    spawnPopup('❌ BLOCKED!', false, true);
    return;
  }
  const cooldown = BASE_CAPTURE_COOLDOWN / captureMultiplier;
  const now = Date.now();
  if (now - lastCaptureTime < cooldown) return;
  lastCaptureTime = now;

  const isNew   = !capturedCells[key];
  const isSteal = !isNew && capturedCells[key]._ownerColor !== playerColor;

  if (isNew) {
    const bounds = getCellBounds(key);
    const rect = L.rectangle(bounds, {
      color: playerColor, fillColor: playerColor,
      fillOpacity: 0.45, weight: 1
    }).addTo(map);
    rect._ownerColor = playerColor;
    capturedCells[key] = rect;
    score++; streak++;
    spawnPopup(captureMultiplier >= 1.5 ? '⚡ +1 BOOST!' : '+1');
  } else if (isSteal) {
    capturedCells[key].setStyle({ color: playerColor, fillColor: playerColor });
    capturedCells[key]._ownerColor = playerColor;
    score++; streak = 1;
    spawnPopup('⚔ STOLEN!', true);
  } else {
    if (key !== lastCellKey) streak++;
  }

  lastCellKey = key;
  updateScoreUI();
  set(ref(db, `cells/${key}`), { color: playerColor, owner: playerId });
  set(ref(db, `leaderboard/${playerId}`), { score, color: playerColor, id: playerId });
}

// ── Leaderboard ───────────────────────────────────────────
let lbData = [];

function renderLeaderboard() {
  lbData.sort((a, b) => b.score - a.score);
  const totalCells = lbData.reduce((acc, p) => acc + p.score, 0);
  lbTotal.textContent = `${totalCells} cells claimed`;
  livePlayerCount.textContent = lbData.length;
  const myRank = lbData.findIndex(p => p.id === playerId) + 1;
  msRank.textContent = myRank > 0 ? `#${myRank}` : '#–';
  const myEntry = lbData.find(p => p.id === playerId);
  if (myEntry && totalCells > 0) {
    msPct.textContent = Math.round((myEntry.score / totalCells) * 100) + '%';
  }
  if (lbData.length === 0) {
    lbList.innerHTML = '<li class="lb-empty">No players yet…</li>';
    return;
  }
  lbList.innerHTML = '';
  lbData.forEach((player, i) => {
    const rank = i + 1;
    const isMe = player.id === playerId;
    const li = document.createElement('li');
    li.className = 'lb-entry' + (isMe ? ' is-me' : '');
    li.style.borderLeftColor = isMe ? player.color : 'transparent';
    const rankClass = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
    const rankIcon  = rank === 1 ? '①' : rank === 2 ? '②' : rank === 3 ? '③' : rank;
    li.innerHTML = `
      <span class="lb-rank ${rankClass}">${rankIcon}</span>
      <span class="lb-dot" style="background:${player.color};color:${player.color}"></span>
      <span class="lb-name">${isMe ? '▶ ' + player.id : player.id}</span>
      <span class="lb-score">${player.score}</span>
    `;
    lbList.appendChild(li);
  });
}

onValue(ref(db, 'leaderboard'), (snapshot) => {
  lbData = Object.values(snapshot.val() || {});
  renderLeaderboard();
});

onValue(ref(db, 'cells'), (snapshot) => {
  const data = snapshot.val();
  if (!data) return;
  Object.entries(data).forEach(([key, cell]) => {
    if (capturedCells[key]) {
      capturedCells[key].setStyle({ color: cell.color, fillColor: cell.color });
      capturedCells[key]._ownerColor = cell.color;
    } else {
      const bounds = getCellBounds(key);
      const rect = L.rectangle(bounds, {
        color: cell.color, fillColor: cell.color,
        fillOpacity: 0.45, weight: 1
      }).addTo(map);
      rect._ownerColor = cell.color;
      capturedCells[key] = rect;
    }
  });
});

function getTimeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  return s < 60 ? `${s}s ago` : `${Math.floor(s/60)}m ago`;
}
function updateMarkerStatus(id, lastSeen) {
  if (!markers[id]) return;
  const running = (Date.now() - lastSeen) / 1000 < 10;
  const el = markers[id].getElement();
  if (el) el.style.opacity = running ? '1' : '0.4';
  markers[id].bindTooltip(
    `${id}<br>${running ? '🟢 RUNNING' : '🔴 STOPPED'}<br>${getTimeAgo(lastSeen)}`,
    { permanent: true, direction: 'top', className: 'player-tooltip' }
  ).openTooltip();
}
setInterval(() => {
  Object.keys(playerLastSeen).forEach(id => {
    if (id !== playerId) updateMarkerStatus(id, playerLastSeen[id]);
  });
}, 5000);

onValue(ref(db, 'players'), (snapshot) => {
  const data = snapshot.val();
  Object.keys(markers).forEach(id => {
    if (id === playerId) return;
    if (!data || !data[id]) {
      map.removeLayer(markers[id]);
      if (polylines[id]) map.removeLayer(polylines[id]);
      delete markers[id]; delete polylines[id]; delete playerLastSeen[id];
    }
  });
  if (!data) return;
  Object.entries(data).forEach(([id, player]) => {
    if (id === playerId) return;
    playerLastSeen[id] = player.lastSeen || Date.now();
    if (!markers[id]) {
      markers[id] = L.marker([player.lat, player.lng]).addTo(map);
      polylines[id] = L.polyline([], { color: player.color, weight: 4, opacity: 0.8 }).addTo(map);
    } else {
      markers[id].setLatLng([player.lat, player.lng]);
      polylines[id].addLatLng([player.lat, player.lng]);
    }
    updateMarkerStatus(id, playerLastSeen[id]);
  });
  livePlayerCount.textContent = Object.keys(data).length;
});

// ── GPS ───────────────────────────────────────────────────
let gpsActive = false;
navigator.geolocation.watchPosition(
  (position) => {
    const { latitude: lat, longitude: lng } = position.coords;
    const key = getCellKey(lat, lng);
    if (!gpsActive) {
      gpsActive = true;
      map.setView([lat, lng], 18);
      statusPip.className = 'pip running';
      statusLabel.textContent = 'RUNNING';
      markers[playerId] = L.marker([lat, lng]).addTo(map);
      polylines[playerId] = L.polyline([], { color: playerColor, weight: 4, opacity: 1 }).addTo(map);
    } else {
      markers[playerId].setLatLng([lat, lng]);
      map.panTo([lat, lng]);
    }
    set(ref(db, `players/${playerId}`), { lat, lng, color: playerColor, lastSeen: Date.now() });
    trailCoords.push([lat, lng]);
    polylines[playerId].setLatLngs(trailCoords);
    captureCell(key);
  },
  (err) => {
    statusPip.className = 'pip stopped';
    statusLabel.textContent = 'GPS ERROR';
    alert('GPS Error: ' + err.message);
  },
  { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
);
