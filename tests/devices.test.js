import { describe, it, expect } from 'vitest'
import { DEVICES, deviceDims } from '../src/core/devices.js'

const DEVICE_NAMES = ['phone', 'tablet', 'laptop', 'browser']
const REQUIRED_KEYS = [
  'name',
  'width',
  'height',
  'cornerRadius',
  'bezel',
  'screenRadius',
  'layers',
  'hasNotch',
  'thickness',
]
const LAYER_ORDER = ['shell', 'body', 'screen', 'glass']

describe('DEVICES', () => {
  it('has all four devices', () => {
    expect(Object.keys(DEVICES).sort()).toEqual(DEVICE_NAMES.sort())
  })

  it.each(DEVICE_NAMES)('%s has all required keys', (name) => {
    const device = DEVICES[name]
    for (const key of REQUIRED_KEYS) {
      expect(device).toHaveProperty(key)
    }
    expect(device.name).toBe(name)
    expect(typeof device.width).toBe('number')
    expect(typeof device.height).toBe('number')
    expect(device.bezel).toEqual(
      expect.objectContaining({
        top: expect.any(Number),
        right: expect.any(Number),
        bottom: expect.any(Number),
        left: expect.any(Number),
      })
    )
  })

  it.each(DEVICE_NAMES)('%s orders layers back to front: shell, body, screen, glass', (name) => {
    const device = DEVICES[name]
    expect(device.layers.map((l) => l.id)).toEqual(LAYER_ORDER)
    for (const layer of device.layers) {
      expect(typeof layer.depth).toBe('number')
    }
  })

  it('phone width is the 300 reference unit', () => {
    expect(DEVICES.phone.width).toBe(300)
  })

  it('only laptop declares lidAngle', () => {
    expect(DEVICES.laptop.lidAngle).toBeTypeOf('number')
    expect(DEVICES.phone.lidAngle).toBeUndefined()
    expect(DEVICES.tablet.lidAngle).toBeUndefined()
    expect(DEVICES.browser.lidAngle).toBeUndefined()
  })

  it.each(DEVICE_NAMES)('%s has a positive thickness', (name) => {
    expect(DEVICES[name].thickness).toBeTypeOf('number')
    expect(DEVICES[name].thickness).toBeGreaterThan(0)
  })

  it('laptop is thicker than phone (thickest body vs thinnest)', () => {
    expect(DEVICES.laptop.thickness).toBeGreaterThan(DEVICES.phone.thickness)
  })
})

describe('deviceDims', () => {
  it('returns native dims in portrait for phone', () => {
    const dims = deviceDims(DEVICES.phone, 'portrait')
    expect(dims).toEqual({ width: DEVICES.phone.width, height: DEVICES.phone.height })
  })

  it('swaps width/height in landscape for phone', () => {
    const dims = deviceDims(DEVICES.phone, 'landscape')
    expect(dims).toEqual({ width: DEVICES.phone.height, height: DEVICES.phone.width })
  })

  it('swaps width/height in landscape for tablet', () => {
    const dims = deviceDims(DEVICES.tablet, 'landscape')
    expect(dims).toEqual({ width: DEVICES.tablet.height, height: DEVICES.tablet.width })
  })

  it('does not swap for laptop regardless of orientation', () => {
    const dims = deviceDims(DEVICES.laptop, 'landscape')
    expect(dims).toEqual({ width: DEVICES.laptop.width, height: DEVICES.laptop.height })
  })

  it('does not swap for browser regardless of orientation', () => {
    const dims = deviceDims(DEVICES.browser, 'landscape')
    expect(dims).toEqual({ width: DEVICES.browser.width, height: DEVICES.browser.height })
  })
})
