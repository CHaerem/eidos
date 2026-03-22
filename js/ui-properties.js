import { state, onSelectionChange } from './state.js';
import { FURNITURE_CATALOG } from './furniture.js';
import { pushSnapshot } from './history.js';

// ─── PROPERTIES PANEL ───

const ENTITY_LABELS = {
  wall: 'Innervegg',
  window: 'Vindu',
  door: 'Dør',
  protrusion: 'Bjelke/utstikk',
  furniture: 'Møbel',
  room: 'Rom',
};
const ENTITY_ICONS = {
  wall: '▬', window: '▢', door: '🚪', protrusion: '▣', furniture: '🪑', room: '⬚',
};
const DELETABLE_TYPES = new Set(['furniture', 'protrusion']);

export function initPropertiesPanel() {
  onSelectionChange((newEntity, _oldEntity) => {
    renderProperties(newEntity);
  });
}

export function initPropertiesCard() {
  const closeBtn = document.getElementById('properties-card-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      const card = document.getElementById('properties-card');
      if (card) card.style.display = 'none';
      // Clear selection
      if (window.eidos) window.eidos.selectEntity(null, null);
    });
  }
}

export function renderProperties(entity) {
  const card = document.getElementById('properties-card');
  const panel = document.getElementById('properties-panel');
  if (!card || !panel) return;

  if (!entity) {
    card.style.display = 'none';
    panel.innerHTML = '';
    return;
  }

  card.style.display = '';
  const cfg = state.apartmentConfig;
  if (!cfg) return;

  const typeLabel = ENTITY_LABELS[entity.type] || entity.type;
  const icon = ENTITY_ICONS[entity.type] || '';
  const canDelete = DELETABLE_TYPES.has(entity.type);
  let html = `<div class="prop-header">
    <span class="prop-type">${icon} ${typeLabel}</span>
    <div style="display:flex;align-items:center;gap:6px">
      <span class="prop-id">${entity.id}</span>
      ${canDelete ? `<button class="prop-delete" data-entity="${entity.type}" data-id="${entity.id}" title="Slett">✕</button>` : ''}
    </div>
  </div>`;

  // Helper for property row with unit
  const ed = entity.type, eid = entity.id;
  const row = (label, value, field, unit = 'm', step = '0.01') =>
    `<span class="prop-label">${label}</span><div class="prop-input-wrap"><input class="prop-value" type="number" step="${step}" value="${value}" data-entity="${ed}" data-id="${eid}" data-field="${field}"><span class="prop-unit">${unit}</span></div>`;
  const readonlyRow = (label, value) =>
    `<span class="prop-label">${label}</span><input class="prop-value readonly" value="${value}" readonly>`;

  if (entity.type === 'wall') {
    const wall = cfg.walls?.interior?.find(w => w.id === entity.id);
    if (wall) {
      html += `<div class="prop-grid">
        ${readonlyRow('Akse', wall.axis)}
        ${row('Posisjon', wall.pos, 'pos')}
        ${row('Fra', wall.from, 'from')}
        ${row('Til', wall.to, 'to')}
      </div>`;
    }
  } else if (entity.type === 'window') {
    const win = cfg.windows?.find(w => w.id === entity.id);
    if (win) {
      const isH = win.wall === 'south' || win.wall === 'north';
      html += `<div class="prop-grid">
        ${readonlyRow('Vegg', win.wall)}
        ${isH ? row('X1', win.x1, 'x1') + row('X2', win.x2, 'x2') : row('Z1', win.z1, 'z1') + row('Z2', win.z2, 'z2')}
        ${row('Brystning', win.sillHeight, 'sillHeight')}
        ${row('Topp', win.topHeight, 'topHeight')}
      </div>`;
    }
  } else if (entity.type === 'door') {
    const door = cfg.doors?.find(d => d.id === entity.id);
    if (door) {
      html += `<div class="prop-grid">
        ${readonlyRow('Vegg', door.wall)}
        ${row('Fra', door.from, 'from')}
        ${row('Til', door.to, 'to')}
        ${row('Høyde', door.height, 'height')}
      </div>`;
    }
  } else if (entity.type === 'protrusion') {
    const p = cfg.walls?.protrusions?.find(pr => pr.id === entity.id);
    if (p) {
      html += `<div class="prop-grid">
        ${row('Min X', p.bounds.minX, 'bounds.minX')}
        ${row('Max X', p.bounds.maxX, 'bounds.maxX')}
        ${row('Min Z', p.bounds.minZ, 'bounds.minZ')}
        ${row('Max Z', p.bounds.maxZ, 'bounds.maxZ')}
        ${row('Høyde', p.height || '', 'height')}
        ${row('Fra Y', p.fromY || 0, 'fromY')}
      </div>`;
      if (p.note) {
        html += `<div style="margin-top:6px;font-size:10px;color:rgba(255,255,255,0.25);font-style:italic">${p.note}</div>`;
      }
    }
  } else if (entity.type === 'furniture') {
    const item = state.placedItems.find(i => String(i.id) === entity.id);
    if (item) {
      const cat = FURNITURE_CATALOG[item.type];
      html += `<div class="prop-grid">
        ${readonlyRow('Type', cat?.name || item.type)}
        ${row('X', item.x.toFixed(2), 'x', 'm', '0.05')}
        ${row('Z', item.z.toFixed(2), 'z', 'm', '0.05')}
        ${row('Rotasjon', item.rotation, 'rotation', '°', '90')}
      </div>`;
    }
  }

  panel.innerHTML = html;

  // Attach change handlers to editable inputs
  panel.querySelectorAll('.prop-value:not(.readonly)').forEach(input => {
    input.addEventListener('change', handlePropertyChange);
  });

  // Attach delete handler
  const deleteBtn = panel.querySelector('.prop-delete');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      const type = deleteBtn.dataset.entity;
      const id = deleteBtn.dataset.id;
      pushSnapshot(`Slett ${ENTITY_LABELS[type] || type} ${id}`);
      if (type === 'furniture') {
        const { removeFurniture } = await import('./interaction.js');
        removeFurniture(parseInt(id));
      } else if (type === 'protrusion') {
        const arr = cfg.walls?.protrusions;
        if (arr) {
          const idx = arr.findIndex(p => p.id === id);
          if (idx >= 0) arr.splice(idx, 1);
        }
        if (window.eidos) await window.eidos.rebuild(false);
      }
      renderProperties(null);
    });
  }
}

