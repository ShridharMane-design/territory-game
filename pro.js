import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, onValue, onDisconnect } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

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

const GRID_SIZE = 0.0001;
let capturedCells = {};
let score = 0;

const scoreDiv = document.getElementById('score');
const playerInfoDiv = document.getElementById('playerInfo');
playerInfoDiv.innerText = `You are: ${playerId} (${playerColor})`;
playerInfoDiv.style.background = playerColor;

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

function captureCell(key) {
  if (capturedCells[key]) {
    // Enemy cell — steal it!
    if (capturedCells[key].options.fillColor !== playerColor) {
      capturedCells[key].setStyle({
        color: playerColor,
        fillColor: playerColor,
        fillOpacity: 0.5
      });
      score++;
    }
  } else {
    // Empty cell — capture it!
    const bounds = getCellBounds(key);
    const rect = L.rectangle(bounds, {
      color: playerColor,
      fillColor: playerColor,
      fillOpacity: 0.5,
      weight: 1
    }).addTo(map);
    capturedCells[key] = rect;
    score++;
  }

  set(ref(db, `cells/${key}`), {
    color: playerColor,
    owner: playerId
  });

  set(ref(db, `leaderboard/${playerId}`), {
    score: score,
    color: playerColor,
    id: playerId
  });

  scoreDiv.innerText = `Score: ${score} cells`;
}

// Listen for all cells
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
        fillOpacity: 0.5,
        weight: 1
      }).addTo(map);
      capturedCells[key] = rect;
    }
  });
});

// Listen for all players
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
      polylines[id] = L.polyline([], {
        color: player.color,
        weight: 4,
        opacity: 1
      }).addTo(map);
    } else {
      markers[id].setLatLng([player.lat, player.lng]);
    }
  });
});

// GPS Tracking
navigator.geolocation.watchPosition(
  (position) => {
    const { latitude, longitude } = position.coords;
    const key = getCellKey(latitude, longitude);

    if (!markers[playerId]) {
      map.setView([latitude, longitude], 18);
      markers[playerId] = L.marker([latitude, longitude]).addTo(map);
      polylines[playerId] = L.polyline([], {
        color: playerColor,
        weight: 4,
        opacity: 1
      }).addTo(map);
    } else {
      markers[playerId].setLatLng([latitude, longitude]);
      map.panTo([latitude, longitude]);
    }

    set(ref(db, `players/${playerId}`), {
      lat: latitude,
      lng: longitude,
      color: playerColor
    });

    trailCoords.push([latitude, longitude]);
    polylines[playerId].setLatLngs(trailCoords);

    captureCell(key);
  },
  (error) => { alert('Location error: ' + error.message); },
  { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
);
