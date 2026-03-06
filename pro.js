import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, onValue, onDisconnect, get } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

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
const db = getDatabase(app);

const playerId = localStorage.getItem('playerId') || 'player_' + Math.floor(Math.random() * 10000);
localStorage.setItem('playerId', playerId);

const COLORS = ['blue', 'red', 'green', 'orange'];
const colorIndex = parseInt(playerId.split('_')[1]) % COLORS.length;
let playerColor = COLORS[colorIndex];

const playerRef = ref(db, `players/${playerId}`);
onDisconnect(playerRef).remove();

const map = L.map('map').setView([0, 0], 18);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

let markers = {};
let polylines = {};
let trailCoords = [];
let loopCompleted = false;

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
  return [
    [row * GRID_SIZE, col * GRID_SIZE],
    [(row + 1) * GRID_SIZE, (col + 1) * GRID_SIZE]
  ];
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

// ─── Point in Polygon ──────────────────────────

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
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
         ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function detectSelfIntersection(trail) {
  if (trail.length < 4) return -1;
  const last = trail[trail.length - 1];
  const prev = trail[trail.length - 2];
  for (let i = 0; i < trail.length - 3; i++) {
    if (segmentsIntersect(prev, last, trail[i], trail[i + 1])) {
      return i;
    }
  }
  return -1;
}

// ─── Cell Capture ──────────────────────────

function captureCell(key) {
  const existingCell = capturedCells[key];

  if (!existingCell) {
    const bounds = getCellBounds(key);
    const rect = L.rectangle(bounds, {
      color: playerColor,
      fillColor: playerColor,
      fillOpacity: 0.5,
      weight: 1
    }).addTo(map);
    capturedCells[key] = rect;
    score++;
  } else if (existingCell.options.fillColor !== playerColor) {
    existingCell.setStyle({
      color: playerColor,
      fillColor: playerColor,
      fillOpacity: 0.5
    });
    score++;
  }

  set(ref(db, `cells/${key}`), {
    color: playerColor,
    owner: playerId
  });

  updateLeaderboard();
  scoreDiv.innerText = `Score: ${score} cells`;
}

function updateLeaderboard() {
  set(ref(db, `leaderboard/${playerId}`), {
    score: score,
    color: playerColor,
    id: playerId
  });
}

// ─── Polygon Fill ──────────────────────────

function fillEnclosedArea(loopPath) {
  if (loopPath.length < 3) return;

  const closedPath = [...loopPath, loopPath[0]];

  const lats = closedPath.map(p => p[0]);
  const lngs = closedPath.map(p => p[1]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  let captured = 0;

  for (let lat = minLat; lat <= maxLat; lat += GRID_SIZE) {
    for (let lng = minLng; lng <= maxLng; lng += GRID_SIZE) {
      const checks = [
        [lat + GRID_SIZE * 0.5,  lng + GRID_SIZE * 0.5],
        [lat + GRID_SIZE * 0.25, lng + GRID_SIZE * 0.25],
        [lat + GRID_SIZE * 0.75, lng + GRID_SIZE * 0.25],
        [lat + GRID_SIZE * 0.25, lng + GRID_SIZE * 0.75],
        [lat + GRID_SIZE * 0.75, lng + GRID_SIZE * 0.75],
      ];

      const anyInside = checks.some(([clat, clng]) =>
        isPointInPolygon(clat, clng, closedPath)
      );

      if (anyInside) {
        const key = getCellKey(lat, lng);

        if (capturedCells[key]) {
          if (capturedCells[key].options.fillColor !== playerColor) {
            capturedCells[key].setStyle({
              color: playerColor,
              fillColor: playerColor,
              fillOpacity: 0.5
            });
            captured++;
          }
        } else {
          const bounds = getCellBounds(key);
          const rect = L.rectangle(bounds, {
            color: playerColor,
            fillColor: playerColor,
            fillOpacity: 0.5,
            weight: 1
          }).addTo(map);
          capturedCells[key] = rect;
          captured++;
        }

        set(ref(db, `cells/${key}`), {
          color: playerColor,
          owner: playerId
        });
      }
    }
  }

  score += captured;
  updateLeaderboard();

  // Show loop done message then revert to score
  scoreDiv.innerText = `✅ Loop done! +${captured} cells! Total: ${score}`;
  setTimeout(() => {
    scoreDiv.innerText = `Score: ${score} cells`;
  }, 3000);
}

// ─── Firebase Listeners ──────────────────────────

onValue(ref(db, 'cells'), (snapshot) => {
  const data = snapshot.val();
  if (!data) return;

  Object.entries(data).forEach(([key, cell]) => {
    if (capturedCells[key]) {
      const wasMyCell = capturedCells[key].options.fillColor === playerColor;
      const nowEnemyCell = cell.color !== playerColor;

      // Enemy stole my cell — increase their leaderboard score
      if (wasMyCell && nowEnemyCell && cell.owner && cell.owner !== playerId) {
        get(ref(db, `leaderboard/${cell.owner}`)).then(snap => {
          const current = snap.val();
          const currentScore = current ? current.score : 0;
          set(ref(db, `leaderboard/${cell.owner}`), {
            score: currentScore + 1,
            color: cell.color,
            id: cell.owner
          });
        });
      }

      capturedCells[key].setStyle({
        color: cell.color,
        fillColor: cell.color
      });

    } else {
      const bounds = getCellBounds(key);
      const rect = L.rectangle(bounds, {
        color: cell.color,
        fillColor: cell.color,
        fillOpacity: 0.5,
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

    set(ref(db, `players/${playerId}`), {
      lat: latitude,
      lng: longitude,
      color: playerColor
    });

    // Stop after loop completed
    if (loopCompleted) return;

    trailCoords.push([latitude, longitude]);
    polylines[playerId].setLatLngs(trailCoords);

    // ── Loop Detection ──
    if (trailCoords.length > 15) {

      // Method 1 — Trail crosses itself
      const intersectIndex = detectSelfIntersection(trailCoords);
      if (intersectIndex >= 0) {
        fillEnclosedArea(trailCoords.slice(intersectIndex));
        loopCompleted = true;
        return;
      }

      // Method 2 — Close to start point within 15 meters
      const distToStart = getDistance(
        latitude, longitude,
        trailCoords[0][0], trailCoords[0][1]
      );
      if (distToStart < 15) {
        fillEnclosedArea(trailCoords);
        loopCompleted = true;
        return;
      }
    }

    // Normal walking capture
    captureCell(key);
  },
  (error) => { alert('Location error: ' + error.message); },
  { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
);