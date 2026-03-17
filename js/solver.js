// ─── TIKHONOV-REGULARISED LEAST-SQUARES SOLVER ───
// Computes optimal wall positions and thicknesses from room measurements.
// Pure functions — no DOM, no Three.js, no side effects.

// ─── ADJACENCY BUILDER ───

/**
 * Build adjacency map: for each room+dimension, identify the two boundaries.
 * A boundary is either { type:'ext', value } or { type:'wall', id, sign }.
 * sign: +1 means wall's hi-face borders room, -1 means wall's lo-face borders room.
 */
export function buildAdjacency(rooms, interiorWalls, exterior) {
  const adj = {};
  const tol = 0.10; // tolerance for matching bounds to walls

  for (const room of rooms) {
    const b = room.bounds;

    // Width (X-axis): lo = minX boundary, hi = maxX boundary
    const loX = findBoundary(b.minX, 'x', 'lo', interiorWalls, exterior, tol);
    const hiX = findBoundary(b.maxX, 'x', 'hi', interiorWalls, exterior, tol);
    adj[`${room.id}:width`] = { lo: loX, hi: hiX };

    // Depth (Z-axis): lo = minZ boundary, hi = maxZ boundary
    const loZ = findBoundary(b.minZ, 'z', 'lo', interiorWalls, exterior, tol);
    const hiZ = findBoundary(b.maxZ, 'z', 'hi', interiorWalls, exterior, tol);
    adj[`${room.id}:depth`] = { lo: loZ, hi: hiZ };
  }

  return adj;
}

function findBoundary(coord, axis, side, interiorWalls, exterior, tol) {
  // Check exterior walls first
  const extKey = axis === 'x'
    ? (side === 'lo' ? 'minX' : 'maxX')
    : (side === 'lo' ? 'minZ' : 'maxZ');
  if (Math.abs(coord - exterior[extKey]) < tol) {
    return { type: 'ext', value: exterior[extKey] };
  }

  // Find matching interior wall
  const wallAxis = axis; // wall axis='x' means wall at fixed X
  for (const w of interiorWalls) {
    if (w.axis !== wallAxis) continue;
    if (Math.abs(w.pos - coord) < tol) {
      // sign: if room's lo-boundary matches wall, room is on the hi-side of the wall
      // sign: if room's hi-boundary matches wall, room is on the lo-side of the wall
      const sign = side === 'lo' ? +1 : -1;
      return { type: 'wall', id: w.id, sign };
    }
  }

  // Fallback: treat as exterior (shouldn't happen with correct config)
  return { type: 'ext', value: coord };
}

// ─── SOLVER ───

/**
 * Solve for optimal wall positions and thicknesses.
 *
 * @param {Object} params
 * @param {Array}  params.measurements  - [{ room, dim, value }]
 * @param {Object} params.exterior      - { minX, maxX, minZ, maxZ, thickness }
 * @param {Array}  params.interiorWalls - [{ id, axis, pos }]
 * @param {Array}  params.rooms         - [{ id, bounds }]
 * @param {number} params.defaultWallThickness
 * @param {Object} params.priors        - { wallPositionWeight, wallThicknessWeight }
 * @returns {Object} { wallPositions, wallThicknesses, roomBounds, residuals, rmsResidual }
 */
