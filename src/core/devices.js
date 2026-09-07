// Parametric device specs — the single source of truth for both the CSS and
// WebGL renderers. Abstract units, phone width = 300.
//
// Layers are always ordered back -> front: shell, body, screen, glass.
// `depth` is the layer's static Z offset (px); animation/explode adds on top
// of it per-layer in the renderer.

const LAYER_DEPTHS = { shell: 0, body: 4, screen: 8, glass: 12 }

function layerStack() {
  return Object.entries(LAYER_DEPTHS).map(([id, depth]) => ({ id, depth }))
}

export const DEVICES = {
  phone: {
    name: 'phone',
    width: 300,
    height: 650,
    cornerRadius: 40,
    bezel: { top: 14, right: 8, bottom: 14, left: 8 },
    screenRadius: 30,
    layers: layerStack(),
    hasNotch: true,
    thickness: 8,
  },
  tablet: {
    name: 'tablet',
    width: 480,
    height: 640,
    cornerRadius: 28,
    bezel: { top: 24, right: 24, bottom: 24, left: 24 },
    screenRadius: 8,
    layers: layerStack(),
    hasNotch: false,
    thickness: 10,
  },
  laptop: {
    name: 'laptop',
    width: 820,
    height: 520,
    cornerRadius: 18,
    bezel: { top: 20, right: 14, bottom: 14, left: 14 },
    screenRadius: 6,
    layers: layerStack(),
    hasNotch: false,
    lidAngle: 110,
    thickness: 14,
  },
  browser: {
    name: 'browser',
    width: 800,
    height: 520,
    cornerRadius: 10,
    bezel: { top: 36, right: 0, bottom: 0, left: 0 },
    screenRadius: 0,
    layers: layerStack(),
    hasNotch: false,
    thickness: 6,
  },
}

const ORIENTABLE = new Set(['phone', 'tablet'])

/**
 * @param {typeof DEVICES[keyof typeof DEVICES]} device
 * @param {'portrait'|'landscape'} orientation
 * @returns {{width: number, height: number}}
 */
export function deviceDims(device, orientation) {
  const swap = orientation === 'landscape' && ORIENTABLE.has(device.name)
  return swap
    ? { width: device.height, height: device.width }
    : { width: device.width, height: device.height }
}
