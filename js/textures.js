import * as THREE from 'three';

let _floorTex = null;
let _wallTex = null;
let _ceilTex = null;

// Oak parquet floor texture
export function getFloorTexture() {
  if (_floorTex) return _floorTex;
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Base warm oak color
  ctx.fillStyle = '#C4A87C';
  ctx.fillRect(0, 0, size, size);

  // Draw planks
  const plankH = size / 8; // 8 planks
  for (let i = 0; i < 8; i++) {
    const y = i * plankH;
    // Slight color variation per plank
    const hue = 25 + Math.random() * 10;
    const lightness = 55 + Math.random() * 15;
    ctx.fillStyle = `hsl(${hue}, 40%, ${lightness}%)`;
    ctx.fillRect(0, y + 1, size, plankH - 2);

    // Plank gap line
    ctx.strokeStyle = 'rgba(80, 60, 40, 0.3)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();

    // Wood grain lines
    for (let g = 0; g < 12; g++) {
      const gy = y + 3 + Math.random() * (plankH - 6);
      ctx.strokeStyle = `rgba(120, 85, 50, ${0.05 + Math.random() * 0.1})`;
      ctx.lineWidth = 0.5 + Math.random();
      ctx.beginPath();
      ctx.moveTo(0, gy);
      // Wavy grain
      for (let x = 0; x < size; x += 20) {
        ctx.lineTo(x, gy + (Math.random() - 0.5) * 3);
      }
      ctx.stroke();
    }

    // Vertical stagger joint (every other plank offset)
    if (i % 2 === 0) {
      const jx = size * 0.4 + Math.random() * size * 0.2;
      ctx.strokeStyle = 'rgba(80, 60, 40, 0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(jx, y);
      ctx.lineTo(jx, y + plankH);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3); // Tile 3x3 for realistic plank density
  tex.colorSpace = THREE.SRGBColorSpace;
  _floorTex = tex;
  return tex;
}

// Painted wall texture (subtle)
export function getWallTexture() {
  if (_wallTex) return _wallTex;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#F5F5F0';
  ctx.fillRect(0, 0, size, size);

  // Very subtle noise for painted drywall
  const imgData = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < imgData.data.length; i += 4) {
    const noise = (Math.random() - 0.5) * 6;
    imgData.data[i] += noise;
    imgData.data[i+1] += noise;
    imgData.data[i+2] += noise;
  }
  ctx.putImageData(imgData, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  _wallTex = tex;
  return tex;
}

// Ceiling texture (very smooth, barely visible grain)
export function getCeilingTexture() {
  if (_ceilTex) return _ceilTex;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#F8F8F4';
  ctx.fillRect(0, 0, size, size);

  const imgData = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < imgData.data.length; i += 4) {
    const noise = (Math.random() - 0.5) * 3;
    imgData.data[i] += noise;
    imgData.data[i+1] += noise;
    imgData.data[i+2] += noise;
  }
  ctx.putImageData(imgData, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  tex.colorSpace = THREE.SRGBColorSpace;
  _ceilTex = tex;
  return tex;
}