export function solveConstraints({
  measurements, exterior, interiorWalls, rooms,
  defaultWallThickness = 0.08,
  priors = { wallPositionWeight: 0.1, wallThicknessWeight: 10.0, heightWeight: 1.0 },
  ceilingZones = [],
  upperFloorY = null
}) {
  if (!measurements || measurements.length === 0) {
    return noopResult(interiorWalls, rooms, defaultWallThickness, ceilingZones, upperFloorY);
  }

  const adj = buildAdjacency(rooms, interiorWalls, exterior);

  // Map wall IDs to variable indices
  // x = [pos_0..n-1, thick_0..n-1, floorY, slopeStart, slopeEnd]
  const wallIds = interiorWalls.map(w => w.id);
  const n = wallIds.length;

  // Height variable indices (after wall pos + thick)
  const IDX_FLOOR_Y = 2 * n;
  const IDX_SLOPE_START = 2 * n + 1;
  const IDX_SLOPE_END = 2 * n + 2;
  const numVars = 2 * n + 3; // wall positions + thicknesses + 3 height unknowns

  const wallIdx = {};
  wallIds.forEach((id, i) => {
    wallIdx[id] = i;          // position index
  });

  // Find slope zone for prior values
  const slopeZone = ceilingZones.find(z => z.type === 'slope');

  // Build prior vector
  const xPrior = new Array(numVars).fill(0);
  for (let i = 0; i < n; i++) {
    xPrior[i] = interiorWalls[i].pos;          // position prior = current config
    xPrior[n + i] = defaultWallThickness;       // thickness prior
  }
  xPrior[IDX_FLOOR_Y] = upperFloorY != null ? upperFloorY : 2.25;
  xPrior[IDX_SLOPE_START] = slopeZone ? slopeZone.startHeight : 2.214;
  xPrior[IDX_SLOPE_END] = slopeZone ? slopeZone.endHeight : 4.81;

  // Build A matrix and b vector from measurements
  const validRows = [];
  const bVals = [];
  const rowKeys = []; // track which measurement each row corresponds to

  // Build room ceilingType lookup
  const roomCeilingType = {};
  for (const r of rooms) {
    roomCeilingType[r.id] = r.ceilingType || 'flat';
  }

  for (const m of measurements) {
    // ─── Height constraints ───
    if (m.dim === 'height' || m.dim === 'height_low' || m.dim === 'height_high') {
      const row = new Array(numVars).fill(0);
      const ct = roomCeilingType[m.room];

      if (m.dim === 'height' && ct !== 'slope') {
        row[IDX_FLOOR_Y] = 1;
        validRows.push(row);
        bVals.push(m.value);
        rowKeys.push(`${m.room}:${m.dim}`);
      } else if (m.dim === 'height_low' && ct === 'slope') {
        row[IDX_SLOPE_START] = 1;
        validRows.push(row);
        bVals.push(m.value);
        rowKeys.push(`${m.room}:${m.dim}`);
      } else if (m.dim === 'height_high' && ct === 'slope') {
        row[IDX_SLOPE_END] = 1;
        validRows.push(row);
        bVals.push(m.value);
        rowKeys.push(`${m.room}:${m.dim}`);
      }
      continue;
    }

    // ─── Width/depth constraints ───
    const key = `${m.room}:${m.dim}`;
    const entry = adj[key];
    if (!entry) continue; // unknown room/dim combination

    // Room interior width = hiFace - loFace
    // where face = wallPos + sign * thick/2  (for wall boundaries)
    //       face = extValue                   (for exterior boundaries)
    //
    // Equation: hiFace - loFace = measurement
    // In terms of variables:
    //   For wall boundary { id, sign }:
    //     face = wallPos[id] + sign * wallThick[id] / 2
    //   sign=+1 means room touches the wall's hi face (pos + thick/2)
    //   sign=-1 means room touches the wall's lo face (pos - thick/2)

    const row = new Array(numVars).fill(0);
    let bVal = m.value;

    // hi boundary contributes +face
    if (entry.hi.type === 'wall') {
      const wi = wallIdx[entry.hi.id];
      if (wi === undefined) continue;
      row[wi] += 1;                          // +pos
      row[n + wi] += entry.hi.sign * 0.5;    // +sign*thick/2
    } else {
      bVal += entry.hi.value; // move constant to RHS (but we subtract it from hiFace)
      // Actually: hiFace - loFace = measurement
      // If hiFace is ext: extVal - loFace = measurement → loFace = extVal - measurement
      // Let me rethink the sign convention...
    }

    // Let me redo this more carefully.
    // Equation: hiFace - loFace = measurement
    //
    // For each boundary, face value is:
    //   ext: just the constant value
    //   wall: pos + sign * thick/2
    //
    // So: (hi terms) - (lo terms) = measurement
    // Move constants to RHS:
    //   (hi wall terms) - (lo wall terms) = measurement - (hi ext) + (lo ext)

    // Reset and redo
    row.fill(0);
    bVal = m.value;

    // hi boundary
    if (entry.hi.type === 'wall') {
      const wi = wallIdx[entry.hi.id];
      if (wi === undefined) continue;
      row[wi] += 1;                        // +pos coefficient
      row[n + wi] += entry.hi.sign * 0.5;  // +sign*thick/2 coefficient
    } else {
      // Exterior: constant, move to RHS with negative sign
      bVal -= entry.hi.value; // subtract because hiFace was +extVal
      // Wait: hiFace - loFace = m.value
      // If hi is ext: extVal - loFace = m.value → -loFace = m.value - extVal
      // So bVal for the equation Ax=b needs extVal on the other side
      // Let me think step by step...
    }

    // OK let me use a cleaner formulation.
    // The equation is: hiFace - loFace = m.value
    // Rearranged: (wall terms on LHS) = m.value + (ext terms moved to RHS)
    row.fill(0);
    let rhs = m.value;

    // hi contributes +face to LHS
    if (entry.hi.type === 'wall') {
      const wi = wallIdx[entry.hi.id];
      if (wi === undefined) continue;
      row[wi] += 1;
      row[n + wi] += entry.hi.sign * 0.5;
    } else {
      // hi is exterior: hiFace = entry.hi.value (constant)
      // Move to RHS: rhs = m.value - hiFace (because we're computing hiFace - loFace = m.value)
      // Actually from hiFace - loFace = m.value, if hiFace is constant:
      // -loFace = m.value - entry.hi.value → loFace terms on LHS = entry.hi.value - m.value
      // Hmm this is getting confusing. Let me just build it as sum of signed terms.
      rhs -= entry.hi.value;
    }

    // lo contributes -face to LHS
    if (entry.lo.type === 'wall') {
      const wi = wallIdx[entry.lo.id];
      if (wi === undefined) continue;
      row[wi] -= 1;
      row[n + wi] -= entry.lo.sign * 0.5;
    } else {
      // lo is exterior: loFace = entry.lo.value (constant)
      // Contributes -entry.lo.value to LHS, move to RHS:
      rhs += entry.lo.value;
    }

    // Now row · x = rhs means: hiFace(x) - loFace(x) = m.value
    // where ext constants have been moved to rhs
    // But wait, we need: hiFace - loFace = m.value
    // Let's verify: if hi=wall, lo=ext:
    //   row·x = pos_hi + sign_hi*thick_hi/2 (from hi wall)
    //   rhs = m.value + entry.lo.value (from lo ext)
    //   So: pos_hi + sign_hi*thick_hi/2 = m.value + lo.value
    //   Meaning: hiFace = m.value + loFace ✓ (hiFace - loFace = m.value)

    validRows.push(row);
    bVals.push(rhs);
    rowKeys.push(key);
  }

  const m = validRows.length;
  if (m === 0) {
    return noopResult(interiorWalls, rooms, defaultWallThickness);
  }

  // Build normal equations: N = AᵀA + Λ, z = Aᵀb + Λ·xPrior
  const N = zeros2D(numVars, numVars);
  const z = new Array(numVars).fill(0);

  // AᵀA and Aᵀb
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < numVars; j++) {
      z[j] += validRows[i][j] * bVals[i];
      for (let k = 0; k < numVars; k++) {
        N[j][k] += validRows[i][j] * validRows[i][k];
      }
    }
  }

  // Add regularisation: Λ diagonal + Λ·xPrior
  for (let i = 0; i < numVars; i++) {
    let lambda;
    if (i < n) lambda = priors.wallPositionWeight;
    else if (i < 2 * n) lambda = priors.wallThicknessWeight;
    else lambda = priors.heightWeight || 1.0;
    N[i][i] += lambda;
    z[i] += lambda * xPrior[i];
  }

  // Solve Nx = z via Gaussian elimination with partial pivoting
  const x = gaussSolve(N, z);

  if (!x) {
    console.warn('Solver: singular matrix, returning priors');
    return noopResult(interiorWalls, rooms, defaultWallThickness, ceilingZones, upperFloorY);
  }

  // Extract results
  const wallPositions = {};
  const wallThicknesses = {};
  for (let i = 0; i < n; i++) {
    wallPositions[wallIds[i]] = x[i];
    wallThicknesses[wallIds[i]] = Math.max(0.02, Math.min(0.25, x[n + i])); // clamp
  }

  // Extract height results
  const heights = {
    floorY: x[IDX_FLOOR_Y],
    slopeStart: x[IDX_SLOPE_START],
    slopeEnd: x[IDX_SLOPE_END],
  };

  // Compute room bounds from solved wall positions
  const roomBounds = computeRoomBounds(rooms, adj, wallPositions, wallThicknesses, exterior);

  // Compute residuals
  const residuals = {};
  let sumSqRes = 0;
  for (let i = 0; i < m; i++) {
    let predicted = 0;
    for (let j = 0; j < numVars; j++) {
      predicted += validRows[i][j] * x[j];
    }
    const res = predicted - bVals[i];
    if (rowKeys[i]) {
      residuals[rowKeys[i]] = res;
    }
    sumSqRes += res * res;
  }
  const rmsResidual = Math.sqrt(sumSqRes / Math.max(1, m));

  return { wallPositions, wallThicknesses, heights, roomBounds, residuals, rmsResidual, adjacency: adj };
}

