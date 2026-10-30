/** Catalogue of J2ME API families the analyzer recognises (by package prefix, internal `a/b/` form). */
export interface ApiFamily {
  id: string;
  label: string;
  group: '3d' | 'jsr' | 'vendor' | 'core';
  vendor?: string;
  prefixes: string[];
  /** Short note shown in the report. */
  note?: string;
  /** Needs an OpenGL context (X display) in the runtime. */
  needsGl?: boolean;
}

export const API_FAMILIES: ApiFamily[] = [
  { id: 'm3g', label: 'M3G (JSR-184)', group: '3d', prefixes: ['javax/microedition/m3g/'], needsGl: true, note: 'rendered through LWJGL/OpenGL; needs a display (Xvfb) + Mesa' },
  { id: 'mascot', label: 'Mascot Capsule v3', group: '3d', prefixes: ['com/mascotcapsule/'], needsGl: true, note: 'micro3d_gl backend (OpenGL)' },
  { id: 'mascot-v1', label: 'Mascot Capsule (Motorola/Vodafone/J-Phone variants)', group: '3d', prefixes: ['com/motorola/iden/micro3d/', 'com/motorola/graphics/j3d/', 'com/vodafone/v10/graphics/j3d/', 'com/j_phone/amuse/j3d/', 'com/jblend/graphics/j3d/'], needsGl: true },
  { id: 'khronos', label: 'OpenGL ES (JSR-239)', group: '3d', prefixes: ['javax/microedition/khronos/'], needsGl: true },
  { id: 'nokia-m3d', label: 'Nokia M3D', group: '3d', vendor: 'nokia', prefixes: ['com/nokia/mid/m3d/'], needsGl: true },
  { id: 'nokia-ui', label: 'Nokia UI API', group: 'vendor', vendor: 'nokia', prefixes: ['com/nokia/mid/ui/', 'com/nokia/mid/impl/'], note: 'FullCanvas, DirectGraphics, DirectUtils, DeviceControl' },
  { id: 'nokia-sound', label: 'Nokia Sound / MMA extensions', group: 'vendor', vendor: 'nokia', prefixes: ['com/nokia/mid/sound/', 'com/nokia/microedition/media/'] },
  { id: 'nokia-other', label: 'Nokia other (payment, location, IAP)', group: 'vendor', vendor: 'nokia', prefixes: ['com/nokia/mid/payment/', 'com/nokia/mid/location/', 'com/nokia/mid/iapinfo/', 'com/nokia/mid/s40/'] },
  { id: 'sonyericsson', label: 'Sony Ericsson API', group: 'vendor', vendor: 'sonyericsson', prefixes: ['com/sonyericsson/', 'com/sonyericsson'], note: 'KEmulator v2.22 ships no com.sonyericsson classes' },
  { id: 'siemens', label: 'Siemens API', group: 'vendor', vendor: 'siemens', prefixes: ['com/siemens/'] },
  { id: 'motorola', label: 'Motorola API', group: 'vendor', vendor: 'motorola', prefixes: ['com/motorola/', 'com/mot/'] },
  { id: 'samsung', label: 'Samsung API', group: 'vendor', vendor: 'samsung', prefixes: ['com/samsung/'] },
  { id: 'lg', label: 'LG API', group: 'vendor', vendor: 'lg', prefixes: ['com/lge/'] },
  { id: 'sprint', label: 'Sprint PCS API', group: 'vendor', vendor: 'sprint', prefixes: ['com/sprintpcs/'] },
  { id: 'doja', label: 'NTT DoCoMo DoJa', group: 'vendor', vendor: 'doja', prefixes: ['com/nttdocomo/'], note: 'DoJa profile support is limited in KEmulator' },
  { id: 'jphone', label: 'J-Phone / Vodafone / SoftBank', group: 'vendor', vendor: 'jphone', prefixes: ['com/j_phone/', 'com/vodafone/', 'com/jblend/', 'com/mexa/'] },
  { id: 'nec', label: 'NEC / Pantech / other', group: 'vendor', vendor: 'other', prefixes: ['com/nec/', 'com/pantech/', 'com/immersion/'] },
  { id: 'mmapi', label: 'Mobile Media API (JSR-135)', group: 'jsr', prefixes: ['javax/microedition/media/'] },
  { id: 'amms', label: 'Advanced Multimedia (JSR-234)', group: 'jsr', prefixes: ['javax/microedition/amms/'] },
  { id: 'fileconn', label: 'FileConnection (JSR-75)', group: 'jsr', prefixes: ['javax/microedition/io/file/'] },
  { id: 'pim', label: 'PIM (JSR-75)', group: 'jsr', prefixes: ['javax/microedition/pim/'] },
  { id: 'bluetooth', label: 'Bluetooth (JSR-82)', group: 'jsr', prefixes: ['javax/bluetooth/', 'javax/obex/'] },
  { id: 'wma', label: 'Wireless Messaging (JSR-120/205)', group: 'jsr', prefixes: ['javax/wireless/messaging/'] },
  { id: 'location', label: 'Location (JSR-179)', group: 'jsr', prefixes: ['javax/microedition/location/'] },
  { id: 'svg', label: 'Scalable 2D Vector Graphics (JSR-226)', group: 'jsr', prefixes: ['javax/microedition/m2g/', 'org/w3c/dom/svg/'] },
  { id: 'sensor', label: 'Mobile Sensor (JSR-256)', group: 'jsr', prefixes: ['javax/microedition/sensor/'] },
  { id: 'net', label: 'Network (HTTP/socket/datagram)', group: 'core', prefixes: ['javax/microedition/io/Connector', 'javax/microedition/io/HttpConnection', 'javax/microedition/io/SocketConnection', 'javax/microedition/io/DatagramConnection', 'javax/microedition/io/StreamConnection'], note: 'blocked by default in the container (internal network)' },
  { id: 'gamecanvas', label: 'LCDUI game API (GameCanvas, Sprite, LayerManager)', group: 'core', prefixes: ['javax/microedition/lcdui/game/'] },
  { id: 'rms', label: 'Record Management System', group: 'core', prefixes: ['javax/microedition/rms/'] },
  { id: 'lcdui-high', label: 'High-level LCDUI (Form, List, TextBox, Alert)', group: 'core', prefixes: ['javax/microedition/lcdui/Form', 'javax/microedition/lcdui/List', 'javax/microedition/lcdui/TextBox', 'javax/microedition/lcdui/Alert', 'javax/microedition/lcdui/TextField', 'javax/microedition/lcdui/ChoiceGroup'], note: 'TextBox/List are not rendered by the Bridge frontend (see docs/BRIDGE.md)' },
];

/** Prefixes that identify a vendor/optional API: references to classes in these namespaces that
 *  exist neither in the JAR nor in the emulator are predicted ClassNotFoundExceptions. */
export const CHECKED_PREFIXES: string[] = [
  'javax/microedition/', 'javax/bluetooth/', 'javax/obex/', 'javax/wireless/', 'org/w3c/dom/svg/',
  'com/nokia/', 'com/sonyericsson', 'com/siemens/', 'com/motorola/', 'com/mot/', 'com/samsung/', 'com/lge/', 'com/sprintpcs/',
  'com/nttdocomo/', 'com/j_phone/', 'com/vodafone/', 'com/jblend/', 'com/mexa/', 'com/nec/', 'com/pantech/', 'com/immersion/', 'com/mascotcapsule/',
];
