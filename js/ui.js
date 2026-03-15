import { state } from './state.js';
import { FURNITURE_CATALOG } from './furniture.js';

// ─── FURNITURE LIST RENDERING ───

export function renderFurnitureList() {
  const list = document.getElementById('furnList');
  list.innerHTML = '';
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
        <button class="${item.rotation===0?'active':''}" onclick="rotateFurn(${item.id},0)">0°</button>
        <button class="${item.rotation===90?'active':''}" onclick="rotateFurn(${item.id},90)">90°</button>
        <button class="${item.rotation===180?'active':''}" onclick="rotateFurn(${item.id},180)">180°</button>
        <button class="${item.rotation===270?'active':''}" onclick="rotateFurn(${item.id},270)">270°</button>
      </div>
      <div class="furn-controls">
        <label>X: <span id="fxv_${item.id}">${item.x.toFixed(1)}</span>m</label>
        <label>Z: <span id="fzv_${item.id}">${item.z.toFixed(1)}</span>m</label>
        <input type="range" id="fx_${item.id}" min="-4.5" max="4.5" step="0.05" value="${item.x}" oninput="updateFurnPos(${item.id})">
        <input type="range" id="fz_${item.id}" min="-2.6" max="2.6" step="0.05" value="${item.z}" oninput="updateFurnPos(${item.id})">
      </div>
    `;
    list.appendChild(div);
  }
}

// ─── INIT UI ───

export function initUI() {
  // Section toggle
  window.toggleSection = function(header) {
    header.parentElement.classList.toggle('collapsed');
  };
}
