// Jaali: the carved lattice screens of South Asian buildings, which let air
// and light through while keeping the room private. Used in two places:
//   - a quiet background lattice on the home screen, and
//   - the safety pattern, a lattice drawn from a connection's safety number
//     so two people can compare it at a glance.

const NS = 'http://www.w3.org/2000/svg';

export function jaaliTile(stroke = '#2a3160', size = 44) {
  const c = size / 2;
  const s = size * 0.2; // half side of the square
  const d = s * Math.SQRT2; // half diagonal of the rotated square
  const lines = [
    // two squares make the eight-point star
    `M${c - s} ${c - s}h${2 * s}v${2 * s}h${-2 * s}z`,
    `M${c} ${c - d}L${c + d} ${c}L${c} ${c + d}L${c - d} ${c}z`,
    // ties to the neighbouring stars
    `M${c} ${c - d}V0M${c + d} ${c}H${size}M${c} ${c + d}V${size}M${c - d} ${c}H0`,
    `M${c - s} ${c - s}L0 0M${c + s} ${c - s}L${size} 0M${c + s} ${c + s}L${size} ${size}M${c - s} ${c + s}L0 ${size}`,
  ];
  const svg = `<svg xmlns="${NS}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><path d="${lines.join(
    '',
  )}" fill="none" stroke="${stroke}" stroke-width="1.1"/><circle cx="${c}" cy="${c}" r="${s * 0.32}" fill="none" stroke="${stroke}" stroke-width="1.1"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function el(name, attrs) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

/** Arch outline (a pointed mehrab) inside a w x h box. */
export function archPath(w, h) {
  const spring = h * 0.42;
  return `M0 ${h}V${spring}C0 ${h * 0.17} ${w * 0.3} ${h * 0.05} ${w / 2} 0C${w * 0.7} ${h * 0.05} ${w} ${h * 0.17} ${w} ${spring}V${h}Z`;
}

/**
 * Draws the safety pattern for a 32-byte digest. Both people on a
 * connection get the same picture only if their safety numbers match.
 */
export function safetyGlyph(bytes, size = 72) {
  const cells = 8;
  const w = size;
  const h = size * 1.18;
  const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, class: 'safety-glyph', role: 'img' });
  const clipId = 'g' + Math.random().toString(36).slice(2);
  const defs = el('defs', {});
  const clip = el('clipPath', { id: clipId });
  clip.appendChild(el('path', { d: archPath(w, h) }));
  defs.appendChild(clip);
  svg.appendChild(defs);

  const g = el('g', { 'clip-path': `url(#${clipId})` });
  svg.appendChild(g);
  g.appendChild(el('rect', { x: 0, y: 0, width: w, height: h, class: 'g-bg' }));

  const cell = w / cells;
  const top = h - cell * cells - cell * 0.5;
  // 4x4 quadrant from 32 bits, mirrored both ways like a carved screen.
  const bits = [];
  for (let i = 0; i < 4; i++) for (let b = 7; b >= 0; b -= 2) bits.push((bytes[i] >> (b - 1)) & 3);
  const shapes = [];
  for (let r = 0; r < cells; r++) {
    for (let col = 0; col < cells; col++) {
      const qr = r < 4 ? r : cells - 1 - r;
      const qc = col < 4 ? col : cells - 1 - col;
      const v = bits[qr * 4 + qc];
      const cx = col * cell + cell / 2;
      const cy = top + r * cell + cell / 2;
      const k = cell * 0.36;
      if (v === 0) shapes.push(`M${cx - 0.8} ${cy}a0.8 0.8 0 1 0 1.6 0a0.8 0.8 0 1 0 -1.6 0`);
      else if (v === 1) shapes.push(`M${cx} ${cy - k}L${cx + k} ${cy}L${cx} ${cy + k}L${cx - k} ${cy}Z`);
      else if (v === 2) {
        const q = k * 0.72;
        shapes.push(`M${cx - q} ${cy - q}h${2 * q}v${2 * q}h${-2 * q}z`);
        shapes.push(`M${cx} ${cy - k}L${cx + k} ${cy}L${cx} ${cy + k}L${cx - k} ${cy}Z`);
      } else shapes.push(`M${cx - k} ${cy}H${cx + k}M${cx} ${cy - k}V${cy + k}`);
    }
  }
  // Lattice ties between cells.
  const ties = [];
  for (let i = 1; i < cells; i++) {
    ties.push(`M${i * cell} ${top}V${h}`);
    ties.push(`M0 ${top + i * cell}H${w}`);
  }
  g.appendChild(el('path', { d: ties.join(''), class: 'g-ties' }));
  g.appendChild(el('path', { d: shapes.join(''), class: 'g-shapes' }));
  svg.appendChild(el('path', { d: archPath(w, h), class: 'g-outline' }));
  return svg;
}