export async function handlePropertyChange(e) {
  if (!state.editMode) return; // Guard: no edits outside edit mode
  const input = e.target;
  const entityType = input.dataset.entity;
  const entityId = input.dataset.id;
  const field = input.dataset.field;
  const value = parseFloat(input.value);
  if (isNaN(value)) return;

  const cfg = state.apartmentConfig;
  pushSnapshot(`Endre ${ENTITY_LABELS[entityType] || entityType} ${entityId} ${field}`);

  if (entityType === 'wall') {
    const wall = cfg.walls?.interior?.find(w => w.id === entityId);
    if (wall) wall[field] = value;
  } else if (entityType === 'window') {
    const win = cfg.windows?.find(w => w.id === entityId);
    if (win) win[field] = value;
  } else if (entityType === 'door') {
    const door = cfg.doors?.find(d => d.id === entityId);
    if (door) door[field] = value;
  } else if (entityType === 'protrusion') {
    const p = cfg.walls?.protrusions?.find(pr => pr.id === entityId);
    if (p) {
      if (field.startsWith('bounds.')) {
        const subField = field.split('.')[1];
        p.bounds[subField] = value;
      } else {
        p[field] = value;
      }
    }
  } else if (entityType === 'furniture') {
    const item = state.placedItems.find(i => String(i.id) === entityId);
    if (item) {
      if (field === 'rotation') {
        const { rotateFurn } = await import('./interaction.js');
        rotateFurn(item.id, value % 360);
        return;
      }
      item[field] = value;
      item.mesh.position.set(item.x, 0, item.z);
      const { saveFurnitureToConfig } = await import('./furniture.js');
      saveFurnitureToConfig();
      renderProperties({ type: entityType, id: entityId });
      return;
    }
  }

  // Rebuild and re-select for architecture changes
  if (entityType !== 'furniture') {
    await window.eidos.rebuild(false);
    // Use eidos API to re-select (avoids circular import)
    window.eidos.selectEntity(entityType, entityId);
  }
}
