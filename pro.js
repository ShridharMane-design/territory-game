import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, onValue, onDisconnect } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyA49GTlnp4jDpiGEhXcnFzZYq0l710pcPM",
  authDomain: "territory-game-be63b.firebaseapp.com",
  databaseURL: "https://territory-game-be63b-default-rtdb.firebaseio.com",
  projectId: "territory-game-be63b",
  storageBucket: "territory-game-be63b.firebasestorage.app",
  messagingSenderId: "550730239747",
  appId: "1:550730239747:web:53bd1c6678efd8822d6336"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Player setup
const playerId = localStorage.getItem('playerId') || 'player_' + Math.floor(Math.random() * 10000);
localStorage.setItem('playerId', playerId);

const COLORS = ['blue', 'red', 'green', 'orange'];
const colorIndex = parseInt(playerId.split('_')[1]) % COLORS.length;
let playerColor = COLORS[colorIndex];

// Auto remove player when they close app
const playerRef = ref(db, `players/${playerId}`);
onDisconnect(playerRef).remove();

// Map setup
const map = L.map('map').setView([0, 0], 18);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

// Player markers and paths
let markers = {};
let polylines = {};

// Trail tracking
let trailCoords = [];
let enemyTrail = [];
let inEnemyTerritory = false;

// Grid settings
const GRID_SIZE = 0.0001;
let capturedCells = {};
let score = 0;

const scoreDiv = document.getElementById('score');
const playerInfoDiv = document.getElementById('playerInfo');
playerInfoDiv.innerText = `You are: ${playerId} (${playerColor})`;
playerInfoDiv.style.background = playerColor;

// ─── Helper Functions ──────────────────────────

function getCellKey(lat, lng) {
  const row = Math.floor(lat / GRID_SIZE);
  const col = Math.floor(lng / GRID_SIZE);
  return `${row}_${col}`;
}

function getCellBounds(key) {
  const [row, col] = key.split('_').map(Number);
  const lat1 = row * GRID_SIZE;
  const lat2 = lat1 + GRID_SIZE;
  const lng1 = col * GRID_SIZE;
  const lng2 = lng1 + GRID_SIZE;
  return [[lat1, lng1], [lat2, lng2]];
}

function getDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function isMyCell(key) {
  if (!capturedCells[key]) return false;
  return capturedCells[key].options.fillColor === playerColor;
}

function isEnemyCell(key) {
  if (!capturedCells[key]) return false;
  return capturedCells[key].options.fillColor !== playerColor;
}

// ─── Polygon Fill ──────────────────────────

