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

// Remove from DB on disconnect
const playerRef = ref(db, `players/${playerId}`);
onDisconnect(playerRef).remove();

// ── Map ──────────────────────────────────────────────────
const map = L.map('map', { zoomControl: true }).setView([0, 0], 18);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap'
}).addTo(map);

// ── State ────────────────────────────────────────────────
const GRID_SIZE  = 0.0001;
let capturedCells  = {};   // key → L.rectangle
let score          = 0;
let streak         = 0;
let lastCellKey    = null;
let markers        = {};
let polylines      = {};
let trailCoords    = [];
let playerLastSeen = {};
let sessionStart   = Date.now();
let totalLbCells   = 0;

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

// ── Init badge ────────────────────────────────────────────
badgeId.textContent = playerId;
badgeBar.style.background = playerColor;
badgeBar.style.boxShadow  = `0 0 10px ${playerColor}`;

// ── Leaderboard toggle ────────────────────────────────────
lbToggle.addEventListener('click', () => lbPanel.classList.toggle('collapsed'));

// ── Session timer ─────────────────────────────────────────
setInterval(() => {
  const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
  const m = String(Math.floor(elapsed / 60)).padStart(2,'0');
  const s = String(elapsed % 60).padStart(2,'0');
  sessionTimeEl.textContent = `${m}:${s}`;
}, 1000);

// ── Helpers ───────────────────────────────────────────────
function getCellKey(lat, lng) {
  return `${Math.floor(lat / GRID_SIZE)}_${Math.floor(lng / GRID_SIZE)}`;
}
function getCellBounds(key) {
  const [row, col] = key.split('_').map(Number);
  return [[row * GRID_SIZE, col * GRID_SIZE], [(row+1)*GRID_SIZE, (col+1)*GRID_SIZE]];
}

function animateScore(from, to) {
  const diff = to - from;
  const steps = 20;
  let i = 0;
  const interval = setInterval(() => {
    i++;
    const v = Math.round(from + (diff * i / steps));
    scoreValEl.textContent = v;
    if (i >= steps) { clearInterval(interval); scoreValEl.textContent = to; }
  }, 18);
}

function spawnPopup(text, isSteal = false) {
  const el = document.createElement('div');
  el.className = 'score-popup' + (isSteal ? ' steal' : '');
  el.textContent = text;
  // place near center-bottom of screen
  el.style.left = (40 + Math.random() * 140) + 'px';
  el.style.bottom = '95px';
  popupLayer.appendChild(el);
  setTimeout(() => el.remove(), 1300);
}

function updateScoreUI() {
  animateScore(parseInt(scoreValEl.textContent) || 0, score);
  // bar fill relative to leader
  const maxScore = getMaxScore();
  const pct = maxScore > 0 ? Math.min(100, (score / maxScore) * 100) : 0;
  scoreBarFill.style.width = pct + '%';
  msStreak.textContent = streak;
}

function getMaxScore() {
  let max = 1;
  lbData.forEach(p => { if (p.score > max) max = p.score; });
  return max;
}

// ── Cell capture ──────────────────────────────────────────
function captureCell(key) {
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
    score++;
    streak++;
    spawnPopup('+1');
  } else if (isSteal) {
    capturedCells[key].setStyle({ color: playerColor, fillColor: playerColor });
    capturedCells[key]._ownerColor = playerColor;
    score++;
    streak = 1;
    spawnPopup('⚔ STOLEN!', true);
  } else {
    // already ours — keep streak going if consecutive
    if (key !== lastCellKey) streak++;
  }

  lastCellKey = key;
  updateScoreUI();

  set(ref(db, `cells/${key}`), { color: playerColor, owner: playerId });
  set(ref(db, `leaderboard/${playerId}`), { score, color: playerColor, id: playerId });
}

// ── Leaderboard rendering ─────────────────────────────────
let lbData = [];

function renderLeaderboard() {
  lbData.sort((a, b) => b.score - a.score);

  // count total cells
  totalLbCells = lbData.reduce((acc, p) => acc + p.score, 0);
  lbTotal.textContent = `${totalLbCells} cells claimed`;

  // update player count
  livePlayerCount.textContent = lbData.length;

  // find my rank
  const myRank = lbData.findIndex(p => p.id === playerId) + 1;
  msRank.textContent = myRank > 0 ? `#${myRank}` : '#–';

  // territory %
  const myEntry = lbData.find(p => p.id === playerId);
  if (myEntry && totalLbCells > 0) {
    msPct.textContent = Math.round((myEntry.score / totalLbCells) * 100) + '%';
  }

  // score bar
  const maxScore = getMaxScore();
  const pct = maxScore > 0 ? Math.min(100, (score / maxScore) * 100) : 0;
  scoreBarFill.style.width = pct + '%';

  if (lbData.length === 0) {
    lbList.innerHTML = '<li class="lb-empty">No players yet…</li>';
    return;
  }

  lbList.innerHTML = '';
  lbData.forEach((player, i) => {
    const rank = i + 1;
    const isMe = player.id === playerId;
    const li   = document.createElement('li');
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

// ── Firebase: leaderboard ─────────────────────────────────
onValue(ref(db, 'leaderboard'), (snapshot) => {
  const data = snapshot.val() || {};
  lbData = Object.values(data);
  renderLeaderboard();
});

// ── Firebase: cells ───────────────────────────────────────
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

// ── Firebase: other players ───────────────────────────────
function getTimeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  return s < 60 ? `${s}s ago` : `${Math.floor(s/60)}m ago`;
}

function updateMarkerStatus(id, lastSeen) {
  if (!markers[id]) return;
  const secondsAgo = (Date.now() - lastSeen) / 1000;
  const running = secondsAgo < 10;
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

  // remove gone players
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
      statusPip.className   = 'pip running';
      statusLabel.textContent = 'RUNNING';

      markers[playerId] = L.marker([lat, lng]).addTo(map);
      polylines[playerId] = L.polyline([], {
        color: playerColor, weight: 4, opacity: 1
      }).addTo(map);
    } else {
      markers[playerId].setLatLng([lat, lng]);
      map.panTo([lat, lng]);
    }

    // Upload to Firebase
    set(ref(db, `players/${playerId}`), {
      lat, lng, color: playerColor, lastSeen: Date.now()
    });

    trailCoords.push([lat, lng]);
    polylines[playerId].setLatLngs(trailCoords);

    captureCell(key);
  },
  (err) => {
    statusPip.className    = 'pip stopped';
    statusLabel.textContent = 'GPS ERROR';
    alert('GPS Error: ' + err.message);
  },
  { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
);
