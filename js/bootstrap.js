import { registerPWA } from './modules/pwa.js';
import { storage } from './core/storage.js';
import { events } from './core/events.js';
import { logger } from './utils/logger.js';
window.IPTV = window.IPTV || {};
Object.assign(window.IPTV,{storage,events,logger});
registerPWA();