// ─── APPLY TO CONFIG ───

/**
 * Apply solver results back to config (mutates config in place).
 */
export function applyToConfig(config, result) {
  const { wallPositions, wallThicknesses, roomBounds, heights } = result;

  // Update interior wall positions and thicknesses
  if (config.walls && config.walls.interior) {
    for (const w of config.walls.interior) {
      if (wallPositions[w.id] !== undefined) {
        w.pos = wallPositions[w.id];
      }
      if (wallThicknesses[w.id] !== undefined) {
        w.thickness = wallThicknesses[w.id];
      }
    }
  }

  // Update room bounds
  if (config.rooms) {
    for (const room of config.rooms) {
      const nb = roomBounds[room.id];
      if (nb) {
        room.bounds.minX = nb.minX;
        room.bounds.maxX = nb.maxX;
        room.bounds.minZ = nb.minZ;
        room.bounds.maxZ = nb.maxZ;
      }
    }
  }

  // Sync ceiling zones — match zone bounds to room bounds by overlap
  if (config.ceiling && config.ceiling.zones) {
    syncZoneBounds(config.ceiling.zones, config.rooms, config.walls.exterior);
  }

  // Sync upper floor areas
  if (config.upperFloor && config.upperFloor.areas) {
    syncZoneBounds(config.upperFloor.areas, config.rooms, config.walls.exterior);
  }

  // Apply solved heights to ceiling zones and upper floor
  if (heights) {
    // Update flat ceiling zones + upperFloor.floorY
    if (config.upperFloor) {
      config.upperFloor.floorY = heights.floorY;
    }
    if (config.ceiling && config.ceiling.zones) {
      for (const zone of config.ceiling.zones) {
        if (zone.type === 'flat') {
          zone.height = heights.floorY;
        } else if (zone.type === 'slope') {
          zone.startHeight = heights.slopeStart;
          zone.endHeight = heights.slopeEnd;
        }
      }
    }
  }
}

