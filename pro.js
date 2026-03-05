// Map setup
const map = L.map('map').setView([0, 0], 18);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

// Player marker
let marker = null;
let pathCoords = [];
let polyline = L.polyline([], { color: 'blue' }).addTo(map);

// Grid settings
const GRID_SIZE = 0.0001; // size of each cell in degrees (~10 meters)
let capturedCells = {};
let score = 0;

// Score display
const scoreDiv = document.getElementById('score');

// Convert lat/lng to grid cell key
function getCellKey(lat, lng) {
  const row = Math.floor(lat / GRID_SIZE);
  const col = Math.floor(lng / GRID_SIZE);
  return `${row}_${col}`;
}

// Get cell bounds from key
function getCellBounds(key) {
  const [row, col] = key.split('_').map(Number);
  const lat1 = row * GRID_SIZE;
  const lat2 = lat1 + GRID_SIZE;
  const lng1 = col * GRID_SIZE;
  const lng2 = lng1 + GRID_SIZE;
  return [[lat1, lng1], [lat2, lng2]];
}

// Capture a cell
function captureCell(lat, lng) {
  const key = getCellKey(lat, lng);

  if (!capturedCells[key]) {
    const bounds = getCellBounds(key);
    const rect = L.rectangle(bounds, {
      color: 'blue',
      fillColor: 'blue',
      fillOpacity: 0.4,
      weight: 1
    }).addTo(map);

    capturedCells[key] = rect;
    score++;
    scoreDiv.innerText = `Score: ${score} cells`;
  }
}

// Watch GPS position
navigator.geolocation.watchPosition(
  (position) => {
    const { latitude, longitude, accuracy } = position.coords;

    // Center map on first load
    if (!marker) {
      map.setView([latitude, longitude], 18);
      marker = L.marker([latitude, longitude]).addTo(map);
    } else {
      marker.setLatLng([latitude, longitude]);
    }

    // Draw path
    pathCoords.push([latitude, longitude]);
    polyline.setLatLngs(pathCoords);

    // Capture grid cell
    captureCell(latitude, longitude);
  },
  (error) => {
    alert('Location error: ' + error.message);
  },
  {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 10000
  }
);