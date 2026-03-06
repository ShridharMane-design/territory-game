// Always track trail for loop detection
// Check if current trail crosses itself
if (trailCoords.length > 15) {
  if (detectSelfIntersection(trailCoords)) {
    // Loop detected on full trail!
    fillEnclosedArea(trailCoords.slice(-50));
    trailCoords = [[latitude, longitude]];
    polylines[playerId].setLatLngs(trailCoords);
  }

  // Check if close to start of trail
  const distToStart = getDistance(
    latitude, longitude,
    trailCoords[0][0], trailCoords[0][1]
  );
  if (distToStart < 15 && trailCoords.length > 15) {
    fillEnclosedArea(trailCoords);
    trailCoords = [[latitude, longitude]];
    polylines[playerId].setLatLngs(trailCoords);
  }
}

// Normal cell capture
captureCell(key);