// ─── HELPERS ───

function computeRoomBounds(rooms, adj, wallPos, wallThick, exterior) {
  const bounds = {};
  for (const room of rooms) {
    const wAdj = adj[`${room.id}:width`];
    const dAdj = adj[`${room.id}:depth`];
    if (!wAdj || !dAdj) continue;

    bounds[room.id] = {
      minX: faceValue(wAdj.lo, 'inner', wallPos, wallThick, exterior),
      maxX: faceValue(wAdj.hi, 'inner', wallPos, wallThick, exterior),
      minZ: faceValue(dAdj.lo, 'inner', wallPos, wallThick, exterior),
      maxZ: faceValue(dAdj.hi, 'inner', wallPos, wallThick, exterior),
    };
  }
  return bounds;
}

/**
 * Get the inner face of a boundary (the face that touches the room interior).
 * For exterior: just the value.
 * For wall with sign +1 (room on hi side): inner face = pos + thick/2
 * For wall with sign -1 (room on lo side): inner face = pos - thick/2
 */
function faceValue(boundary, _side, wallPos, wallThick, exterior) {
  if (boundary.type === 'ext') return boundary.value;
  const pos = wallPos[boundary.id];
  const thick = wallThick[boundary.id] || 0.08;
  return pos + boundary.sign * thick / 2;
}

