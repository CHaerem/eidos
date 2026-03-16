import { state } from './state.js';
import { FURNITURE_CATALOG } from './furniture.js';
import { BOUNDS } from './room.js';

// ─── FURNITURE LIST RENDERING ───

export function renderFurnitureList() {
  const list = document.getElementById('furnList');
  list.innerHTML = '';

  // Slider ranges computed from apartment config bounds (with small margin)
  const xMin = (BOUNDS.minX - 0.1).toFixed(2);
  const xMax = (BOUNDS.maxX + 0.1).toFixed(2);
  const zMin = (BOUNDS.minZ - 0.1).toFixed(2);
  const zMax = (BOUNDS.maxZ + 0.1).toFixed(2);

  for (const item of state.placedItems) {
    const cat = FURNITURE_CATALOG[item.type];
    const sel = item.id === state.selectedItemId;
    const div = document.createElement('div');
    div.className = 'furn-item' + (sel ? ' selected' : '');
    div.innerHTML = `
      <div class="furn-item-header">
        <span onclick="selectFurniture(${item.id})">${cat.name}</span>
        <button class="btn-del" onclick="removeFurniture(${item.id})" title="Slett">&times;</button>
      </div>
      <div class="rot-btns">
        <button class="${item.rotation===0?'active':''}" onclick="rotateFurn(${item.id},0)">0&deg;</button>
        <button class="${item.rotation===90?'active':''}" onclick="rotateFurn(${item.id},90)">90&deg;</button>
        <button class="${item.rotation===180?'active':''}" onclick="rotateFurn(${item.id},180)">180&deg;</button>
        <button class="${item.rotation===270?'active':''}" onclick="rotateFurn(${item.id},270)">270&deg;</button>
      </div>
      <div class="furn-controls">
        <label>X: <span id="fxv_${item.id}">${item.x.toFixed(1)}</span>m</label>
        <label>Z: <span id="fzv_${item.id}">${item.z.toFixed(1)}</span>m</label>
        <input type="range" id="fx_${item.id}" min="${xMin}" max="${xMax}" step="0.05" value="${item.x}" oninput="updateFurnPos(${item.id})">
        <input type="range" id="fz_${item.id}" min="${zMin}" max="${zMax}" step="0.05" value="${item.z}" oninput="updateFurnPos(${item.id})">
      </div>
    `;
    list.appendChild(div);
  }
}

// ─── APARTMENT INFO ───

function populateApartmentInfo() {
  const el = document.getElementById('apartment-info');
  if (!el) return;

  const cfg = state.apartmentConfig;
  if (!cfg) {
    el.innerHTML = '<span class="lbl">Ingen config lastet</span>';
    return;
  }

  const b = cfg.bounds || {};
  const width = ((b.maxX || 0) - (b.minX || 0)).toFixed(1);
  const depth = ((b.maxZ || 0) - (b.minZ || 0)).toFixed(1);
  const roomCount = (cfg.rooms || []).length;
  const upperRoomCount = (cfg.upperFloor && cfg.upperFloor.rooms || []).length;
  const totalRooms = roomCount + upperRoomCount;
  const floors = cfg.upperFloor ? '2' : '1';

  el.innerHTML = `
    <span class="lbl">Navn:</span><span class="val">${cfg.name || '—'}</span>
    <span class="lbl">Bredde:</span><span class="val">${width} m</span>
    <span class="lbl">Dybde:</span><span class="val">${depth} m</span>
    <span class="lbl">Etasjer:</span><span class="val">${floors}</span>
    <span class="lbl">Rom:</span><span class="val">${totalRooms}</span>
  `;
}

// ─── TAB SWITCHING ───

function initTabs() {
  const tabs = document.querySelectorAll('#panel-tabs .tab');
  const contents = document.querySelectorAll('.tab-content');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;

      // Update tab active states
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Show/hide tab content (display toggle, not DOM removal)
      contents.forEach(c => {
        c.style.display = c.id === `tab-${target}` ? '' : 'none';
      });
    });
  });
}

// ─── PANEL COLLAPSE / EXPAND ───

function initPanelToggle() {
  const panel = document.getElementById('panel');
  const collapseBtn = document.getElementById('panel-collapse');
  const toggleBtn = document.getElementById('panel-toggle');

  if (collapseBtn) {
    collapseBtn.addEventListener('click', () => {
      panel.classList.add('collapsed');
      if (toggleBtn) toggleBtn.style.display = 'flex';
    });
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      panel.classList.remove('collapsed');
      toggleBtn.style.display = 'none';
    });
  }
}

// ─── INIT UI ───

export function initUI() {
  initTabs();
  initPanelToggle();

  // Populate apartment info once config is loaded
  // (called after config load, so may need a slight delay or direct call)
  if (state.apartmentConfig) {
    populateApartmentInfo();
  } else {
    // Retry once after a short delay (config loads async)
    setTimeout(populateApartmentInfo, 500);
  }
}

// Re-export for external calls (e.g. after config loads)
export { populateApartmentInfo };