function isPointInPolygon(lat, lng, polygon) {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersect = ((yi > lng) !== (yj > lng)) &&
      (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function fillEnclosedArea(loopPath) {
  if (loopPath.length < 3) return;

  // Close the polygon properly
  const closedPath = [...loopPath];
  closedPath.push(loopPath[0]);

  const lats = closedPath.map(p => p[0]);
  const lngs = closedPath.map(p => p[1]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  let captured = 0;

  for (let lat = minLat; lat <= maxLat; lat += GRID_SIZE) {
    for (let lng = minLng; lng <= maxLng; lng += GRID_SIZE) {
      const centerLat = lat + GRID_SIZE / 2;
      const centerLng = lng + GRID_SIZE / 2;

      if (isPointInPolygon(centerLat, centerLng, closedPath)) {
        const key = getCellKey(lat, lng);

        // Force draw rectangle visually
        if (capturedCells[key]) {
          capturedCells[key].setStyle({
            color: playerColor,
            fillColor: playerColor,
            fillOpacity: 0.5
          });
        } else {
          const bounds = getCellBounds(key);
          const rect = L.rectangle(bounds, {
            color: playerColor,
            fillColor: playerColor,
            fillOpacity: 0.5,
            weight: 1
          }).addTo(map);
          capturedCells[key] = rect;
        }

        // Update Firebase
        set(ref(db, `cells/${key}`), {
          color: playerColor,
          owner: playerId
        });

        score++;
        captured++;
      }
    }
  }

  if (captured > 0) {
    scoreDiv.innerText = `+${captured} cells captured! Total: ${score}`;
    setTimeout(() => {
      scoreDiv.innerText = `Score: ${score} cells`;
    }, 2000);
  }
}

// ─── Self Intersection Detection ──────────────────────────

function direction(pi, pj, pk) {
  return (pk[0] - pi[0]) * (pj[1] - pi[1]) -
         (pj[0] - pi[0]) * (pk[1] - pi[1]);
}

function segmentsIntersect(p1, p2, p3, p4) {
  const d1 = direction(p3, p4, p1);
  const d2 = direction(p3, p4, p2);
  const d3 = direction(p1, p2, p3);
  const d4 = direction(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return false;
}

function detectSelfIntersection(trail) {
  if (trail.length < 4) return false;
  const last = trail[trail.length - 1];
  const prev = trail[trail.length - 2];
  for (let i = 0; i < trail.length - 3; i++) {
    const a = trail[i];
    const b = trail[i + 1];
    if (segmentsIntersect(prev, last, a, b)) {
      return true;
    }
  }
  return false;
}

// ─── Cell Capture ──────────────────────────

function captureCell(key) {
  const existingCell = capturedCells[key];

  if (!existingCell) {
    const bounds = getCellBounds(key);
    const rect = L.rectangle(bounds, {
      color: playerColor,
      fillColor: playerColor,
      fillOpacity: 0.4,
      weight: 1
    }).addTo(map);
    capturedCells[key] = rect;
    score++;
  } else if (existingCell.options.fillColor !== playerColor) {
    existingCell.setStyle({ color: playerColor, fillColor: playerColor });
    score++;
  }

  set(ref(db, `cells/${key}`), {
    color: playerColor,
    owner: playerId
  });

  scoreDiv.innerText = `Score: ${score} cells`;
}

// ─── Loop Completion ──────────────────────────

function completeLoop() {
  if (enemyTrail.length > 5) {
    fillEnclosedArea(enemyTrail);
  }
  enemyTrail = [];
  inEnemyTerritory = false;
}

// ─── Firebase Listeners ──────────────────────────

onValue(ref(db, 'cells'), (snapshot) => {
  const data = snapshot.val();
  if (!data) return;
  Object.entries(data).forEach(([key, cell]) => {
    if (capturedCells[key]) {
      capturedCells[key].setStyle({
        color: cell.color,
        fillColor: cell.color
      });
    } else {
      const bounds = getCellBounds(key);
      const rect = L.rectangle(bounds, {
        color: cell.color,
        fillColor: cell.color,
        fillOpacity: 0.4,
        weight: 1
      }).addTo(map);
      capturedCells[key] = rect;
    }
  });
});

onValue(ref(db, 'players'), (snapshot) => {
  const data = snapshot.val();

  Object.keys(markers).forEach(id => {
    if (id === playerId) return;
    if (!data || !data[id]) {
      map.removeLayer(markers[id]);
      map.removeLayer(polylines[id]);
      delete markers[id];
      delete polylines[id];
    }
  });

  if (!data) return;
  Object.entries(data).forEach(([id, player]) => {
    if (id === playerId) return;
    if (!markers[id]) {
      markers[id] = L.marker([player.lat, player.lng]).addTo(map);
      polylines[id] = L.polyline([], { color: player.color }).addTo(map);
    } else {
      markers[id].setLatLng([player.lat, player.lng]);
    }
  });
});

// ─── GPS Tracking ────────────────────────────────

navigator.geolocation.watchPosition(
  (position) => {
    const { latitude, longitude } = position.coords;
    const key = getCellKey(latitude, longitude);

    if (!markers[playerId]) {
      map.setView([latitude, longitude], 18);
      markers[playerId] = L.marker([latitude, longitude]).addTo(map);
      polylines[playerId] = L.polyline([], { color: playerColor }).addTo(map);
    } else {
      markers[playerId].setLatLng([latitude, longitude]);
    }

    trailCoords.push([latitude, longitude]);
    polylines[playerId].setLatLngs(trailCoords);

    set(ref(db, `players/${playerId}`), {
      lat: latitude,
      lng: longitude,
      color: playerColor
    });

    // ── Core Loop Logic ──

    if (isEnemyCell(key) || (inEnemyTerritory && !isMyCell(key))) {
      if (!inEnemyTerritory) {
        inEnemyTerritory = true;
        enemyTrail = [[latitude, longitude]];
      } else {
        enemyTrail.push([latitude, longitude]);

        // Method 1 — Trail crosses itself
        if (enemyTrail.length > 10 && detectSelfIntersection(enemyTrail)) {
          completeLoop();
        }
        // Method 2 — Close to start point
        else if (enemyTrail.length > 10) {
          const distToStart = getDistance(
            latitude, longitude,
            enemyTrail[0][0], enemyTrail[0][1]
          );
          if (distToStart < 15) {
            completeLoop();
          }
        }
      }

    } else if (isMyCell(key)) {
      if (inEnemyTerritory && enemyTrail.length > 5) {
        enemyTrail.push([latitude, longitude]);
        completeLoop();
      } else {
        inEnemyTerritory = false;
        enemyTrail = [];
        captureCell(key);
      }

    } else {
      if (inEnemyTerritory) {
        enemyTrail.push([latitude, longitude]);
      } else {
        captureCell(key);
      }
    }
  },
  (error) => { alert('Location error: ' + error.message); },
  { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
);