function syncZoneBounds(zones, rooms, exterior) {
  const tol = 0.15;
  for (const zone of zones) {
    if (!zone.bounds) continue;
    for (const room of rooms) {
      // Check if this zone's bounds roughly match a room
      const zb = zone.bounds;
      const rb = room.bounds;
      if (Math.abs(zb.minX - rb.minX) < tol && Math.abs(zb.maxX - rb.maxX) < tol) {
        zb.minX = rb.minX;
        zb.maxX = rb.maxX;
      }
      if (Math.abs(zb.minZ - rb.minZ) < tol && Math.abs(zb.maxZ - rb.maxZ) < tol) {
        zb.minZ = rb.minZ;
        zb.maxZ = rb.maxZ;
      }
    }
  }
}

function noopResult(interiorWalls, rooms, defaultThickness, ceilingZones = [], upperFloorY = null) {
  const wallPositions = {};
  const wallThicknesses = {};
  for (const w of interiorWalls) {
    wallPositions[w.id] = w.pos;
    wallThicknesses[w.id] = w.thickness || defaultThickness;
  }
  const roomBounds = {};
  for (const r of rooms) {
    roomBounds[r.id] = { ...r.bounds };
  }
  const slopeZone = ceilingZones.find(z => z.type === 'slope');
  const heights = {
    floorY: upperFloorY != null ? upperFloorY : 2.25,
    slopeStart: slopeZone ? slopeZone.startHeight : 2.214,
    slopeEnd: slopeZone ? slopeZone.endHeight : 4.81,
  };
  return { wallPositions, wallThicknesses, heights, roomBounds, residuals: {}, rmsResidual: 0, adjacency: {} };
}

function zeros2D(rows, cols) {
  return Array.from({ length: rows }, () => new Array(cols).fill(0));
}

/**
 * Solve Ax = b via Gaussian elimination with partial pivoting.
 * Modifies A and b in place. Returns solution x or null if singular.
 */
function gaussSolve(A, b) {
  const n = b.length;

  for (let col = 0; col < n; col++) {
    // Partial pivoting: find row with largest absolute value in this column
    let maxVal = Math.abs(A[col][col]);
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(A[row][col]) > maxVal) {
        maxVal = Math.abs(A[row][col]);
        maxRow = row;
      }
    }

    if (maxVal < 1e-12) return null; // singular

    // Swap rows
    if (maxRow !== col) {
      [A[col], A[maxRow]] = [A[maxRow], A[col]];
      [b[col], b[maxRow]] = [b[maxRow], b[col]];
    }

    // Eliminate below
    for (let row = col + 1; row < n; row++) {
      const factor = A[row][col] / A[col][col];
      for (let j = col; j < n; j++) {
        A[row][j] -= factor * A[col][j];
      }
      b[row] -= factor * b[col];
    }
  }

  // Back substitution
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = b[i];
    for (let j = i + 1; j < n; j++) {
      sum -= A[i][j] * x[j];
    }
    x[i] = sum / A[i][i];
  }

  return x;
}
