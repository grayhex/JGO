import { EMULATED_DEVICES, PHONE_COMPATIBILITY, javaPreset, type DevicePreset, type PhoneCatalog, type SymbianStatus } from '@mgo/protocol';

/** Catalog readiness uses the installed firmware, independently of the artwork. */
export function phoneCatalog(presets: readonly DevicePreset[], status: SymbianStatus): PhoneCatalog {
  return {
    devices: EMULATED_DEVICES, compatibility: PHONE_COMPATIBILITY,
    availability: EMULATED_DEVICES.map(device => {
      if (device.engine === 'kemulator') return { deviceId: device.id, available: !!javaPreset(device, presets), ...(!javaPreset(device, presets) ? { code: 'devices_unavailable', message: `Required KEmulator preset unavailable: ${device.presetId}` } : {}) };
      const available = status.configured && status.reachable && status.firmware.devices.some(d => d.code.toLowerCase() === device.firmware.product.toLowerCase());
      return { deviceId: device.id, available, ...(!available ? { code: !status.reachable ? 'symbian_unavailable' : 'device_missing', message: `EKA2L1 requires installed firmware for ${device.name} (${device.firmware.product}, ${device.firmware.os}). The skin does not install firmware.` } : {}) };
    }),
  };
}
