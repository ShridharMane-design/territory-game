import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, onValue, remove, onDisconnect } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

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

// Player setup — permanent ID per phone
const playerId = localStorage.getItem('playerId') || 'player_' + Math.floor(Math.random() * 10000);
localStorage.setItem('playerId', playerId);

const COLORS = ['blue', 'red', 'green', 'orange'];
const colorIndex = parseInt(playerId.split('_')[1]) % COLORS.length;
let playerColor = COLORS[colorIndex];

// Auto remove player when they close the app
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
let pathCoords = [];

// Grid settings
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
  const lat1 = row * GRID_SIZE;
  const lat2 = lat1 + GRID_SIZE;
  const lng1 = col * GRID_SIZE;
  const lng2 = lng1 + GRID_SIZE;
  return [[lat1, lng1], [lat2, lng2]];
}

// Listen for all players territory
onValue(ref(db, 'cells'), (snapshot) => {
  const data = snapshot.val();
  if (!data) return;
  Object.entries(data).forEach(([key, cell]) => {
    if (!capturedCells[key]) {
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

// Listen for all players positions
onValue(ref(db, 'players'), (snapshot) => {
  const data = snapshot.val();

  // Remove markers for players no longer in database
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

// Watch own GPS
navigator.geolocation.watchPosition(
  (position) => {
    const { latitude, longitude } = position.coords;

    if (!markers[playerId]) {
      map.setView([latitude, longitude], 18);
      markers[playerId] = L.marker([latitude, longitude]).addTo(map);
      polylines[playerId] = L.polyline([], { color: playerColor }).addTo(map);
    } else {
      markers[playerId].setLatLng([latitude, longitude]);
    }

    pathCoords.push([latitude, longitude]);
    polylines[playerId].setLatLngs(pathCoords);

    // Update position in Firebase
    set(ref(db, `players/${playerId}`), {
      lat: latitude,
      lng: longitude,
      color: playerColor
    });

    // Capture cell
    const key = getCellKey(latitude, longitude);
    if (!capturedCells[key]) {
      set(ref(db, `cells/${key}`), {
        color: playerColor,
        owner: playerId
      });
      score++;
      scoreDiv.innerText = `Score: ${score} cells`;
    }
  },
  (error) => { alert('Location error: ' + error.message); },
  { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
);


