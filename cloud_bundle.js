// ==UserScript==
// @name         حصاد مظبوط المدمج
// @namespace    https://supreme-farm.local
// @version      2.1.0
// @description  نظام المزرعة الذكي - معمارية التوسعة اللانهائية
// @author       Supreme Farm Team
// @match        *://*.centurygames.com/*
// @match        *://*.apps.fbsbx.com/*
// @match        *://apps.facebook.com/familyfarm*
// @match        *://*.familyfarm.com/*
// @match        *://ff-us.centurygames.com/*
// @match        *://farmbot-vip.online/*
// @match        *://*.farmbot-vip.online/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-end
// ==/UserScript==

var SF = window.SF || {};
window.SF = SF;

// --- File: core/EventBus.js ---
// --- core\EventBus.js ---
window.SF = window.SF || {};

SF.EventBus = class EventBus {
    constructor() {
        this.events = {};
    }
    on(event, callback) {
        if (!this.events[event]) this.events[event] = [];
        this.events[event].push(callback);
    }
    off(event, callback) {
        if (!this.events[event]) return;
        this.events[event] = this.events[event].filter(cb => cb !== callback);
    }
    emit(event, data) {
        if (!this.events[event]) return;
        this.events[event].forEach(cb => {
            try { cb(data); } catch (e) { console.error(`[EventBus] Error in ${event}:`, e); }
        });
    }
};

// Initialize global EventBus
SF.bus = new SF.EventBus();




// --- File: core/ModuleBase.js ---
// --- core\ModuleBase.js ---
window.SF = window.SF || {};

SF.ModuleBase = class ModuleBase {
    constructor(id, name, icon) {
        this.id = id;
        this.name = name;
        this.icon = icon;
        this.container = null;
    }

    // Called by UI Manager when the tab is clicked and content area is created
    init(container) {
        this.container = container;
        this.container.innerHTML = this.render();
        this.bindEvents();
    }

    // Returns HTML string for the module
    render() {
        return `<div>محتوى ${this.name}</div>`;
    }

    // Bind DOM events for the rendered HTML
    bindEvents() {}

    // Called when the tab becomes active, useful for refreshing data
    update() {}
};




// --- File: core/ModuleManager.js ---
// --- core\ModuleManager.js ---
window.SF = window.SF || {};

SF.ModuleManager = class ModuleManager {
    constructor() {
        this.modules = [];
    }

    // Register a new module dynamically
    register(moduleInstance) {
        if (!(moduleInstance instanceof SF.ModuleBase)) {
            console.error('[ModuleManager] Cannot register module: must inherit from SF.ModuleBase', moduleInstance);
            return;
        }

        // Prevent duplicate IDs
        if (this.modules.find(m => m.id === moduleInstance.id)) {
            console.warn(`[ModuleManager] Module with ID ${moduleInstance.id} is already registered.`);
            return;
        }

        this.modules.push(moduleInstance);
        console.log(`[ModuleManager] Registered Module: ${moduleInstance.name}`);

        // If UI is already initialized, we can dynamically add the tab
        if (SF.ui) {
            SF.ui.addModuleTab(moduleInstance);
        }
    }

    getModules() {
        return this.modules;
    }
};

// Global instance
SF.modules = new SF.ModuleManager();




// --- File: core/StorageManager.js ---
// --- core\StorageManager.js ---
window.SF = window.SF || {};

SF.StorageManager = class StorageManager {
    static get(key, defaultVal) {
        try {
            // Support running outside userscript context for testing
            if (typeof GM_getValue !== 'undefined') {
                let val = GM_getValue(key);
                return val ? JSON.parse(val) : defaultVal;
            }
            let val = localStorage.getItem(key);
            return val ? JSON.parse(val) : defaultVal;
        } catch(e) { return defaultVal; }
    }

    static set(key, val) {
        if (typeof GM_setValue !== 'undefined') {
            GM_setValue(key, JSON.stringify(val));
        } else {
            localStorage.setItem(key, JSON.stringify(val));
        }
    }

    // IndexedDB wrapper for large data (sessions, configs)
    static async openDB(dbName = 'SupremeFarm', version = 1) {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(dbName, version);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
                if (!db.objectStoreNames.contains('configs')) db.createObjectStore('configs', { keyPath: 'id' });
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    static async dbPut(storeName, data) {
        const db = await this.openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.put(data);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    static async dbGetAll(storeName) {
        const db = await this.openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
};




// --- File: network/NetworkInterceptor.js ---
// --- network\NetworkInterceptor.js ---
window.SF = window.SF || {};

SF.NetworkInterceptor = class NetworkInterceptor {
    constructor() {
        this.stats = { totalRequests: 0, totalBytes: 0, gameRequests: 0, startTime: Date.now() };
        this.installed = false;
    }

    install() {
        if (this.installed) return;
        this.installed = true;
        this._interceptXHR();
        this._interceptFetch();
        console.log('[SupremeFarm Modular] Network interceptor installed');
    }

    _isGameApi(url) {
        if (!url) return false;
        const urlStr = url.toString().toLowerCase();
        return urlStr.includes('farm-us') || 
               urlStr.includes('centurygames') || 
               urlStr.includes('akamaized') ||
               urlStr.includes('api.php') ||
               urlStr.includes('gateway.php') ||
               urlStr.includes('index.php');
    }

    _interceptXHR() {
        const originalXHR = unsafeWindow.XMLHttpRequest || window.XMLHttpRequest;
        if (!originalXHR) return;

        const originalOpen = originalXHR.prototype.open;
        const originalSend = originalXHR.prototype.send;
        const self = this;

        originalXHR.prototype.open = function(method, url) {
            this._sf_method = method;
            this._sf_url = url;
            return originalOpen.apply(this, arguments);
        };

        originalXHR.prototype.send = function(body) {
            const reqTime = Date.now();
            const isGame = self._isGameApi(this._sf_url);

            self.stats.totalRequests++;
            if (isGame) self.stats.gameRequests++;

            SF.bus.emit('network:request', {
                url: this._sf_url,
                method: this._sf_method,
                body: body,
                timestamp: reqTime,
                isGame
            });

            this.addEventListener('load', function() {
                const duration = Date.now() - reqTime;
                let size = 0;
                if (this.response) {
                    if (typeof this.response === 'string') size = this.response.length;
                    else if (this.response.byteLength) size = this.response.byteLength;
                }
                self.stats.totalBytes += size;

                SF.bus.emit('network:response', {
                    url: this._sf_url,
                    status: this.status,
                    response: this.response,
                    responseType: this.responseType,
                    timestamp: Date.now(),
                    duration,
                    size,
                    isGame
                });
            });

            return originalSend.apply(this, arguments);
        };
    }

    _interceptFetch() {
        const originalFetch = unsafeWindow.fetch || window.fetch;
        if (!originalFetch) return;

        const self = this;
        (unsafeWindow || window).fetch = async function() {
            const args = arguments;
            const url = args[0] instanceof Request ? args[0].url : args[0];
            const method = (args[1] && args[1].method) || 'GET';
            const reqTime = Date.now();
            const isGame = self._isGameApi(url);

            self.stats.totalRequests++;
            if (isGame) self.stats.gameRequests++;

            SF.bus.emit('network:request', { url, method, timestamp: reqTime, isGame });

            try {
                const response = await originalFetch.apply(this, args);
                const clone = response.clone();

                clone.text().then(text => {
                    const duration = Date.now() - reqTime;
                    self.stats.totalBytes += text.length;

                    SF.bus.emit('network:response', {
                        url,
                        status: clone.status,
                        response: text,
                        responseType: 'text',
                        timestamp: Date.now(),
                        duration,
                        size: text.length,
                        isGame
                    });
                }).catch(e => {});

                return response;
            } catch (error) {
                throw error;
            }
        };
    }

    getStats() { return this.stats; }
};

// Auto-install upon load
SF.netMonitor = new SF.NetworkInterceptor();
SF.netMonitor.install();




// --- File: network/GameDataExtractor.js ---
// --- network\GameDataExtractor.js ---
window.SF = window.SF || {};

SF.GameDataExtractor = class GameDataExtractor {
    constructor() {
        this.playerInfo = { snsId: 'غير معروف', level: 0, coins: 0, diamonds: 0 };

        SF.bus.on('network:request', (req) => {
            if (req.url && typeof req.url === 'string') {
                const snsMatch = req.url.match(/snsid["']?\s*[:=]\s*["']?(\d+)/i);
                if (snsMatch && snsMatch[1]) {
                    this.playerInfo.snsId = snsMatch[1];
                    SF.bus.emit('player:update', this.playerInfo);
                }
            }
        });

        SF.bus.on('network:response', (res) => {
            if (!res.isGame || !res.response) return;
            try {
                if (typeof res.response === 'string' && res.response.startsWith('{')) {
                    const data = JSON.parse(res.response);
                    if (data.data && data.data.player) {
                        if (data.data.player.level) this.playerInfo.level = data.data.player.level;
                        if (data.data.player.coins) this.playerInfo.coins = data.data.player.coins;
                        if (data.data.player.cash) this.playerInfo.diamonds = data.data.player.cash;
                        SF.bus.emit('player:update', this.playerInfo);
                    }
                }
            } catch(e) {}
        });
    }
};

// Auto-initialize
SF.dataExtractor = new SF.GameDataExtractor();




// --- File: ui/Styles.js ---
// --- ui\Styles.js ---
window.SF = window.SF || {};

SF.Styles = `
    :root {
        --sf-bg: rgba(13, 17, 23, 0.98);
        --sf-card: rgba(22, 27, 34, 0.8);
        --sf-border: #444;
        --sf-primary: #3498db;
        --sf-primary-hover: #2980b9;
        --sf-accent: #f1c40f;
        --sf-success: #2ecc71;
        --sf-error: #e74c3c;
        --sf-text: #ecf0f1;
        --sf-text-muted: #95a5a6;
    }

    /* Fixed Top Bar for Script Buttons */
    #sf-top-bar {
        position: fixed;
        top: 0;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        z-index: 2147483647;
    }

    .sf-menu-btn {
        background: linear-gradient(180deg, var(--sf-primary), var(--sf-primary-hover));
        border: 1px solid #2980b9;
        color: #fff;
        padding: 6px 15px;
        border-bottom-left-radius: 8px;
        border-bottom-right-radius: 8px;
        cursor: pointer;
        font-weight: bold;
        font-size: 13px;
        box-shadow: 0 4px 10px rgba(0,0,0,0.5);
    }

    .sf-menu-btn:hover {
        background: linear-gradient(180deg, var(--sf-primary-hover), var(--sf-primary));
    }

    .sf-dropdown-menu {
        background: rgba(0, 0, 0, 0.85);
        border: 1px solid var(--sf-border);
        border-radius: 8px;
        padding: 5px;
        display: flex;
        flex-direction: column;
        gap: 5px;
        margin-top: 5px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.6);
        backdrop-filter: blur(5px);
        transition: opacity 0.2s;
    }

    .sf-dropdown-menu.sf-hidden {
        display: none !important;
    }

    /* Top Bar Buttons */
    .sf-tab {
        background: linear-gradient(180deg, #2c3e50, #1a252f);
        border: 1px solid #34495e;
        color: #ecf0f1;
        padding: 8px 15px;
        border-radius: 6px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        font-weight: bold;
        font-size: 13px;
        transition: all 0.2s;
        text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.1), 0 2px 4px rgba(0,0,0,0.4);
    }

    .sf-tab:hover {
        background: linear-gradient(180deg, #34495e, #2c3e50);
        transform: translateY(-1px);
    }

    .sf-tab.active {
        background: linear-gradient(180deg, var(--sf-primary), var(--sf-primary-hover));
        border-color: #2980b9;
        box-shadow: inset 0 2px 4px rgba(0,0,0,0.3);
    }

    /* Main Application Panel (Fixed Center) */
    #sf-app {
        position: fixed;
        top: 60px;
        left: 50%;
        transform: translateX(-50%);
        width: 750px;
        max-height: 85vh;
        background: var(--sf-bg);
        border: 2px solid var(--sf-primary);
        border-radius: 12px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.8);
        z-index: 2147483646;
        display: flex;
        flex-direction: column;
        color: var(--sf-text);
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        direction: rtl;
        overflow: hidden;
        transition: opacity 0.3s ease, transform 0.3s ease;
    }

    #sf-app.sf-hidden {
        display: none !important;
    }

    /* Header */
    .sf-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 15px;
        background: linear-gradient(180deg, rgba(52, 152, 219, 0.2), rgba(0,0,0,0.4));
        border-bottom: 1px solid var(--sf-border);
    }

    .sf-title {
        font-size: 16px;
        font-weight: bold;
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--sf-primary);
    }

    .sf-controls button {
        background: rgba(231, 76, 60, 0.2);
        border: 1px solid var(--sf-error);
        color: var(--sf-error);
        cursor: pointer;
        font-size: 14px;
        padding: 4px 12px;
        border-radius: 4px;
        transition: all 0.2s;
        font-weight: bold;
    }
    .sf-controls button:hover {
        background: var(--sf-error);
        color: white;
    }

    /* Content Area */
    .sf-content {
        flex: 1;
        padding: 15px;
        overflow-y: auto;
        position: relative;
    }
    .sf-content::-webkit-scrollbar { width: 8px; }
    .sf-content::-webkit-scrollbar-thumb { background: var(--sf-primary); border-radius: 4px; }
    .sf-content::-webkit-scrollbar-track { background: rgba(0,0,0,0.3); }

    /* Module Views */
    .sf-module {
        display: none;
        animation: sf-fadeIn 0.3s;
    }
    .sf-module.active {
        display: block;
    }

    @keyframes sf-fadeIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
    }

    /* Generic UI Components */
    .sf-card {
        background: var(--sf-card);
        border: 1px solid var(--sf-border);
        border-radius: 8px;
        padding: 15px;
        margin-bottom: 15px;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);
    }
    .sf-card-title {
        margin: 0 0 15px 0;
        font-size: 15px;
        color: var(--sf-accent);
        border-bottom: 1px solid var(--sf-border);
        padding-bottom: 5px;
    }

    /* Standard Buttons */
    .sf-btn {
        background: linear-gradient(180deg, #34495e, #2c3e50);
        border: 1px solid #1a252f;
        color: white;
        padding: 8px 12px;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s;
        font-family: inherit;
        font-weight: bold;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.1), 0 2px 4px rgba(0,0,0,0.3);
    }
    .sf-btn:hover {
        background: linear-gradient(180deg, #3d566e, #34495e);
        transform: translateY(-1px);
    }
    .sf-btn:active {
        transform: translateY(1px);
        box-shadow: inset 0 2px 4px rgba(0,0,0,0.5);
    }

    .sf-btn-success { background: linear-gradient(180deg, #2ecc71, #27ae60); border-color: #219653; }
    .sf-btn-success:hover { background: linear-gradient(180deg, #2ecc71, #2ecc71); }

    .sf-btn-danger { background: linear-gradient(180deg, #e74c3c, #c0392b); border-color: #a93226; }
    .sf-btn-danger:hover { background: linear-gradient(180deg, #e74c3c, #e74c3c); }

    /* Grid layouts */
    .sf-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 10px;
    }

    .sf-stat {
        background: rgba(0,0,0,0.4);
        padding: 10px;
        border-radius: 6px;
        text-align: center;
        border: 1px solid rgba(255,255,255,0.05);
    }
    .sf-stat-value {
        font-size: 18px;
        font-weight: bold;
        color: var(--sf-success);
        margin-top: 5px;
    }
    .sf-stat-label {
        font-size: 11px;
        color: var(--sf-text-muted);
    }
`;




// --- File: ui/SplashScreen.js ---
// --- ui\SplashScreen.js ---
window.SF = window.SF || {};

SF.SplashScreen = class SplashScreen {
    constructor() {
        this.container = null;
        this.styleElement = null;
        this.cssText = `
            #sf-splash-screen {
                position: fixed;
                top: 0; left: 0; width: 100vw; height: 100vh;
                background: radial-gradient(circle at center, rgba(13, 17, 23, 0.8) 0%, rgba(0, 0, 0, 0.95) 100%);
                backdrop-filter: blur(12px);
                z-index: 2147483647;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                font-family: 'Tajawal', 'Cairo', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                direction: rtl;
                opacity: 0;
                transition: opacity 0.8s ease-in-out;
            }

            .sf-splash-glass {
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid rgba(255, 255, 255, 0.1);
                box-shadow: 0 0 40px rgba(52, 152, 219, 0.2), inset 0 0 20px rgba(255, 255, 255, 0.02);
                border-radius: 20px;
                padding: 40px 60px;
                text-align: center;
                transform: translateY(30px) scale(0.95);
                opacity: 0;
                animation: sf-slide-up 1s cubic-bezier(0.16, 1, 0.3, 1) 0.2s forwards;
            }

            @keyframes sf-slide-up {
                to { transform: translateY(0) scale(1); opacity: 1; }
            }

            .sf-splash-logo {
                font-size: 65px;
                filter: drop-shadow(0 0 15px rgba(241, 196, 15, 0.6));
                animation: sf-bounce 2s infinite alternate ease-in-out;
                display: flex;
                gap: 20px;
                justify-content: center;
                margin-bottom: 10px;
            }

            .sf-splash-logo span {
                display: inline-block;
                animation: sf-float 3s infinite ease-in-out;
            }
            
            .sf-splash-logo span:nth-child(2) { animation-delay: 0.5s; }
            .sf-splash-logo span:nth-child(3) { animation-delay: 1s; }

            @keyframes sf-bounce {
                0% { filter: drop-shadow(0 0 15px rgba(241, 196, 15, 0.4)); }
                100% { filter: drop-shadow(0 0 35px rgba(241, 196, 15, 1)); }
            }

            @keyframes sf-float {
                0%, 100% { transform: translateY(0); }
                50% { transform: translateY(-15px) scale(1.1); }
            }

            .sf-splash-title {
                color: #fff;
                font-size: 32px;
                font-weight: 800;
                margin-top: 20px;
                letter-spacing: 2px;
                text-transform: uppercase;
                text-shadow: 0 0 20px rgba(52, 152, 219, 0.8);
                background: linear-gradient(90deg, #3498db, #2ecc71, #3498db);
                background-size: 200% auto;
                color: transparent;
                -webkit-background-clip: text;
                animation: sf-shine 3s linear infinite;
            }

            @keyframes sf-shine {
                to { background-position: 200% center; }
            }

            .sf-splash-subtitle {
                color: #f1c40f;
                font-size: 16px;
                margin-top: 15px;
                letter-spacing: 0px;
                font-weight: bold;
                text-shadow: 0 0 10px rgba(241, 196, 15, 0.5);
            }

            .sf-progress-bar {
                width: 100%;
                height: 4px;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 2px;
                margin-top: 30px;
                overflow: hidden;
                position: relative;
            }

            .sf-progress-fill {
                height: 100%;
                width: 0%;
                background: #3498db;
                box-shadow: 0 0 10px #3498db;
                border-radius: 2px;
                animation: sf-fill 2.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
            }

            @keyframes sf-fill {
                0% { width: 0%; }
                40% { width: 60%; }
                80% { width: 90%; }
                100% { width: 100%; }
            }
        `;
    }

    injectCSS() {
        this.styleElement = document.createElement('style');
        this.styleElement.textContent = this.cssText;
        document.head.appendChild(this.styleElement);
    }

    createUI() {
        this.container = document.createElement('div');
        this.container.id = 'sf-splash-screen';
        
        // رسم الشعار كـ SVG معقد يعطي إيحاء الذكاء الاصطناعي والمزرعة
        this.container.innerHTML = `
            <div class="sf-splash-glass">
                <div class="sf-splash-logo">
                    <span>🐮</span>
                    <span>🌾</span>
                    <span>🚜</span>
                </div>
                <div class="sf-splash-title">حصاد مظبوط</div>
                <div class="sf-splash-subtitle">هيثم كوتش يُرحب بكم في نظام المزرعة الذكي ✨</div>
                <div class="sf-progress-bar">
                    <div class="sf-progress-fill"></div>
                </div>
            </div>
        `;
        document.body.appendChild(this.container);

        // طلب رسم لكي يبدأ الأنميشن من نقطة الصفر بشكل صحيح
        requestAnimationFrame(() => {
            this.container.style.opacity = '1';
        });
    }

    show(callback) {
        this.injectCSS();
        this.createUI();

        // إخفاء الشاشة بعد اكتمال الشريط (حوالي 3.5 ثوانٍ)
        setTimeout(() => {
            this.container.style.opacity = '0';
            
            // انتظار انتهاء أنميشن الإخفاء (Fade Out) ثم التدمير
            setTimeout(() => {
                this.destroy();
                if (callback && typeof callback === 'function') {
                    callback();
                }
            }, 800); // مدة التلاشي
        }, 3000); // مدة ظهور الشاشة
    }

    destroy() {
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        if (this.styleElement && this.styleElement.parentNode) {
            this.styleElement.parentNode.removeChild(this.styleElement);
        }
        // تفريغ الذاكرة (Garbage Collection)
        this.container = null;
        this.styleElement = null;
    }
};


// --- File: ui/UIManager.js ---
// --- ui\UIManager.js ---
window.SF = window.SF || {};

SF.UIManager = class UIManager {
    constructor() {
        this.app = null;
        this.contentArea = null;
        this.topBar = null;

        this.injectCSS();
        this.createLayout();

        // Add modules that were already registered before UI was ready
        SF.modules.getModules().forEach(mod => this.addModuleTab(mod));

        // Select first tab by default
        const firstMod = SF.modules.getModules()[0];
        if (firstMod) {
            this.switchTab(firstMod.id);
            // Hide panel initially so it doesn't clutter the screen
            this.app.classList.add('sf-hidden');
        }
    }

    injectCSS() {
        const style = document.createElement('style');
        style.textContent = SF.Styles;
        document.head.appendChild(style);
    }

    createLayout() {
        // 1. Fixed Top Bar (Holds the main button and dropdown)
        this.topBar = document.createElement('div');
        this.topBar.id = 'sf-top-bar';

        this.mainMenuBtn = document.createElement('div');
        this.mainMenuBtn.className = 'sf-menu-btn';
        this.mainMenuBtn.innerHTML = '🌾 أدوات SupremeFarm ⬇️';

        this.dropdownMenu = document.createElement('div');
        this.dropdownMenu.className = 'sf-dropdown-menu sf-hidden';

        this.mainMenuBtn.onclick = () => {
            this.dropdownMenu.classList.toggle('sf-hidden');
        };

        this.topBar.appendChild(this.mainMenuBtn);
        this.topBar.appendChild(this.dropdownMenu);
        document.body.appendChild(this.topBar);

        // 2. Main App Panel (Fixed Center Modal)
        this.app = document.createElement('div');
        this.app.id = 'sf-app';

        // Header of the Panel
        const header = document.createElement('div');
        header.className = 'sf-header';

        this.titleEl = document.createElement('div');
        this.titleEl.className = 'sf-title';
        this.titleEl.innerHTML = `🌾 Supreme Farm`;

        const controls = document.createElement('div');
        controls.className = 'sf-controls';

        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = 'إغلاق النافذة ✖';
        closeBtn.onclick = () => {
            this.app.classList.add('sf-hidden');
            // Remove active state from top buttons
            this.topBar.querySelectorAll('.sf-tab').forEach(t => t.classList.remove('active'));
        };

        controls.appendChild(closeBtn);
        header.appendChild(this.titleEl);
        header.appendChild(controls);

        // Content Area
        this.contentArea = document.createElement('div');
        this.contentArea.className = 'sf-content';

        this.app.appendChild(header);
        this.app.appendChild(this.contentArea);
        document.body.appendChild(this.app);
    }

    addModuleTab(mod) {
        if (!this.topBar) return;

        // Tab Button (Inside dropdown)
        const tab = document.createElement('div');
        tab.className = 'sf-tab';
        tab.id = `tab-${mod.id}`;
        tab.innerHTML = `${mod.icon} <span>${mod.name}</span>`;
        tab.onclick = () => {
            // If already active and panel is open, close it
            if (tab.classList.contains('active') && !this.app.classList.contains('sf-hidden')) {
                this.app.classList.add('sf-hidden');
                tab.classList.remove('active');
            } else {
                this.switchTab(mod.id);
            }
            this.dropdownMenu.classList.add('sf-hidden');
        };

        this.dropdownMenu.appendChild(tab);

        // Module Container inside Panel
        const modContainer = document.createElement('div');
        modContainer.className = 'sf-module';
        modContainer.id = `mod-${mod.id}`;
        this.contentArea.appendChild(modContainer);

        // Initialize module HTML
        mod.init(modContainer);
    }

    switchTab(moduleId) {
        const tabs = this.topBar.querySelectorAll('.sf-tab');
        const mods = this.app.querySelectorAll('.sf-module');

        let activeMod = null;

        tabs.forEach(tab => {
            if (tab.id === `tab-${moduleId}`) tab.classList.add('active');
            else tab.classList.remove('active');
        });

        mods.forEach(mod => {
            if (mod.id === `mod-${moduleId}`) {
                mod.classList.add('active');
                activeMod = SF.modules.getModules().find(x => x.id === moduleId);
                if (activeMod && activeMod.update) activeMod.update();
            } else {
                mod.classList.remove('active');
            }
        });

        // Open the panel
        this.app.classList.remove('sf-hidden');
        if (activeMod) {
            this.titleEl.innerHTML = `${activeMod.icon} ${activeMod.name}`;
        }
    }
};




// --- File: features/AutoFarmModule.js ---
// --- features\AutoFarmModule.js ---
window.SF = window.SF || {};

SF.AutoFarmModule = class AutoFarmModule extends SF.ModuleBase {
    constructor() {
        super('autofarm', 'المزرعة الآلية', '🚜');
        this.harvestableGroups = {};
        this.autoHarvestInterval = null;
    }

    render() {
        return `
            <div class="sf-card">
                <p style="color: var(--sf-text-muted); font-size: 13px; margin-bottom: 15px; text-align: center;">
                    أدوات التحكم الذكي في الحصاد والمحاصيل (آمن 100%).
                </p>

                <!-- Sub-tabs for Auto Farm features -->
                <div style="display:flex; gap:5px; border-bottom:1px solid var(--sf-border); padding-bottom:10px; margin-bottom: 15px;">
                    <button class="sf-btn" id="sf-tab-harvest" style="flex:1; background:var(--sf-primary); color:white;">🍎 الحصاد الذكي</button>
                    <button class="sf-btn" id="sf-tab-bees" style="flex:1;">🐝 منزل النحل</button>
                    <button class="sf-btn" id="sf-tab-crops" style="flex:1;">🌾 المحاصيل</button>
                </div>

                <!-- Harvest View -->
                <div id="sf-view-harvest" style="display:flex; flex-direction:column; gap:10px;">
                    <button class="sf-btn sf-btn-success" id="sf-btn-scan-harvest">🔍 فحص الأبنية والأشجار والمحاصيل</button>
                    <div id="sf-harvest-list" style="height:120px; overflow-y:auto; background:rgba(0,0,0,0.3); padding:10px; border-radius:6px; border:1px inset rgba(255,255,255,0.1);">
                        <div style="font-size:12px; color:var(--sf-text-muted); text-align:center; margin-top:40px;">اضغط فحص لجلب العناصر...</div>
                    </div>
                    <div style="display:flex; gap:10px; margin-top:10px;">
                        <button class="sf-btn" id="sf-btn-harvest-selected" style="flex:1;">✅ حصاد المحدد</button>
                        <button class="sf-btn" id="sf-btn-auto-harvest" style="flex:1; background:#8e44ad; border-color:#9b59b6;">🔁 تشغيل الحصاد التلقائي</button>
                    </div>
                    <div id="sf-harvest-status" style="font-size:12px; text-align:center; margin-top:5px; color:var(--sf-text-muted);">
                        جاهز.
                    </div>
                </div>



                <!-- Bees View -->
                <div id="sf-view-bees" style="display:none; flex-direction:column; gap:10px;">
                    <button class="sf-btn" style="background: linear-gradient(180deg, #f1c40f, #f39c12); color:#000; border-color:#d35400;" id="sf-btn-bee-fertilize">🐝 تسميد المزرعة فوراً</button>
                    <div id="sf-bee-status" style="height:120px; background:rgba(0,0,0,0.3); border-radius:6px; border:1px inset rgba(255,255,255,0.1); padding:10px; font-size:12px; color:var(--sf-text-muted); text-align:center;">
                        جاهز لاستخدام منزل النحل.
                    </div>
                </div>

                <!-- Crops View (Crop Mix Configurator) -->
                <div id="sf-view-crops" style="display:none; flex-direction:column; gap:10px;">
                    <div style="position:relative;">
                        <input type="text" id="sf-mix-search" placeholder="🔍 ابحث بالاسم أو ID..." style="width:100%; box-sizing:border-box; background:rgba(0,0,0,0.6); border:1px solid #3498db; color:#fff; padding:8px 12px; border-radius:8px; font-size:13px; outline:none; transition: border-color 0.3s;" />
                    </div>
                    <div id="sf-mix-list" style="max-height:280px; overflow-y:auto; background:rgba(0,0,0,0.2); padding:8px; border-radius:8px; border:1px solid rgba(255,255,255,0.08); display:grid; grid-template-columns: repeat(2, 1fr); gap:6px;">
                        <div style="grid-column: 1/-1; font-size:12px; color:var(--sf-text-muted); text-align:center; padding:40px 0;">
                            ⏳ جاري تحميل قائمة المحاصيل المتاحة...
                        </div>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button class="sf-btn sf-btn-success" id="sf-btn-plant-mix" style="flex:1; font-size:13px; padding:10px;">🌱 زراعة المحاصيل المحددة</button>
                        <button class="sf-btn" id="sf-btn-clear-mix" style="background:#e74c3c; border-color:#c0392b; padding:10px;">🗑️ إلغاء</button>
                    </div>
                    <div id="sf-mix-status" style="font-size:12px; text-align:center; color:var(--sf-text-muted);">
                        جاهز لإنشاء الخلطة.
                    </div>
                </div>
            </div>
        `;
    }

    bindEvents() {
        const tabHarvest = this.container.querySelector('#sf-tab-harvest');
        const tabBees = this.container.querySelector('#sf-tab-bees');
        const tabCrops = this.container.querySelector('#sf-tab-crops');

        const viewHarvest = this.container.querySelector('#sf-view-harvest');
        const viewBees = this.container.querySelector('#sf-view-bees');
        const viewCrops = this.container.querySelector('#sf-view-crops');

        const switchSubTab = (activeTab, activeView) => {
            [tabHarvest, tabBees, tabCrops].forEach(t => { t.style.background = ''; t.style.color = ''; });
            [viewHarvest, viewBees, viewCrops].forEach(v => v.style.display = 'none');
            activeTab.style.background = 'var(--sf-primary)';
            activeTab.style.color = 'white';
            activeView.style.display = 'flex';
        };

        tabHarvest.onclick = () => switchSubTab(tabHarvest, viewHarvest);
        tabBees.onclick = () => switchSubTab(tabBees, viewBees);
        tabCrops.onclick = () => switchSubTab(tabCrops, viewCrops);

        // Harvest logic binds
        this.container.querySelector('#sf-btn-scan-harvest').onclick = () => this.scanHarvest();
        this.container.querySelector('#sf-btn-harvest-selected').onclick = () => this.harvestSelected();
        this.container.querySelector('#sf-btn-auto-harvest').onclick = () => this.toggleAutoHarvest();

        // Bee logic binds
        this.container.querySelector('#sf-btn-bee-fertilize').onclick = () => this.fertilizeBees();

        // Crop Mix Logic Binds
        const btnPlantMix = this.container.querySelector('#sf-btn-plant-mix');
        const btnClearMix = this.container.querySelector('#sf-btn-clear-mix');
        const mixListDiv = this.container.querySelector('#sf-mix-list');
        const mixStatus = this.container.querySelector('#sf-mix-status');

        const resolveIconUrl = (seed) => {
            let iconKey = seed.icon || seed.image || seed.url || "";
            iconKey = iconKey.replace(/^Achieve_/, '').replace(/_p$/, '');

            let b64 = "";
            try {
                const gw = unsafeWindow;
                if (gw.RES && typeof gw.RES.getRes === 'function') {
                    const texKey = seed.icon || seed.url || (iconKey + "_png");
                    const tex = gw.RES.getRes(texKey);
                    if (tex) {
                        if (typeof tex.toDataURL === 'function') {
                            b64 = tex.toDataURL("image/png");
                        } else if (tex.bitmapData) {
                            let img = tex.bitmapData.source || tex.bitmapData;
                            if (img && (img instanceof HTMLImageElement || img instanceof HTMLCanvasElement)) {
                                const canvas = document.createElement("canvas");
                                canvas.width = tex.textureWidth || img.width || 48;
                                canvas.height = tex.textureHeight || img.height || 48;
                                const ctx = canvas.getContext("2d");
                                ctx.drawImage(img, tex.bitmapX || 0, tex.bitmapY || 0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
                                b64 = canvas.toDataURL("image/png");
                            }
                        }
                    }
                }
            } catch(e) {}

            if (b64) return b64;
            if (iconKey) return `https://fso-en.img.centurygames.com/items/${iconKey}.png`;
            return `https://fso-en.img.centurygames.com/items/${seed.id}.png`;
        };

        const getStockCount = (seedId) => {
            try {
                const gw = unsafeWindow;
                if (gw.GF && gw.GF.loginModel && typeof gw.GF.loginModel.getStorageQtyById === 'function') {
                    return gw.GF.loginModel.getStorageQtyById(seedId) || 0;
                }
                if (gw.GF && gw.GF.loginModel && gw.GF.loginModel.AppData && gw.GF.loginModel.AppData.storage) {
                    return gw.GF.loginModel.AppData.storage[seedId] || 0;
                }
            } catch(e) {}
            return '?';
        };

        const renderMixList = () => {
            const gw = unsafeWindow;
            if (!gw.Config || !gw.Config.Store || !gw.GF || !gw.GF.loginModel) {
                mixListDiv.innerHTML = '<div style="grid-column:1/-1; color:#e74c3c; text-align:center; padding:20px;">تعذر تحميل البذور. محرك اللعبة غير جاهز.</div>';
                return;
            }

            const searchInput = this.container.querySelector('#sf-mix-search');
            const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

            const playerLevel = gw.GF.loginModel.AppData ? gw.GF.loginModel.AppData.level : 1;

            // Filter seeds (type === 'seeds' and !water_ranch)
            let availableSeeds = Object.values(gw.Config.Store).filter(item => {
                if (!item || !item.id) return false;
                const isSeed = item.type === "seeds" || item.type === 2;
                const isWater = item.water_ranch === true || item.water_ranch === 1;
                const isUnlocked = (item.unlock_level || 1) <= playerLevel;

                let matchesSearch = true;
                if (query.length > 0) {
                    const nameAr = (item.name_ar || '').toLowerCase();
                    const nameEn = (item.name_en || item.name || '').toLowerCase();
                    const idStr = String(item.id);
                    matchesSearch = nameAr.includes(query) || nameEn.includes(query) || idStr === query || idStr.startsWith(query);
                }

                return isSeed && !isWater && isUnlocked && matchesSearch;
            });

            // Sort by ID ascending
            availableSeeds.sort((a, b) => parseInt(a.id) - parseInt(b.id));

            if (availableSeeds.length === 0) {
                mixListDiv.innerHTML = '<div style="grid-column:1/-1; color:#f39c12; text-align:center; padding:20px;">لا توجد بذور مطابقة للبحث.</div>';
                return;
            }

            // Save checked states before re-rendering
            const checkedIds = new Set();
            const counts = {};
            this.container.querySelectorAll('.sf-mix-seed-checkbox:checked').forEach(cb => {
                const id = cb.getAttribute('data-id');
                checkedIds.add(id);
                const inputEl = this.container.querySelector(`.sf-mix-seed-count-input[data-id="${id}"]`);
                if (inputEl) counts[id] = inputEl.value;
            });

            mixListDiv.innerHTML = availableSeeds.map(seed => {
                const name = seed.name_ar || seed.name || `بذرة ${seed.id}`;
                const imgUrl = resolveIconUrl(seed);
                const stock = getStockCount(seed.id);

                const isChecked = checkedIds.has(String(seed.id)) ? 'checked' : '';
                const savedCount = counts[String(seed.id)] || '';
                const checkedStyle = isChecked ? 'background:rgba(46,204,113,0.15); border:1px solid #2ecc71;' : 'background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1);';

                return `<div class="sf-mix-seed-card" data-seed-id="${seed.id}" style="display:flex; flex-direction:column; align-items:center; padding:8px 4px; border-radius:6px; cursor:pointer; transition: all 0.15s ease; ${checkedStyle}" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="if(!this.querySelector('input[type=checkbox]').checked) this.style.background='rgba(0,0,0,0.3)'">
                    <input type="checkbox" class="sf-mix-seed-checkbox" data-id="${seed.id}" style="display:none;" ${isChecked} />
                    <div style="width:48px; height:48px; display:flex; align-items:center; justify-content:center; margin-bottom:4px;">
                        <img src="${imgUrl}" style="width:48px; height:48px; object-fit:contain;" onerror="this.onerror=null; this.src='https://fso-en.img.centurygames.com/items/${seed.id}.png'; this.addEventListener('error', function(){ this.style.display='none'; this.parentElement.innerHTML='<div style=\\'font-size:24px\\'>🌱</div>'; })" />
                    </div>
                    <div style="font-size:11px; color:#eaeaea; text-align:center; line-height:1.2; width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:sans-serif;" title="${name} (ID: ${seed.id})">${name}</div>
                    <div style="font-size:9px; color:#aaa; margin-top:2px;">ID: ${seed.id} | مخزن: ${stock}</div>
                    <input type="number" class="sf-mix-seed-count-input" data-id="${seed.id}" value="${savedCount}" placeholder="الكل" min="0" onclick="event.stopPropagation()" style="width:60px; margin-top:6px; background:rgba(0,0,0,0.5); border:1px solid rgba(255,255,255,0.2); color:#fff; padding:4px; border-radius:4px; text-align:center; font-size:11px; outline:none;" />
                </div>`;
            }).join('');
        };

        const searchInput = this.container.querySelector('#sf-mix-search');
        if (searchInput) {
            let searchTimer = null;
            searchInput.oninput = () => {
                clearTimeout(searchTimer);
                searchTimer = setTimeout(() => renderMixList(), 150);
            };
            searchInput.onfocus = () => { searchInput.style.borderColor = '#2ecc71'; };
            searchInput.onblur = () => { searchInput.style.borderColor = '#3498db'; };
        }

        // Card click toggles checkbox
        mixListDiv.addEventListener('click', (e) => {
            const card = e.target.closest('.sf-mix-seed-card');
            if (!card) return;
            if (e.target.classList.contains('sf-mix-seed-count-input')) return;
            const cb = card.querySelector('.sf-mix-seed-checkbox');
            if (!cb) return;
            cb.checked = !cb.checked;
            if (cb.checked) {
                card.style.borderColor = '#2ecc71';
                card.style.background = 'rgba(46,204,113,0.15)';
            } else {
                card.style.borderColor = 'rgba(255,255,255,0.1)';
                card.style.background = 'rgba(0,0,0,0.3)';
            }
        });

        // Render the list when the crops tab is clicked
        const origTabCropsClick = tabCrops.onclick;
        tabCrops.onclick = (e) => {
            if (origTabCropsClick) origTabCropsClick(e);
            if (mixListDiv.innerHTML.includes('جاري تحميل')) {
                renderMixList();
            }
        };

        btnClearMix.onclick = () => {
            const checkboxes = this.container.querySelectorAll('.sf-mix-seed-checkbox');
            const inputs = this.container.querySelectorAll('.sf-mix-seed-count-input');
            checkboxes.forEach(cb => cb.checked = false);
            inputs.forEach(inp => inp.value = '');
            this.container.querySelectorAll('.sf-mix-seed-card').forEach(card => {
                card.style.borderColor = 'rgba(255,255,255,0.1)';
                card.style.background = 'rgba(0,0,0,0.3)';
            });
            mixStatus.innerHTML = 'تم إلغاء التحديد.';
        };

        btnPlantMix.onclick = () => this.plantMix();
    }

    // --- Core Logic ---

    _isInstanceOfSoil(o) {
        if (!o) return false;
        const egretClass = o.__class__ || (o.constructor && o.constructor.prototype && o.constructor.prototype.__class__) || '';
        if (egretClass === 'Soil' || egretClass === 'Soil2' || egretClass === 'Soil3') return true;
        if (o.constructor && (o.constructor.name === 'Soil' || o.constructor.name === 'Soil2' || o.constructor.name === 'Soil3')) return true;
        const gw = unsafeWindow;
        if (gw.Soil && o instanceof gw.Soil) return true;
        if (gw.Soil2 && o instanceof gw.Soil2) return true;
        if (gw.Soil3 && o instanceof gw.Soil3) return true;
        // Fallback: check objName or className
        if (o.objName && String(o.objName).includes('Soil')) return true;
        return false;
    }

    _findEmptySoils(seedId) {
        const gw = unsafeWindow;
        let soilList = [];

        // Strategy 1: Use GameGridData.moList (used by CropinatorModule - proven to work)
        if (gw.GameGridData && gw.GameGridData.moList) {
            soilList = gw.GameGridData.moList;
        }
        // Strategy 2: Fallback to getSoils()
        else if (gw.GameGridData && typeof gw.GameGridData.getSoils === 'function') {
            let s = gw.GameGridData.getSoils();
            soilList = Array.isArray(s) ? s : Object.values(s || {});
        }
        // Strategy 3: Fallback to uidDictionary
        else if (gw.GameGridData && gw.GameGridData.uidDictionary) {
            soilList = Object.values(gw.GameGridData.uidDictionary);
        }

        const seedConfig = gw.Config ? gw.Config.Store_GetItemData(seedId) : null;
        const isSeedWater = seedConfig ? !!seedConfig.water_ranch : false;

        return soilList.filter(o => {
            if (!o || o.isDestroyed || o.usable === false) return false;
            if (!this._isInstanceOfSoil(o)) return false;

            // Check soil type matches seed type (water vs land)
            const isSoilWater = !!o.water_ranch;
            if (isSeedWater !== isSoilWater) return false;

            // Empty soil: no plant attached, or plant_id is 0
            // The soil has a "plant" property when occupied
            if (o.plant && !o.plant.isDestroyed) return false;
            if (o.crop && !o.crop.isDestroyed) return false;
            if (o.plant_id && o.plant_id > 0) return false;

            return true;
        });
    }

    async plantMix() {
        const mixStatus = this.container.querySelector('#sf-mix-status');

        // Read selected checkboxes
        const checkboxes = this.container.querySelectorAll('.sf-mix-seed-checkbox:checked');
        if (checkboxes.length === 0) {
            mixStatus.innerHTML = '<span style="color:#e74c3c">لم تقم بتحديد أي بذور. يرجى تفعيل بذور للزراعة.</span>';
            return;
        }

        let mixItems = [];
        checkboxes.forEach(cb => {
            const seedId = parseInt(cb.getAttribute('data-id'));
            const inputEl = this.container.querySelector(`.sf-mix-seed-count-input[data-id="${seedId}"]`);
            const countStr = inputEl ? inputEl.value.trim() : '';
            const count = countStr === '' || countStr === '0' ? Infinity : parseInt(countStr);
            if (!isNaN(seedId)) {
                mixItems.push({ id: seedId, count: count });
            }
        });

        if (mixItems.length === 0) {
            mixStatus.innerHTML = '<span style="color:#e74c3c">تعذر قراءة البذور المحددة.</span>';
            return;
        }

        const gw = unsafeWindow;
        if (!gw.App || !gw.App.ControllerManager || !gw.NetUtils) {
            mixStatus.innerHTML = '<span style="color:#e74c3c">محرك اللعبة غير جاهز.</span>';
            return;
        }

        if (!gw.GameGridData) {
            mixStatus.innerHTML = '<span style="color:#e74c3c">بيانات الخريطة غير جاهزة.</span>';
            return;
        }

        mixStatus.innerHTML = '⏳ جاري البحث عن تربة فارغة...';

        // Use first seed to determine soil type (land vs water)
        const firstSeedId = mixItems[0].id;
        let emptySoils = this._findEmptySoils(firstSeedId);

        if (emptySoils.length === 0) {
            mixStatus.innerHTML = '<span style="color:#f39c12">لا توجد تربة فارغة حالياً. يرجى حصاد الأراضي أولاً.</span>';
            return;
        }

        // --- Auto-Distribution Logic ---
        let totalSoils = emptySoils.length;
        let specifiedCount = 0;
        let infinityCount = 0;

        mixItems.forEach(item => {
            if (item.count !== Infinity) specifiedCount += item.count;
            else infinityCount++;
        });

        let remainingSoils = Math.max(0, totalSoils - specifiedCount);
        let dividePerInfinity = infinityCount > 0 ? Math.floor(remainingSoils / infinityCount) : 0;

        mixItems.forEach(item => {
            if (item.count === Infinity) {
                item.count = dividePerInfinity;
            }
        });
        // -------------------------------

        let soilsToPlant = [];
        let soilIndex = 0;

        for (let i = 0; i < mixItems.length; i++) {
            const mixItem = mixItems[i];
            let plantedCount = 0;

            while (plantedCount < mixItem.count && soilIndex < emptySoils.length) {
                const targetSoil = emptySoils[soilIndex];
                soilsToPlant.push({
                    soil: targetSoil,
                    seedId: mixItem.id
                });
                plantedCount++;
                soilIndex++;
            }
            if (soilIndex >= emptySoils.length) break;
        }

        if (soilsToPlant.length === 0) {
            mixStatus.innerHTML = '<span style="color:#f39c12">تعذر تخصيص التربة للزراعة.</span>';
            return;
        }

        mixStatus.innerHTML = `⏳ جاري زراعة الخلطة في ${soilsToPlant.length} تربة...`;

        // Determine greenhouse exploit - ALWAYS ON for AutoFarm
        let greenhouseId = 100249; // Zero-Gas Exploit
        let greenhouseX = 82;
        let greenhouseY = 78;

        const currentScene = gw.GF && gw.GF.loginModel ? gw.GF.loginModel.AppData.scene_select : 1;
        const gc = gw.App.ControllerManager.getController(gw.ControllerConst ? gw.ControllerConst.Game : 'Game');

        let successCount = 0;
        let errorCount = 0;

        for (let i = 0; i < soilsToPlant.length; i++) {
            const item = soilsToPlant[i];
            const soil = item.soil;

            try {
                const soilX = soil.grid_x !== undefined ? soil.grid_x : (soil.serverData ? soil.serverData.x : soil.map_x);
                const soilY = soil.grid_y !== undefined ? soil.grid_y : (soil.serverData ? soil.serverData.y : soil.map_y);
                const fakeUniqueId = 10000 + (soil.map_unique_id || soil.uid || Date.now() + Math.floor(Math.random() * 9000));

                const payload = {
                    unique_id: String(fakeUniqueId),
                    plant_id: item.seedId,
                    soil_x: soilX,
                    soil_y: soilY,
                    x: soilX,
                    y: soilY,
                    cur_sceneid: currentScene
                };

                // Inject greenhouse exploit if active
                if (greenhouseId) {
                    payload.greenhouse_id = greenhouseId;
                    payload.greenhouse_x = greenhouseX;
                    payload.greenhouse_y = greenhouseY;
                }

                const endpoint = (gw.HttpConst && gw.HttpConst.ADD_PLANT) ? gw.HttpConst.ADD_PLANT : 'add_plant.save_data';
                gw.NetUtils.enqueue(endpoint, payload);

                // Visual update to match Harvest Machine greenhouse behavior exactly
                try {
                    const seedConfig = gw.Config ? gw.Config.Store_GetItemData(item.seedId) : null;
                    if (gc && typeof gc._soilToPlant === 'function' && seedConfig) {
                        const newPlant = gc._soilToPlant(soil, seedConfig, true);
                        if (newPlant && greenhouseId) {
                            newPlant.greenhouse_id = greenhouseId;
                            if (newPlant.serverData) newPlant.serverData.greenhouse_id = greenhouseId;
                            if (typeof newPlant.update_collect_in === 'function') newPlant.update_collect_in();
                        }
                    } else {
                        // Fallback visual update
                        soil.plant_id = item.seedId;
                        soil.state = 1;
                        if (typeof soil.updateStage === 'function') soil.updateStage();
                    }
                } catch(ve) {
                    // Silent visual error
                    console.log('[SF-PlantMix] Visual update error: ' + ve.message);
                }

                successCount++;
            } catch(e) {
                errorCount++;
                console.log('[SF-PlantMix] Error planting: ' + e.message);
            }

            // Rate limit: small delay every 10 plants
            if (i > 0 && i % 10 === 0) {
                await new Promise(r => setTimeout(r, 50));
            }
        }

        // Flush all enqueued network requests
        if (typeof gw.NetUtils.flush === 'function') gw.NetUtils.flush();
        if (gc && typeof gc.onSortMapObject === 'function') gc.onSortMapObject();

        if (errorCount > 0) {
            mixStatus.innerHTML = `<span style="color:#f39c12">⚠️ زرعت ${successCount} تربة بنجاح، فشلت ${errorCount}.</span>`;
        } else {
            mixStatus.innerHTML = `<span style="color:#2ecc71">✅ تمت زراعة الخلطة بنجاح (${successCount} تربة).</span>`;

            // Clear selection dynamically for a fresh start next time
            const btnClear = this.container.querySelector('#sf-btn-clear-mix');
            if (btnClear) btnClear.click();
        }
    }

    scanHarvest() {
        const listDiv = this.container.querySelector('#sf-harvest-list');
        listDiv.innerHTML = '⏳ جاري الفحص...';
        this.harvestableGroups = {};

        try {
            let moList = [];
            if (unsafeWindow.GameGridData && unsafeWindow.GameGridData.uidDictionary) {
                moList = Object.values(unsafeWindow.GameGridData.uidDictionary);
            }

            moList.forEach(mo => {
                if (!mo) return;

                let className = mo.className || mo.configData?.className || '';
                let type = mo.type || mo.configData?.type || '';
                let id = mo.id || mo.configData?.id || '';

                let isCrop = (className === 'Crop' || type === 'crop' || type === 'seeds');
                let isField = (className === 'Field' || className === 'Soil' || type === 'field' || type === 'soil' || id == 101);
                let isTree = (className === 'Tree' || type === 'tree');
                let canHarvest = typeof mo.collect === 'function' || typeof mo.harvest === 'function' || isTree || isCrop || className === 'Animal' || className === 'Machine';

                let isReady = typeof mo.isReady === 'function' ? mo.isReady() : false;

                if (isCrop || isField) {
                    let st = mo.state || 0;
                    if (st == 2 || st === 'collect_over' || st === 'ripe' || mo.readyToHarvest) isReady = true;
                }

                if ((isTree || canHarvest) && isReady) {
                    let name = "";
                    try {
                        let pObj = mo.plant || mo.crop || mo;
                        let seedId = pObj.plant_id || pObj.plantId || pObj.seed_id || pObj.configData?.id;
                        if ((isField || isCrop) && seedId && seedId != 101 && unsafeWindow.Config && typeof unsafeWindow.Config.Store_GetItemData === 'function') {
                            let c = unsafeWindow.Config.Store_GetItemData(seedId);
                            if (c && (c.name_ar || c.name)) name = c.name_ar || c.name;
                        }
                    } catch(e) {}

                    if (!name) name = mo.configData?.name_ar || mo.configData?.name || `عنصر ${mo.configData?.id || mo.id}`;
                    if (name === 'Field' || name === 'Soil' || name.includes('أرض')) name = "محصول ناضج";

                    if (!this.harvestableGroups[name]) this.harvestableGroups[name] = { count: 0, items: [] };
                    this.harvestableGroups[name].count++;
                    this.harvestableGroups[name].items.push(mo);
                }
            });

            let html = '';
            let keys = Object.keys(this.harvestableGroups);
            if (keys.length === 0) {
                listDiv.innerHTML = '<span style="color:#f39c12">لم يتم العثور على أي عناصر ناضجة حالياً.</span>';
                return;
            }

            keys.forEach(k => {
                html += `
                <label style="display:block; margin-bottom:5px; font-size:12px; cursor:pointer; color:#ddd;">
                    <input type="checkbox" class="sf-harvest-chk" value="${k}" checked>
                    ${k} <span style="color:#2ecc71">(${this.harvestableGroups[k].count} جاهز)</span>
                </label>`;
            });
            listDiv.innerHTML = html;
        } catch(e) {
            listDiv.innerHTML = `<span style="color:#ff6b6b">خطأ: ${e.message}</span>`;
        }
    }

    async doHarvest(selectedNames) {
        let gc = unsafeWindow.GF?.gameController;
        if (!gc) return 0;
        let toHarvest = [];

        // Re-fetch to ensure fresh data
        let moList = [];
        if (unsafeWindow.GameGridData && unsafeWindow.GameGridData.uidDictionary) {
            moList = Object.values(unsafeWindow.GameGridData.uidDictionary);
        }

        moList.forEach(mo => {
            if (!mo) return;

            let className = mo.className || mo.configData?.className || '';
            let type = mo.type || mo.configData?.type || '';
            let id = mo.id || mo.configData?.id || '';
            let isCrop = (className === 'Crop' || type === 'crop' || type === 'seeds');
            let isField = (className === 'Field' || className === 'Soil' || type === 'field' || type === 'soil' || id == 101);

            let isReady = typeof mo.isReady === 'function' ? mo.isReady() : false;
            if (isCrop || isField) {
                let st = mo.state || 0;
                if (st == 2 || st === 'collect_over' || st === 'ripe' || mo.readyToHarvest) isReady = true;
            }

            if (!isReady) return;

            let name = "";
            try {
                let pObj = mo.plant || mo.crop || mo;
                let seedId = pObj.plant_id || pObj.plantId || pObj.seed_id || pObj.configData?.id;
                if ((isField || isCrop) && seedId && seedId != 101 && unsafeWindow.Config && typeof unsafeWindow.Config.Store_GetItemData === 'function') {
                    let c = unsafeWindow.Config.Store_GetItemData(seedId);
                    if (c && (c.name_ar || c.name)) name = c.name_ar || c.name;
                }
            } catch(e) {}

            if (!name) name = mo.configData?.name_ar || mo.configData?.name || `عنصر ${mo.configData?.id || mo.id}`;
            if (name === 'Field' || name === 'Soil' || name.includes('أرض')) name = "محصول ناضج";

            if (selectedNames.includes(name)) {
                toHarvest.push(mo);
            }
        });

        let count = 0;
        const batchSize = 250; // زيادة الدفعة لتسريع الحصاد (سرعة البرق)
        for (let i = 0; i < toHarvest.length; i += batchSize) {
            const batch = toHarvest.slice(i, i + batchSize);
            for (let b = 0; b < batch.length; b++) {
                let mo = batch[b];
                try {
                    let preCalcProductId = null;
                    let preCalcIsWaterCrop = false;
                    try {
                        let gw = unsafeWindow;
                        let pObj = mo.plant || mo.crop || mo;
                        let seedId = pObj.plant_id || pObj.plantId || pObj.seed_id || pObj.configData?.id;
                        if (seedId && seedId != 101 && gw.Config) {
                            let c = gw.Config.Store_GetItemData(seedId);
                            preCalcProductId = c ? (c.product_id || c.product || seedId) : seedId;
                            if (c && (c.water_ranch === true || c.water_ranch === 1)) preCalcIsWaterCrop = true;
                            if (!c && pObj.configData) {
                                if (pObj.configData.product_id) preCalcProductId = pObj.configData.product_id;
                                if (pObj.configData.water_ranch === true || pObj.configData.water_ranch === 1) preCalcIsWaterCrop = true;
                            }
                        }
                    } catch(e) {}

                    if (typeof gc._collectMapObject === 'function') gc._collectMapObject(mo);
                    else if (typeof gc.collectMapObject === 'function') gc.collectMapObject(mo);
                    else if (typeof mo.harvest === 'function') mo.harvest();
                    else if (typeof mo.collect === 'function') mo.collect();

                    let type = (mo.type || mo.configData?.type || '').toLowerCase();
                    let className = (mo.className || mo.configData?.className || '');
                    let isActualPlant = (className === 'Plant' || className === 'Crop' || type === 'plant' || type === 'crop' || type === 'seeds');
                    let isFieldOrSoil = (className === 'Field' || className === 'Soil' || type === 'field' || type === 'soil' || mo.id == 101);

                    mo.state = 0;

                    if (isActualPlant) {
                        if (typeof gc._harvestOneCrop === 'function') try { gc._harvestOneCrop([mo]); } catch(e) {}
                        if (typeof gc._plantToSoil === 'function') try { gc._plantToSoil(mo); } catch(e) {}
                    } else if (isFieldOrSoil) {
                        mo.plant_id = 0; mo.isReady = false;
                        if (mo.configData) mo.configData.id = 101;
                        try {
                            let obj = mo.plant || mo.crop;
                            if (obj && !obj.isDestroyed) {
                                if (typeof gc._harvestOneCrop === 'function') try { gc._harvestOneCrop([obj]); } catch(e) {}
                                if (typeof gc._plantToSoil === 'function') try { gc._plantToSoil(obj); } catch(e) {}
                                if (obj.view) obj.view.visible = false;
                                if (obj.clip) obj.clip.visible = false;
                            }
                        } catch(e) {}
                    }

                    try {
                        ['clearCrop', 'removeCrop', 'clean', 'reset'].forEach(fn => {
                            if (typeof mo[fn] === 'function') mo[fn]();
                        });
                        let view = mo.view || mo._view || mo.clip || mo.sprite;
                        if (view) {
                            for (let key in view) {
                                if (key.toLowerCase().includes('crop') || key.toLowerCase().includes('plant')) {
                                    if (view[key]) view[key].visible = false;
                                }
                            }
                            if (typeof view.removeChild === 'function' && view.children && view.children.length > 1) {
                                for (let c = 1; c < view.children.length; c++) view.children[c].visible = false;
                            }
                        }
                    } catch (e) {}

                    // إضافة تحديث لحظي للواجهة والحظيرة لتفادي الحاجة لتحديث الصفحة
                    try {
                        let gw = unsafeWindow;
                        if (preCalcProductId && preCalcProductId != 101) {
                            if (gw.GF && gw.GF.loginModel && gw.GF.loginModel.AppData) {
                                if (preCalcIsWaterCrop && gw.GF.loginModel.AppData.drier && gw.GF.loginModel.AppData.drier.crops) {
                                    let cropsArr = gw.GF.loginModel.AppData.drier.crops;
                                    let found = false;
                                    for (let i = 0; i < cropsArr.length; i++) {
                                        if (cropsArr[i].id == preCalcProductId) {
                                            cropsArr[i].qty = (cropsArr[i].qty || 0) + 1;
                                            found = true;
                                            break;
                                        }
                                    }
                                    if (!found) {
                                        cropsArr.push({ id: preCalcProductId, qty: 1 });
                                    }
                                } else if (gw.GF.loginModel.AppData.storage) {
                                    let curQty = gw.GF.loginModel.AppData.storage[preCalcProductId] || 0;
                                    gw.GF.loginModel.AppData.storage[preCalcProductId] = curQty + 1;
                                }
                            }
                            if (gw.GF && gw.GF.gameController && gw.Animations) {
                                gw.GF.gameController.collectTopTip(preCalcProductId, 1);
                                // [تعديل حصاد البرق]: تم تعطيل الرسوم المتحركة flyItemTo لتفادي تهنيج المتصفح
                            }
                        }
                    } catch(e) {}

                    count++;
                } catch(e) {}
            }
            await new Promise(r => setTimeout(r, 0)); // تفريغ الذاكرة فورياً بدون تأخير (0ms)
        }
        return count;
    }

    async harvestSelected() {
        const status = this.container.querySelector('#sf-harvest-status');
        let checkboxes = Array.from(this.container.querySelectorAll('.sf-harvest-chk:checked'));
        let names = checkboxes.map(c => c.value);
        if (names.length === 0) {
            status.innerHTML = '<span style="color:#e74c3c">الرجاء تحديد عنصر واحد على الأقل.</span>';
            return;
        }
        status.innerHTML = '⏳ جاري الحصاد...';
        let c = await this.doHarvest(names);
        status.innerHTML = `<span style="color:#2ecc71">✅ تم حصاد ${c} عنصر بنجاح!</span>`;
        this.scanHarvest();
    }

    toggleAutoHarvest() {
        const btn = this.container.querySelector('#sf-btn-auto-harvest');
        const status = this.container.querySelector('#sf-harvest-status');

        if (this.autoHarvestInterval) {
            clearInterval(this.autoHarvestInterval);
            this.autoHarvestInterval = null;
            btn.innerHTML = '🔁 تشغيل الحصاد التلقائي';
            btn.style.background = '#8e44ad';
            status.innerHTML = '<span style="color:#f39c12">⏹️ تم إيقاف الحصاد التلقائي.</span>';
        } else {
            let checkboxes = Array.from(this.container.querySelectorAll('.sf-harvest-chk:checked'));
            let names = checkboxes.map(c => c.value);
            if (names.length === 0) {
                status.innerHTML = '<span style="color:#e74c3c">حدد عناصر للحصاد التلقائي!</span>';
                return;
            }
            btn.innerHTML = '⏹️ إيقاف الحصاد التلقائي';
            btn.style.background = '#c0392b';
            status.innerHTML = `<span style="color:#2ecc71">▶️ الحصاد التلقائي يعمل في الخلفية...</span>`;

            this.autoHarvestInterval = setInterval(async () => {
                let c = await this.doHarvest(names);
                if (c > 0) {
                    status.innerHTML = ` <span style="color:#2ecc71">▶️ الحصاد التلقائي يعمل... (حصد للتو ${c})</span> `;
                    this.scanHarvest();
                }
            }, 5000);
        }
    }

    async fertilizeBees(silent = false) {
        const status = this.container.querySelector('#sf-bee-status');
        const setStatus = (msg) => { if (!silent && status) status.innerHTML = msg; };

        const gw = unsafeWindow;
        if (!gw.App || !gw.App.ControllerManager || !gw.NetUtils || !gw.GF || !gw.GF.loginModel) {
            setStatus('<span style="color:#e74c3c">محرك اللعبة غير جاهز.</span>');
            return;
        }

        const gameCtrl = gw.App.ControllerManager.getController(gw.ControllerConst.Game);
        const loginCtrl = gw.App.ControllerManager.getController(gw.ControllerConst.Login);
        const loginProxy = loginCtrl ? loginCtrl.loginProxy : null;

        if (!gw.GameGridData || !gw.GameGridData.uidDictionary) {
            setStatus('<span style="color:#e74c3c">بيانات الخريطة غير جاهزة.</span>');
            return;
        }

        const allObjects = Object.values(gw.GameGridData.uidDictionary);

        let beeHouses = allObjects.filter(o => {
            if (!o || o.isDestroyed) return false;
            const egretClass = o.__class__ || (o.constructor && o.constructor.prototype && o.constructor.prototype.__class__) || o.className;
            return egretClass === "BeeHouse";
        });

        if (!beeHouses || beeHouses.length === 0) {
            setStatus('<span style="color:#e74c3c">لم يتم العثور على منزل نحل في هذه المزرعة/الجزيرة.</span>');
            return;
        }

        const btnFertilize = this.container.querySelector('#sf-btn-bee-fertilize');
        if (btnFertilize) {
            btnFertilize.disabled = true;
            btnFertilize.style.opacity = '0.5';
        }

        setStatus(`⏳ جاري التجهيز...`);
        // Yield immediately so the status text renders before heavy work
        await new Promise(r => setTimeout(r, 0));

        // ── Phase 1: Build HashMap of available crops keyed by templateId ──
        // This converts the O(N) linear scan per hive into O(1) lookup
        const cropMap = new Map(); // Map<templateId(Number), Array<cropObject>>
        for (let i = 0; i < allObjects.length; i++) {
            const o = allObjects[i];
            if (!o || o.isDestroyed || !o.usable) continue;

            const egretClass = o.__class__
                || (o.constructor && o.constructor.prototype && o.constructor.prototype.__class__)
                || o.className
                || (o.configData ? o.configData.className : "");

            if (egretClass !== "Plant" && o.type !== "crop" && egretClass !== "Tree" && o.type !== "tree") continue;
            if (o.pollinated || (o.serverData && o.serverData.pollinated)) continue;
            if (typeof o.is_pollinated === 'function' && o.is_pollinated()) continue;
            if (o.marked_for_pollination_sf) continue;
            if (typeof o.is_mark_pollination === 'function' && o.is_mark_pollination()) continue;

            // Cache class info on the object to avoid recomputing
            o._sf_egretClass = egretClass;

            const templateId = Number(o.configData ? o.configData.id : o.wid);
            if (!templateId) continue;

            let bucket = cropMap.get(templateId);
            if (!bucket) {
                bucket = [];
                cropMap.set(templateId, bucket);
            }
            bucket.push(o);
        }

        setStatus(`⏳ جاري مطابقة ${beeHouses.length} منزل نحل مع ${cropMap.size} نوع محصول...`);
        await new Promise(r => setTimeout(r, 0));

        // ── Phase 2: Match hives to crops via HashMap (O(H×F) instead of O(H×F×C)) ──
        let matches = [];
        const YIELD_INTERVAL = 50; // yield every 50 matches to keep UI alive
        let opsCounter = 0;

        for (let b = 0; b < beeHouses.length; b++) {
            const beeHouse = beeHouses[b];
            if ((!beeHouse.beeHiveList || beeHouse.beeHiveList.length === 0) && typeof beeHouse.initBeehiveList === 'function') {
                beeHouse.initBeehiveList();
            }

            const hives = beeHouse.beeHiveList || [];
            for (let h = 0; h < hives.length; h++) {
                const hive = hives[h];
                if (typeof hive.canCollectFlowers !== 'function') continue;

                const allowedFlowers = hive.canCollectFlowers();
                if (!allowedFlowers || allowedFlowers.length === 0) continue;

                // For each allowed flower type, do O(1) HashMap lookup
                for (let f = 0; f < allowedFlowers.length; f++) {
                    const flowerId = Number(allowedFlowers[f]);
                    const bucket = cropMap.get(flowerId);
                    if (!bucket) continue;

                    // Iterate bucket in reverse so we can splice matched items out
                    for (let c = bucket.length - 1; c >= 0; c--) {
                        const o = bucket[c];
                        if (o.__matched_sf) continue;

                        const egretClass = o._sf_egretClass;
                        const isPlant = egretClass === "Plant" || o.type === "crop";
                        const isTree = egretClass === "Tree" || o.type === "tree";

                        if (isPlant && typeof o.can_be_pollinated === 'function' && !o.can_be_pollinated()) continue;
                        if (isTree && (!o.canCollectFlowers || (typeof o.canCollectFlowers === 'function' && !o.canCollectFlowers()))) continue;

                        if (typeof o.mark_for_pollination === 'function') {
                            o.mark_for_pollination();
                        } else {
                            o.marked_for_pollination_sf = true;
                        }

                        o.__matched_sf = true;
                        bucket.splice(c, 1); // Remove from bucket so no future hive rechecks it
                        matches.push({ beeHouse, hive, targetCrop: o });

                        opsCounter++;
                        if (opsCounter % YIELD_INTERVAL === 0) {
                            setStatus(`⏳ جاري المطابقة... (${matches.length} حتى الآن)`);
                            await new Promise(r => setTimeout(r, 0));
                        }
                    }
                }
            }
        }

        if (matches.length === 0) {
            setStatus('<span style="color:#f39c12">لم توجد محاصيل متوافقة وجاهزة للتلقيح.</span>');
            if (btnFertilize) { btnFertilize.disabled = false; btnFertilize.style.opacity = ''; }
            return;
        }

        const LoginProxyClass = gw.LoginProxy || (loginProxy ? loginProxy.constructor : null);

        // ── Phase 3: Send network payloads in small batches with generous yields ──
        const BATCH_SIZE = 10;
        const BATCH_DELAY_MS = 80;

        for (let i = 0; i < matches.length; i += BATCH_SIZE) {
            const batch = matches.slice(i, i + BATCH_SIZE);
            for (let j = 0; j < batch.length; j++) {
                const item = batch[j];
                const beeHouse = item.beeHouse;
                const hive = item.hive;
                const targetCrop = item.targetCrop;
                delete targetCrop.__matched_sf;
                delete targetCrop._sf_egretClass;

                let uid = 0;
                if (LoginProxyClass && typeof LoginProxyClass.pollinate_beehouse_UID === 'number') {
                    uid = LoginProxyClass.pollinate_beehouse_UID++;
                } else if (loginProxy && typeof loginProxy.pollinate_beehouse_UID === 'number') {
                    uid = loginProxy.pollinate_beehouse_UID++;
                } else {
                    if (LoginProxyClass) {
                        if (typeof LoginProxyClass.pollinate_beehouse_UID !== 'number') {
                            LoginProxyClass.pollinate_beehouse_UID = 1;
                        }
                        uid = LoginProxyClass.pollinate_beehouse_UID++;
                    } else {
                        uid = Date.now() + i + j;
                    }
                }

                const payload = {
                    id: beeHouse.id,
                    x: beeHouse.serverData ? beeHouse.serverData.x : beeHouse.grid_x,
                    y: beeHouse.serverData ? beeHouse.serverData.y : beeHouse.grid_y,
                    plant_id: targetCrop.id,
                    plant_x: targetCrop.serverData ? targetCrop.serverData.x : targetCrop.grid_x,
                    plant_y: targetCrop.serverData ? targetCrop.serverData.y : targetCrop.grid_y,
                    flip: beeHouse.isFlip ? 1 : 0,
                    hive_id: hive.itemid || (hive.beeHouseData ? hive.beeHouseData.id : hive.id),
                    unique_id: uid
                };

                gw.NetUtils.enqueue(gw.HttpConst.POLLINATE_BEEHOUSE, payload);

                if (typeof hive.setPolling === 'function') hive.setPolling();

                if (targetCrop.serverData) {
                    if (!targetCrop.serverData.pollinated) targetCrop.serverData.pollinated = 0;
                    targetCrop.serverData.pollinated++;
                } else {
                    targetCrop.pollinated = true;
                }

                // Lightweight state updates only - NO eui.Image creation
                try { if (typeof targetCrop.updateStage === 'function') targetCrop.updateStage(); } catch (e) {}
                try { if (typeof targetCrop.pollinate === 'function') targetCrop.pollinate(); } catch (e) {}

                if (typeof beeHouse.addProduct === 'function') {
                    try {
                        const cropTemplateId = targetCrop.configData ? targetCrop.configData.id : targetCrop.wid;
                        beeHouse.addProduct(cropTemplateId);
                    } catch(e) {}
                }
            }

            // Yield to browser rendering after each small batch
            setStatus(`⏳ جاري التلقيح... (${Math.min(i + BATCH_SIZE, matches.length)} / ${matches.length})`);
            await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
        }

        if (gameCtrl && typeof gameCtrl.onSortMapObject === 'function') gameCtrl.onSortMapObject();
        gw.NetUtils.flush();

        setStatus(`<span style="color:#2ecc71">✅ اكتمل التلقيح بسرعة البرق! (${matches.length})</span>`);
        if (btnFertilize) { btnFertilize.disabled = false; btnFertilize.style.opacity = ''; }
    }
};

// Register the module
SF.modules.register(new SF.AutoFarmModule());





// --- File: features/ZeroGasModule.js ---
// --- features\ZeroGasModule.js ---
window.SF = window.SF || {};

SF.ZeroGasModule = class ZeroGasModule extends SF.ModuleBase {
    constructor() {
        super('invisible_gas', 'Zero-Gas Protocol', '₤');
        this.isActive = false;
        this.injectZeroGasProtocol();
    }

    render() {
        return `\
            <div class="sf-card">
                <p style="color: var(--sf-text-muted); font-size: 13px; margin-bottom: 15px; text-align: center;">
                    Zero-Gas Protocol: Bypass Automation Gas limits natively.
                </p>
                <div style="display:flex; direction:column; gap:10px; align-items:center;">
                    <div id="sf-zerogas-status" style="font-size:14px; color:#2ecc71; font-weight:bold;">
                        ✅ Zero-Gas Active
                    </div>
                    <div style="font-size:11px; color:#aaa; text-align:center; padding: 10px; background: rgba(0,0,0,0.3); border-radius: 6px;">
                        Zero-Gas intercepts all network requests to strip automation flags, forcing the server to treat actions as manual.
                    </div>
                </div>
            </div>
        `;
    }

    bindEvents() {}

    injectZeroGasProtocol() {
        if (this.isActive) return;
        this.isActive = true;

        const fnStr = function() {
            const initZeroGas = function() {
                if (window.GF && window.GF.loginModel && window.GF.loginModel.AppData && window.TreasureType) {
                    
                    // Helper: robust OP type check (handles 'op', 'OP', TreasureType.OP, TreasureType.op)
                    const isOpType = function(type) {
                        if (!type) return false;
                        let tLow = (typeof type === 'string') ? type.toLowerCase() : '';
                        if (tLow === 'op') return true;
                        try { if (type === window.TreasureType.OP) return true; } catch(e) {}
                        try { if (type === window.TreasureType.op) return true; } catch(e) {}
                        try { if (type === window.TreasureType.Op) return true; } catch(e) {}
                        return false;
                    };

                    // 1. Block costTreasure (visual deduction) for ALL OP operations
                    const orig_cost = window.GF.loginModel.costTreasure;
                    window.GF.loginModel.costTreasure = function(type, amount, ...args) {
                        try {
                            if (isOpType(type)) {
                                return; // Block OP deduction (auto-run animals/machines/crops)
                            }
                        } catch(e) {}
                        return orig_cost.apply(this, arguments);
                    };
                    
                    // 2. Block validation methods
                    window.GF.loginModel.isMeetUseOP = function() { return true; };
                    
                    const orig_treasureIsMeet = window.GF.loginModel.treasureIsMeet;
                    window.GF.loginModel.treasureIsMeet = function(type, amount) {
                        if (isOpType(type)) return true;
                        return orig_treasureIsMeet.apply(this, arguments);
                    };

                    // 3. Prevent 'AppData.op <= 0' hardcoded checks from failing
                    try {
                        let actualOp = window.GF.loginModel.AppData.op || 999;
                        Object.defineProperty(window.GF.loginModel.AppData, 'op', {
                            get: function() { return Math.max(actualOp, 999); }, // Always pretend we have at least 999 OP
                            set: function(val) { actualOp = val; },
                            configurable: true
                        });
                    } catch(e) {}

                    console.log('[SF-ZeroGas] Hooked OP verification & locked AppData.op successfully!');
                } else {
                    setTimeout(initZeroGas, 2000);
                }
            };

            const initNetUtils = function() {
                if (window.NetUtils && window.NetUtils.enqueue) {
                    const orig_enqueue = window.NetUtils.enqueue;
                    window.NetUtils.enqueue = function(action, payload) {
                        try {
                            // Layer 1: Block toggle_automation from reaching server
                            // (client-side state is already set before this call)
                            if (action === 'toggle_automation.save_data') {
                                console.log('[SF-ZeroGas] Blocked toggle_automation → server never knows auto-run is ON');
                                return;
                            }

                            // Layer 2: Strip automation flags from payloads
                            if (payload) {
                                const forbiddenKeys = [
                                    'op_cost', 'useOp', 'automatic', 'isAuto', 
                                    'automation', 'auto', 'gas', 'is_auto', 'automate', 'is_automatic'
                                ];
                                forbiddenKeys.forEach(k => {
                                    if (payload.hasOwnProperty(k)) {
                                        delete payload[k];
                                    }
                                });
                            }
                        } catch(e) {}
                        return orig_enqueue.apply(this, arguments);
                    };
                    console.log('[SF-ZeroGas] Hooked NetUtils successfully!');
                } else {
                    setTimeout(initNetUtils, 2000);
                }
            };

            setTimeout(initZeroGas, 3000);
            setTimeout(initNetUtils, 3500);
        };

        const tryInject = () => {
            const headOrDoc = document.head || document.documentElement;
            if (headOrDoc) {
                const script = document.createElement('script');
                script.textContent = '(' + fnStr + ')();';
                headOrDoc.appendChild(script);
                script.remove();
                console.log('[SupremeFarm Modular] Injected ZeroGas Ghost Protocol');
            } else {
                window.addEventListener('DOMContentLoaded', tryInject, { once: true });
            }
        };

        if (document.readyState === 'loading') {
            window.addEventListener('DOMContentLoaded', tryInject, { once: true });
        } else {
            tryInject();
        }
    }
};

// Register the module
SF.modules.register(new SF.ZeroGasModule());


// --- File: features/CropinatorModule.js ---
// --- features\CropinatorModule.js ---
window.SF = window.SF || {};

SF.CropinatorModule = class CropinatorModule extends SF.ModuleBase {
    constructor() {
        super('cropinator', 'آلة الحصاد (شبح)', '🚜');
        this.isActive = false;
        this.injectCropinatorFix();
    }

    render() {
        return `
            <div class="sf-card">
                <p style="color: var(--sf-text-muted); font-size: 13px; margin-bottom: 15px; text-align: center;">
                    وحدة تحكم آلة الحصاد والزراعة المجانية (Zero-Gas Cropinator).
                </p>
                <div style="display:flex; flex-direction:column; gap:10px; align-items:center;">
                    <div style="font-size:14px; color:#2ecc71; font-weight:bold;">
                        ✅ تم تفعيل آلة الحصاد المجانية
                    </div>
                    <div style="font-size:11px; color:#aaa; text-align:center; padding: 10px; background: rgba(0,0,0,0.3); border-radius: 6px;">
                        جميع عمليات الزراعة والحصاد باستخدام الآلة (الجرار الأصفر) أصبحت مجانية تماماً وبدون بنزين.
                        كما تم تطبيق ثغرة البيت الزجاجي الوهمي لتقليل وقت نمو المحاصيل بنسبة 40%.
                    </div>
                </div>
            </div>
        `;
    }

    bindEvents() {}

    injectCropinatorFix() {
        if (this.isActive) return;
        this.isActive = true;

        const fnStr = function() {
            const gw = window;

            function sysLog(msg) {
                console.log('[SF-Cropinator] ' + msg);
            }

            function initZeroGasMachine() {
                if (!gw.App || !gw.App.ControllerManager || !gw.NetUtils) {
                    setTimeout(initZeroGasMachine, 2000);
                    return;
                }

                applyGreenhouseVisualPatch();

                const origApplyFunc = gw.App.ControllerManager.applyFunc;
                gw.App.ControllerManager.applyFunc = function(controllerType, funcType, data) {
                    const ctrlName = getConstName('ControllerConst', controllerType) || String(controllerType);
                    const funcId = parseInt(funcType);

                    if (ctrlName === 'Cropinator' && funcId === 10013) {
                        if (data && data.id) {
                            const seedId = data.id;
                            sysLog('تم اعتراض زراعة الآلة لبذرة ' + seedId + '. إرسال طلبات زراعة يدوية متتالية.');
                            closeCropinator(controllerType);
                            executeManualPlanting(seedId);
                            return null;
                        }
                    }

                    const harvestModes = {
                        10088: "ONE_CROP",
                        10089: "ALL_CROP",
                        10090: "ALL_TREE",
                        10091: "ALL_CROP_AND_TREE"
                    };

                    if (ctrlName === 'Game' && harvestModes[funcId]) {
                        const modeName = harvestModes[funcId];
                        sysLog('تم اعتراض حصاد الآلة (الوضع: ' + modeName + '). إرسال طلبات حصاد يدوية لمنع خصم البنزين.');
                        closeCropinator(gw.ControllerConst ? gw.ControllerConst.Cropinator : 10010);

                        try {
                            if (window.SF && window.SF.modules) {
                                const autoFarm = window.SF.modules.find(m => m.id === 'autofarm');
                                if (autoFarm && typeof autoFarm.fertilizeBees === 'function') {
                                    sysLog('تشغيل التلقيح التلقائي الصامت قبل الحصاد...');
                                    autoFarm.fertilizeBees(true);
                                }
                            }
                        } catch(e) {
                            sysLog('فشل تشغيل التلقيح التلقائي: ' + e);
                        }

                        if (modeName === "ONE_CROP") {
                            executeManualHarvesting("ALL_CROP");
                        } else {
                            executeManualHarvesting(modeName);
                        }
                        return null;
                    }

                    return origApplyFunc.apply(this, arguments);
                };

                sysLog('تم تفعيل سكربت ZeroGas Cropinator V1.1 بنجاح.');
            }

            function executeManualPlanting(seedId) {
                const emptySoils = findEmptySoils(seedId);
                if (emptySoils.length === 0) {
                    sysLog('لا توجد تربة فارغة صالحة لهذه البذرة.');
                    return;
                }

                const currentScene = gw.GF && gw.GF.loginModel ? gw.GF.loginModel.AppData.scene_select : 1;
                const seedConfig = gw.Config ? gw.Config.Store_GetItemData(seedId) : null;

                sysLog('جاري تجهيز طلبات الزراعة اليدوية لعدد ' + emptySoils.length + ' أرض...');

                emptySoils.forEach(soil => {
                    const fakeUniqueId = 10000 + (soil.map_unique_id || soil.uid || Date.now());

                    const payload = {
                        unique_id: String(fakeUniqueId),
                        plant_id: seedId,
                        soil_x: soil.grid_x !== undefined ? soil.grid_x : soil.map_x,
                        soil_y: soil.grid_y !== undefined ? soil.grid_y : soil.map_y,
                        x: soil.grid_x !== undefined ? soil.grid_x : soil.map_x,
                        y: soil.grid_y !== undefined ? soil.grid_y : soil.map_y,
                        cur_sceneid: currentScene,
                        greenhouse_id: 100249,
                        greenhouse_x: 82,
                        greenhouse_y: 78
                    };

                    gw.NetUtils.enqueue(gw.HttpConst && gw.HttpConst.ADD_PLANT ? gw.HttpConst.ADD_PLANT : 'add_plant.save_data', payload);

                    try {
                        if (seedConfig && gw.App && gw.App.ControllerManager) {
                            const gameCtrl = gw.App.ControllerManager.getController(gw.ControllerConst.Game);
                            if (gameCtrl && typeof gameCtrl._soilToPlant === 'function') {
                                const newPlant = gameCtrl._soilToPlant(soil, seedConfig, true);
                                if (newPlant) {
                                    newPlant.greenhouse_id = 100249;
                                    if (newPlant.serverData) newPlant.serverData.greenhouse_id = 100249;
                                    if (typeof newPlant.update_collect_in === 'function') newPlant.update_collect_in();
                                }
                            }
                        }
                    } catch(e) {}
                });

                gw.NetUtils.flush();
                sysLog('تم دمج جميع طلبات الزراعة (Flush) وإرسالها للسيرفر.');
            }

            function executeManualHarvesting(modeName) {
                const ripeTargets = findRipeTargets(modeName);
                if (ripeTargets.length === 0) {
                    sysLog('لا توجد عناصر جاهزة للحصاد بهذا الوضع.');
                    return;
                }

                sysLog('جاري تنفيذ الحصاد اليدوي لعدد ' + ripeTargets.length + ' عنصر...');

                let gc = null;
                if (gw.App && gw.App.ControllerManager) {
                    gc = gw.App.ControllerManager.getController(gw.ControllerConst.Game);
                }

                if (!gc) {
                    sysLog('تعذر العثور على GameController.');
                    return;
                }

                ripeTargets.forEach(target => {
                    try {
                        let preCalcProductId = null;
                        let preCalcIsWaterCrop = false;
                        try {
                            let pObj = target.plant || target.crop || target;
                            let seedId = pObj.plant_id || pObj.plantId || pObj.seed_id || (pObj.configData ? pObj.configData.id : null);
                            if (seedId && seedId != 101 && gw.Config) {
                                let c = gw.Config.Store_GetItemData(seedId);
                                preCalcProductId = c ? (c.product_id || c.product || seedId) : seedId;
                                if (c && (c.water_ranch === true || c.water_ranch === 1)) preCalcIsWaterCrop = true;
                                if (!c && target.configData) {
                                    if (target.configData.product_id) preCalcProductId = target.configData.product_id;
                                    if (target.configData.water_ranch === true || target.configData.water_ranch === 1) preCalcIsWaterCrop = true;
                                }
                            }
                        } catch(e) {}

                        if (typeof gc._collectMapObject === 'function') gc._collectMapObject(target);
                        else if (typeof gc.collectMapObject === 'function') gc.collectMapObject(target);
                        else if (typeof target.harvest === 'function') target.harvest();
                        else if (typeof target.collect === 'function') target.collect();

                        let type = (target.type || (target.configData && target.configData.type) || '').toLowerCase();
                        let className = (target.className || (target.configData && target.configData.className) || '');
                        let isActualPlant = (className === 'Plant' || className === 'Crop' || type === 'plant' || type === 'crop' || type === 'seeds' || isInstanceOf(target, "Plant"));
                        let isFieldOrSoil = (className === 'Field' || className === 'Soil' || className === 'Soil2' || className === 'Soil3' || type === 'field' || type === 'soil');

                        target.state = 0;

                        if (isActualPlant) {
                            if (typeof gc._harvestOneCrop === 'function') {
                                try { gc._harvestOneCrop([target]); } catch(e) {}
                            }
                        } else if (isFieldOrSoil) {
                            try {
                                let plantObj = target.plant || target.crop;
                                if (plantObj && !plantObj.isDestroyed) {
                                    if (typeof gc._harvestOneCrop === 'function') try { gc._harvestOneCrop([plantObj]); } catch(e) {}
                                } else if (gw.GameGridData && gw.GameGridData.uidDictionary) {
                                    let allObjs = Object.values(gw.GameGridData.uidDictionary);
                                    allObjs.forEach(obj => {
                                        if (obj && obj !== target && obj.col === target.col && obj.row === target.row) {
                                            let objClass = (obj.className || obj.configData?.className || '').toLowerCase();
                                            if (objClass.includes('plant') || objClass.includes('crop') || objClass.includes('seed')) {
                                                if (typeof gc._harvestOneCrop === 'function') try { gc._harvestOneCrop([obj]); } catch(e) {}
                                            }
                                        }
                                    });
                                }
                            } catch(e) {}
                        }

                        try {
                            if (preCalcProductId && preCalcProductId != 101) {
                                if (gw.GF && gw.GF.loginModel && gw.GF.loginModel.AppData) {
                                    if (preCalcIsWaterCrop && gw.GF.loginModel.AppData.drier && gw.GF.loginModel.AppData.drier.crops) {
                                        let cropsArr = gw.GF.loginModel.AppData.drier.crops;
                                        let found = false;
                                        for (let i = 0; i < cropsArr.length; i++) {
                                            if (cropsArr[i].id == preCalcProductId) {
                                                cropsArr[i].qty = (cropsArr[i].qty || 0) + 1;
                                                found = true;
                                                break;
                                            }
                                        }
                                        if (!found) {
                                            cropsArr.push({ id: preCalcProductId, qty: 1 });
                                        }
                                    } else if (gw.GF.loginModel.AppData.storage) {
                                        let curQty = gw.GF.loginModel.AppData.storage[preCalcProductId] || 0;
                                        gw.GF.loginModel.AppData.storage[preCalcProductId] = curQty + 1;
                                    }
                                }
                                if (gw.GF && gw.GF.gameController && gw.Animations) {
                                    gw.GF.gameController.collectTopTip(preCalcProductId, 1);
                                }
                            }
                        } catch(e) {}
                    } catch(e) {
                        sysLog('خطأ أثناء حصاد العنصر ' + target.id + ': ' + e.message);
                    }
                });

                gw.NetUtils.flush();
                sysLog('تم الانتهاء من الحصاد اليدوي.');
            }

            function findEmptySoils(seedId) {
                let mapObjs = [];
                if (gw.GameGridData) {
                    if (gw.GameGridData.uidDictionary) {
                        mapObjs = Object.values(gw.GameGridData.uidDictionary);
                    } else if (gw.GameGridData.moList) {
                        mapObjs = gw.GameGridData.moList;
                    }
                }
                if (mapObjs.length === 0) return [];

                const seedConfig = gw.Config ? gw.Config.Store_GetItemData(seedId) : null;
                const isSeedWater = seedConfig ? !!seedConfig.water_ranch : false;

                return mapObjs.filter(o => {
                    if (!o || o.isDestroyed || o.usable === false) return false;
                    const isSoil = isInstanceOf(o, "Soil") || isInstanceOf(o, "Soil2") || isInstanceOf(o, "Soil3") || (o.objName && String(o.objName).includes("Soil"));
                    if (!isSoil) return false;
                    const isSoilWater = !!o.water_ranch;
                    return isSeedWater === isSoilWater;
                });
            }

            function findRipeTargets(modeName) {
                let mapObjs = [];
                if (gw.GameGridData) {
                    if (gw.GameGridData.uidDictionary) {
                        mapObjs = Object.values(gw.GameGridData.uidDictionary);
                    } else if (gw.GameGridData.moList) {
                        mapObjs = gw.GameGridData.moList;
                    }
                }
                if (mapObjs.length === 0) return [];

                let targets = [];
                mapObjs.forEach(o => {
                    if (!o || o.isDestroyed) return;

                    const type = (o.type || (o.configData && o.configData.type) || '').toLowerCase();
                    const className = (o.className || (o.configData && o.configData.className) || '');

                    let isCrop = (className === 'Crop' || className === 'Plant' || type === 'crop' || type === 'seeds' || type === 'plant');
                    let isField = (className === 'Soil' || className === 'Field' || className === 'Soil2' || className === 'Soil3' || type === 'soil' || type === 'field' || o.id == 101);
                    let isTree = isInstanceOf(o, "Tree");

                    let isReady = typeof o.isReady === 'function' ? o.isReady() : false;

                    if (isCrop || isField || isTree) {
                        let st = o.state || 0;
                        if (st == 2 || st === 'collect_over' || st === 'ripe' || o.readyToHarvest) {
                            isReady = true;
                        }
                    }

                    if (isReady) {
                        if (modeName === "ALL_CROP" && (isCrop || isField)) targets.push(o);
                        if (modeName === "ALL_TREE" && isTree) targets.push(o);
                        if (modeName === "ALL_CROP_AND_TREE" && (isCrop || isField || isTree)) targets.push(o);
                    }
                });
                return targets;
            }

            function applyGreenhouseVisualPatch() {
                if (gw.GF && gw.GF.loginModel && !gw.GF.loginModel._hookedDirtyData) {
                    const originalDirtyData = gw.GF.loginModel.dealDirtyData;
                    gw.GF.loginModel.dealDirtyData = function() {
                        try {
                            if (!this || !this.AppData || !this.AppData.map) return;
                            var t = this.AppData.map;
                            var e = {};
                            var i = [];
                            for (var o in t) {
                                var n = t[o];
                                if (n && typeof n === 'object') {
                                    e[n.id + "_" + n.map_x + "_" + n.map_y] = 1;
                                    if (n.uid) e[n.uid + "_" + n.map_x + "_" + n.map_y] = 1;
                                }
                            }
                            for (var o in t) {
                                var n = t[o];
                                if (n && typeof n === 'object' && n.greenhouse_id) {
                                    var r = n.greenhouse_id + "_" + n.greenhouse_x + "_" + n.greenhouse_y;
                                    if (!e[r]) {
                                        i.push(n.id + "_" + n.map_x + "_" + n.map_y + ":" + r);
                                        n.greenhouse_id = 0; n.greenhouse_x = 0; n.greenhouse_y = 0;
                                    }
                                }
                            }
                        } catch(e) {}
                    };
                    gw.GF.loginModel._hookedDirtyData = true;
                    sysLog("تم تفعيل رقعة حماية انهيار الخريطة (DirtyData Bypass).");
                }

                if (gw.CollectObject && gw.CollectObject.prototype && !gw.CollectObject.prototype._hookedGreenhouse) {
                    const originalCompute = gw.CollectObject.prototype._compute_new_collect_in;
                    gw.CollectObject.prototype._compute_new_collect_in = function() {
                        try {
                            if (isInstanceOf(this, "Plant")) {
                                if (!this.greenhouse_id) {
                                    this.greenhouse_id = 100249;
                                    this.greenhouse_x = 82;
                                    this.greenhouse_y = 78;
                                }
                                if (this.serverData && !this.serverData.greenhouse_id) {
                                    this.serverData.greenhouse_id = 100249;
                                    this.serverData.greenhouse_x = 82;
                                    this.serverData.greenhouse_y = 78;
                                }
                            }
                        } catch(e) {}

                        if (typeof originalCompute === 'function') {
                            return originalCompute.apply(this, arguments);
                        }
                    };
                    gw.CollectObject.prototype._hookedGreenhouse = true;
                    sysLog("تم تفعيل رقعة خصم الوقت البصري الدائم (-40%).");
                }
            }

            function isInstanceOf(o, className) {
                if (!o) return false;
                const egretClass = o.__class__ || (o.constructor && o.constructor.prototype && o.constructor.prototype.__class__);
                if (egretClass === className) return true;
                if (o.constructor && o.constructor.name === className) return true;
                if (gw[className] && o instanceof gw[className]) return true;
                return false;
            }

            function closeCropinator(cropCtrl) {
                try {
                    if (gw.App && gw.App.ControllerManager && cropCtrl) {
                        gw.App.ControllerManager.applyFunc(cropCtrl, 10010);
                        gw.App.ControllerManager.applyFunc(cropCtrl, 10002);
                    }
                } catch(e) {}
            }

            function getConstName(className, val) {
                if (gw[className]) {
                    for (let k in gw[className]) {
                        if (gw[className][k] === val) return k;
                    }
                }
                return null;
            }

            setTimeout(initZeroGasMachine, 3000);
        };

        const tryInject = () => {
            const headOrDoc = document.head || document.documentElement;
            if (headOrDoc) {
                const script = document.createElement('script');
                script.textContent = '(' + fnStr + ')();';
                headOrDoc.appendChild(script);
                script.remove();
                console.log('[SupremeFarm Modular] Injected Cropinator Ghost Protocol');
            } else {
                window.addEventListener('DOMContentLoaded', tryInject, { once: true });
            }
        };

        if (document.readyState === 'loading') {
            window.addEventListener('DOMContentLoaded', tryInject, { once: true });
        } else {
            tryInject();
        }
    }
};

// Register the module

new SF.CropinatorModule();


// --- File: config/MachineBuilderAccounts.js ---
// ملف إعدادات حسابات بناء الآلات
// انسخ كل المفاتيح (الكوكيز) والصقها هنا تحت بعضها مباشرة
// بدون أي علامات تنصيص، وبدون فواصل، وبدون أي أكواد إضافية.

window.MachineBuilderAccounts = `
2xlpe7xjvkr4vsojee7p0mq000005oau
21i2wia9svcx428qvwiltw4k00005ob2
21ni4y3ostq7gt0mhml4947y0000akng
23lrcb1go4otqwqjzj1z9xh600005oas
2z1p28a0eqlj64sduluz48qo0000aknl
215b7lf2c9lg6wdmkqoai11t00005ob2
2z1s8peimjigf2urqp11v9zc000058os
22fbtk54k06ulm1cork1mel800005oba
234ttcjzzijhs4qi4i0qsskq000099hg
2vfpsebx0jo2yl37605v6nr400005lpp
214femdu89etxgsscff07ksp00005obp
22f1vq681lahza5k0u0t188v0000aku3
233xklbtdj5y4zzirg12cw9k00005obq
234ui55mmkql1glvba8m9hqm00009jmd
234unq7yu65eqis026lgqal900007apk
234uoue9slsyxafnt2vhxvr600005obd
22epqj6cbi0qxjm50w2xircm0000aktr
234uzuc0vlf30x3svajxjmow00005k54
22h365bgvhhbnycqe0nk3tka00007aof
211sqh2u8o6h2npgbp3bvla400005ob0
21yedp4tfadrl2cc6icbx5xh00007anl
2ypbc2gyyksfh5vz1z2gl6yj00005obx
23lnq9e4jxysx7czmc3coe1z00005oat
22isk8an9kgpminjfs4juam80000aktf
234vcicowt1weuvtzjw36rgo00005kcu
234vdm9eskeyerngr0hkbcia0000akt3
211prm5suxegtg5z4x3mitu4000099w5
211q9x114e3yzd82jcrkhkd40000akud
211rro5j2yzs8kyrno95g8uz0000akut
211sn81k8d0f3llmnd7v01jq0000ts3p
211tai62ykcvjotaj5vtn7gb0000aktd
211tr92udfho3ozcv7s3atsp0000aktb
211u402x2ggnevxjboqrukmb0000akt9
211v0g5bd90bqk2hdadjup690000aku8
211vq22gmysjos0gtxq7etrb0000ts49
212spx1r2gzrpqe1dhh6yx8n0000akt1
`;


// --- File: features/MachineBuilderModule.js ---
// --- features/MachineBuilderModule.js ---
window.SF = window.SF || {};

SF.MachineBuilderModule = class MachineBuilderModule extends SF.ModuleBase {
    constructor() {
        super("machine_builder", "بناء الآلات", "🛠️");
    }

    render() {
        const BOT_PREFIX = "bot-mb-";
        return `
        <style>
        #${BOT_PREFIX}container {
            position: fixed; top: 20px; left: 20px; width: 380px;
            background: rgba(15, 20, 25, 0.95); border: 2px solid #00ffcc;
            border-radius: 10px; padding: 15px; color: #fff;
            font-family: 'Segoe UI', Tahoma, sans-serif; z-index: 999999;
            box-shadow: 0 0 15px rgba(0, 255, 204, 0.5); backdrop-filter: blur(5px);
        }
        .${BOT_PREFIX}title { font-size: 16px; font-weight: bold; color: #00ffcc; text-align: center; margin-bottom: 15px; border-bottom: 1px solid #333; padding-bottom: 5px; }
        .${BOT_PREFIX}btn { width: 100%; background: #00ffcc; color: #000; border: none; padding: 8px; margin: 5px 0; font-weight: bold; cursor: pointer; border-radius: 4px; transition: 0.3s; }
        .${BOT_PREFIX}btn:hover { background: #00ccaa; }
        .${BOT_PREFIX}btn:disabled { background: #555; color: #888; cursor: not-allowed; }
        .${BOT_PREFIX}select { width: 100%; background: #222; color: #00ffcc; border: 1px solid #00ffcc; padding: 5px; margin: 5px 0; }
        .${BOT_PREFIX}textarea { width: 100%; height: 80px; background: #111; color: #00ffcc; border: 1px solid #005544; border-radius: 4px; margin: 5px 0; padding: 8px; font-size: 11px; font-family: monospace; resize: vertical; box-sizing: border-box; }
        .${BOT_PREFIX}log { background: #080c0f; border: 1px solid #005544; border-radius: 4px; height: 160px; overflow-y: auto; font-family: monospace; font-size: 11px; padding: 8px; color: #00ff00; margin-top: 10px; box-sizing: border-box; }
        .${BOT_PREFIX}log p { margin: 3px 0; border-bottom: 1px dashed #1a2a2a; padding-bottom: 2px; }
        .${BOT_PREFIX}error { color: #ff4444; }
        .${BOT_PREFIX}warning { color: #ffaa00; }
        .${BOT_PREFIX}success { color: #00ffcc; }
        .${BOT_PREFIX}info { color: #88ccff; }
        </style>
        <div class="sf-card" style="padding: 15px; color: #fff;">
            <div class="${BOT_PREFIX}title" style="font-size: 16px; font-weight: bold; color: #00ffcc; text-align: center; margin-bottom: 15px; border-bottom: 1px solid #333; padding-bottom: 5px;">🛠️ Machine Builder V9 (Elite Bot)</div>
            <button id="${BOT_PREFIX}btn-scan" class="sf-btn" style="width: 100%; margin: 5px 0;">1. فحص المزرعة الحية</button>
            <select id="${BOT_PREFIX}select-machine" style="width: 100%; background: #222; color: #00ffcc; border: 1px solid #00ffcc; padding: 5px; margin: 5px 0;">
                <option value="">-- اضغط فحص أولاً --</option>
            </select>
            <div style="font-size: 11px; color: #88ccff; margin-top: 10px;">2. الحسابات (يتم سحبها تلقائياً من config/MachineBuilderAccounts.js):</div>
            <textarea id="${BOT_PREFIX}textarea-alts" style="display:none;"></textarea>
            <button id="${BOT_PREFIX}btn-check-keys" class="sf-btn" style="width: 100%; margin: 5px 0; background: #228855; color: #fff;">4. فحص صلاحية المفاتيح المدمجة</button>
            <button id="${BOT_PREFIX}btn-start" class="sf-btn" disabled style="width: 100%; margin: 5px 0;">3. بدء الحقن</button>
            <div style="font-size: 10px; color: #ffaa00; margin-top: 8px; text-align: center; background: rgba(0,0,0,0.5); padding: 5px; border-radius: 4px;" id="${BOT_PREFIX}status">
                الحساب الحالي: <span id="${BOT_PREFIX}mem-index" style="color:#fff; font-weight:bold;">0</span> 
                <a href="#" id="${BOT_PREFIX}btn-reset-index" style="color:#ff4444; text-decoration:none; margin-right:8px; font-weight:bold;">[تصفير العداد]</a>
            </div>
            <div id="${BOT_PREFIX}invalid-keys-container" style="display:none; margin-top: 10px;">
                <div style="font-size: 11px; color: #ffaa00; margin-bottom: 5px;">⚠️ المفاتيح المنتهية (انسخها واحذفها من الإعدادات):</div>
                <textarea id="${BOT_PREFIX}textarea-invalid-keys" style="width: 100%; height: 60px; background: #330000; color: #ff8888; border: 1px solid #ff4444; border-radius: 4px; padding: 5px; font-size: 10px; font-family: monospace; resize: vertical; box-sizing: border-box;" readonly></textarea>
            </div>
            <div id="${BOT_PREFIX}log-area" style="background: #080c0f; border: 1px solid #005544; border-radius: 4px; height: 160px; overflow-y: auto; font-family: monospace; font-size: 11px; padding: 8px; color: #00ff00; margin-top: 10px; box-sizing: border-box;"></div>
        </div>
        `;
    }

    bindEvents() {
        const BOT_PREFIX = "bot-mb-";
        const STATIC_ACCOUNTS = window.MachineBuilderAccounts || "";

    let altAccounts = [];
    let incompleteMachines = [];
    let isRunning = false;

    const btnScan = this.container.querySelector(`#${BOT_PREFIX}btn-scan`);
    const selectMachine = this.container.querySelector(`#${BOT_PREFIX}select-machine`);
    const textareaAlts = this.container.querySelector(`#${BOT_PREFIX}textarea-alts`);
    const btnCheckKeys = this.container.querySelector(`#${BOT_PREFIX}btn-check-keys`);
    const invalidKeysContainer = this.container.querySelector(`#${BOT_PREFIX}invalid-keys-container`);
    const textareaInvalidKeys = this.container.querySelector(`#${BOT_PREFIX}textarea-invalid-keys`);
    const btnStart = this.container.querySelector(`#${BOT_PREFIX}btn-start`);
    const logArea = this.container.querySelector(`#${BOT_PREFIX}log-area`);
    const memIndexSpan = this.container.querySelector(`#${BOT_PREFIX}mem-index`);
    const btnResetIndex = this.container.querySelector(`#${BOT_PREFIX}btn-reset-index`);

    const STATE_KEY = "Bot_Alt_State_V8";

    // حساب "يوم اللعبة" بحيث يتغير عند الساعة 7 صباحاً
    function getGameDayString() {
        let now = new Date();
        if (now.getHours() < 7) now.setDate(now.getDate() - 1);
        return now.toDateString();
    }

    function getSavedState() {
        try {
            let state = localStorage.getItem(STATE_KEY);
            let gameDay = getGameDayString();
            if (state) {
                let parsed = JSON.parse(state);
                if (parsed.date === gameDay) return parsed.index;
            }
        } catch (e) {}
        return 0;
    }

    function saveState(index) {
        localStorage.setItem(STATE_KEY, JSON.stringify({
            date: getGameDayString(),
            index: index
        }));
    }

    memIndexSpan.textContent = getSavedState();

    btnResetIndex.addEventListener('click', (e) => {
        e.preventDefault();
        saveState(0);
        memIndexSpan.textContent = "0";
        logMsg("تم تصفير عداد الحسابات بنجاح.", "success");
    });

    function logMsg(msg, type = 'normal') {
        const p = document.createElement('p');
        p.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
        if (type === 'error') p.className = `${BOT_PREFIX}error`;
        if (type === 'warning') p.className = `${BOT_PREFIX}warning`;
        if (type === 'success') p.className = `${BOT_PREFIX}success`;
        if (type === 'info') p.className = `${BOT_PREFIX}info`;
        logArea.appendChild(p);
        logArea.scrollTop = logArea.scrollHeight;
    }

    function loadAccountsFromText() {
        const lines = textareaAlts.value.split('\n');
        altAccounts = [];
        lines.forEach(line => {
            line = line.trim();
            if (!line) return;
            if (line.includes('|')) {
                let parts = line.split('|');
                if (parts.length >= 2) altAccounts.push({ type: 'direct', uid: parts[0].trim(), sessionKey: parts[1].trim() });
            } else if (line.includes('__Host-bf_s=')) {
                let cookie = line.split('__Host-bf_s=')[1].split(';')[0].trim();
                altAccounts.push({ type: 'cookie', cookie: cookie });
            } else if (line.length > 25) {
                // افتراض أنه كوكيز مباشر
                altAccounts.push({ type: 'cookie', cookie: line });
            }
        });
        checkReadyState();
    }

    // تحميل الحسابات المدمجة عند بدء التشغيل
    if (STATIC_ACCOUNTS) {
        if (typeof STATIC_ACCOUNTS === 'string' && STATIC_ACCOUNTS.trim().length > 0) {
            textareaAlts.value = STATIC_ACCOUNTS.trim();
            loadAccountsFromText();
            logMsg(`تم تحميل ${altAccounts.length} حساب مدمج تلقائياً.`, 'info');
        } else if (Array.isArray(STATIC_ACCOUNTS) && STATIC_ACCOUNTS.length > 0) {
            textareaAlts.value = STATIC_ACCOUNTS.join('\n');
            loadAccountsFromText();
            logMsg(`تم تحميل ${altAccounts.length} حساب مدمج تلقائياً.`, 'info');
        }
    }

    textareaAlts.addEventListener('input', () => {
        saveState(0);
        memIndexSpan.textContent = "0";
        loadAccountsFromText();
    });

    // ==========================================
    // 3. محرك الفحص الذكي (مع حساب نقرات الجيران)
    // ==========================================
    btnScan.addEventListener('click', () => {
        try {
            if (typeof GF === 'undefined' || !GF.loginModel || !GF.loginModel.AppData) {
                logMsg('خطأ: اللعبة غير محملة.', 'error');
                return;
            }

            let mapObjects = [];
            if (typeof GameGridData !== 'undefined' && GameGridData.ins && GameGridData.ins.moList) {
                mapObjects = GameGridData.ins.moList;
            } else if (typeof GF !== 'undefined' && GF.scene && GF.scene.sceneGrid && GF.scene.sceneGrid.moList) {
                mapObjects = GF.scene.sceneGrid.moList;
            }

            if (mapObjects.length === 0 && typeof egret !== 'undefined' && egret.MainContext) {
                let searchEgretTree = (container) => {
                    if(!container || typeof container.getChildAt !== 'function') return;
                    for (let i = 0; i < container.numChildren; i++) {
                        let child = container.getChildAt(i);
                        if (child && typeof child.is_under_construction === 'function') mapObjects.push(child);
                        if (child && child.numChildren > 0) searchEgretTree(child);
                    }
                };
                searchEgretTree(egret.MainContext.instance.stage);
            }

            incompleteMachines = [];
            for (let i = 0; i < mapObjects.length; i++) {
                const obj = mapObjects[i];
                if (obj && typeof obj.is_under_construction === 'function' && obj.is_under_construction()) {
                    if (obj.configData && obj.configData.materials) {
                        let missingCount = 0;
                        let missingMats = {};
                        let required = obj.configData.materials;

                        let obtained = obj.obtained_materials || (obj.serverData && obj.serverData.obtained_materials) || {};
                        let neighborMats = (obj.serverData && obj.serverData.neighbor_materials && obj.serverData.neighbor_materials.materials) ? obj.serverData.neighbor_materials.materials : {};

                        for (let j = 0; j < required.length; j++) {
                            let reqMat = required[j];
                            let matId = reqMat.id;
                            let reqQty = Number(reqMat.qty);

                            // 🔥 دمج النقرات التي استلمتها اللعبة مسبقاً من الجيران + المشترية
                            let obtQty = Number(obtained[matId] || 0);
                            let neighQty = Number(neighborMats[matId] || 0);
                            let totalHave = obtQty + neighQty;

                            let isFree = false;
                            if (typeof GameUtils !== 'undefined' && typeof GameUtils.isFreeMaterial === 'function') {
                                isFree = GameUtils.isFreeMaterial(Number(matId));
                            } else {
                                let matConfig = Config.Store_GetItemData(matId);
                                isFree = matConfig && (matConfig.rp_price == 1) && Boolean(matConfig.giftable);
                            }

                            if (isFree && reqQty > totalHave) {
                                let diff = reqQty - totalHave;
                                missingCount += diff;
                                missingMats[matId] = diff;
                            }
                        }

                        if (missingCount > 0) {
                            incompleteMachines.push({ objData: obj, missingCount: missingCount, materials: missingMats });
                        }
                    }
                }
            }

            if (incompleteMachines.length === 0) {
                logMsg(`لا يوجد آلات تحتاج مواد مجانية.`, 'warning');
                selectMachine.innerHTML = '<option value="">-- لا يوجد أهداف --</option>';
            } else {
                selectMachine.innerHTML = '';
                incompleteMachines.forEach((item, index) => {
                    let rawId = item.objData.configData ? item.objData.configData.id : (item.objData.serverData ? item.objData.serverData.id : item.objData.id);
                    let name = "آلة مجهولة";
                    try {
                    if (item.objData.configData && item.objData.configData.name) {
                        name = item.objData.configData.name;
                    } else {
                        let prodId = item.objData.configData ? (item.objData.configData.product || item.objData.configData.id || rawId) : rawId;
                        let cnf = Config.Store_GetItemData(prodId);
                        if(cnf && cnf.name) name = cnf.name;
                    }
                    } catch(e) {}

                    const opt = document.createElement('option');
                    opt.value = index;
                    opt.textContent = `[${name}] يحتاج ${item.missingCount} طاقة مجانية`;
                    selectMachine.appendChild(opt);
                });
                logMsg(`تم العثور على ${incompleteMachines.length} هدف.`);
                checkReadyState();
            }
        } catch (err) {
            logMsg(`خطأ الفحص: ${err.message}`, 'error');
        }
    });

    function checkReadyState() {
        btnStart.disabled = !(incompleteMachines.length > 0 && altAccounts.length > 0);
    }

    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const randomJitter = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

    // ==========================================
    // 4. محرك استخراج مفاتيح السيرفر (CenturyPro Style)
    // ==========================================
    const RETRIEVE_DATA_B64 = "AAMAAAABABJEYXRhSGFuZGxlci5oYW5kbGUAAi8xAAAA/woAAAAEAgANcmV0cmlldmVfZGF0YREKCwEXZmJfc2lnX3VzZXIGIzAwMDAwMDAwMDAwMDAwMDAwCWxhbmcGBWFyDXNnbktleQYvMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAVc2duU2Vzc2lvbgY9MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwE3BsaW5nYUtleQYVMTc3Mzc5MjQzMRtwbGluZ2FTZXNzaW9uBkE5YzU5MTQwNGQ3NGY1YmU2MmI5ODA1NTA1ZjliYzIzNhdjdXJfc2NlbmVpZAQACWZpZHMJAQEPY2FsbF9pZAEBAgAIcmV0cmlldmUBAQ==";

    function replaceAmfString(buffer, keyName, newValue) {
        let u8 = new Uint8Array(buffer);
        let keyBytes = new TextEncoder().encode(keyName);
        let newValBytes = new TextEncoder().encode(newValue);

        let startIdx = -1;
        for (let i = 0; i < u8.length - keyBytes.length; i++) {
            let match = true;
            for (let j = 0; j < keyBytes.length; j++) {
                if (u8[i+j] !== keyBytes[j]) { match = false; break; }
            }
            if (match) { startIdx = i; break; }
        }

        if (startIdx !== -1) {
            let pos = startIdx + keyBytes.length;
            let marker = u8[pos];
            if (marker === 0x06) {
                let oldLenStr = u8[pos+1] >> 1;
                let oldBlockSize = 2 + oldLenStr; // 1 marker + 1 len + str bytes

                let newLenMarker = (newValBytes.length << 1) | 1;
                let newBlock = new Uint8Array(2 + newValBytes.length);
                newBlock[0] = 0x06;
                newBlock[1] = newLenMarker;
                newBlock.set(newValBytes, 2);

                let out = new Uint8Array(u8.length - oldBlockSize + newBlock.length);
                out.set(u8.subarray(0, pos), 0);
                out.set(newBlock, pos);
                out.set(u8.subarray(pos + oldBlockSize), pos + newBlock.length);
                return out.buffer;
            }
        }
        return buffer;
    }

    function extract_amf_login_session(buffer) {
        let u8 = new Uint8Array(buffer);
        let keyBytes = new TextEncoder().encode("loginSession");
        let startIdx = -1;
        for (let i = 0; i < u8.length - keyBytes.length; i++) {
            let match = true;
            for (let j = 0; j < keyBytes.length; j++) {
                if (u8[i+j] !== keyBytes[j]) { match = false; break; }
            }
            if (match) { startIdx = i; break; }
        }
        if (startIdx !== -1) {
            let idx = startIdx + 12;
            let marker = u8[idx];
            if (marker === 0x06) {
                let len = u8[idx+1] >> 1;
                return new TextDecoder().decode(u8.subarray(idx+2, idx+2+len));
            } else if (marker === 0x02) {
                let len = (u8[idx+1] << 8) | u8[idx+2];
                return new TextDecoder().decode(u8.subarray(idx+3, idx+3+len));
            } else {
                let chunk = new TextDecoder("ascii").decode(u8.subarray(idx, idx+25));
                let match = chunk.match(/[\x00-\x10]([a-zA-Z0-9]{8,15})/);
                if (match) return match[1];
            }
        }
        return "";
    }

    function extract_amf_iq(buffer) {
        let u8 = new Uint8Array(buffer);
        let iq4 = [0x69, 0x71, 0x04]; // 'i', 'q', 0x04
        let idx = -1;
        for (let i = 0; i < u8.length - 3; i++) {
            if (u8[i] === iq4[0] && u8[i+1] === iq4[1] && u8[i+2] === iq4[2]) {
                idx = i; break;
            }
        }
        if (idx !== -1) {
            idx += 3;
            let val = 0;
            for (let i = 0; i < 4; i++) {
                if (idx >= u8.length) break;
                let b = u8[idx++];
                if (i === 3) {
                    val = (val << 8) | b; break;
                } else {
                    val = (val << 7) | (b & 0x7F);
                    if (b < 128) break;
                }
            }
            return val;
        }
        return null;
    }

    // 🔥 دالة عزل الطلبات (Ghost Injector) لمنع المتصفح من دمج كوكيز حسابك الأساسي مع الحساب المساعد
    function sendAmfAsGhost(amfClientObj, methodName, methodTarget, amfParams, customCookie, serverDomain) {
        return new Promise((resolve, reject) => {
            let originalOpen = XMLHttpRequest.prototype.open;
            let originalSend = XMLHttpRequest.prototype.send;
            let originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

            let intercepted = false;
            let ghostUrl = "";
            let ghostHeaders = {};

            XMLHttpRequest.prototype.open = function(method, url) {
                if (url && url.includes("gateway.php") && url.includes("s=")) {
                    intercepted = true;
                    ghostUrl = url;
                }
                originalOpen.apply(this, arguments);
            };

            XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
                if (intercepted) { ghostHeaders[header] = value; }
                originalSetRequestHeader.apply(this, arguments);
            };

            XMLHttpRequest.prototype.send = function(data) {
                XMLHttpRequest.prototype.open = originalOpen;
                XMLHttpRequest.prototype.send = originalSend;
                XMLHttpRequest.prototype.setRequestHeader = originalSetRequestHeader;

                if (intercepted) {
                    let fakeXhr = this;
                    GM_xmlhttpRequest({
                        method: "POST",
                        url: (ghostUrl.startsWith("http") ? ghostUrl : (serverDomain + ghostUrl)).replace("http://", "https://"),
                        data: (function(d){
                            if(typeof d === 'string') {
                                let u8 = new Uint8Array(d.length);
                                for(let i=0; i<d.length; i++) u8[i] = d.charCodeAt(i) & 0xff;
                                return new Blob([u8.buffer], {type: "application/x-amf"});
                            } else if (d instanceof ArrayBuffer || d instanceof Uint8Array) {
                                return new Blob([d], {type: "application/x-amf"});
                            }
                            return d;
                        })(data),
                        responseType: "arraybuffer",
                        anonymous: true,
                        cookie: `__Host-bf_s=${customCookie}`,
                        headers: { 
                            "Content-Type": ghostHeaders["Content-Type"] || "application/x-amf",
                            "Accept": "*/*",
                            "Origin": "https://familyfarm-play-fb.diandian.com",
                            "Referer": "https://familyfarm-play-fb.diandian.com/",
                            "Cookie": `__Host-bf_s=${customCookie}`
                        },
                        onload: function(res) {
                            Object.defineProperty(fakeXhr, 'readyState', { value: 4 });
                            Object.defineProperty(fakeXhr, 'status', { value: res.status });
                            Object.defineProperty(fakeXhr, 'response', { value: res.response });
                            Object.defineProperty(fakeXhr, 'responseType', { value: "arraybuffer", writable: true });
                            fakeXhr.getResponseHeader = function(name) {
                                if (name.toLowerCase() === "content-type") return "application/x-amf";
                                return "";
                            };
                            if (fakeXhr.onload) fakeXhr.onload({ target: fakeXhr });
                            if (fakeXhr.onreadystatechange) fakeXhr.onreadystatechange();
                        },
                        onerror: function(err) {
                            console.error("[FakeXHR Error] Request failed:", err);
                            Object.defineProperty(fakeXhr, 'readyState', { value: 4 });
                            Object.defineProperty(fakeXhr, 'status', { value: 0 });
                            Object.defineProperty(fakeXhr, 'response', { value: new ArrayBuffer(0) });
                            if (fakeXhr.onload) fakeXhr.onload({ target: fakeXhr });
                            if (fakeXhr.onreadystatechange) fakeXhr.onreadystatechange();
                        },
                        onerror: function(err) {
                            if (fakeXhr.onerror) fakeXhr.onerror(err);
                        }
                    });
                } else {
                    originalSend.apply(this, arguments);
                }
            };

            amfClientObj.invoke(methodName, methodTarget, amfParams, false, true).then(res => {
                XMLHttpRequest.prototype.open = originalOpen;
                XMLHttpRequest.prototype.send = originalSend;
                XMLHttpRequest.prototype.setRequestHeader = originalSetRequestHeader;
                resolve(res);
            }, err => {
                XMLHttpRequest.prototype.open = originalOpen;
                XMLHttpRequest.prototype.send = originalSend;
                XMLHttpRequest.prototype.setRequestHeader = originalSetRequestHeader;
                resolve({ error: "network_error", details: err });
            });
        });
    }

    function extractKeysFromCookie(cookieVal) {
        return new Promise((resolve) => {
            let safeCookie = cookieVal.trim().split('\n')[0].replace(/__Host-bf_s=/g, '').trim();
            GM_xmlhttpRequest({
                method: "GET",
                url: "https://farm.centurygames.com/play?ref=canvas2web&gv=us",
                anonymous: true,
                cookie: `__Host-bf_s=${safeCookie}`,
                headers: {
                    "User-Agent": navigator.userAgent,
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
                    "Sec-Fetch-Dest": "document",
                    "Sec-Fetch-Mode": "navigate",
                    "Sec-Fetch-Site": "none",
                    "Sec-Fetch-User": "?1",
                    "Upgrade-Insecure-Requests": "1"
                },
                onload: function(response) {
                    let html = response.responseText;
                    let keys = {};

                    let sgnSessMatch = html.match(/"sgnSession"\s*:\s*"?([^"',;}\s]+)"?/i) || html.match(/sgnSession\s*=\s*["']([^"']+)["']/i) || html.match(/var\s+sessionKey\s*=\s*["']([^"']+)["']/i);
                    let loginSessMatch = html.match(/"loginSession"\s*:\s*"?([^"',;}\s]+)"?/i) || html.match(/loginSession\s*=\s*["']([^"']+)["']/i);
                    let sgnKeyMatch = html.match(/"sgnKey"\s*:\s*"?([^"',;}\s]+)"?/i) || html.match(/sgnKey\s*=\s*["']([^"']+)["']/i);
                    let uidMatch = html.match(/var\s+snsid\s*=\s*"?([\w:]+)"?/i) || html.match(/"uid"\s*:\s*"?([\w:]+)"?/i);

                    if (uidMatch) keys.uid = uidMatch[1];
                    if (sgnSessMatch) keys.sgnSession = sgnSessMatch[1];
                    if (loginSessMatch) keys.loginSession = loginSessMatch[1];
                    if (sgnKeyMatch) keys.sgnKey = sgnKeyMatch[1];

                    // Fallbacks exactly like CenturyPro
                    if (!keys.sgnSession && keys.loginSession) keys.sgnSession = keys.loginSession;
                    if (!keys.sgnKey && keys.sgnSession) keys.sgnKey = keys.sgnSession;

                    if (keys.sgnSession && keys.uid) {
                        resolve(keys);
                    } else {
                        let shortResp = (html && html.length < 200) ? ` | نص الرد: ${html.replace(/\n/g, ' ')}` : "";
                        logMsg(`[تشخيص الخطأ] فشل الاستخراج! الرابط: ${response.finalUrl || 'غير معروف'} | حجم الرد: ${html ? html.length : 0} حرف.${shortResp}`, 'error');
                        resolve(null);
                    }
                },
                onerror: function(err) {
                    logMsg(`[تشخيص الخطأ] فشل الاتصال بخادم اللعبة أثناء الاستخراج.`, 'error');
                    resolve(null);
                }
            });
        });
    }

    // ==========================================
    // 5. محرك الحقن المباشر (Dynamic Payload Engine)
    // ==========================================

    btnCheckKeys.addEventListener('click', async () => {
        if (altAccounts.length === 0) {
            logMsg('لا يوجد حسابات للفحص. يرجى إضافة مفاتيح.', 'warning');
            return;
        }
        btnCheckKeys.disabled = true;
        btnStart.disabled = true;
        btnScan.disabled = true;
        invalidKeysContainer.style.display = 'none';
        textareaInvalidKeys.value = '';
        logMsg(`بدء فحص ${altAccounts.length} مفتاح بدقة...`, 'info');
        
        let validCount = 0;
        let invalidCount = 0;
        let invalidKeysText = [];

        for (let j = 0; j < altAccounts.length; j++) {
            let acc = altAccounts[j];
            logMsg(`[فحص] جاري تجربة المفتاح رقم ${j}...`);
            
            if (acc.type === 'direct') {
                logMsg(`[شغال] المفتاح رقم ${j} مباشر. (UID: ${acc.uid})`, 'success');
                validCount++;
                continue;
            }

            try {
                let params = await extractKeysFromCookie(acc.cookie);
                if (params && params.sgnSession) {
                    logMsg(`[شغال] المفتاح رقم ${j} صالح. (UID: ${params.uid})`, 'success');
                    validCount++;
                } else {
                    logMsg(`[منتهي] المفتاح رقم ${j} غير صالح أو طرد.`, 'error');
                    invalidCount++;
                    invalidKeysText.push(acc.cookie);
                }
            } catch(e) {
                logMsg(`[منتهي] المفتاح رقم ${j} تعذر استخراج بياناته.`, 'error');
                invalidCount++;
                invalidKeysText.push(acc.cookie);
            }
            await wait(randomJitter(800, 1500));
        }

        logMsg(`============= تقرير الفحص =============`, 'info');
        logMsg(`المفاتيح الصالحة: ${validCount}`, 'success');
        logMsg(`المفاتيح المنتهية/المعطلة: ${invalidCount}`, 'error');

        if (invalidCount > 0) {
            invalidKeysContainer.style.display = 'block';
            textareaInvalidKeys.value = invalidKeysText.join('\n');
        }

        btnCheckKeys.disabled = false;
        checkReadyState();
        btnScan.disabled = false;
    });

    btnStart.addEventListener('click', async () => {
        if (isRunning) return;
        const selectedIndex = selectMachine.value;
        if (selectedIndex === "") return;

        const targetInfo = incompleteMachines[selectedIndex];
        const targetObj = targetInfo.objData;
        let totalMissing = targetInfo.missingCount;
        let materialsNeeded = JSON.parse(JSON.stringify(targetInfo.materials));

        isRunning = true;
        btnStart.disabled = true;
        btnScan.disabled = true;

        let rawId = targetObj.configData ? targetObj.configData.id : (targetObj.serverData ? targetObj.serverData.id : targetObj.id);
        logMsg(`[بدء الهجوم] على الآلة ID: ${rawId} | العدد المطلوب: ${totalMissing}`);

        const myUid = GF.loginModel.AppData.uid;
        const myName = GF.loginModel.AppData.name || "Elite_Bot";
        let mySceneId = GF.loginModel.AppData.scene_select;
        if (mySceneId === undefined || mySceneId === null) mySceneId = GF.loginModel.AppData.sceneId;
        if (mySceneId === undefined || mySceneId === null) mySceneId = 1;

        let materialQueue = [];
        for (let matId in materialsNeeded) {
            let count = parseInt(materialsNeeded[matId]);
            for (let i = 0; i < count; i++) materialQueue.push(matId);
        }

        let domain = "";
        if (typeof App !== 'undefined' && App.Platform && typeof App.Platform.serverUrl === 'function') {
            domain = App.Platform.serverUrl();
        }
        if (domain && !domain.endsWith('/')) domain += '/';

        // 🔥 التحقق من وجود المكتبات الحرجة (بند 6: التعافي الذاتي)
        if (typeof amf === 'undefined' || typeof amf.Client !== 'function') {
            logMsg(`[خطأ حرج] مكتبة AMF غير محملة. تأكد من تحميل اللعبة أولاً.`, 'error');
            isRunning = false; btnStart.disabled = false; btnScan.disabled = false; return;
        }

        let accountIndex = getSavedState();
        if (accountIndex >= altAccounts.length) {
            logMsg(`[تنبيه] الحسابات استنفدت! ضع مفاتيح جديدة واضغط فحص.`, 'error');
            isRunning = false; btnStart.disabled = false; btnScan.disabled = false; return;
        }

        while (materialQueue.length > 0 && accountIndex < altAccounts.length) {
            const currentAlt = altAccounts[accountIndex];
            memIndexSpan.textContent = accountIndex;

            let currentUid, currentSession, currentLoginSession, currentSgnKey;

            // 🔥 نظام الاستخراج الذكي من الكوكيز
            if (currentAlt.type === 'cookie') {
                logMsg(`[تجهيز] استخراج UID من الكوكيز ${accountIndex}...`);
                let extracted = await extractKeysFromCookie(currentAlt.cookie);
                if (!extracted) {
                    logMsg(`[خطأ] فشل استخراج الكلمات من المفتاح. ننتقل للتالي.`, 'error');
                    accountIndex++;
                    continue;
                }
                currentUid = extracted.uid;
                currentSession = extracted.sgnSession;
                currentLoginSession = extracted.loginSession;
                currentSgnKey = extracted.sgnKey;
                // كاش لتسريع الطلبات القادمة لنفس الحساب
                currentAlt.type = 'direct';
                currentAlt.uid = currentUid;
                currentAlt.sessionKey = currentSession;
                currentAlt.loginSession = currentLoginSession;
                currentAlt.sgnKey = currentSgnKey;
            } else {
                currentUid = currentAlt.uid;
                currentSession = currentAlt.sessionKey;
                currentLoginSession = currentAlt.loginSession;
                currentSgnKey = currentAlt.sgnKey || currentSession;
            }

            try {
                let sUrl = domain.replace("http://", "https://") + "gateway.php?s=" + currentSession.substring(0, 6) + "_" + currentUid;
                let myGhostClient = new amf.Client("save_data", sUrl);

                // 🔥 1. طلب ملف الداتا باستخدام القالب الثابت (Base64) تماماً كما في CenturyPro
                if (!currentAlt.loginSession) {
                    logMsg(`[تجهيز] حقن الكلمات في ملف الداتا لاستخراج loginSession للحساب ${currentUid.substring(0, 5)}...`);

                    let binStr = atob(RETRIEVE_DATA_B64);
                    // مطابقة استبدال المفاتيح حرفياً كما في بايثون
                    binStr = binStr.replace("plingaSession", "ignoreSession");
                    binStr = binStr.replace("data_hash", "data_void");

                    let pBytes = new Uint8Array(binStr.length);
                    for (let k = 0; k < binStr.length; k++) pBytes[k] = binStr.charCodeAt(k);

                    pBytes = new Uint8Array(replaceAmfString(pBytes.buffer, 'fb_sig_user', currentUid));
                    pBytes = new Uint8Array(replaceAmfString(pBytes.buffer, 'sgnKey', currentSgnKey));
                    pBytes = new Uint8Array(replaceAmfString(pBytes.buffer, 'sgnSession', currentSession));

                    // 🔥 الإصلاح الحاسم: تحديث طول الرسالة (AMF Message Length) لأن حجم البايتات تغير!
                    // الطول مسجل في البايتات 30, 31, 32, 33 (Big Endian)
                    let newMsgLength = pBytes.length - 34;
                    pBytes[30] = (newMsgLength >>> 24) & 0xFF;
                    pBytes[31] = (newMsgLength >>> 16) & 0xFF;
                    pBytes[32] = (newMsgLength >>> 8) & 0xFF;
                    pBytes[33] = newMsgLength & 0xFF;

                    try {
                        let initRes = await new Promise((resolve) => {
                            GM_xmlhttpRequest({
                                method: "POST",
                                url: sUrl,
                                data: new Blob([pBytes.buffer], {type: "application/x-amf"}),
                                responseType: "arraybuffer",
                                anonymous: true,
                                cookie: `__Host-bf_s=${currentAlt.cookie || currentAlt.sessionKey}`,
                                headers: { 
                                    "Content-Type": "application/x-amf",
                                    "Accept": "*/*",
                                    "Origin": "https://familyfarm-play-fb.diandian.com",
                                    "Referer": "https://familyfarm-play-fb.diandian.com/",
                                    "Cookie": `__Host-bf_s=${currentAlt.cookie || currentAlt.sessionKey}`
                                },
                                onload: resolve,
                                onerror: (err) => {
                                    console.error("[GM_xmlhttpRequest] Error:", err);
                                    err.response = err.response || new ArrayBuffer(0); // fallback
                                    resolve(err);
                                }
                            });
                        });

                        if (initRes && initRes.status && initRes.status >= 400) {
                            logMsg(`[خطأ] رد HTTP ${initRes.status} أثناء استخراج الداتا. تخطي.`, 'error');
                            accountIndex++; saveState(accountIndex); continue;
                        }
                        if (initRes && initRes.response) {
                            let ls = extract_amf_login_session(initRes.response);
                            let extractedIq = extract_amf_iq(initRes.response);

                            if (ls) {
                                currentLoginSession = ls;
                                currentAlt.loginSession = ls;
                                if (extractedIq) {
                                    currentAlt.iq = extractedIq;
                                    logMsg(`[نجاح] تم استخراج loginSession و IQ (${extractedIq}) من ملف الداتا بنجاح!`);
                                } else {
                                    logMsg(`[نجاح] تم استخراج loginSession بنجاح! (${ls.substring(0,5)}...)`);
                                }
                            } else {
                                // 💡 كود استكشافي مدمج لمعرفة سبب الرفض من السيرفر
                                let byteLen = 0;
                                let errorText = 'Unknown Error';
                                try {
                                    let respU8 = new Uint8Array(initRes.response);
                                    byteLen = respU8.length;
                                    let ascii = '';
                                    for(let i=0; i<respU8.length; i++){
                                        if (respU8[i] >= 32 && respU8[i] <= 126) ascii += String.fromCharCode(respU8[i]);
                                        else ascii += '.';
                                    }
                                    let printable = ascii.replace(/\.+/g, '.').substring(0, 100);
                                    errorText = `(Bytes: ${byteLen}) ` + printable;
                                } catch(e) {}
                                logMsg(`[Rejected] Server reply: ${errorText}`, 'error');
                                console.error('[Hawk-Eye] Failed AMF Dump:', initRes.response);
                                
                                accountIndex++;
                                saveState(accountIndex);
                                continue;
                            }
                        } else {
                            logMsg(`[خطأ] فشل الاتصال للحصول على ملف الداتا. سيتم التخطي.`, 'error');
                            accountIndex++;
                            saveState(accountIndex);
                            continue;
                        }
                    } catch (e) {
                        logMsg(`[خطأ] فشل في استخراج الداتا: ${e.message}`, 'error');
                        accountIndex++;
                        saveState(accountIndex);
                        continue;
                    }
                }

                // 🔥 2. تنفيذ النقرات "نقرة نقرة" كما طلبت، بدون دمج
                if (!currentAlt.clicksCount) currentAlt.clicksCount = 0;

                // نتأكد أن الحساب لم يتجاوز 5 نقرات
                if (currentAlt.clicksCount >= 5) {
                    logMsg(`[تغيير] الحساب أدى 5 نقرات، ننتقل للتالي...`);
                    accountIndex++;
                    saveState(accountIndex);
                    continue;
                }

                let batchItems = [];
                let rawX = targetObj.grid_x !== undefined ? targetObj.grid_x : (targetObj.serverData ? targetObj.serverData.x : 0);
                let rawY = targetObj.grid_y !== undefined ? targetObj.grid_y : (targetObj.serverData ? targetObj.serverData.y : 0);

                if (!currentAlt.iq) currentAlt.iq = Math.floor(Math.random() * 100000) + 1000;
                currentAlt.iq++;
                let currentIq = currentAlt.iq;

                let currentCallId = "call" + (new Date().getTime() + currentAlt.clicksCount);

                let currentIqHash = "";
                if (typeof md5 !== 'undefined' && typeof md5.hex === 'function') {
                    currentIqHash = md5.hex(currentIq.toString() + currentSgnKey);
                }

                // 🔥 اختيار عشوائي للمادة (مطابقة لسلوك اللعبة: getHelpMaterialID → randomArray)
                let randomIndex = Math.floor(Math.random() * materialQueue.length);
                let selectedMatId = materialQueue[randomIndex];
                // 🔥 Payload مطابق 100% للكود الأصلي (LoginProxy.onFriendHelpMaterial)
                // 🔥 حساب opTime ديناميكياً لتجنب الكشف
                let dynOpTime = Number((1.25 + (currentAlt.clicksCount * 0.35)).toFixed(2));

                batchItems.push({
                    "method": "Friend/SendMaterial",
                    "data": {
                        "machineId": parseInt(rawId),
                        "x": rawX,
                        "y": rawY,
                        "cur_sceneid": mySceneId,
                        "friend_id": GF.loginModel.AppData.uid,
                        // 🔥 تصحيح: friendName هنا هو اسم المرسل
                        "friendName": currentAlt.name || ("Neighbor_" + currentUid.substring(0, 5)),
                        "materialId": parseInt(selectedMatId)
                    },
                    "opTime": dynOpTime
                });

                logMsg(`[حقن] إرسال مادة ${selectedMatId} (نقرة ${currentAlt.clicksCount + 1}/5) للحساب ${currentUid.substring(0,5)}...`);

                let amfParams = {
                    "fb_sig_user": currentUid,
                    "uid": currentUid,
                    "lang": "ar",
                    "sgnKey": currentSgnKey,
                    "sgnSession": currentSession,
                    "plingaKey": "1773792431",
                    "plingaSession": currentSession,
                    "trackRef": "canvas2web",
                    "fbSource": "",
                    "swf_version": navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0] || "Chrome 134.0.0.0",
                    "version": 77,
                    "isWeb": true,
                    "iq": currentIq,
                    "queue": batchItems,
                    "iq_hash": currentIqHash,
                    "loginSession": currentLoginSession,
                    "data_void": "bypass_hash",
                    "call_id": currentCallId,
                    "lasttime_log": new Date().getTime() - 1000,
                    "addTime": 1.5
                };

                // 🔥 Pre-Flight Validation (بند 12 من الدستور)
                if (!currentUid || !currentSession || !currentLoginSession) {
                    logMsg(`[تدقيق] مفاتيح الحساب ناقصة (uid/session/login). تخطي.`, 'error');
                    accountIndex++; saveState(accountIndex); continue;
                }

                let t_start = Date.now();
                let resJson = await sendAmfAsGhost(myGhostClient, "execute_batch", "save_data", amfParams, currentAlt.cookie || currentAlt.sessionKey, domain);
                let responseData = resJson ? resJson.data : null;
                logMsg(`[تتبع] زمن الاستجابة: ${Date.now() - t_start}ms`);

                let isSuccess = false;
                let limitReached = false;

                if (responseData) {
                    // بناءً على هيكل الرد الصحيح (موضح بالصورة): النجاح يعتمد على وجود mid كرقم داخل objects_to_update
                    if (responseData.objects_to_update && responseData.objects_to_update.length > 0 && responseData.objects_to_update[0].mid) {
                        isSuccess = true;
                    } else if (responseData.error === "no need") {
                        limitReached = false;
                        materialQueue = materialQueue.filter(m => m !== selectedMatId);
                        totalMissing = materialQueue.length;
                        logMsg(`[مادة مكتملة] المادة ${selectedMatId} اكتملت (no need).`, 'info');
                    } else if (responseData.error || responseData.retrieve_error || responseData.state !== "ok") {
                        limitReached = true;
                    } else {
                        // رد سليم ولكن بدون mid = لم تتم الإضافة
                        logMsg(`[تحذير] رد فارغ من السيرفر بدون mid. تخطي.`, 'warning');
                        limitReached = true;
                    }
                } else {
                    limitReached = true;
                }

                if (isSuccess) {
                    // 🔥 تحديث حالة اللعبة الحية (المزرعة) فوراً لتجنب التكرار في الفحص القادم
                    let matIdStr = selectedMatId.toString();
                    if (!targetObj.obtained_materials) targetObj.obtained_materials = {};
                    targetObj.obtained_materials[matIdStr] = Number(targetObj.obtained_materials[matIdStr] || 0) + 1;
                    
                    if (targetObj.serverData) {
                        if (!targetObj.serverData.obtained_materials) targetObj.serverData.obtained_materials = {};
                        targetObj.serverData.obtained_materials[matIdStr] = Number(targetObj.serverData.obtained_materials[matIdStr] || 0) + 1;
                    }

                    // 🔥 إزالة المادة المحددة من الطابور
                    let matIdx = materialQueue.indexOf(selectedMatId);
                    if (matIdx !== -1) materialQueue.splice(matIdx, 1);
                    totalMissing--;
                    
                    currentAlt.clicksCount++;  // 🔥 زيادة العداد بعد النجاح
                    currentAlt.retryCount = 0;
                    logMsg(`[نجاح] تمت الإضافة (نقرة ${currentAlt.clicksCount}/5). المتبقي: ${totalMissing}`, 'success');
                } else if (limitReached) {
                    logMsg(`[نفاذ الطاقة] الحساب ${currentUid} استنفد طاقته أو مفتاحه منتهي.`, 'warning');
                    accountIndex++;
                    saveState(accountIndex);
                }

            } catch (err) {
                // 🔥 إعادة محاولة متصاعدة (بند 11 من الدستور)
                if (!currentAlt.retryCount) currentAlt.retryCount = 0;
                currentAlt.retryCount++;
                if (currentAlt.retryCount <= 2) {
                    let backoff = currentAlt.retryCount * 1500;
                    logMsg(`[إعادة محاولة ${currentAlt.retryCount}/2] الحساب ${currentUid} بعد ${backoff}ms: ${err.message}`, 'warning');
                    await wait(backoff);
                    continue;
                }
                logMsg(`[خطأ اتصال] الحساب ${currentUid} فشل بعد ${currentAlt.retryCount} محاولات: ${err.message}`, 'error');
                currentAlt.retryCount = 0;
                accountIndex++;
                saveState(accountIndex);
            }

            await wait(randomJitter(300, 700));
        }

        if (totalMissing <= 0) {
            logMsg(`====================`);
            logMsg(`[اكتمال] تم بناء الآلة بالكامل بنجاح! 🎉`, 'success');
        } else {
            logMsg(`[توقف] تم استنفاد كل المفاتيح المدرجة. المتبقي: ${totalMissing}`, 'warning');
        }

        saveState(accountIndex);
        memIndexSpan.textContent = accountIndex;
        isRunning = false;
        btnStart.disabled = false;
        btnScan.disabled = false;
    });

    }
};
SF.modules.register(new SF.MachineBuilderModule());


// --- File: features/AlbumTrackerModule.js ---
window.SF = window.SF || {};

SF.AlbumTrackerModule = class AlbumTrackerModule extends SF.ModuleBase {
    constructor() {
        super('albumtracker', 'الألبوم الذكي', '📚');
        this.isSendMessage = false;
        this.showingOnlyMissing = false;
        this.langDict = { en: null, tr: null };
        this.isFetchingLangs = false;
        this.imgLoadTasks = [];
        
        // المتغيرات الجديدة لفحص الأصدقاء
        this.isFriendMatching = false;
        this.friendMissingNames = [];
    }

    render() {
        return `
            <style>
                .sf-album-content {
                    flex: 1;
                    padding: 10px 0;
                    max-height: 60vh;
                    overflow-y: auto;
                    margin-top: 15px;
                    border-top: 1px solid rgba(255,255,255,0.1);
                    display: none; /* مخفي في البداية */
                }
                .sf-album-content::-webkit-scrollbar { width: 8px; }
                .sf-album-content::-webkit-scrollbar-thumb { background: var(--sf-primary); border-radius: 4px; }
                .sf-album-content::-webkit-scrollbar-track { background: rgba(0,0,0,0.3); }
                .sf-page-container {
                    background: rgba(0,0,0,0.3);
                    margin-bottom: 10px;
                    border: 1px solid rgba(255,255,255,0.1);
                    border-radius: 8px;
                    overflow: hidden;
                }
                .sf-page-title {
                    background: var(--sf-primary);
                    color: white;
                    padding: 10px;
                    font-weight: bold;
                    font-size: 14px;
                    cursor: pointer;
                    list-style-position: inside;
                    outline: none;
                }
                .sf-rarity-normal { color: #bdc3c7; }
                .sf-rarity-special { color: #f1c40f; font-weight: bold; }
                .sf-action-btn {
                    padding: 5px 10px;
                    border: none;
                    border-radius: 5px;
                    cursor: pointer;
                    font-weight: bold;
                    color: white;
                }
                .sf-btn-ask { background: #e74c3c; }
                .sf-btn-send { background: #f39c12; }
            </style>
            
            <div class="sf-card">
                <p style="color: var(--sf-text-muted); font-size: 13px; margin-bottom: 15px; text-align: center;">
                    استخراج بطاقات الألبوم بأسماء أصلية مع أزرار الطلب والإرسال والبحث الذكي.
                </p>
                
                <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                    <button class="sf-btn" id="sf-album-tracker-btn" style="flex: 1; background: #27ae60; color: white; border: 2px solid #2ecc71; font-weight: bold;">
                        استخراج الألبوم 📚
                    </button>
                    <button class="sf-btn" id="sf-album-open-pkgs-btn" style="flex: 1; background: #8e44ad; color: white; border: 2px solid #9b59b6; font-weight: bold;">
                        فتح حزم التخزين 🎁
                    </button>
                </div>

                <div id="sf-album-tracker-content" class="sf-album-content">
                    <div style="position: sticky; top: 0; z-index: 100; background: var(--sf-bg); padding-bottom: 10px; margin-bottom: 10px;">
                        
                        <!-- صندوق فحص النواقص للصديق -->
                        <div style="display: flex; flex-direction: column; margin-bottom: 10px; background: rgba(0,0,0,0.2); border-radius: 5px;">
                            <div id="sf-friend-box-header" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.1);">
                                <span style="color: #f1c40f; font-size: 14px; font-weight: bold;">📋 قائمة نواقص الصديق (اضغط للطي/الفتح)</span>
                                <span id="sf-friend-box-icon" style="color: white; font-size: 14px; transition: 0.3s; display: inline-block;">▼</span>
                            </div>
                            <div id="sf-friend-missing-body" style="display: flex; gap: 10px; padding: 10px; transition: 0.3s;">
                                <textarea id="sf-album-friend-missing-text" placeholder="📝 الصق هنا قائمة النواقص المنسوخة من الصديق..." style="flex: 1; padding: 10px; border-radius:5px; border:1px solid #3498db; background: rgba(0,0,0,0.5); color: white; font-size: 13px; outline: none; resize: none; min-height: 40px; max-height: 250px; overflow-y: auto; transition: height 0.2s;"></textarea>
                                <div style="display: flex; flex-direction: column; justify-content: flex-start; width: 120px;">
                                    <button id="sf-btn-match-friend" class="sf-btn" style="background:#2ecc71; padding: 12px 8px; font-size:13px; height: 100%;">فحص المتطابق 🔍</button>
                                </div>
                            </div>
                        </div>

                        <input type="text" id="sf-album-search-input" placeholder="🔍 بحث عن بطاقة..." style="width: 100%; padding: 8px; border-radius:5px; border:1px solid var(--sf-border); background: rgba(0,0,0,0.5); color: white; font-size: 13px; outline: none; margin-bottom: 8px; box-sizing: border-box;" />
                        <div style="display: flex; gap: 5px;">
                            <button id="sf-btn-filter-missing" class="sf-btn" style="flex:1; background:#e74c3c; font-size:12px;">فلترة النواقص ❌</button>
                            <button id="sf-btn-copy-missing" class="sf-btn" style="flex:1; background:#3498db; font-size:12px;">نسخ النواقص 📋</button>
                            <button id="sf-btn-send-multi" class="sf-btn" style="flex:1; background:#f39c12; font-size:12px; display:none;">إرسال المحدد 🎁 (0)</button>
                        </div>
                    </div>
                    
                    <div id="sf-album-content-body">
                        <!-- Pages will be injected here -->
                    </div>
                </div>
            </div>
        `;
    }

    bindEvents() {
        const btn = this.container.querySelector('#sf-album-tracker-btn');
        const contentDiv = this.container.querySelector('#sf-album-tracker-content');
        const searchInput = this.container.querySelector('#sf-album-search-input');
        const filterMissingBtn = this.container.querySelector('#sf-btn-filter-missing');
        const copyMissingBtn = this.container.querySelector('#sf-btn-copy-missing');

        if (searchInput) {
            searchInput.onkeyup = () => this.filterAlbumCards();
        }

        if (filterMissingBtn) {
            filterMissingBtn.onclick = () => this.toggleMissingFilter();
        }

        if (copyMissingBtn) {
            copyMissingBtn.onclick = () => this.copyAllMissing();
        }

        if (btn) {
            btn.onclick = () => this.openAlbumTracker(btn, contentDiv);
        }

        const openPkgsBtn = this.container.querySelector('#sf-album-open-pkgs-btn');
        if (openPkgsBtn) {
            openPkgsBtn.onclick = () => this.openAllPackages(openPkgsBtn);
        }

        const ta = this.container.querySelector('#sf-album-friend-missing-text');
        if (ta) {
            ta.oninput = () => {
                ta.style.height = '';
                ta.style.height = Math.min(ta.scrollHeight, 250) + 'px';
            };
        }

        const friendHeader = this.container.querySelector('#sf-friend-box-header');
        if (friendHeader) {
            friendHeader.onclick = () => this.toggleFriendBox();
        }

        const matchBtn = this.container.querySelector('#sf-btn-match-friend');
        if (matchBtn) {
            matchBtn.onclick = () => this.matchFriendCards();
        }

        const multiSendBtn = this.container.querySelector('#sf-btn-send-multi');
        if (multiSendBtn) {
            multiSendBtn.onclick = () => this.triggerMultiSend();
        }

        this.container.addEventListener('change', (e) => {
            if (e.target && e.target.classList.contains('sf-album-multi-send-cb')) {
                this.updateMultiSendBtn();
            }
        });

        unsafeWindow.triggerAlbumSmartSearch = (cardId, isAsk, pageId) => this.triggerAlbumSmartSearch(cardId, isAsk, pageId);
        unsafeWindow.copyAlbumText = (text, btnElement) => this.copyAlbumText(text, btnElement);

        this.hookAlbumView();
    }

    hookAlbumView() {
        if (this.isWareHooked) return;
        this.isWareHooked = true;
        
        let self = this;
        let tryHook = setInterval(() => {
            if (unsafeWindow.AlbumWareView && unsafeWindow.AlbumWareView.prototype.open) {
                clearInterval(tryHook);
                
                let origWareOpen = unsafeWindow.AlbumWareView.prototype.open;
                unsafeWindow.AlbumWareView.prototype.open = function() {
                    origWareOpen.apply(this, arguments);
                    
                    setTimeout(() => {
                        let albumModel = unsafeWindow.GF.albumModel;
                        if (albumModel) {
                            let packages = albumModel.getPackageList();
                            let total = 0;
                            if (packages && packages.length > 0) {
                                packages.forEach(p => total += p.num);
                            }
                            if (total > 0) {
                                self.showInGamePopup(total);
                            }
                        }
                    }, 800);
                };
            }
        }, 1000);
    }

    showInGamePopup(total) {
        if (document.getElementById('sf-ingame-pkg-popup')) return;
        
        let div = document.createElement('div');
        div.id = 'sf-ingame-pkg-popup';
        div.style.cssText = `
            position: absolute; top: 10%; left: 50%; transform: translateX(-50%);
            background: linear-gradient(135deg, rgba(142, 68, 173, 0.95), rgba(41, 128, 185, 0.95));
            border: 3px solid #f1c40f; border-radius: 15px; padding: 20px;
            z-index: 999999; text-align: center; color: white;
            box-shadow: 0 10px 25px rgba(0,0,0,0.8); font-family: Tahoma, sans-serif;
            width: 350px; backdrop-filter: blur(5px);
        `;
        div.innerHTML = `
            <h3 style="margin-top:0; color: #f1c40f; text-shadow: 1px 1px 2px #000;">🎁 حزم الألبوم المكدسة</h3>
            <p style="font-size:14px; margin-bottom: 20px; line-height: 1.5; text-shadow: 1px 1px 1px #000;">
                الرادار التقط <b>${total}</b> حزمة جديدة أو مكدسة.<br>
                بدل ما تفتحهم واحدة واحدة وتوجع إيدك.. تحب أفتحهم لك بضربة واحدة؟ 😎
            </p>
            <div style="display:flex; gap:10px; justify-content:center;">
                <button id="sf-ig-yes" style="background:#2ecc71; color:white; border:2px solid #27ae60; padding:10px 15px; border-radius:8px; cursor:pointer; font-weight:bold; flex:1; font-size:13px; box-shadow: 0 4px 6px rgba(0,0,0,0.3); transition: 0.2s;">دوس يا وحش 🚀</button>
                <button id="sf-ig-no" style="background:#e74c3c; color:white; border:2px solid #c0392b; padding:10px 15px; border-radius:8px; cursor:pointer; font-weight:bold; flex:1; font-size:13px; box-shadow: 0 4px 6px rgba(0,0,0,0.3); transition: 0.2s;">لا شكراً ❌</button>
            </div>
            <div id="sf-ig-status" style="margin-top: 15px; font-size:13px; font-weight:bold; color:#f1c40f; text-shadow: 1px 1px 1px #000; min-height:18px;"></div>
        `;
        document.body.appendChild(div);
        
        let btnYes = document.getElementById('sf-ig-yes');
        let btnNo = document.getElementById('sf-ig-no');
        
        btnYes.onmouseover = () => btnYes.style.transform = 'scale(1.05)';
        btnYes.onmouseout = () => btnYes.style.transform = 'scale(1)';
        btnNo.onmouseover = () => btnNo.style.transform = 'scale(1.05)';
        btnNo.onmouseout = () => btnNo.style.transform = 'scale(1)';

        btnNo.onclick = () => { div.remove(); };
        btnYes.onclick = async (e) => {
            let status = document.getElementById('sf-ig-status');
            btnYes.disabled = true;
            btnNo.disabled = true;
            btnYes.style.opacity = '0.5';
            btnNo.style.opacity = '0.5';
            
            try {
                let albumModel = unsafeWindow.GF.albumModel;
                let packages = albumModel.getPackageList();
                let openedCount = 0;
                
                for (let i = 0; i < packages.length; i++) {
                    let pkg = packages[i];
                    let isFlame = !!(albumModel.flameCardPackageCfg && albumModel.flameCardPackageCfg[pkg.id]);
                    
                    openedCount += pkg.num;
                    status.innerText = `📦 جاري فتح (${pkg.num}) حزمة من النوع (${i+1}/${packages.length}) بضربة واحدة... 💥`;
                    
                    albumModel.isSendMessage = false; // تجاوز قفل اللعبة
                    if (isFlame) albumModel.callServerUseItemFlame(pkg.id, pkg.num);
                    else albumModel.callServerUseItem(pkg.id, pkg.num);
                    
                    // انتظار بين كل نوع وآخر للسماح للسيرفر بمعالجة الكمية
                    await new Promise(r => setTimeout(r, 800 + Math.random() * 400));
                    
                    // تحديث واجهة الألبوم الأصلية لاختفاء الحزم المفتوحة
                    if (unsafeWindow.GF.albumController) {
                        unsafeWindow.GF.albumController.updateWarePanel1View();
                    }
                }
                status.innerText = 'تم مسح الحزم بنجاح! مبروك ✔️';
                status.style.color = '#2ecc71';
                
                if (unsafeWindow.GF.albumController) {
                    unsafeWindow.GF.albumController.updateWarePanel1View();
                    unsafeWindow.GF.albumController.updateWarePanel3View();
                }
                setTimeout(() => div.remove(), 2500);
            } catch(err) {
                status.innerText = 'حدث خطأ غير متوقع!';
                status.style.color = '#e74c3c';
                setTimeout(() => div.remove(), 2500);
            }
        };
    }


    updateMultiSendBtn() {
        let checked = this.container.querySelectorAll('.sf-album-multi-send-cb:checked');
        let btn = this.container.querySelector('#sf-btn-send-multi');
        if (btn) {
            if (checked.length > 0) {
                btn.style.display = 'block';
                btn.innerText = `إرسال المحدد 🎁 (${checked.length})`;
            } else {
                btn.style.display = 'none';
            }
        }
    }

    triggerMultiSend() {
        let checked = this.container.querySelectorAll('.sf-album-multi-send-cb:checked');
        if (checked.length === 0) return;
        
        this.multiSendQueue = [];
        checked.forEach(cb => {
            this.multiSendQueue.push({
                cardId: parseInt(cb.getAttribute('data-card-id')),
                setId: parseInt(cb.getAttribute('data-set-id'))
            });
        });
        
        // Hook send card if not hooked
        if (!this.sendCardHooked) {
            this.sendCardHooked = true;
            let albumModel = unsafeWindow.GF.albumModel;
            if (albumModel && typeof albumModel.callServerSendCard === 'function') {
                const origSendCard = albumModel.callServerSendCard;
                const self = this;
                albumModel.callServerSendCard = function(cardId, neighbor, cb, ctx) {
                    let res = origSendCard.apply(this, arguments);
                    
                    if (self.isMultiSendingAuto) return res; // Prevent double trigger from our own automated calls

                    if (self.multiSendQueue && self.multiSendQueue.length > 0) {
                        self.multiSendQueue = self.multiSendQueue.filter(c => c.cardId != cardId);
                        if (self.multiSendQueue.length > 0) {
                            self.isMultiSendingAuto = true;
                            self.processMultiSendQueue(neighbor);
                        } else {
                            alert("تم إرسال جميع الكروت المحددة بنجاح! 🚀");
                        }
                    }
                    return res;
                };
            }
        }

        let first = this.multiSendQueue[0];
        this.triggerAlbumSmartSearch(first.cardId, false, first.setId);
    }

    processMultiSendQueue(neighbor) {
        if (!this.multiSendQueue || this.multiSendQueue.length === 0) {
            this.isMultiSendingAuto = false;
            return;
        }
        
        let albumModel = unsafeWindow.GF.albumModel;
        if (!albumModel) {
            this.isMultiSendingAuto = false;
            return;
        }

        let nextItem = this.multiSendQueue.shift();
        
        setTimeout(() => {
            albumModel.isSendMessage = false; // Bypass the lock
            albumModel.callServerSendCard(nextItem.cardId, neighbor, null, null);
            
            if (this.multiSendQueue.length > 0) {
                this.processMultiSendQueue(neighbor);
            } else {
                this.isMultiSendingAuto = false;
                setTimeout(() => alert("تم إرسال جميع الكروت المحددة بنجاح! 🚀"), 1000);
            }
        }, 600); // Wait 600ms between each send
    }

    toggleFriendBox(forceState = null) {
        let body = this.container.querySelector('#sf-friend-missing-body');
        let icon = this.container.querySelector('#sf-friend-box-icon');
        if (!body || !icon) return;
        
        let isHidden = body.style.display === 'none';
        let newState = forceState !== null ? forceState : isHidden;
        
        if (newState) {
            body.style.display = 'flex';
            icon.style.transform = 'rotate(0deg)';
        } else {
            body.style.display = 'none';
            icon.style.transform = 'rotate(180deg)';
        }
    }

    matchFriendCards() {
        if (this.isFriendMatching) {
            this.isFriendMatching = false;
            this.friendMissingNames = [];
            let ta = this.container.querySelector('#sf-album-friend-missing-text');
            if (ta) {
                ta.value = '';
                ta.style.height = '40px';
            }
            let btn = this.container.querySelector('#sf-btn-match-friend');
            if(btn) {
                btn.innerText = 'فحص المتطابق 🔍';
                btn.style.background = '#2ecc71';
            }
            
            this.toggleFriendBox(true);
            this.filterAlbumCards();
            return;
        }

        let ta = this.container.querySelector('#sf-album-friend-missing-text');
        let text = ta ? ta.value.trim() : '';
        
        if (!text) {
            alert("يرجى لصق النواقص أولاً في الحقل المخصص.");
            return;
        }

        let lines = text.split('\n');
        this.friendMissingNames = [];
        lines.forEach(line => {
            line = line.trim();
            if (line.startsWith('- ')) {
                let name = line.substring(2);
                name = name.replace(/\(نادر.*\)/, '').trim();
                if (name) this.friendMissingNames.push(name.toLowerCase());
            } else if (!line.startsWith('[') && line.length > 0) {
                this.friendMissingNames.push(line.toLowerCase());
            }
        });

        if (this.friendMissingNames.length === 0) {
            alert("لم يتم العثور على أسماء كروت في النص.");
            return;
        }

        // إلغاء فلتر النواقص تلقائياً لتجنب التعارض الخفي وإظهار المخزون بالكامل للمطابقة
        if (this.showingOnlyMissing) {
            this.showingOnlyMissing = false;
            let btnFilter = this.container.querySelector('#sf-btn-filter-missing');
            if (btnFilter) {
                btnFilter.style.background = '#e74c3c';
                btnFilter.innerText = 'فلترة النواقص ❌';
            }
        }

        this.isFriendMatching = true;
        let btn = this.container.querySelector('#sf-btn-match-friend');
        if(btn) {
            btn.innerText = 'إلغاء التطابق ❌';
            btn.style.background = '#e74c3c';
        }
        
        this.toggleFriendBox(false);
        this.filterAlbumCards();
    }

    fetchLanguages() {
        if (this.isFetchingLangs || (this.langDict.en && this.langDict.tr)) return;
        this.isFetchingLangs = true;
        
        let resRoot = "";
        if (unsafeWindow.GameConfig && unsafeWindow.GameConfig.resRoot) resRoot = unsafeWindow.GameConfig.resRoot;
        else if (unsafeWindow.resourceRoot) resRoot = unsafeWindow.resourceRoot;
        
        let enUrl = resRoot + "config/lang_en.json";
        let trUrl = resRoot + "config/lang_tr.json";
        
        try {
            let dic = unsafeWindow.RES.config.config ? unsafeWindow.RES.config.config.resourceDic : (unsafeWindow.RES.config.resourceDic || {});
            for (let k in dic) {
                let u = dic[k].url;
                if (u && u.indexOf("lang_") !== -1 && u.indexOf(".json") !== -1) {
                    enUrl = resRoot + u.replace(/lang_[a-z]{2}/, "lang_en");
                    trUrl = resRoot + u.replace(/lang_[a-z]{2}/, "lang_tr");
                    break;
                }
            }
        } catch(e) {}
        
        let bust = "?v=" + Date.now();
        fetch(enUrl + bust).then(r => r.json()).then(d => this.langDict.en = d).catch(e=>{});
        fetch(trUrl + bust).then(r => r.json()).then(d => this.langDict.tr = d).catch(e=>{});
    }

    triggerAlbumSmartSearch(cardId = null, isAsk = true, pageId = 0) {
        this.fetchLanguages();

        try {
            const ctrl = unsafeWindow.GF.albumController;
            if (ctrl && typeof ctrl.onOpenSendFriend === 'function') {
                ctrl.isAskOrSend = isAsk ? 1 : 2;
                ctrl.AskSendCardID = cardId;
                ctrl.currentCard = cardId; 
                if (pageId) ctrl.currentSet = pageId;
                
                ctrl.onOpenSendFriend();
            } else {
                alert("لم يتم العثور على الدالة الأصلية في AlbumController.");
            }
        } catch(e) {
            console.error(e);
            alert("حدث خطأ أثناء فتح نافذة الأصدقاء.");
        }
    }

    filterAlbumCards() {
        let query = this.container.querySelector('#sf-album-search-input').value.toLowerCase();
        let rows = this.container.querySelectorAll('.sf-album-card-row');
        let pages = this.container.querySelectorAll('.sf-page-container');
        
        rows.forEach(row => {
            let text = row.getAttribute('data-search').toLowerCase();
            let isMissing = row.getAttribute('data-missing') === 'true';
            let cardNameRaw = row.getAttribute('data-card-name');
            let cardName = cardNameRaw ? cardNameRaw.toLowerCase() : '';
            let count = parseInt(row.getAttribute('data-count') || '0');
            
            let matchesSearch = text.includes(query);
            let matchesFilter = this.showingOnlyMissing ? isMissing : true;
            
            let matchesFriend = true;
            if (this.isFriendMatching) {
                if (count <= 1) {
                    matchesFriend = false; // Player doesn't have duplicates to send
                } else {
                    let isRequested = this.friendMissingNames.some(reqName => cardName.includes(reqName) || reqName.includes(cardName));
                    if (!isRequested) matchesFriend = false;
                }
            }
            
            row.style.display = (matchesSearch && matchesFilter && matchesFriend) ? '' : 'none';
        });

        pages.forEach(page => {
            let pageRows = page.querySelectorAll('.sf-album-card-row');
            let hasVisible = false;
            pageRows.forEach(r => { if (r.style.display !== 'none') hasVisible = true; });
            
            page.style.display = hasVisible ? '' : 'none';
            if (query.trim() !== '' || this.showingOnlyMissing || this.isFriendMatching) {
                page.open = hasVisible;
            }
        });
    }

    toggleMissingFilter() {
        this.showingOnlyMissing = !this.showingOnlyMissing;
        let btn = this.container.querySelector('#sf-btn-filter-missing');
        btn.style.background = this.showingOnlyMissing ? '#2ecc71' : '#e74c3c';
        btn.innerText = this.showingOnlyMissing ? 'إظهار الكل 👁️' : 'فلترة النواقص ❌';
        this.filterAlbumCards();
    }

    copyAlbumText(text, btnElement) {
        navigator.clipboard.writeText(text).then(() => {
            btnElement.style.opacity = '0.5';
            setTimeout(() => { btnElement.style.opacity = '1'; }, 500);
        });
    }

    copyAllMissing() {
        let text = "قائمة الكروت الناقصة:\n\n";
        let pages = this.container.querySelectorAll('.sf-page-container');
        let hasMissing = false;
        pages.forEach(page => {
            let pageTitleNode = page.querySelector('.sf-page-title');
            let pageTitle = pageTitleNode ? pageTitleNode.innerText.split('اضغط')[0].trim() : '';
            let missingRows = page.querySelectorAll('.sf-album-card-row[data-missing="true"]');
            if (missingRows.length > 0) {
                hasMissing = true;
                text += `[${pageTitle}]\n`;
                missingRows.forEach(row => {
                    let cardName = row.getAttribute('data-card-name');
                    let isRare = row.getAttribute('data-search').includes('نادر');
                    text += `- ${cardName} ${isRare ? '(نادر🌟)' : ''}\n`;
                });
                text += '\n';
            }
        });
        
        if (!hasMissing) {
            text = "تهانينا! لا يوجد كروت ناقصة في هذا الألبوم.";
        }
        
        try {
            let textArea = document.createElement("textarea");
            textArea.value = text;
            textArea.style.position = "fixed";
            textArea.style.left = "-9999px";
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            document.execCommand('copy');
            textArea.remove();
        } catch(e) {}
        
        let btn = this.container.querySelector('#sf-btn-copy-missing');
        let oldText = btn.innerHTML;
        btn.innerHTML = 'تم النسخ ✔️';
        btn.style.background = '#2ecc71';
        setTimeout(() => { 
            btn.innerHTML = oldText; 
            btn.style.background = '#3498db';
        }, 2000);
    }

    openAlbumTracker(btn, contentDiv) {
        try {
            const albumModel = unsafeWindow.GF.albumModel;
            if (!albumModel) {
                alert('لم يتم العثور على وحدة تحكم الألبوم في اللعبة.');
                return;
            }

            btn.innerText = 'جاري المزامنة ⏳...';
            btn.disabled = true;
            btn.style.background = '#e67e22';

            const renderAlbumTable = () => {
                btn.innerText = 'تحديث البيانات 🔄';
                btn.disabled = false;
                btn.style.background = '#3498db';

                if (!albumModel.caCfg || !albumModel.caCfg.cards) {
                    alert('لم يتم العثور على كروت، قد يكون الألبوم مغلقاً.');
                    return;
                }

                let cards = albumModel.caCfg.cards;
                let sets = albumModel.caCfg.set;
                let currentKey = albumModel.currentKey; 

                const contentBody = this.container.querySelector('#sf-album-content-body');
                contentBody.innerHTML = '';

                const getLang = (key, fallback) => {
                    if (unsafeWindow.Language && typeof unsafeWindow.Language.GetString === 'function') {
                        let trans = unsafeWindow.Language.GetString(key);
                        if (trans && trans !== key) return trans;
                    }
                    return fallback;
                };

                let pages = {};

                const processCards = (cardDict, isFlame) => {
                    let flameKey = albumModel.currentFlameKey;
                    for (let cardId in cardDict) {
                        if (cardDict.hasOwnProperty(cardId)) {
                            let card = cardDict[cardId];
                            let setId = card.set;
                            
                            if (!pages[setId]) {
                                pages[setId] = { id: setId, cards: [], isFlame: isFlame };
                            }

                            let cKey = isFlame ? flameKey : currentKey;
                            let cardNameKey = isFlame ? "Album_FlameCard" : "Album_Card";
                            let cardName = getLang(cardNameKey + cKey + "_" + card.id, 'كارت ' + card.id);
                            
                            let count = 0;
                            if (isFlame) {
                                if (typeof albumModel.getFlameCardNumById === 'function') count = albumModel.getFlameCardNumById(card.id);
                                else if (albumModel.caDataFlame && albumModel.caDataFlame.list) count = albumModel.caDataFlame.list[card.id] || 0;
                            } else {
                                if (typeof albumModel.getCardNumById === 'function') count = albumModel.getCardNumById(card.id);
                                else if (albumModel.caData && albumModel.caData.list) count = albumModel.caData.list[card.id] || 0;
                            }

                            pages[setId].cards.push({
                                id: card.id, name: cardName, rarity: card.rarity, special: card.special, count: count, isFlame: isFlame
                            });
                        }
                    }
                };

                processCards(cards, false);
                if (albumModel.flameCardCfg && albumModel.caDataFlame) {
                    processCards(albumModel.flameCardCfg, true);
                }

                let finalHtml = '';
                let pageKeys = Object.keys(pages).sort((a,b) => parseInt(a) - parseInt(b));
                
                if (pageKeys.length === 0) {
                    alert("لم يتم العثور على كروت.");
                    return;
                }

                this.imgLoadTasks = [];

                pageKeys.forEach(setId => {
                    let pageData = pages[setId];
                    let isFlame = pageData.isFlame;
                    let cKey = isFlame ? albumModel.currentFlameKey : currentKey;
                    
                    let setDict = isFlame ? albumModel.flameCardSetCfg : sets;
                    let setObj = setDict ? setDict[setId] : null;
                    let setName = setObj ? getLang("Album_Set" + cKey + "_" + setId, 'الصفحة ' + setId) : 'الصفحة ' + setId;
                    if (isFlame) setName = "🔥 " + setName;

                    let tableHtml = `
                        <details class="sf-page-container">
                            <summary class="sf-page-title">
                                ${setName} (${setId}) <span style="font-size:10px; float:left;">اضغط للفتح</span>
                            </summary>
                            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; padding: 10px;">
                    `;

                    pageData.cards.sort((a,b) => a.id - b.id).forEach(card => {
                        let rarityType = card.special == 1 ? '<span class="sf-rarity-special" style="font-size: 10px;">نادر</span>' : '<span class="sf-rarity-normal">عادي</span>';
                        let stars = '⭐'.repeat(card.rarity);

                        let actionHtml = '';
                        if (card.count === 0) {
                            actionHtml = `<button class="sf-action-btn sf-btn-ask" style="width: 100%; font-size:11px;" onclick="window.triggerAlbumSmartSearch(${card.id}, true, ${setId})">طلب 📩</button>`;
                        } else if (card.count > 1) {
                            actionHtml = `<button class="sf-action-btn sf-btn-send" style="width: 100%; font-size:11px;" onclick="window.triggerAlbumSmartSearch(${card.id}, false, ${setId})">إرسال 🎁</button>`;
                        } else {
                            actionHtml = `<button disabled style="width: 100%; padding: 5px; border-radius: 5px; font-weight:bold; background:rgba(255,255,255,0.1); color:#ecf0f1; border:none; font-size:11px;">مملوك</button>`;
                        }

                        let cardNameKey = card.isFlame ? "Album_FlameCard" : "Album_Card";
                        let translationKey = cardNameKey + cKey + "_" + card.id;
                        let enName = this.langDict.en ? this.langDict.en[translationKey] : null;
                        let trName = this.langDict.tr ? this.langDict.tr[translationKey] : null;
                        
                        let fullCopyText = card.name;
                        let multiLangHtml = "";
                        let searchMultiText = "";
                        
                        if (enName || trName) {
                            fullCopyText = card.name + (enName ? " / " + enName : "") + (trName ? " / " + trName : "");
                            searchMultiText = " " + (enName||"") + " " + (trName||"");
                            multiLangHtml = `<div style="color:#f1c40f; font-size:9px; text-align:center; margin-top:2px; font-weight:normal; line-height:1.1;">` + 
                                            (enName ? enName : "") + 
                                            (enName && trName ? " <br/> " : "") + 
                                            (trName ? trName : "") + 
                                            `</div>`;
                        }

                        let imgId = "sf-album-card-img-" + card.id;
                        let imgHtml = '';
                        let countBadgeHtml = '';
                        let checkboxHtml = '';
                        
                        if (card.count > 0) {
                            imgHtml = `<img id="${imgId}" src="" style="width:100%; max-width:110px; aspect-ratio:1; object-fit:contain; border-radius:5px; border:2px solid #2ecc71; background:#fff; display:block; margin: 0 auto;" />`;
                            countBadgeHtml = `<span style="position: absolute; top: -5px; right: -5px; background: #2ecc71; border-radius: 50%; width: 20px; height: 20px; line-height: 20px; text-align: center; font-weight: bold; color: white; border: 2px solid white; z-index: 2; font-size:12px; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">${card.count}</span>`;
                            if (card.count > 1) {
                                checkboxHtml = `<input type="checkbox" class="sf-album-multi-send-cb" data-card-id="${card.id}" data-set-id="${setId}" style="position: absolute; top: 5px; left: 5px; z-index: 3; width: 16px; height: 16px; cursor: pointer;">`;
                            }
                        } else {
                            imgHtml = `<img id="${imgId}" src="" style="width:100%; max-width:110px; aspect-ratio:1; object-fit:contain; border-radius:5px; border:2px solid #e74c3c; filter: grayscale(40%) opacity(85%); background:#fff; display:block; margin: 0 auto;" title="غير مملوك" />`;
                            countBadgeHtml = `<span style="position: absolute; top: -5px; right: -5px; background: #e74c3c; border-radius: 50%; width: 20px; height: 20px; line-height: 20px; text-align: center; font-weight: bold; color: white; border: 2px solid white; z-index: 2; font-size:11px; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">❌</span>`;
                        }

                        this.imgLoadTasks.push(() => {
                            if (unsafeWindow.Url && unsafeWindow.RES) {
                                let resKey = unsafeWindow.Url.getImagePath(translationKey, "Module/albumCard/");
                                unsafeWindow.RES.getResAsync(resKey, function(texture) {
                                    let el = document.getElementById(imgId);
                                    if (!el) return;
                                    
                                    if (texture && texture.bitmapData && texture.bitmapData.source && texture.bitmapData.source.src) {
                                        el.src = texture.bitmapData.source.src;
                                        return;
                                    }
                                    
                                    try {
                                        let dic = unsafeWindow.RES.config.config ? unsafeWindow.RES.config.config.resourceDic : (unsafeWindow.RES.config.resourceDic || {});
                                        let resObj = dic[resKey];
                                        if (resObj && resObj.url) {
                                            let url = resObj.url;
                                            if (typeof unsafeWindow.RES.getVirtualUrl === 'function') {
                                                url = unsafeWindow.RES.getVirtualUrl(url);
                                            } else {
                                                let rRoot = (unsafeWindow.GameConfig && unsafeWindow.GameConfig.resRoot) ? unsafeWindow.GameConfig.resRoot : (unsafeWindow.resourceRoot || "");
                                                if (rRoot && !rRoot.endsWith("/")) rRoot += "/";
                                                if (!url.startsWith("http")) url = rRoot + url;
                                            }
                                            el.src = url;
                                            return;
                                        }
                                    } catch(e) {}
                                    
                                    try {
                                        if (texture && typeof texture.toDataURL === 'function') {
                                            el.src = texture.toDataURL("image/png");
                                        }
                                    } catch(e) {}
                                });
                            }
                        });

                        let searchText = `${card.name}${searchMultiText} ${setName} ${card.special == 1 ? 'نادر' : 'عادي'} ${card.rarity}`;
                        let isMissingStr = card.count === 0 ? 'true' : 'false';
                        
                        let copyIcon = card.count === 0 ? `<button style="cursor:pointer; font-size:11px; padding: 4px; margin-bottom: 4px; width: 100%; background: #3498db; color: white; border: none; border-radius: 5px; font-weight: bold; transition: 0.3s;" onclick="window.copyAlbumText('${fullCopyText.replace(/'/g, "\\'")}', this)" title="نسخ اسم الكارت">📋 نسخ</button>` : '';

                        let bgStyle = card.special == 1 ? 'background: linear-gradient(135deg, rgba(255, 215, 0, 0.2), rgba(0, 0, 0, 0.4)); border: 1px solid rgba(255, 215, 0, 0.6);' : 'background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.05);';

                        tableHtml += `
                            <div class="sf-album-card-row" data-search="${searchText.toLowerCase()}" data-missing="${isMissingStr}" data-card-name="${card.name}" data-count="${card.count}" style="${bgStyle} border-radius: 8px; padding: 8px; display: flex; flex-direction: column; align-items: center; justify-content: space-between; box-shadow: 0 4px 6px rgba(0,0,0,0.2);">
                                
                                <div style="position: relative; width: 100%;">
                                    ${checkboxHtml}
                                    ${countBadgeHtml}
                                    ${imgHtml}
                                </div>
                                
                                <div style="font-weight:bold; margin: 6px 0 4px 0; font-size: 11px; text-align: center; color: white; min-height: 28px; display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1.2;">
                                    ${card.name}
                                    ${multiLangHtml}
                                </div>
                                
                                <div style="font-size: 10px; margin-bottom: 6px; color: #ecf0f1; text-align:center;">
                                    ${rarityType} <br/> <span style="font-size:9px;">(${stars})</span>
                                </div>
                                
                                <div style="width: 100%; display: flex; flex-direction: column;">
                                    ${copyIcon}
                                    ${actionHtml}
                                </div>
                            </div>
                        `;
                    });

                    tableHtml += `</div></details>`;
                    finalHtml += tableHtml;
                });

                contentBody.innerHTML = finalHtml;
                contentDiv.style.display = 'block'; // إظهار القائمة

                this.imgLoadTasks.forEach(task => task());
            };

            let loadTimeout = setTimeout(() => {
                if (btn.disabled) {
                    console.warn('Server response timeout, forcing render.');
                    renderAlbumTable();
                }
            }, 3000);

            albumModel.isSendMessage = false;
            
            albumModel.callServerLoad(function() {
                clearTimeout(loadTimeout);
                renderAlbumTable();
            }, albumModel);

        } catch(e) {
            console.error('Album Tracker Error:', e);
            alert('حدث خطأ أثناء فحص البيانات: ' + e.message);
            
            if (btn) {
                btn.innerText = 'استخراج الألبوم 📚';
                btn.disabled = false;
                btn.style.background = '#27ae60';
            }
        }
    }

    async openAllPackages(btn) {
        try {
            const albumModel = unsafeWindow.GF.albumModel;
            if (!albumModel) {
                alert('الرجاء فتح اللعبة وفتح الألبوم أولاً لتهيئة البيانات.');
                return;
            }

            let packages = albumModel.getPackageList();
            if (!packages || packages.length === 0) {
                alert("لا توجد حزم متاحة في التخزين حالياً.");
                return;
            }

            let totalPackages = 0;
            packages.forEach(pkg => { totalPackages += pkg.num; });

            let confirmOpen = confirm(`تم العثور على ${totalPackages} حزمة في التخزين.\nهل تريد فتحها جميعاً بضربة واحدة الآن؟`);
            if (!confirmOpen) return;

            btn.disabled = true;
            let originalText = btn.innerText;
            let openedCount = 0;

            for (let i = 0; i < packages.length; i++) {
                let pkg = packages[i];
                let isFlame = !!(albumModel.flameCardPackageCfg && albumModel.flameCardPackageCfg[pkg.id]);

                for (let j = 0; j < pkg.num; j++) {
                    openedCount++;
                    btn.innerText = `جاري الفتح (${openedCount}/${totalPackages})...`;

                    if (isFlame) {
                        albumModel.callServerUseItemFlame(pkg.id, 1);
                    } else {
                        albumModel.callServerUseItem(pkg.id, 1);
                    }

                    // تأخير عشوائي بين 500 و 800 ملي ثانية لمحاكاة اللاعب الطبيعي
                    let delay = 500 + Math.random() * 300;
                    await new Promise(r => setTimeout(r, delay));
                }
            }

            btn.innerText = 'تم الفتح بنجاح ✔️';
            btn.style.background = '#2ecc71';
            
            // تحديث واجهة الألبوم في اللعبة إذا أمكن
            if (unsafeWindow.GF.albumController) {
                unsafeWindow.GF.albumController.updateWarePanel1View();
                unsafeWindow.GF.albumController.updateWarePanel3View();
            }

            setTimeout(() => {
                btn.disabled = false;
                btn.innerText = originalText;
                btn.style.background = '#8e44ad';
            }, 3000);

        } catch(e) {
            console.error('Open Packages Error:', e);
            alert('حدث خطأ أثناء فتح الحزم: ' + e.message);
            btn.disabled = false;
            btn.innerText = 'فتح حزم التخزين 🎁';
            btn.style.background = '#8e44ad';
        }
    }
};

SF.modules.register(new SF.AlbumTrackerModule());


// --- File: features/MineModule.js ---
window.SF = window.SF || {};

SF.MineModule = class MineModule extends SF.ModuleBase {
    constructor() {
        super('minesweeper', 'ماسح المنجم', '⛏️');
        this.isRunning = false;
        this.autoJumpTimeout = null;
    }

    render() {
        return `
            <style>
                .sf-mine-btn {
                    padding: 10px 15px;
                    border: none;
                    border-radius: 6px;
                    font-weight: bold;
                    cursor: pointer;
                    width: 100%;
                    transition: all 0.3s ease;
                    font-family: inherit;
                }
                .sf-mine-btn:hover {
                    opacity: 0.8;
                }
                .sf-mine-btn-start {
                    background: #e1b12c;
                    color: #2f3640;
                }
                .sf-mine-btn-stop {
                    background: #ff4757;
                    color: white;
                }
                .sf-mine-log {
                    margin-top: 10px;
                    padding: 8px;
                    background: rgba(0,0,0,0.4);
                    border-radius: 5px;
                    border: 1px solid rgba(255,255,255,0.1);
                    font-size: 11px;
                    color: #a4b0be;
                    text-align: right;
                    min-height: 20px;
                }
            </style>
            
            <div class="sf-card">
                <p style="color: var(--sf-text-muted); font-size: 13px; margin-bottom: 15px; text-align: center;">
                    القفز التلقائي (+5) ومسح الهدايا مجاناً دون استهلاك أدوات.
                </p>
                
                <button id="sf-mine-toggle-btn" class="sf-mine-btn sf-mine-btn-start">
                    ▶️ تشغيل (Ghost Sweeper) +5
                </button>

                <div id="sf-mine-status-log" class="sf-mine-log">
                    [النظام] جاهز للمسح الجراحي...
                </div>
            </div>
        `;
    }

    bindEvents() {
        const toggleBtn = this.container.querySelector('#sf-mine-toggle-btn');
        if (toggleBtn) {
            toggleBtn.onclick = () => {
                if (this.isRunning) {
                    this.stopAutoJump();
                } else {
                    this.startAutoJump();
                }
            };
        }
    }

    logStatus(message) {
        const logDiv = this.container.querySelector('#sf-mine-status-log');
        if (logDiv) {
            logDiv.innerText = message;
        }
        console.log(`[SF-MineModule] ${message}`);
    }

    updateUIButtonState() {
        const btn = this.container.querySelector('#sf-mine-toggle-btn');
        if (btn) {
            if (this.isRunning) {
                btn.innerText = "⏹️ إيقاف (Ghost Sweeper)";
                btn.className = "sf-mine-btn sf-mine-btn-stop";
            } else {
                btn.innerText = "▶️ تشغيل (Ghost Sweeper) +5";
                btn.className = "sf-mine-btn sf-mine-btn-start";
            }
        }
    }

    executeTacticalJump() {
        if (!this.isRunning) return;

        try {
            let gw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

            if (!gw.NetUtils || !gw.App || !gw.App.ControllerManager) {
                this.logStatus("⏳ في انتظار تحميل كلاسات اللعبة...");
                this._scheduleRetry();
                return;
            }

            // Null-safe access: ControllerConst may not exist yet
            const digMiningConst = (gw.ControllerConst && gw.ControllerConst.DigMining !== undefined)
                ? gw.ControllerConst.DigMining
                : 'DigMining';

            let digModel = gw.App.ControllerManager.getControllerModel(digMiningConst);
            if (!digModel || typeof digModel.getCurrDepth !== 'function' || !digModel._mapList) {
                this.logStatus("⚠️ يرجى فتح المنجم في اللعبة أولاً. في انتظار التحميل...");
                this._scheduleRetry();
                return;
            }

            let currentDepth = Number(digModel.getCurrDepth());
            let targetDepth = currentDepth + 5;

            // --- المسح الشامل (Ghost Sweep) للهدايا المخفية والمرئية ---
            let itemsToClaim = [];
            let mapList = digModel._mapList;

            for (let x = 0; x < mapList.length; x++) {
                let row = mapList[x];
                if (!row) continue;
                for (let y = 0; y < row.length; y++) {
                    let block = row[y];
                    // البحث عن أي بلوك يحتوي على "item" ولم يتم حصاده بعد
                    if (block && block.hasOwnProperty("item") && !block.hasOwnProperty("claimed")) {
                        itemsToClaim.push({ mx: x, my: y });
                    }
                }
            }

            // 3. تحديث العدادات محلياً وإرسال طلب الحصاد
            if (itemsToClaim.length > 0) {
                digModel.claimReward(itemsToClaim);
                this.logStatus(`🎁 تم مسح ${itemsToClaim.length} عنصر مجاناً! (طبقة ${currentDepth} → ${targetDepth})`);
            } else {
                this.logStatus(`🔍 لا توجد عناصر في الطبقة ${currentDepth}. جارٍ القفز → ${targetDepth}...`);
            }

            // 4. الطلب الأساسي للقفز
            gw.NetUtils.enqueue("Mine/SetPos", {
                mx: targetDepth,
                port: "0_0_0_0_0_0_0",
                needResponse: true
            });

            // جدولة الدورة القادمة
            this._scheduleNextJump();

        } catch (err) {
            console.error("[SF-MineModule] Exception:", err);
            this.logStatus("❌ خطأ: " + err.message);
            this.stopAutoJump(true); // true = preserve error message
        }
    }

    _scheduleNextJump() {
        if (!this.isRunning) return;
        let jitter = Math.floor(Math.random() * 500) + 300;
        let nextRunDelay = 2500 + jitter;
        this.autoJumpTimeout = setTimeout(() => this.executeTacticalJump(), nextRunDelay);
    }

    _scheduleRetry() {
        if (!this.isRunning) return;
        this._retryCount = (this._retryCount || 0) + 1;
        if (this._retryCount > 15) {
            this.logStatus("❌ فشل الاتصال بالمنجم بعد 15 محاولة. تأكد من فتح المنجم ثم أعد التشغيل.");
            this.stopAutoJump(true);
            return;
        }
        this.logStatus(`⏳ محاولة ${this._retryCount}/15 — في انتظار تحميل المنجم...`);
        this.autoJumpTimeout = setTimeout(() => this.executeTacticalJump(), 2000);
    }

    startAutoJump() {
        if (this.isRunning) return;
        this.isRunning = true;
        this._retryCount = 0;
        this.updateUIButtonState();
        this.logStatus("▶️ بدء القفز والمسح...");
        this.executeTacticalJump();
    }

    stopAutoJump(preserveMessage = false) {
        if (!this.isRunning) return;
        this.isRunning = false;
        this._retryCount = 0;
        if (this.autoJumpTimeout) {
            clearTimeout(this.autoJumpTimeout);
            this.autoJumpTimeout = null;
        }
        this.updateUIButtonState();
        if (!preserveMessage) {
            this.logStatus("⏹️ تم الإيقاف.");
        }
    }
};

console.log('[SF-MineModule] ✅ MineModule class defined. Registering now...');
SF.modules.register(new SF.MineModule());
console.log('[SF-MineModule] ✅ Registration complete. Total modules:', SF.modules.getModules().length);


// --- File: features/BattlePassModule.js ---
window.SF = window.SF || {};

SF.BattlePassModule = class BattlePassModule extends SF.ModuleBase {
    constructor() {
        super('battlepass', 'حاصد التذكرة', '🎫');
        this.smartButtonInterval = setInterval(() => this.manageSmartButton(), 500);
    }

    render() {
        return `
            <style>
                .sf-bp-btn {
                    padding: 10px 15px;
                    border: none;
                    border-radius: 6px;
                    font-weight: bold;
                    cursor: pointer;
                    width: 100%;
                    transition: all 0.3s ease;
                    font-family: inherit;
                    background: linear-gradient(180deg, #ffdc3a 0%, #ff9800 100%);
                    color: #fff;
                    border: 1px solid #fff;
                }
                .sf-bp-btn:hover {
                    opacity: 0.8;
                }
                .sf-bp-log {
                    margin-top: 10px;
                    padding: 8px;
                    background: rgba(0,0,0,0.4);
                    border-radius: 5px;
                    border: 1px solid rgba(255,255,255,0.1);
                    font-size: 11px;
                    color: #a4b0be;
                    text-align: right;
                    min-height: 20px;
                }
            </style>
            
            <div class="sf-card">
                <p style="color: var(--sf-text-muted); font-size: 13px; margin-bottom: 15px; text-align: center;">
                    استخراج الهدايا الحقيقية من التذكرة بدون استهلاك الموارد وبدون أقفال.
                </p>
                
                <button id="sf-bp-harvest-btn" class="sf-bp-btn">
                    🎁 حصد التذكرة الذكي 🎁
                </button>

                <div id="sf-bp-status-log" class="sf-bp-log">
                    [النظام] جاهز...
                </div>
            </div>
        `;
    }

    bindEvents() {
        const btn = this.container.querySelector('#sf-bp-harvest-btn');
        if (btn) {
            btn.onclick = () => {
                this.executeSmartExploit();
            };
        }
    }

    logStatus(message) {
        const logDiv = this.container.querySelector('#sf-bp-status-log');
        if (logDiv) {
            logDiv.innerText = message;
        }
        console.log(`[SF-BattlePassModule] ${message}`);
    }

    extractAndPlayVisuals(rewardStr) {
        const gw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        if (!rewardStr) return;

        let visualTriggered = false;
        try {
            if (gw.DropEventManager && gw.DropEventManager.instance) {
                for (let k in gw.DropEventManager.instance) {
                    if (typeof gw.DropEventManager.instance[k] === 'function' && k.toLowerCase().includes('rewardpanel')) {
                        gw.DropEventManager.instance[k](rewardStr);
                        visualTriggered = true; break;
                    }
                }
            }
        } catch(e) {}

        if (!visualTriggered && gw.App && gw.App.CommonTips) {
            for (let k in gw.App.CommonTips) {
                if (typeof gw.App.CommonTips[k] === 'function' && k.toLowerCase().includes('reward') && k.toLowerCase().includes('show')) {
                    gw.App.CommonTips[k](rewardStr);
                    visualTriggered = true; break;
                }
            }
        }

        if (!visualTriggered && gw.GF && gw.GF.loginModel) {
            for (let k in gw.GF.loginModel) {
                if (typeof gw.GF.loginModel[k] === 'function' && k.toLowerCase().includes('showreward')) {
                    gw.GF.loginModel[k](rewardStr);
                    visualTriggered = true; break;
                }
            }
        }
    }

    executeSmartExploit() {
        this.logStatus("⏳ جاري إزالة الأقفال والعرض...");
        const gw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        const model = gw.GF && gw.GF.newBattlePassModel;
        
        if (!model) {
            this.logStatus("⚠️ تعذر العثور على بيانات التذكرة. يرجى فتح اللعبة بالكامل.");
            return;
        }

        let eventId = "";
        try {
            if (typeof model.getEvent === 'function') eventId = model.getEvent();
            else if (model.data && model.data.event) eventId = model.data.event;
        } catch(e) {}

        const netCore = gw.NetUtils || (gw.App && gw.App.NetUtils) || (gw.GF && gw.GF.NetUtils);

        // 1. تحديد الجوائز المتبقية (45 حد أقصى)
        let payloadList = [];
        let exactRewardsArray = []; 
        let allConfigRewards = typeof model.getRewardsList === 'function' ? model.getRewardsList() : [];

        for (let i = 1; i <= 45; i++) {
            let scoreRequired = i * 100;
            let isClaimed = false;

            if (typeof model.isBPClaimed === 'function') {
                isClaimed = model.isBPClaimed(scoreRequired, 1);
            } else if (model.data && model.data.bpReward && Array.isArray(model.data.bpReward)) {
                isClaimed = model.data.bpReward.includes(scoreRequired + "_1");
            }

            if (!isClaimed) {
                payloadList.push(scoreRequired + "_1");

                try {
                    let levelConfig = allConfigRewards.find(r => r.score == scoreRequired);
                    if (levelConfig) {
                        let rewardStr = levelConfig.reward1 || levelConfig.freeReward || levelConfig.reward;
                        if (rewardStr) exactRewardsArray.push(rewardStr);
                    }
                } catch(e) {}
            }
        }

        if (payloadList.length === 0) {
            this.logStatus("✅ لقد قمت بحصد جميع الهدايا مسبقاً!");
            return;
        }

        let payload = {
            action: "getReward",
            event: eventId,
            list: payloadList
        };

        // 2. إرسال الطلب للسيرفر
        if (netCore && netCore.request) {
            netCore.request("Activity/NewBattlePass", payload, (res) => {
                this._forceUnlockAndVisuals(model, payloadList, res, exactRewardsArray, gw);
                this.logStatus("✅ تم حصد الجوائز بنجاح!");
            }, gw);
        } else {
             // Fallback to enqueue if request is missing
             if(gw.NetUtils && gw.NetUtils.enqueue) {
                 gw.NetUtils.enqueue("Activity/NewBattlePass", payload);
             }
        }

        // حماية إضافية (Fallback)
        setTimeout(() => {
            this._forceUnlockAndVisuals(model, payloadList, null, exactRewardsArray, gw);
            this.logStatus("✅ تمت العملية (عبر نظام الحماية).");
        }, 1500);
    }

    _forceUnlockAndVisuals(model, payloadList, res, exactRewardsArray, gw) {
        if (model.data) {
            if (!Array.isArray(model.data.bpReward)) model.data.bpReward = [];
            payloadList.forEach(id => {
                if (!model.data.bpReward.includes(id)) {
                    model.data.bpReward.push(id);
                }
            });
        }

        try {
            if (gw.GF.newBattlePassController && gw.GF.newBattlePassController.mainView && gw.GF.newBattlePassController.mainView.milestoneView) {
                gw.GF.newBattlePassController.mainView.milestoneView.udpateBP();
            }
        } catch(e) {}

        let serverRewardStr = (res && (res.reward || res.rewards || res.gifts || (res.data && res.data.reward))) || "";
        let finalVisualStr = serverRewardStr;
        if (!finalVisualStr && exactRewardsArray.length > 0) {
            finalVisualStr = exactRewardsArray.join(",");
        }

        if (finalVisualStr) {
            this.extractAndPlayVisuals(finalVisualStr);
        }

        let btn = document.getElementById('btn-bp-smart');
        if (btn) {
            btn.style.display = 'none';
            btn.innerHTML = "🎁 حصد التذكرة الذكي 🎁";
        }
    }

    manageSmartButton() {
        const gw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        let btn = document.getElementById('btn-bp-smart');

        let isUIOpen = false;
        try {
            let mainView = gw.GF.newBattlePassController.mainView;
            if (mainView && mainView.parent) {
                isUIOpen = true;
            }
        } catch(e) {}

        if (isUIOpen) {
            let hasUnclaimed = false;
            let model = gw.GF && gw.GF.newBattlePassModel;
            if (model) {
                for (let i = 1; i <= 45; i++) {
                    let scoreRequired = i * 100;
                    let isClaimed = false;
                    if (typeof model.isBPClaimed === 'function') {
                        isClaimed = model.isBPClaimed(scoreRequired, 1);
                    } else if (model.data && model.data.bpReward && Array.isArray(model.data.bpReward)) {
                        isClaimed = model.data.bpReward.includes(scoreRequired + "_1");
                    }
                    if (!isClaimed) {
                        hasUnclaimed = true;
                        break;
                    }
                }
            }

            if (hasUnclaimed) {
                if (!btn) {
                    btn = document.createElement("button");
                    btn.id = "btn-bp-smart";
                    btn.innerHTML = "🎁 حصد التذكرة الذكي 🎁";
                    btn.style.cssText = "position:absolute; top:12%; left:50%; transform:translate(-50%, -50%); z-index:9999999; padding:12px 30px; font-size:22px; font-weight:bold; background: linear-gradient(180deg, #ffdc3a 0%, #ff9800 100%); color:#fff; border:3px solid #fff; border-radius:30px; cursor:pointer; box-shadow: 0 4px 8px rgba(0,0,0,0.5); text-shadow: 1px 1px 2px #000; font-family:Tahoma;";

                    btn.onclick = () => {
                        btn.innerHTML = "⏳ جاري إزالة الأقفال والعرض...";
                        this.executeSmartExploit();
                    };
                    try { document.body.appendChild(btn); } catch(e) {}
                }
                btn.style.display = 'block';
            } else {
                if (btn) btn.style.display = 'none';
            }
        } else {
            if (btn) btn.style.display = 'none';
        }
    }
};

new SF.BattlePassModule();


// --- File: features/IslandPointBuyerModule.js ---
window.SF = window.SF || {};

SF.IslandPointBuyerModule = class IslandPointBuyerModule extends SF.ModuleBase {
    constructor() {
        super('island_buyer', 'شراء نقاط الحدث', '🏝️');
        this.discoveredTokens = [];
        this.isRunning = false;
    }

    render() {
        return `
            <style>
                .sf-ipb-input, .sf-ipb-select {
                    width: 100%;
                    padding: 8px;
                    margin-bottom: 15px;
                    background: #222;
                    color: #fff;
                    border: 1px solid var(--sf-primary);
                    border-radius: 4px;
                    box-sizing: border-box;
                    font-family: inherit;
                }
                .sf-ipb-btn {
                    width: 100%;
                    padding: 10px;
                    background: var(--sf-primary);
                    color: #000;
                    font-weight: bold;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    margin-bottom: 5px;
                    font-family: inherit;
                    transition: opacity 0.2s;
                }
                .sf-ipb-btn:hover {
                    opacity: 0.8;
                }
                .sf-ipb-btn:disabled {
                    background: #555;
                    cursor: not-allowed;
                }
                .sf-ipb-refresh {
                    padding: 8px 12px;
                    background: #555;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    margin-left: 10px;
                    white-space: nowrap;
                }
                .sf-ipb-log {
                    height: 120px;
                    overflow-y: auto;
                    background: #000;
                    color: #0f0;
                    padding: 8px;
                    font-size: 11px;
                    border-radius: 4px;
                    border: 1px solid #333;
                    margin-bottom: 15px;
                    text-align: right;
                }
            </style>
            
            <div class="sf-card">
                <p style="color: var(--sf-text-muted); font-size: 13px; margin-bottom: 15px; text-align: center;">
                    وحدة دقيقة وخالية من التخمين لشراء نقاط المهام للحدث الجاري (مثل الصيف الحافل أو المتجر الغامض) بصيغة قانونية للسيرفر.
                </p>
                
                <div style="display: flex; align-items: center; margin-bottom: 5px;">
                    <label style="flex-grow: 1; font-size: 13px;">المهام الشغالة (اختر لملء الكود):</label>
                </div>
                
                <div style="display: flex; margin-bottom: 15px;">
                    <select id="sf-ipb-select" class="sf-ipb-select" style="margin-bottom: 0;"></select>
                    <button id="sf-ipb-refresh" class="sf-ipb-refresh">🔄 تحديث</button>
                </div>

                <label style="display: block; font-size: 13px; margin-bottom: 5px;">كود العنصر (ID):</label>
                <input type="number" id="sf-ipb-id" class="sf-ipb-input" placeholder="اختر من القائمة أو اكتب الكود">

                <label style="display: block; font-size: 13px; margin-bottom: 5px;">العدد المراد شراءه:</label>
                <input type="number" id="sf-ipb-amount" class="sf-ipb-input" value="1" min="1">

                <div id="sf-ipb-log" class="sf-ipb-log"></div>

                <button id="sf-ipb-buy" class="sf-ipb-btn">🚀 بدء الشراء</button>
            </div>
        `;
    }

    bindEvents() {
        this.selectEl = this.container.querySelector('#sf-ipb-select');
        this.idInput = this.container.querySelector('#sf-ipb-id');
        this.amountInput = this.container.querySelector('#sf-ipb-amount');
        this.logEl = this.container.querySelector('#sf-ipb-log');
        this.btnBuy = this.container.querySelector('#sf-ipb-buy');
        this.btnRefresh = this.container.querySelector('#sf-ipb-refresh');

        this.btnRefresh.onclick = () => this.scanTokens();
        
        this.selectEl.onchange = () => {
            if (this.selectEl.value) {
                this.idInput.value = this.selectEl.value;
            }
        };

        this.btnBuy.onclick = () => this.executePurchase();

        // Initial Scan
        this.scanTokens();
    }

    logMsg(msg) {
        if (!this.logEl) return;
        this.logEl.innerHTML += `<div>[${new Date().toLocaleTimeString('en-US', {hour12:false})}] ${msg}</div>`;
        this.logEl.scrollTop = this.logEl.scrollHeight;
        console.log(`[SF-IslandBuyer] ${msg}`);
    }

    scanTokens() {
        this.discoveredTokens = [];
        try {
            const uw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            const Config = uw.Config;
            const GF = uw.GF;
            
            if (Config) {
                for (let key in Config) {
                    try {
                        if (Config[key] && typeof Config[key] === 'object' && Config[key].use) {
                            let useKey = Config[key].use;
                            let activeData = Config[key][useKey];
                            if (activeData && activeData.tokenId) {
                                let tid = activeData.tokenId;
                                let itemName = key; 
                                try {
                                    if (typeof Config.Store_GetItemData === 'function') {
                                        let itemData = Config.Store_GetItemData(tid);
                                        if (itemData && itemData.name) itemName = itemData.name;
                                    }
                                } catch(e1) {}
                                this.discoveredTokens.push({ id: tid, name: itemName, event: key });
                            }
                        }
                    } catch(err) {}
                }
            }
            
            const modelsToCheck = [
                { name: 'الصيف الحافل', m: (GF && GF.BusySummerController) ? GF.BusySummerController.model : null },
                { name: 'المتجر الغامض', m: (GF && GF.mysteryShopkeeperController) ? GF.mysteryShopkeeperController.selfModel : null },
                { name: 'تصريح المعركة', m: (GF && GF.bpContoller) ? GF.bpContoller.bpModel : null }
            ];
            
            for (let i = 0; i < modelsToCheck.length; i++) {
                try {
                    let entry = modelsToCheck[i];
                    let m = entry.m;
                    if (m && m.activeCfg && m.activeCfg.tokenId) {
                        let tid = m.activeCfg.tokenId;
                        if (!this.discoveredTokens.find(t => t.id == tid)) {
                            let itemName = entry.name;
                            try {
                                if (Config && typeof Config.Store_GetItemData === 'function') {
                                    let itemData = Config.Store_GetItemData(tid);
                                    if (itemData && itemData.name) itemName = itemData.name;
                                }
                            } catch(e2) {}
                            this.discoveredTokens.push({ id: tid, name: itemName, event: 'Model' });
                        }
                    }
                } catch(err) {}
            }
        } catch(e) {
            console.warn("[SF-IslandBuyer] Auto-Read Failed:", e);
        }
        
        this.updateDropdown();
        this.logMsg(`🟢 تم فحص الذاكرة. وُجدت ${this.discoveredTokens.length} مهام.`);
    }

    updateDropdown() {
        if (!this.selectEl) return;
        this.selectEl.innerHTML = '';
        
        const defOpt = document.createElement('option');
        defOpt.value = '';
        defOpt.innerText = this.discoveredTokens.length > 0 ? '--- اختر المهمة من هنا ---' : 'لم يتم اكتشاف مهام';
        this.selectEl.appendChild(defOpt);
        
        this.discoveredTokens.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.innerText = `[${t.id}] ${t.name}`;
            this.selectEl.appendChild(opt);
        });
        
        if (this.discoveredTokens.length === 1) {
            this.selectEl.value = this.discoveredTokens[0].id;
            if (this.idInput) this.idInput.value = this.discoveredTokens[0].id;
        }
    }

    async executePurchase() {
        if (this.isRunning) return;
        
        const targetId = parseInt(this.idInput.value);
        const amount = parseInt(this.amountInput.value);
        
        if (isNaN(targetId) || isNaN(amount) || amount <= 0) {
            this.logMsg('❌ بيانات غير صالحة! الرجاء إدخال كود العنصر.');
            return;
        }

        this.isRunning = true;
        this.btnBuy.disabled = true;
        this.btnBuy.innerText = '⏳ جاري التنفيذ...';
        
        let dynamicNeedResponse = "spend_rp.save_data"; 
        let selectedTokenObj = this.discoveredTokens.find(t => t.id === targetId);
        
        if (selectedTokenObj && selectedTokenObj.event && selectedTokenObj.event !== 'Model') {
            dynamicNeedResponse = "/Activity/" + selectedTokenObj.event;
        } else if (selectedTokenObj && selectedTokenObj.event === 'Model') {
            if (selectedTokenObj.name === 'الصيف الحافل') dynamicNeedResponse = "/Activity/BusySummer";
            else if (selectedTokenObj.name === 'المتجر الغامض') dynamicNeedResponse = "/Activity/MysteryShopkeeper.save_data";
            else if (selectedTokenObj.name === 'تصريح المعركة') dynamicNeedResponse = "/Activity/BattlePass"; 
        }

        this.logMsg(`بدء محاولة شراء ${amount} وحدة من [${targetId}]`);
        this.logMsg(`[DEBUG] مسار السيرفر: ${dynamicNeedResponse}`);

        const uw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        let successCount = 0;

        for (let i = 0; i < amount; i++) {
            // Check if user navigated away from tab
            if (document.getElementById('sf-content') && document.getElementById('sf-content').style.display === 'none') {
                break;
            }

            try {
                const payload = {
                    id: targetId,
                    type: "automation",
                    is_gift: false,
                    needResponse: dynamicNeedResponse,
                    cur_sceneid: (uw.GF && uw.GF.loginModel && uw.GF.loginModel.AppData) ? (uw.GF.loginModel.AppData.cur_sceneid || 1) : 1
                };

                this.logMsg(`إرسال الدفعة ${i + 1} / ${amount}...`);
                
                if (uw.NetUtils && uw.NetUtils.enqueue) {
                    uw.NetUtils.enqueue("spend_rp", payload);
                } else {
                    this.logMsg(`❌ تعذر العثور على محرك الشبكة.`);
                    break;
                }
                
                successCount++;

                const jitter = Math.floor(Math.random() * 500) + 300; 
                await new Promise(r => setTimeout(r, jitter));
                
            } catch (error) {
                this.logMsg(`❌ خطأ: ${error.message}`);
                break;
            }
        }

        this.logMsg(`✅ اكتمل. تم إرسال ${successCount} طلبات.`);
        this.isRunning = false;
        this.btnBuy.disabled = false;
        this.btnBuy.innerText = '🚀 بدء الشراء';
    }
};

SF.modules.register(new SF.IslandPointBuyerModule());


// --- File: features/StoreFlipFixModule.js ---
// --- features\StoreFlipFixModule.js ---
window.SF = window.SF || {};

SF.StoreFlipFixModule = class StoreFlipFixModule extends SF.ModuleBase {
    constructor() {
        super('storeflipfix', 'إصلاح متجر اللعبة (البطاقات)', '🛒');
        this.isActive = false;
        this.injectStoreFlipFix();
    }

    render() {
        return `
            <div class="sf-card">
                <p style="color: var(--sf-text-muted); font-size: 13px; margin-bottom: 15px; text-align: center;">
                    إصلاح مشكلة عدم قلب بطاقات متجر اللعبة.
                </p>
                <div style="display:flex; flex-direction:column; gap:10px; align-items:center;">
                    <div style="font-size:14px; color:#2ecc71; font-weight:bold;">
                        ✅ تم تفعيل إصلاح المتجر
                    </div>
                    <div style="font-size:11px; color:#aaa; text-align:center; padding: 10px; background: rgba(0,0,0,0.3); border-radius: 6px;">
                        تم تجاوز متطلبات الإنجازات (Achievements) للسماح بقلب بطاقات البذور والأشجار
                        دائماً لرؤية الكمية المتوفرة في الحظيرة، كما طلب المستخدم.
                    </div>
                </div>
            </div>
        `;
    }

    bindEvents() {}

    injectStoreFlipFix() {
        if (this.isActive) return;
        this.isActive = true;

        const fnStr = function() {
            function sysLog(msg) {
                console.log('[SF-StoreFlip] ' + msg);
            }

            function injectFix() {
                let ShopItemCls;
                try {
                    ShopItemCls = window.ShopItem || (window.egret && window.egret.getDefinitionByName('ShopItem'));
                } catch(e) {}

                if (!ShopItemCls || !ShopItemCls.prototype) {
                    setTimeout(injectFix, 2000);
                    return;
                }

                if (ShopItemCls.prototype._sf_hooked_achieve) return;

                const origUpdateAchieveData = ShopItemCls.prototype.updateAchieveData;
                ShopItemCls.prototype.updateAchieveData = function() {
                    // Call the original first to populate default stuff
                    try {
                        if (typeof origUpdateAchieveData === 'function') {
                            origUpdateAchieveData.call(this);
                        }
                    } catch(e) {}

                    // Now, FORCE the card to be flip-able for seeds and trees
                    if (this.itemData && (this.itemData.type === 'seeds' || this.itemData.type === 'trees' || (window.Config_Store$Type && (this.itemData.type === window.Config_Store$Type.Seeds || this.itemData.type === window.Config_Store$Type.Trees)))) {
                        
                        this.isCanOverturn = true;
                        if (this.rectTurnOver) {
                            this.rectTurnOver.visible = true;
                        }

                        // Determine the correct product id (the crop or tree fruit)
                        let productId = this.itemData.product;
                        if (!productId) productId = this.itemData.id;

                        // Fetch inventory quantity
                        let qty = 0;
                        if (this.loginModel && typeof this.loginModel.getStorageQtyById === 'function') {
                            qty = this.loginModel.getStorageQtyById(productId);
                        } else if (window.GF && window.GF.loginModel && typeof window.GF.loginModel.getStorageQtyById === 'function') {
                            qty = window.GF.loginModel.getStorageQtyById(productId);
                        }

                        // Update the text fields on the back of the card
                        if (this.lblOwnNum) {
                            this.lblOwnNum.text = String(qty);
                        }
                        
                        // If there is no achievement configured, hide the progress
                        var achAid = window.Config && window.Config.Achievement_FilterAidObj ? window.Config.Achievement_FilterAidObj : {};
                        var hasAchieve = achAid[this.itemData.product];
                        if (!hasAchieve) {
                            if (this.lblAchiProgress) this.lblAchiProgress.text = "-";
                            if (this.imgAchiProgress) this.imgAchiProgress.source = "";
                        }

                        // Add Tip for the invisible click area
                        if (window.App && window.App.TipsManager && window.TipsConst && window.Language && this.rectTurnOver) {
                             window.App.TipsManager.add(this.rectTurnOver, window.TipsConst.NORMAL, window.Language.GetString("click_to_turnover") || "انقر للقلب");
                        }
                    }
                };
                ShopItemCls.prototype._sf_hooked_achieve = true;
                sysLog('تم تفعيل رقعة متجر اللعبة (Store Card Flip Fix) بنجاح.');
            }

            injectFix();
        };

        const script = document.createElement('script');
        script.textContent = '(' + fnStr + ')();';
        (document.head || document.documentElement).appendChild(script);
        script.remove();
        console.log('[SupremeFarm Modular] Injected Store Flip Fix Protocol');
    }
};

// Register the module
new SF.StoreFlipFixModule();


// --- File: features/StoreRevealModule.js ---
// --- features\StoreRevealModule.js ---
window.SF = window.SF || {};

SF.StoreRevealModule = class StoreRevealModule extends SF.ModuleBase {
    constructor() {
        super('storereveal', 'كشف المتاجر (إظهار المخفي)', '🏪');
        this.isActive = false;
        this.injectStoreReveal();
    }

    render() {
        return `
            <div class="sf-card">
                <p style="color: var(--sf-text-muted); font-size: 13px; margin-bottom: 15px; text-align: center;">
                    إظهار كافة العناصر المخفية في المتاجر (المتجر العادي، متجر الغموض، إلخ).
                </p>
                <div style="display:flex; flex-direction:column; gap:10px; align-items:center;">
                    <div style="font-size:14px; color:#2ecc71; font-weight:bold;">
                        ✅ تم تفعيل كشف المتجر الشامل
                    </div>
                    <div style="font-size:11px; color:#aaa; text-align:center; padding: 10px; background: rgba(0,0,0,0.3); border-radius: 6px;">
                        تم إزالة قيود الإخفاء عن جميع العناصر في المتاجر.
                        الآن ستظهر لك جميع البذور والأشجار والمعدات التي كانت مخفية أو محذوفة من اللعبة.
                    </div>
                </div>
            </div>
        `;
    }

    bindEvents() {}

    injectStoreReveal() {
        if (this.isActive) return;
        this.isActive = true;

        const fnStr = function() {
            function sysLog(msg) {
                console.log('[SF-StoreReveal] ' + msg);
            }

            function injectReveal() {
                // التأكد من أن اللعبة قد قامت بتحميل مصفوفة المتجر الأساسية بالكامل قبل التدخل لتفادي الـ Overwrite
                if (!window.Config || !window.Config.isInit || !window.Config.StoreShipOrder || window.Config.StoreShipOrder.length < 10) {
                    setTimeout(injectReveal, 2000);
                    return;
                }

                let ShopModelCls, SilverShopModelCls, ShipOrderModelCls, ShipOrderShopItemCls;
                try {
                    ShopModelCls = window.egret && window.egret.getDefinitionByName('ShopModel');
                    SilverShopModelCls = window.egret && window.egret.getDefinitionByName('SilverShopModel');
                    ShipOrderModelCls = window.egret && window.egret.getDefinitionByName('ShipOrderModel');
                    ShipOrderShopItemCls = window.egret && window.egret.getDefinitionByName('ShipOrderShopItem');
                } catch(e) {}

                if (!ShopModelCls || !ShopModelCls.prototype || !SilverShopModelCls || !SilverShopModelCls.prototype || !ShipOrderModelCls || !ShipOrderModelCls.prototype) {
                    setTimeout(injectReveal, 2000);
                    return;
                }

                if (ShopModelCls.prototype._sf_hooked_reveal) return;

                // 1. Hook ShopModel.prototype.isCanBuy
                const origIsCanBuy = ShopModelCls.prototype.isCanBuy;
                ShopModelCls.prototype.isCanBuy = function(t) {
                    return true;
                };

                // 2. Hook ShopModel.prototype.isAlwaysOnline
                const origIsAlwaysOnline = ShopModelCls.prototype.isAlwaysOnline;
                ShopModelCls.prototype.isAlwaysOnline = function(t) {
                    const itemData = window.Config && window.Config.Store_GetItemData ? window.Config.Store_GetItemData(t) : null;
                    if (!itemData) return false;
                    return this.isCanBuy(t);
                };

                // 3. Hook SilverShopModel.prototype.chargeData
                const origChargeData = SilverShopModelCls.prototype.chargeData;
                SilverShopModelCls.prototype.chargeData = function(t) {
                    let originalBuyable = t.buyable;
                    let hasBuyable = t.hasOwnProperty("buyable");
                    if (hasBuyable && !t.buyable) { t.buyable = 1; }
                    let result;
                    try { result = origChargeData.call(this, t); } catch(e) {}
                    if (hasBuyable) { t.buyable = originalBuyable; }
                    return result;
                };

                // 4. Global Data Manipulation (Inject into arrays & remove limits)
                if (window.Config && window.Config.Store && window.Config.StoreShipOrder) {
                    let injectedCount = 0;
                    for (let key in window.Config.Store) {
                        let item = window.Config.Store[key];
                        
                        // Delete expiration timers so they don't get filtered out or show ugly "9999 days" texts
                        if (item.hasOwnProperty('limit_config')) delete item.limit_config;
                        if (item.hasOwnProperty('time_limit')) delete item.time_limit;
                        if (item.hasOwnProperty('buyable')) delete item.buyable;
                        if (item.hasOwnProperty('not_in_shop')) delete item.not_in_shop;
                        if (item.hasOwnProperty('is_hide')) delete item.is_hide;

                        // توحيد العملات: تحويل قسائم السيارة (voucher) إلى قسائم عادية (new_cash) لكي تفهمها واجهة المتجر
                        if (item.voucher1 && !item.new_cash1) item.new_cash1 = item.voucher1;
                        if (item.voucher2 && !item.new_cash2) item.new_cash2 = item.voucher2;
                        if (item.voucher3 && !item.new_cash3) item.new_cash3 = item.voucher3;
                        if (item.voucher4 && !item.new_cash4) item.new_cash4 = item.voucher4;
                        if (item.voucher5 && !item.new_cash5) item.new_cash5 = item.voucher5;

                        // Inject missing voucher items into the store (شامل قسائم السيارة والقسائم الأخرى)
                        if (item.new_cash1 || item.new_cash2 || item.new_cash3 || item.new_cash4 || item.new_cash5) {
                            if (window.Config.StoreShipOrder.indexOf(item.id) === -1) {
                                window.Config.StoreShipOrder.push(item.id);
                                injectedCount++;
                            }
                        }
                    }
                    sysLog('تم إضافة ' + injectedCount + ' عنصر مخفي، وإزالة قيود الوقت عن جميع العناصر.');
                }

                // 5. Hook UI Item to clearly display quantities without text overlap
                if (ShipOrderShopItemCls && ShipOrderShopItemCls.prototype) {
                    const origUpdateInfo = ShipOrderShopItemCls.prototype.updateInfo;
                    ShipOrderShopItemCls.prototype.updateInfo = function() {
                        origUpdateInfo.call(this);
                        
                        let limitText = "";
                        if (this.itemData.shiporder_buyonce) {
                            limitText = "شراء مرة واحدة فقط";
                        } else if (this.itemData.shiporder_buylimit) {
                            var limit = this.model.hasLimitQty(this.itemData.id);
                            limitText = "المتبقي للمزرعة: " + Math.max(0, limit);
                        } else {
                            limitText = "الكمية: غير محدود ∞";
                        }

                        // Because we deleted limit_config, lblTime is always hidden for expired items.
                        // So we safely use lblUnlock. We only preserve it if the item is locked by level.
                        var t = this.dataModel && this.dataModel.AppData ? this.dataModel.AppData.order_points : 0;
                        if (this.itemData.hasOwnProperty("point_level") && this.itemData.point_level > t) {
                            this.lblUnlock.text = this.lblUnlock.text + " | " + limitText;
                        } else {
                            this.lblUnlock.text = limitText;
                        }
                        this.lblUnlock.visible = true;
                    };
                }

                // 6. Hook ShipOrderModel to STOP hiding exhausted items (let the UI grey them out instead)
                if (ShipOrderModelCls && ShipOrderModelCls.prototype) {
                    ShipOrderModelCls.prototype.getCash3Shop = function() {
                        var e = [], i = (this.shipordersExtra && this.shipordersExtra.shop) ? this.shipordersExtra.shop : [];
                        i.forEach(function(id) {
                            var o = window.Config.Store_GetItemData(id);
                            if (o) e.push(o);
                        }, this);
                        return e;
                    };

                    const origShopList = Object.getOwnPropertyDescriptor(ShipOrderModelCls.prototype, "shopList");
                    if (origShopList && origShopList.get) {
                        Object.defineProperty(ShipOrderModelCls.prototype, "shopList", {
                            get: function() {
                                var e = { 0: this.getCash3Shop(), 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
                                var i = window.Config.StoreShipOrder || [];
                                i.forEach(function(id) {
                                    var o = window.Config.Store_GetItemData(id);
                                    if (!o) return;
                                    switch (o.type) {
                                        case "special_events":
                                        case "automation": e[1].push(o); break;
                                        case "trees": e[2].push(o); break;
                                        case "animals": e[3].push(o); break;
                                        case "gear": e[4].push(o); break;
                                        case "materials": e[5].push(o); break;
                                        default: e[6].push(o);
                                    }
                                }, this);
                                return e;
                            }
                        });
                    }
                }

                ShopModelCls.prototype._sf_hooked_reveal = true;
                sysLog('تم حقن رقعة المتجر الجراحية (Store Hooks) بنجاح.');

                // Force reset Store Models so they rebuild with the revealed items
                if (window.GF) {
                    if (window.GF.shopModel) {
                        window.GF.shopModel._storeArr = null;
                        window.GF.shopModel._storeValidList = null;
                        window.GF.shopModel._storeValidIds = null;
                        window.GF.shopModel._specialItemList = null;
                        window.GF.shopModel._habitatList = null;
                    }
                    if (window.GF.silverShopController && window.GF.silverShopController.model) {
                        window.GF.silverShopController.model.isInit = false;
                    }
                }
            }

            injectReveal();
        };

        const script = document.createElement('script');
        script.textContent = '(' + fnStr + ')();';
        (document.head || document.documentElement).appendChild(script);
        script.remove();
        console.log('[SupremeFarm Modular] Injected Store Reveal Protocol');
    }
};

// Register the module
new SF.StoreRevealModule();


// --- File: features/AutoMegaHarvestModule.js ---
window.SF = window.SF || {};

SF.AutoMegaHarvestModule = class AutoMegaHarvestModule extends SF.ModuleBase {
    constructor() {
        super('autoharvest_pro', 'الحصاد السريع', '🚜');
        this.isRunning = false;
        this.blacklist = JSON.parse(localStorage.getItem('sf_mega_harvest_blacklist') || '{}');
        this.clearBlacklistIfNeeded();
        
        // Settings
        this.JitterMin = 50;
        this.JitterMax = 150;
        this.totalHarvested = 0;
        this.targetLimit = 0;
        
        // HUD Overlay element
        this.hudElement = null;
        this.allItems = [];

        this.interceptorInited = false;
        this.activeCallback = null;
    }

    clearBlacklistIfNeeded() {
        let lastCleared = localStorage.getItem('sf_mega_harvest_last_clear');
        let now = new Date();
        let targetClearTime = new Date();
        targetClearTime.setHours(7, 0, 0, 0);

        if (now < targetClearTime) {
            targetClearTime.setDate(targetClearTime.getDate() - 1);
        }

        if (!lastCleared || new Date(parseInt(lastCleared)) < targetClearTime) {
            this.blacklist = {};
            this.saveBlacklist();
            localStorage.setItem('sf_mega_harvest_last_clear', Date.now().toString());
            console.log("[AutoMegaHarvest] تم تصفير القائمة السوداء تلقائياً (تجاوزت الساعة 7 صباحاً).");
        }
    }

    saveBlacklist() {
        localStorage.setItem('sf_mega_harvest_blacklist', JSON.stringify(this.blacklist));
    }

    getStore() {
        const gw = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
        if (gw.Config && gw.Config.Store) return gw.Config.Store;
        if (gw.GF && gw.GF.Config && gw.GF.Config.Store) return gw.GF.Config.Store;
        return null;
    }

    getHarvestableItems() {
        const store = this.getStore();
        const items = [];
        if (!store) {
            this.log("⚠️ المتجر غير محمل بعد. لا يمكن استخراج المحاصيل.");
            return items;
        }

        for (let key in store) {
            const item = store[key];
            if (item && item.type && !["decor", "avatar", "clothing", "material", "consumable", "coin", "cash", "mission", "coupon"].includes(item.type.toLowerCase())) {
                items.push({ id: item.id, name: item.name || `Item ${item.id}`, type: item.type, kind: item.kind });
            }
        }
        return items;
    }

    initInterceptor() {
        if (this.interceptorInited) return;
        this.interceptorInited = true;
        const gw = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
        
        if (!gw.App || !gw.App.MessageCenter) return;

        const origDispatch = gw.App.MessageCenter.dispatch;
        const self = this;

        gw.App.MessageCenter.dispatch = function(event, ...args) {
            try {
                if (event === "HTTP_SUCCESS") {
                    const data = args[1];
                    let updates = null;
                    if (data && data.objects_to_update) {
                        updates = Array.isArray(data.objects_to_update) ? data.objects_to_update : Object.values(data.objects_to_update);
                    } else if (data && Array.isArray(data)) {
                        updates = data;
                    }

                    if (updates) {
                        
                        let found = false;
                        let product = null;
                        let msg = null;
                        let totalAdded = 0;
                        let usedUpFound = false;

                        for (let obj of updates) {
                            if (obj && obj.needResponse && obj.needResponse.data) {
                                const rData = obj.needResponse.data;
                                if (rData) {
                                    if (rData.msg === "ok") {
                                        if (rData.product) {
                                            product = rData.product;
                                            totalAdded += (rData.product_num || 1);
                                        }
                                        msg = "ok";
                                        self.lastValidRData = rData;
                                    } else if (rData.msg === "used up") {
                                        usedUpFound = true;
                                    } else if (!msg) {
                                        msg = rData.msg || rData.error;
                                    }
                                }
                            }
                        }

                        if (self.activeCallback) {
                            if (usedUpFound) msg = "used up";
                            self.activeCallback({ product, msg, totalAdded, raw: self.lastValidRData });
                            self.activeCallback = null;
                            self.lastValidRData = null;
                        }
                    }
                }
            } catch (e) {
                console.error("Interceptor Error", e);
            }
            return origDispatch.apply(this, arguments);
        };
    }

    render() {
        return `
            <style>
                .sf-harvest-btn {
                    padding: 10px 15px;
                    border: none;
                    border-radius: 6px;
                    font-weight: bold;
                    cursor: pointer;
                    width: 100%;
                    transition: all 0.3s ease;
                    font-family: inherit;
                    margin-bottom: 8px;
                }
                .sf-harvest-btn:hover {
                    opacity: 0.8;
                }
                .sf-harvest-btn-start { background: #00d2d3; color: #222f3e; }
                .sf-harvest-btn-stop { background: #ff6b6b; color: white; display: none; }
                .sf-harvest-btn-clear { background: #576574; color: white; margin-top: 10px; }
                
                .sf-harvest-input-group {
                    display: flex;
                    align-items: center;
                    margin-bottom: 10px;
                    background: rgba(0,0,0,0.3);
                    border-radius: 6px;
                    padding: 8px;
                    border: 1px solid rgba(255,255,255,0.05);
                }
                .sf-harvest-input-group label {
                    flex: 1;
                    font-size: 13px;
                    color: #c8d6e5;
                }
                .sf-harvest-input-group input, .sf-harvest-input-group select {
                    background: rgba(0,0,0,0.5);
                    border: 1px solid rgba(255,255,255,0.2);
                    color: #10ac84;
                    padding: 5px;
                    border-radius: 4px;
                    outline: none;
                }
                .sf-harvest-input-group input[type="text"] {
                    width: 100%;
                    color: #fff;
                    margin-bottom: 5px;
                }
                .sf-harvest-input-group select {
                    width: 100%;
                    color: #fff;
                    margin-bottom: 10px;
                }
            </style>
            
            <div class="sf-card">
                <p style="color: var(--sf-text-muted); font-size: 12px; margin-bottom: 15px; text-align: center;">
                    ابحث عن المحصول واختره من القائمة لتفعيل الحصاد السريع له.
                </p>
                
                <div style="background: rgba(0,0,0,0.3); padding: 8px; border-radius: 6px; margin-bottom: 10px;">
                    <input type="text" id="sf-harvest-search" placeholder="🔍 ابحث عن اسم أو كود المحصول/الشجرة..." style="width: 100%; padding: 5px; background: rgba(0,0,0,0.5); border: 1px solid #00d2d3; color: #fff; border-radius: 4px; outline: none; margin-bottom: 5px;">
                    <select id="sf-harvest-results" size="8" style="width: 100%; padding: 5px; background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.2); color: #fff; border-radius: 4px; outline: none;"></select>
                </div>

                <div class="sf-harvest-input-group">
                    <label>الوضع:</label>
                    <select id="sf-harvest-mode" style="width: 140px; margin-bottom: 0;">
                        <option value="harvest">حصاد (تجميع ثمار)</option>
                        <option value="fertilize">تسميد / ساقية (مساعدة)</option>
                        <option value="building">حصاد أبنية (بركة الملح وغيرها)</option>
                    </select>
                </div>

                <div class="sf-harvest-input-group">
                    <label>العدد المطلوب:</label>
                    <input type="number" id="sf-harvest-target" placeholder="عدد الثمار..." min="1" style="width: 140px; text-align: center; font-weight: bold;">
                </div>

                <button id="sf-harvest-btn-start" class="sf-harvest-btn sf-harvest-btn-start">🚀 بدء الحصاد الصاروخي</button>
                <button id="sf-harvest-btn-stop" class="sf-harvest-btn sf-harvest-btn-stop">🛑 إيقاف الحصاد فوراً</button>
                <button id="sf-harvest-btn-clear" class="sf-harvest-btn sf-harvest-btn-clear">🗑️ مسح القائمة السوداء (${Object.keys(this.blacklist).length})</button>
            </div>
        `;
    }

    bindEvents() {
        const searchInput = this.container.querySelector('#sf-harvest-search');
        const resultsSelect = this.container.querySelector('#sf-harvest-results');
        const btnStart = this.container.querySelector('#sf-harvest-btn-start');
        const btnStop = this.container.querySelector('#sf-harvest-btn-stop');
        const btnClear = this.container.querySelector('#sf-harvest-btn-clear');
        const inputTarget = this.container.querySelector('#sf-harvest-target');
        const modeSelect = this.container.querySelector('#sf-harvest-mode');

        this.btnStart = btnStart;
        this.btnStop = btnStop;
        this.btnClear = btnClear;
        this.inputTarget = inputTarget;
        this.resultsSelect = resultsSelect;

        const lazyLoadData = () => {
            if (this.allItems.length === 0) {
                this.allItems = this.getHarvestableItems();
                if (this.allItems.length > 0) {
                    this.log(`تم تحميل ${this.allItems.length} محصول بنجاح.`);
                }
            }
        };

        modeSelect.addEventListener('change', () => {
            if (modeSelect.value === 'harvest') {
                inputTarget.placeholder = "عدد الثمار...";
            } else if (modeSelect.value === 'fertilize') {
                inputTarget.placeholder = "عدد الجيران...";
            } else {
                inputTarget.placeholder = "العدد...";
            }
            searchInput.dispatchEvent(new Event('input'));
        });

        searchInput.addEventListener("focus", lazyLoadData);

        searchInput.addEventListener("input", (e) => {
            const query = e.target.value.trim().toLowerCase();
            resultsSelect.innerHTML = "";
            if (!query) {
                resultsSelect.size = 8;
                return;
            }

            let modeItems = this.allItems;
            const currentMode = modeSelect.value;
            if (currentMode === "building") {
                modeItems = this.allItems.filter(item => !["seeds", "trees"].includes(item.type));
            } else {
                modeItems = this.allItems.filter(item => ["seeds", "trees"].includes(item.type));
            }

            const filtered = modeItems.filter(item => item.name.toLowerCase().includes(query) || String(item.id).includes(query));
            
            filtered.slice(0, 50).forEach(item => {
                const opt = document.createElement("option");
                opt.value = JSON.stringify(item);
                let tName = item.type;
                if (tName === 'trees') tName = 'شجرة';
                if (tName === 'seeds') tName = 'بذرة/محصول';
                opt.innerText = `[${item.id}] ${item.name} (${tName})`;
                resultsSelect.appendChild(opt);
            });
            resultsSelect.size = Math.min(8, Math.max(2, filtered.length));
        });

        resultsSelect.addEventListener("change", (e) => {
            const selectedOpt = resultsSelect.options[resultsSelect.selectedIndex];
            if (selectedOpt) {
                const item = JSON.parse(selectedOpt.value);
                searchInput.value = item.name;
                resultsSelect.innerHTML = "";
                resultsSelect.appendChild(selectedOpt);
                resultsSelect.size = 2; // Shrink to look neat
            }
        });

        btnStart.addEventListener('click', () => {
            const selectedOpt = resultsSelect.options[resultsSelect.selectedIndex];
            if (!selectedOpt) {
                alert("⚠️ الرجاء البحث وتحديد المحصول من القائمة أولاً.");
                return;
            }

            let limit = parseInt(inputTarget.value);
            if (isNaN(limit) || limit <= 0) {
                alert("⚠️ الرجاء إدخال عدد صحيح صالح.");
                return;
            }

            const item = JSON.parse(selectedOpt.value);
            this.currentMode = modeSelect.value;
            this.targetLimit = limit;
            this.startHarvest(item.id, item.type, item.kind);
        });

        btnStop.addEventListener('click', () => {
            this.log("🛑 جاري الإيقاف الفوري...");
            this.stopHarvest();
        });

        btnClear.addEventListener('click', () => {
            this.blacklist = {};
            this.saveBlacklist();
            btnClear.textContent = `🗑️ مسح القائمة السوداء (0)`;
            alert("✅ تم مسح القائمة السوداء بنجاح!");
        });
    }

    update() {
        if (this.btnClear) {
            this.btnClear.textContent = `🗑️ مسح القائمة السوداء (${Object.keys(this.blacklist).length})`;
        }
    }

    log(msg) {
        console.log(`[AutoMegaHarvest] ${msg}`);
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    processRewards() {
        try {
            let gw = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
            
            // Fixed rewards for 10 clicks (mega harvest)
            let exp = 10;   // 1 xp * 10 clicks
            let coin = 50;  // 5 coins * 10 clicks
            
            if (gw.GF && gw.GF.loginModel && gw.GF.loginModel.addTreasure) {
                // This triggers the internal data update + UI event naturally
                gw.GF.loginModel.addTreasure("experience", exp);
                gw.GF.loginModel.addTreasure("coins", coin);
                if (typeof this.log === 'function') {
                    this.log(`💸 إضافة لحظية: +${exp} خبرة | +${coin} ذهب`);
                }
            }
            
            if (gw.GF && gw.GF.gameController && gw.Animations) {
                let startRect = gw.egret.Rectangle.create();
                startRect.x = window.innerWidth / 2; startRect.y = window.innerHeight / 2;
                startRect.width = 50; startRect.height = 50;
                
                gw.GF.gameController.collectTopTip("exp", exp);
                let ep = gw.egret.Point.create(window.innerWidth / 2, 30);
                if (gw.GF.gameController.operArea && gw.GF.gameController.operArea.lblExp) {
                    gw.GF.gameController.operArea.lblExp.parent.localToGlobal(0, 0, ep);
                    if (gw.GF.loginModel && gw.GF.loginModel.AppData) {
                        gw.GF.gameController.operArea.lblExp.textFormatNum = gw.GF.loginModel.AppData.experience;
                    }
                }
                gw.Animations.flyItemTo("exp", startRect, ep);
                
                gw.GF.gameController.collectTopTip("coins", coin);
                let cp = gw.egret.Point.create(window.innerWidth - 100, 30);
                if (gw.GF.gameController.operArea && gw.GF.gameController.operArea.lblCoin) {
                    gw.GF.gameController.operArea.lblCoin.parent.localToGlobal(0, 0, cp);
                    if (gw.GF.loginModel && gw.GF.loginModel.AppData) {
                        gw.GF.gameController.operArea.lblCoin.textFormatNum = gw.GF.loginModel.AppData.coins;
                    }
                }
                gw.Animations.flyItemTo("coin", startRect, cp);
            }
        } catch(e) { console.log("Error flying rewards:", e); }
    }

    randomJitter() {
        return Math.floor(Math.random() * (this.JitterMax - this.JitterMin + 1)) + this.JitterMin;
    }

    showProgressOverlay(current, target, stats = { total: 0, depleted: 0, active: 0 }) {
        if (!this.hudElement) {
            this.hudElement = document.createElement('div');
            this.hudElement.id = 'sf-harvest-hud';
            Object.assign(this.hudElement.style, {
                position: 'fixed',
                bottom: '80px',
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'rgba(15, 23, 42, 0.9)',
                backdropFilter: 'blur(12px)',
                color: '#fff',
                padding: '15px 30px',
                borderRadius: '16px',
                fontFamily: 'Tajawal, sans-serif',
                zIndex: '9999',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '10px',
                boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
                border: '1px solid rgba(0, 210, 211, 0.5)',
                pointerEvents: 'none',
                minWidth: '320px'
            });
            document.body.appendChild(this.hudElement);
        }

        const actionText = (this.currentMode === "fertilize") ? "تم مساعدة (جيران):" : "تم حصد (ثمار):";

        this.hudElement.innerHTML = `
            <div style="font-size: 22px; font-weight: bold; margin-bottom: 5px;">
                <span style="color: #00d2d3;">${actionText}</span> 
                <span style="color: #feca57; font-size: 28px;">${current}</span> / <span style="color: #c8d6e5;">${target}</span>
            </div>
            <div style="display: flex; gap: 20px; font-size: 14px; font-weight: bold; background: rgba(0,0,0,0.4); padding: 8px 15px; border-radius: 8px; flex-direction: row-reverse;">
                <div style="text-align: center;">
                    <div style="color: #a4b0be; font-size: 11px;">كل الجيران</div>
                    <div style="color: #48dbfb;">${stats.total}</div>
                </div>
                <div style="text-align: center; border-left: 1px solid rgba(255,255,255,0.1); padding-left: 15px;">
                    <div style="color: #a4b0be; font-size: 11px;">مستنفد (محظور)</div>
                    <div style="color: #ff6b6b;">${stats.depleted}</div>
                </div>
                <div style="text-align: center; border-left: 1px solid rgba(255,255,255,0.1); padding-left: 15px;">
                    <div style="color: #a4b0be; font-size: 11px;">جاهز (نشط)</div>
                    <div style="color: #1dd1a1;">${stats.active}</div>
                </div>
            </div>
        `;
    }

    hideProgressOverlay() {
        if (this.hudElement && this.hudElement.parentNode) {
            this.hudElement.parentNode.removeChild(this.hudElement);
            this.hudElement = null;
        }
    }

    async startHarvest(itemId, itemType, itemKind) {
        const gw = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
        if (!gw.GF || !gw.GF.loginModel) {
            this.log("⚠️ اللعبة لم تحمل بالكامل.");
            return;
        }

        this.initInterceptor();
        this.isRunning = true;
        this.totalHarvested = 0; // Number of items (fruits or neighbors depending on mode)
        this.totalFruits = 0;    // Number of total fruits collected (for logging)
        
        if(this.btnStart) this.btnStart.style.display = 'none';
        if(this.btnStop) this.btnStop.style.display = 'block';

        let modeName = "الحصاد";
        let targetName = "ثمرة";
        if (this.currentMode === "fertilize") { modeName = "التسميد/الساقية"; targetName = "جار"; }
        else if (this.currentMode === "building") { modeName = "حصاد الأبنية"; targetName = "ثمرة"; }

        this.log(`🔥 انطلاق وضع [${modeName}] لمحصول [${itemId}]! الهدف: ${this.targetLimit} ${targetName}`);

        let harvestCmd = (itemType === "trees") ? "friend_collect_trees" : "friend_collect";
        const fertCmd = (itemType === "trees") ? "friend_water.save_data" : "friend_fertilize.save_data";
        
        if (this.currentMode === "building") {
            let kindStr = (itemKind || "saltpond").toLowerCase();
            harvestCmd = "friend_collect_" + kindStr;
        }
        
        let friendsList = [];
        if (gw.GF.friendsModel && gw.GF.friendsModel.allNeighbors) {
            friendsList = gw.GF.friendsModel.allNeighbors.filter(n => !n.isNpc && !n.isSelf);
        }

        if (friendsList.length === 0) {
            this.log("❌ لا يوجد جيران متاحين.");
            this.stopHarvest();
            return;
        }

        const updateStatsUI = () => {
            const total = friendsList.length;
            let depletedCount = 0;
            friendsList.forEach(f => {
                if (this.blacklist[f.uid]) depletedCount++;
            });
            const active = total - depletedCount;
            this.showProgressOverlay(this.totalHarvested, this.targetLimit, { total, depleted: depletedCount, active });
        };

        updateStatsUI();

        for (let i = 0; i < friendsList.length; i++) {
            if (!this.isRunning || this.totalHarvested >= this.targetLimit) break;

            let neighbor = friendsList[i];
            const friendId = neighbor.uid;

            if (this.blacklist[friendId]) continue;

            let neighborHasEnergy = true;
            let attempts = 0;

            while (this.isRunning && neighborHasEnergy && this.totalHarvested < this.targetLimit && attempts < 100) {
                attempts++;
                
                if (this.currentMode === "fertilize") {
                    const payloadToUse = { friend_id: friendId, plant_x: 0, plant_y: 0, plant_id: itemId };
                    
                    const fertPromise = new Promise(resolve => {
                        this.activeCallback = resolve;
                        setTimeout(() => { if (this.activeCallback) { this.activeCallback(null); } }, 5000);
                    });

                    let burst = 10;
                    for (let b = 0; b < burst; b++) {
                        gw.NetUtils.enqueue(fertCmd, payloadToUse);
                    }
                    // الضربة الـ 11 لاستلام مكافأة الجار في نفس الدفعة
                    gw.NetUtils.enqueue("water_plants", {
                        id: friendId,
                        needResponse: "water_plants",
                        cur_sceneid: 0
                    });
                    
                    if (gw.NetUtils.flush) gw.NetUtils.flush();
                    
                    const res = await fertPromise;
                    if (res && res.msg !== "used up") {
                        this.processRewards();
                    } else {
                        await this.sleep(500); // fallback wait
                    }
                    
                    this.log(`⛔ الجار [${friendId}] تم توجيه 10 نقرات تسميد مدمجة له بنجاح.`);
                    this.blacklist[friendId] = true;
                    this.saveBlacklist();
                    
                    this.totalHarvested += 1;
                    this.log(`💧 تم استكمال مساعدة الجار [${friendId}] بالكامل. الجيران المكتملين: (${this.totalHarvested}/${this.targetLimit})`);
                    
                    this.update();
                    updateStatsUI();
                    
                    break; // الانتقال للجار التالي
                }

                if (this.currentMode === "harvest" || this.currentMode === "building") {
                    let harvestPayload;
                    if (itemType === "trees") {
                        harvestPayload = { 
                            friend_id: friendId, 
                            friendName: neighbor.name || "", 
                            itemid: itemId, 
                            cur_sceneid: 1, 
                            id: itemId, 
                            achievement_add: "social_1825_9758" 
                        };
                    } else if (this.currentMode === "building") {
                        harvestPayload = { 
                            friend_id: friendId, 
                            itemid: itemId,
                            friendName: neighbor.name || "",
                            cur_sceneid: 0
                        };
                    } else {
                        harvestPayload = { friend_id: friendId, itemid: itemId };
                    }
                    
                    let harvestPromise = new Promise((resolve) => {
                        this.activeCallback = resolve;
                        setTimeout(() => {
                            if (this.activeCallback === resolve) {
                                this.activeCallback = null;
                                resolve(null); // Timeout
                            }
                        }, 5000);
                    });

                    let burst = 10;
                    for (let b = 0; b < burst; b++) {
                        gw.NetUtils.enqueue(harvestCmd, harvestPayload);
                    }
                    // الضربة الـ 11 لاستلام مكافأة الجار في نفس الدفعة
                    gw.NetUtils.enqueue("water_plants", {
                        id: friendId,
                        needResponse: "water_plants",
                        cur_sceneid: 0
                    });

                    if (gw.NetUtils.flush) gw.NetUtils.flush();

                    const res = await harvestPromise;

                    if (!res) {
                        this.log(`⚠️ مهلة الاتصال انتهت مع الجار [${friendId}].`);
                        neighborHasEnergy = false;
                    } else {
                        if (res.totalAdded > 0) {
                            this.totalFruits += res.totalAdded;
                            this.totalHarvested += res.totalAdded; // استرجاع عداد الثمار
                            this.log(`✅ الضربة القاضية (10 نقرات مدمجة): تم حصد ${res.totalAdded} ثمرة! إجمالي الثمار: ${this.totalHarvested}/${this.targetLimit}`);

                            if (gw.GF && gw.GF.loginModel && gw.GF.loginModel.AppData && gw.GF.loginModel.AppData.storage) {
                                let curQty = gw.GF.loginModel.AppData.storage[res.product] || 0;
                                gw.GF.loginModel.AppData.storage[res.product] = curQty + res.totalAdded;
                            }
                            
                            this.processRewards(res);

                            try {
                                if (gw.GF && gw.GF.gameController && gw.Animations) {
                                    gw.GF.gameController.collectTopTip(res.product, res.totalAdded);
                                    let startRect = gw.egret.Rectangle.create();
                                    startRect.x = window.innerWidth / 2;
                                    startRect.y = window.innerHeight / 2;
                                    startRect.width = 75;
                                    startRect.height = 75;
                                    let endPoint = gw.egret.Point.create(100, window.innerHeight - 100); 
                                    if (gw.GF.gameController.operArea && gw.GF.gameController.operArea.btnWarehouse) {
                                        gw.GF.gameController.operArea.btnWarehouse.localToGlobal(0, 0, endPoint);
                                    }
                                    gw.Animations.flyItemTo(res.product, startRect, endPoint);
                                }
                            } catch(e) {}
                        }
                        
                        if (res.msg === "used up" || res.totalAdded === 0) {
                            if (res.msg === "used up") {
                                this.log(`⛔ استنفدت طاقة الجار [${friendId}]. إضافته للقائمة السوداء.`);
                            } else {
                                this.log(`⚠️ حصيلة فارغة للجار [${friendId}] بعد 10 نقرات. الجار فارغ، ننتقل للتالي.`);
                            }
                            this.blacklist[friendId] = true;
                            this.saveBlacklist();
                            neighborHasEnergy = false;
                        } else {
                            await this.sleep(this.randomJitter()); // تأخير عشوائي لتجنب الحظر من السيرفر (Rate Limit)
                        }
                    }

                    this.blacklist[friendId] = true;
                    this.saveBlacklist();
                    this.update(); 
                    updateStatsUI();
                    break;
                }
            }
            // تأخير قبل الانتقال للجار التالي لتجنب حظر السيرفر
            if (this.isRunning) {
                await this.sleep(150); // تأخير قصير جداً لجعل التسميد صاروخياً
            }
        }

        if (this.totalHarvested >= this.targetLimit) {
            this.log(`✅ تمت المهمة بنجاح! تم حصد ${this.totalHarvested} ثمرة.`);
            setTimeout(() => this.hideProgressOverlay(), 3000); 
        } else {
            this.hideProgressOverlay(); 
        }

        this.stopHarvest();
    }

    stopHarvest() {
        this.isRunning = false; 
        if(this.btnStart) this.btnStart.style.display = 'block';
        if(this.btnStop) this.btnStop.style.display = 'none';
        if (this.totalHarvested < this.targetLimit) {
            this.hideProgressOverlay();
            this.log("🛑 تم إيقاف الحصاد يدوياً.");
        }
    }
};

// Register module
if (window.SF && window.SF.modules) {
    window.SF.modules.register(new SF.AutoMegaHarvestModule());
}


// --- File: features/SessionExtractorModule.js ---
window.SF = window.SF || {};

SF.SessionExtractorModule = class SessionExtractorModule extends SF.ModuleBase {
    constructor() {
        super('session_extractor', 'استخراج الكوكي والطلبات', '🍪');
        this.savedSignedRequest = "";
        this.savedSessionKey = "";

        // اعتراض الطلبات لحفظ أحدث طلب واستخلاص المفاتيح بشكل دائم
        SF.bus.on('network:request', (req) => {
            if (req.isGame && req.body) {
                this.lastRequestUrl = req.url;
                this.lastRequestBody = (typeof req.body === 'string') ? req.body : JSON.stringify(req.body);
                
                // استخلاص وحفظ دائم للمفاتيح بمجرد مرورها بأي ريكوست
                const sigMatch = this.lastRequestBody.match(/signed_request\s*[:=]\s*['"]?([^&"'\s]+)/) || this.lastRequestBody.match(/signed_request=([^&]+)/);
                if (sigMatch && sigMatch[1]) this.savedSignedRequest = sigMatch[1];
                
                const sKeyMatch = this.lastRequestBody.match(/sessionKey\s*[:=]\s*['"]?([^&"'\s]+)/) || this.lastRequestBody.match(/sessionKey=([^&]+)/) || (this.lastRequestUrl && this.lastRequestUrl.match(/s=([a-zA-Z0-9_]+)/));
                if (sKeyMatch && sKeyMatch[1]) this.savedSessionKey = sKeyMatch[1];
            }
        });
    }

    render() {
        return `
            <style>
                .sf-extractor-btn {
                    padding: 15px 20px;
                    border: none;
                    border-radius: 8px;
                    font-weight: bold;
                    cursor: pointer;
                    width: 100%;
                    transition: all 0.3s ease;
                    font-family: inherit;
                    margin-bottom: 12px;
                    background: #27ae60; 
                    color: white;
                    font-size: 16px;
                }
                .sf-extractor-btn:hover { background: #2ecc71; }
                
                .sf-extractor-textarea {
                    width: 100%;
                    height: 90px;
                    background: rgba(0,0,0,0.7);
                    border: 1px solid rgba(255,255,255,0.3);
                    color: #00d2d3;
                    padding: 12px;
                    border-radius: 6px;
                    outline: none;
                    resize: vertical;
                    font-family: monospace;
                    font-size: 14px;
                    text-align: center;
                    word-break: break-all;
                }
            </style>
            
            <div class="sf-card">
                <button id="sf-btn-extract-smart" class="sf-extractor-btn">🚀 استخراج مفتاح الدخول (V2)</button>
                <textarea id="sf-txt-smart" class="sf-extractor-textarea" readonly placeholder="سيظهر المفتاح هنا..."></textarea>
            </div>
        `;
    }

    bindEvents() {
        const btnSmart = this.container.querySelector('#sf-btn-extract-smart');
        const txtSmart = this.container.querySelector('#sf-txt-smart');
        
        btnSmart.addEventListener('click', () => {
            const gw = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
            
            let extractedKey = "";
            let keyType = "";

            // --- 1. Try Extracting Facebook signed_request ---
            let sig = this.savedSignedRequest;
            try {
                if (!sig) {
                    const wn = JSON.parse(gw.name);
                    if (wn && wn.signed_request) sig = wn.signed_request;
                }
            } catch(e) {}
            
            if (!sig && gw.location && gw.location.search) {
                const params = new URLSearchParams(gw.location.search);
                if (params.get('signed_request')) sig = params.get('signed_request');
            }
            if (!sig && gw.JSDataManager && gw.JSDataManager.ins && gw.JSDataManager.ins.getFacebookToken) {
                const fb = gw.JSDataManager.ins.getFacebookToken();
                if (fb && fb.signed_request) sig = fb.signed_request;
            }
            if (!sig && gw.document && gw.document.documentElement) {
                const m = gw.document.documentElement.innerHTML.match(/signed_request["']?\s*[:=]\s*["']?([^&"'\s\\><,]+)/);
                if (m && m[1]) sig = m[1];
            }

            if (sig && sig.length > 20) {
                extractedKey = sig;
                keyType = "signed_request";
            } else {
                // --- 2. Try Extracting Website Cookie (__Host-bf_s) ---
                const cookieData = gw.document.cookie || document.cookie;
                if (cookieData) {
                    const match = cookieData.match(/__Host-bf_s=([^;]+)/);
                    if (match && match[1] && match[1].length > 10) {
                        extractedKey = match[1];
                        keyType = "__Host-bf_s";
                    } else {
                        alert("❌ لم يتم العثور على signed_request (فيسبوك) ولا على مفتاح __Host-bf_s (الموقع الرسمي).\nقم بعمل تحديث (Refresh) للصفحة وحاول مجدداً.");
                        return;
                    }
                } else {
                    alert("❌ لا يوجد أي بيانات مسجلة. يرجى تسجيل الدخول أولاً.");
                    return;
                }
            }

            // Output to UI
            txtSmart.value = extractedKey;
            txtSmart.select();
            
            // Copy logic with fallbacks
            navigator.clipboard.writeText(extractedKey).then(() => {
                this.tempBtnText(btnSmart, `✅ تم استخراج ونسخ (${keyType})`, "#10ac84");
            }).catch(() => {
                try {
                    document.execCommand('copy');
                    this.tempBtnText(btnSmart, `✅ تم استخراج ونسخ (${keyType})`, "#10ac84");
                } catch(e) {
                    this.tempBtnText(btnSmart, `⚠️ تم استخراج (${keyType}) - يرجى النسخ יدوياً (Ctrl+C)`, "#f39c12");
                }
            });
        });
    }

    tempBtnText(btnElement, newText, newColor) {
        const oldText = btnElement.innerText;
        const oldColor = btnElement.style.background;
        btnElement.innerText = newText;
        if (newColor) btnElement.style.background = newColor;
        setTimeout(() => {
            btnElement.innerText = oldText;
            btnElement.style.background = oldColor || "";
        }, 3000);
    }
};

// Register module
if (window.SF && window.SF.modules) {
    window.SF.modules.register(new SF.SessionExtractorModule());
}


// --- File: features/MonopolySmartHelper.js ---
// ==========================================
// 🎲 Monopoly Smart Helper (Invisible Feature)
// يظهر فقط كشريط علوي داخل الفعالية، قراءة دقيقة وتبديل دقيق
// ==========================================
(function() {
    'use strict';

    let topBarUI = null;
    let isPlaying = false;
    let currentDice = 0;
    let currentCoins = 0;
    let currentRound = 0;
    let playTimeout = null;

    // ==========================================
    // 1. نظام كشف الفعالية (Auto-Detect)
    // ==========================================
    function setupInterceptor() {
        let gw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        let checkInterval = setInterval(() => {
            if (gw.App && gw.App.MessageCenter && gw.NetUtils && gw.NetUtils.netManager) {
                clearInterval(checkInterval);
                const originalRequest = gw.NetUtils.netManager.request;
                gw.NetUtils.netManager.request = function(cmd, act, data, callback, errCallback, retryCount) {
                    if (cmd === "Activity/Monopoly") {
                        let originalCallback = callback;
                        callback = function(res) {
                            if (res && res.status && res.data) {
                                if (act === "loadData") {
                                    currentDice = res.data.counter || res.data.dice || 0;
                                    currentRound = res.data.round || 0;
                                    currentCoins = detectCoinsAccurately(gw);
                                    showTopBarUI(currentDice, currentCoins, currentRound);
                                } else if (act === "play" || act === "exchange" || act === "buyDice") {
                                    // Update after a short delay to allow bag to update
                                    setTimeout(() => {
                                        currentCoins = detectCoinsAccurately(gw);
                                        // Update dice from response if possible, else rely on loadData
                                        if (res.data.counter !== undefined) currentDice = res.data.counter;
                                        showTopBarUI(currentDice, currentCoins, currentRound);
                                    }, 500);
                                }
                            }
                            if (originalCallback) originalCallback(res);
                        };
                    }
                    return originalRequest.call(this, cmd, act, data, callback, errCallback, retryCount);
                };
            }
        }, 1000);
    }

    // ==========================================
    // 2. قراءة العملات بدقة (Accurate Coin Reading)
    // ==========================================
    function detectCoinsAccurately(gw) {
        let coinCount = 0;
        try {
            if (gw.App && gw.App.ControllerManager) {
                let bag = gw.App.ControllerManager.getControllerModel("Bag");
                if (bag) {
                    // آيدي عملة التبديل لبنك الحظ (من السجلات: 224989, 250395)
                    let possibleTokenIDs = ["250395", "224989", "224988", "224990"];
                    for (let id of possibleTokenIDs) {
                        let count = bag.getItemCount(id);
                        if (count && count > 0) {
                            coinCount = count;
                            break;
                        }
                    }
                }
            }
        } catch (e) {
            console.warn("[Monopoly] Error reading coins", e);
        }
        return coinCount;
    }

    // ==========================================
    // 3. تصميم الشريط العلوي الاحترافي
    // ==========================================
    function showTopBarUI(dice, coins, round) {
        if (topBarUI) {
            updateUIData(dice, coins, round);
            topBarUI.style.display = 'flex';
            return;
        }

        topBarUI = document.createElement('div');
        topBarUI.id = 'sf-monopoly-topbar';
        
        topBarUI.innerHTML = `
            <style>
                #sf-monopoly-topbar {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 55px;
                    background: linear-gradient(180deg, rgba(15, 23, 42, 0.95) 0%, rgba(15, 23, 42, 0.8) 100%);
                    border-bottom: 2px solid #38bdf8;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    color: #fff;
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    z-index: 9999999; /* لضمان ظهوره فوق الكانفاس */
                    direction: rtl;
                    box-shadow: 0 4px 15px rgba(0,0,0,0.5);
                    backdrop-filter: blur(5px);
                    transition: all 0.3s ease;
                }
                .sf-tb-group {
                    display: flex;
                    align-items: center;
                    margin: 0 15px;
                    background: rgba(0,0,0,0.4);
                    padding: 5px 15px;
                    border-radius: 20px;
                    border: 1px solid rgba(255,255,255,0.1);
                }
                .sf-tb-label {
                    font-size: 13px;
                    color: #94a3b8;
                    margin-left: 8px;
                }
                .sf-tb-value {
                    font-size: 16px;
                    font-weight: bold;
                    color: #fbbf24;
                }
                .sf-tb-dice-val {
                    color: #38bdf8;
                }
                .sf-tb-btn {
                    padding: 6px 15px;
                    border: none;
                    border-radius: 20px;
                    font-weight: bold;
                    cursor: pointer;
                    margin: 0 5px;
                    font-size: 13px;
                    transition: all 0.2s;
                }
                .sf-tb-btn-exchange {
                    background: linear-gradient(135deg, #f59e0b, #d97706);
                    color: white;
                }
                .sf-tb-btn-exchange:hover { opacity: 0.9; transform: scale(1.05); }
                
                .sf-tb-btn-play {
                    background: linear-gradient(135deg, #10b981, #059669);
                    color: white;
                }
                .sf-tb-btn-play.stop {
                    background: linear-gradient(135deg, #ef4444, #dc2626);
                }
                
                .sf-tb-btn-hide {
                    background: rgba(255,255,255,0.1);
                    color: #fff;
                    position: absolute;
                    left: 10px;
                    border-radius: 5px;
                }
                .sf-tb-btn-hide:hover { background: rgba(239, 68, 68, 0.8); }

                .sf-tb-input {
                    background: rgba(0,0,0,0.5);
                    border: 1px solid #38bdf8;
                    color: #fff;
                    padding: 4px 8px;
                    border-radius: 5px;
                    width: 70px;
                    text-align: center;
                    font-weight: bold;
                    margin-left: 5px;
                }
                #sf-tb-log {
                    position: absolute;
                    bottom: -30px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: rgba(0,0,0,0.8);
                    padding: 4px 15px;
                    border-radius: 0 0 10px 10px;
                    font-size: 11px;
                    color: #a4b0be;
                    white-space: nowrap;
                    opacity: 0;
                    transition: opacity 0.3s;
                }
                #sf-tb-log.show { opacity: 1; }
            </style>
            
            <!-- زر إخفاء الشريط -->
            <button id="sf-tb-hide-btn" class="sf-tb-btn sf-tb-btn-hide">✖ إخفاء</button>

            <!-- معلومات النرد -->
            <div class="sf-tb-group">
                <span class="sf-tb-label">النرد الجاهز:</span>
                <span class="sf-tb-value sf-tb-dice-val" id="sf-tb-dice-val">0</span>
            </div>

            <!-- معلومات العملات -->
            <div class="sf-tb-group">
                <span class="sf-tb-label">العملات المتاحة:</span>
                <input type="number" id="sf-tb-coins-input" class="sf-tb-input" value="0">
            </div>

            <!-- أزرار التحكم -->
            <button id="sf-tb-exchange-btn" class="sf-tb-btn sf-tb-btn-exchange">
                💱 تبديل دقيق
            </button>
            
            <button id="sf-tb-play-btn" class="sf-tb-btn sf-tb-btn-play">
                ▶️ تشغيل اللعب
            </button>

            <!-- رسائل النظام -->
            <div id="sf-tb-log">جاهز...</div>
        `;

        document.body.appendChild(topBarUI);

        // Bind Events
        document.getElementById('sf-tb-hide-btn').onclick = () => {
            topBarUI.style.display = 'none';
            stopAutoPlay();
            logMessage("تم إخفاء الشريط وإيقاف اللعب.", true);
        };
        
        document.getElementById('sf-tb-exchange-btn').onclick = () => {
            accurateExchange();
        };

        document.getElementById('sf-tb-play-btn').onclick = () => {
            if (isPlaying) {
                stopAutoPlay();
            } else {
                startAutoPlay();
            }
        };

        updateUIData(dice, coins, round);
    }

    function updateUIData(dice, coins, round) {
        if (!topBarUI) return;
        currentDice = dice;
        currentRound = round;
        
        // Only update coin input if it's currently 0 or we found a positive reading
        const coinInput = document.getElementById('sf-tb-coins-input');
        if (coins > 0 || parseInt(coinInput.value) === 0) {
            coinInput.value = coins;
        }

        document.getElementById('sf-tb-dice-val').innerText = dice;
    }

    function logMessage(msg, keep = false) {
        console.log(`[MonopolySmart] ${msg}`);
        const logEl = document.getElementById('sf-tb-log');
        if (logEl) {
            logEl.innerText = msg;
            logEl.classList.add('show');
            if (!keep) {
                setTimeout(() => logEl.classList.remove('show'), 3000);
            }
        }
    }

    // ==========================================
    // 3. التبديل الدقيق والاحترافي (Accurate Exchange)
    // ==========================================
    async function accurateExchange() {
        let gw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        if (!gw.NetUtils || !gw.NetUtils.netManager) return;
        
        const coinInput = document.getElementById('sf-tb-coins-input');
        let totalCoins = parseInt(coinInput.value);
        
        if (isNaN(totalCoins) || totalCoins < 100) {
            logMessage("⚠️ العملات غير كافية! (كل 1 نرد يتطلب 100 عملة)");
            return;
        }

        // حساب عدد النرد الذي يمكن تبديله (تكلفة النرد الواحد = 100 عملة)
        let qtyOfDice = Math.floor(totalCoins / 100);

        logMessage(`🔄 جاري تبديل ${qtyOfDice} نرد بدقة...`);
        const exchangeBtn = document.getElementById('sf-tb-exchange-btn');
        exchangeBtn.disabled = true;
        exchangeBtn.innerText = "⏳ جاري...";

        try {
            // نقوم بإرسال طلب واحد للتبديل بالكمية المحسوبة بدقة
            let res = await gw.NetUtils.netManager.request("Activity/Monopoly", { action: "exchange", index: 1, qty: qtyOfDice });
            
            if (res && res.status) {
                let cost = qtyOfDice * 100;
                logMessage(`✅ تم التبديل بنجاح! حصلت على ${qtyOfDice} نرد (خصم ${cost} عملة)`);
                
                // تحديث مربع العملات بالباقي
                let remainingCoins = totalCoins - cost;
                coinInput.value = remainingCoins;
            } else {
                // إذا رفض السيرفر طلب الكمية كدفعة واحدة، نجرب إرسالها واحد تلو الآخر بدقة
                logMessage(`⚠️ السيرفر رفض الدفعة. جاري التبديل الدقيق التدريجي...`);
                let successCount = 0;
                
                for (let i = 0; i < qtyOfDice; i++) {
                    let singleRes = await gw.NetUtils.netManager.request("Activity/Monopoly", { action: "exchange", index: 1, qty: 1 });
                    if (singleRes && singleRes.status) {
                        successCount++;
                    } else {
                        break;
                    }
                    await sleep(300);
                }
                
                if (successCount > 0) {
                    let cost = successCount * 100;
                    logMessage(`✅ تم تبديل ${successCount} نرد. (خصم ${cost} عملة)`);
                    coinInput.value = totalCoins - cost;
                } else {
                    logMessage("❌ فشل التبديل.");
                }
            }
            
            // Sync
            let syncRes = await gw.NetUtils.netManager.request("Activity/Monopoly", { action: "loadData" });
            if (syncRes && syncRes.data) {
                updateUIData(syncRes.data.counter || 0, parseInt(coinInput.value), syncRes.data.round || 0);
            }

        } catch (e) {
            logMessage("❌ خطأ أثناء التبديل.");
        }

        exchangeBtn.disabled = false;
        exchangeBtn.innerText = "💱 تبديل دقيق";
    }

    // ==========================================
    // 4. اللعب الذكي والتلقائي
    // ==========================================
    async function startAutoPlay() {
        if (currentDice <= 0) {
            logMessage("⚠️ لا يوجد نرد للعب!");
            return;
        }

        isPlaying = true;
        const playBtn = document.getElementById('sf-tb-play-btn');
        playBtn.innerText = "⏸️ إيقاف";
        playBtn.classList.add('stop');
        
        logMessage("▶️ جاري اللعب التلقائي...", true);
        executePlayCycle();
    }

    function stopAutoPlay() {
        isPlaying = false;
        if (playTimeout) {
            clearTimeout(playTimeout);
            playTimeout = null;
        }
        const playBtn = document.getElementById('sf-tb-play-btn');
        if (playBtn) {
            playBtn.innerText = "▶️ تشغيل اللعب";
            playBtn.classList.remove('stop');
        }
        logMessage("⏸️ تم الإيقاف.");
    }

    async function executePlayCycle() {
        if (!isPlaying) return;

        try {
            let gw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            let response = await gw.NetUtils.netManager.request("Activity/Monopoly", { action: "play" });
            
            if (response && response.status) {
                let points = response.data.points;
                let pos = response.data.pos;
                let reward = response.data.reward;
                
                currentDice--;
                logMessage(`🎲 رُمي (${points}) -> موقع ${pos} ${reward && Object.keys(reward).length ? '🎁' : ''}`);
                updateUIData(currentDice, currentCoins, currentRound);
                
                if (currentDice <= 0) {
                    logMessage("⚠️ نفد النرد! تم الإيقاف.");
                    stopAutoPlay();
                    return;
                }

                let jitter = Math.floor(Math.random() * 500) + 1200;
                playTimeout = setTimeout(executePlayCycle, jitter);
            } else {
                logMessage("⚠️ توقف! السيرفر لم يقبل اللعب.");
                stopAutoPlay();
            }
        } catch (e) {
            logMessage("❌ حدث خطأ أثناء اللعب.");
            stopAutoPlay();
        }
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Start Interceptor
    setupInterceptor();
})();


// --- File: features/MiniSlot2AutoModule.js ---
// ==========================================
// 🎰 MiniSlot2 Auto-Spin Module (دوّر وأربح)
// شريط تحكم ذكي للعب التلقائي بعدد محدد
// ==========================================
(function() {
    'use strict';

    let topBarUI = null;
    let isPlaying = false;
    let spinTimeout = null;
    let currentFreeSpins = 0;
    let currentTokens = 0;
    let todaySpinTimes = 0;
    let targetSpins = 0;
    let completedSpins = 0;
    let totalRewards = {};
    let spinLock = false; // قفل لمنع إرسال أكثر من spin في نفس الوقت

    const CMD = '/Activity/MiniSlot2.save_data';
    const TOKEN_ID = 225463; // عملة سلوت الخاصة بـ MiniSlot2

    let isUIHidden = false; // لمنع إعادة الفتح التلقائي بعد الإغلاق

    // ==========================================
    // 1. نظام كشف الفعالية (Auto-Detect)
    // ==========================================
    function setupInterceptor() {
        let gw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        let checkInterval = setInterval(() => {
            if (gw.NetUtils && gw.NetUtils.request) {
                clearInterval(checkInterval);

                const originalRequest = gw.NetUtils.request.bind(gw.NetUtils);
                gw.NetUtils.request = function(cmd, data) {
                    let result = originalRequest.apply(this, arguments);

                    if (cmd && cmd.includes('MiniSlot2') && result && result.then) {
                        result.then(function(res) {
                            let resData = res && res.data ? res.data : res;
                            if (resData) {
                                if (cmd === CMD) {
                                    onMiniSlot2Response(gw, resData, data);
                                } else {
                                    // تم رصد تحديث أو فتح للفعالية، نحدث فقط الرصيد بصمت
                                    setTimeout(() => refreshFreeSpins(gw), 500);
                                }
                            }
                        });
                    }
                    return result;
                };

                readInitialData(gw);
                console.log('[MiniSlot2Auto] ✅ تم تفعيل اعتراض الشبكة.');
            }
        }, 1000);
    }

    // ==========================================
    // 2. قراءة البيانات الحية (Live Data Reading)
    // ==========================================
    function readInitialData(gw) {
        try {
            refreshFreeSpins(gw);
            if (gw.GF && gw.GF.loginModel && gw.GF.loginModel.AppData) {
                let appData = gw.GF.loginModel.AppData;
                if (appData.miniSlot2Data) {
                    todaySpinTimes = appData.miniSlot2Data.todaySpinTimes || 0;
                }
            }
        } catch (e) {
            console.warn('[MiniSlot2Auto] خطأ في قراءة البيانات:', e);
        }
    }

    function refreshFreeSpins(gw) {
        try {
            currentFreeSpins = 0;
            currentTokens = 0;
            
            if (gw.GF && gw.GF.loginModel) {
                if (gw.GF.loginModel.AppData) {
                    currentFreeSpins = gw.GF.loginModel.AppData.free_spins || 0;
                }
                
                // البحث عن معرف العملة الديناميكي من الإعدادات بدلاً من الاعتماد على رقم ثابت
                let activeTokenID = TOKEN_ID;
                try {
                    let cfg = gw.Config.GetData('MiniSlot2') || gw.Config.GetData('minislot2');
                    if (cfg && cfg.item_id) {
                        activeTokenID = Number(cfg.item_id);
                    }
                } catch(e) {}

                // الطريقة الأصلية والمضمونة للعبة
                if (typeof gw.GF.loginModel.get_gifts_num_by_id === 'function') {
                    currentTokens = gw.GF.loginModel.get_gifts_num_by_id(activeTokenID) || 0;
                }
                
                // قراءة احتياطية مباشرة من الذاكرة إذا فشلت الطريقة الأولى
                if (currentTokens === 0 && gw.GF.loginModel.AppData && gw.GF.loginModel.AppData.gifts) {
                    let gifts = gw.GF.loginModel.AppData.gifts;
                    if (gifts && gifts[String(activeTokenID)] !== undefined) {
                        currentTokens = Number(gifts[String(activeTokenID)]);
                    }
                }
            }
        } catch (e) {
            console.error("[MiniSlot2Auto] خطأ في قراءة الرصيد:", e);
        }
        
        // مهم جداً: تحديث الواجهة فوراً بعد قراءة الرقم الجديد
        updateUIData();
    }

    function onMiniSlot2Response(gw, data, requestData) {
        // تحديث من رد السيرفر مباشرة
        if (data.load) {
            todaySpinTimes = data.load.todaySpinTimes || 0;
        }
        if (data.spin) {
            todaySpinTimes = data.spin.todaySpinTimes || todaySpinTimes;
            
            // استخراج وصف الجائزة
            let rewards = data.spin.rewards || [];
            let rewardDesc = rewards.map(r => {
                let name = r.id;
                try {
                    let item = gw.Config.Store_GetItemData(Number(r.id));
                    if (item && item.name) name = item.name;
                } catch(e) {}
                return name + ' x' + r.qty;
            }).join(', ');
            
            // تحديث سجل اللعب الفعلي
            if (isPlaying) {
                completedSpins++; // زيادة العداد فقط عند التأكد من نجاح الدورة من السيرفر
                logMessage('🎁 (' + completedSpins + '/' + targetSpins + ') النتيجة: ' + (rewardDesc || 'لا شيء'), true);
                
                if (completedSpins >= targetSpins) {
                    logMessage('✅ اكتملت الدفعة (' + completedSpins + ') بنجاح!', true);
                    stopAutoSpin();
                }
            }
        }

        // تحديث الذاكرة بعد تأخير قصير جداً لضمان تحديث الـ Bag
        setTimeout(() => {
            refreshFreeSpins(gw);
            updateUIData();
        }, 300);
    }

    // ==========================================
    // 3. تصميم الشريط العلوي الاحترافي
    // ==========================================
    function showTopBarUI() {
        if (topBarUI) {
            updateUIData();
            topBarUI.style.display = 'flex';
            return;
        }

        topBarUI = document.createElement('div');
        topBarUI.id = 'sf-minislot2-topbar';

        topBarUI.innerHTML = `
            <style>
                #sf-minislot2-topbar {
                    position: absolute;
                    top: 43%; /* تم التنزيل قليلاً ليكون فوق الشريط الأسود مباشرة */
                    left: 50%;
                    transform: translate(-50%, -50%);
                    background: rgba(0, 0, 0, 0.85);
                    border: 1px solid #737373;
                    border-radius: 8px;
                    padding: 3px 8px;
                    display: flex;
                    flex-direction: row;
                    align-items: center;
                    justify-content: space-between;
                    color: #fff;
                    font-family: 'Segoe UI', Tahoma, sans-serif;
                    z-index: 9999999;
                    direction: rtl;
                    gap: 8px;
                    width: 220px; /* أصغر جداً */
                    height: 30px; /* أنحف */
                    box-shadow: inset 0 0 10px rgba(0,0,0,0.8), 0 2px 10px rgba(0,0,0,0.5);
                }
                .sf-ms-item {
                    display: flex; align-items: center; gap: 3px;
                }
                .sf-ms-label { font-size: 10px; color: #d4b896; }
                .sf-ms-value { font-size: 12px; font-weight: bold; color: #fbbf24; }
                .sf-ms-input {
                    background: rgba(255,255,255,0.1); border: 1px solid #f59e0b;
                    color: #fff; padding: 1px 3px; border-radius: 3px;
                    width: 30px; text-align: center; font-weight: bold; font-size: 11px;
                }
                .sf-ms-btn-play {
                    background: linear-gradient(180deg, #10b981, #059669);
                    color: white; border: 1px solid #047857; border-radius: 6px;
                    padding: 2px 8px; font-weight: bold; cursor: pointer;
                    font-size: 10px; transition: 0.2s;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.5);
                }
                .sf-ms-btn-play.stop { background: linear-gradient(180deg, #ef4444, #b91c1c); border-color: #991b1b; }
                .sf-ms-btn-play:hover { transform: scale(1.05); }
                .sf-ms-close {
                    background: rgba(239, 68, 68, 0.8); color: white; border: 1px solid #fff;
                    border-radius: 50%; width: 20px; height: 20px; line-height: 18px;
                    font-size: 10px; cursor: pointer; text-align: center;
                    position: absolute; left: -8px; top: -8px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.5);
                }
                #sf-ms-reward-box {
                    position: absolute; bottom: -45px; left: 50%; transform: translateX(-50%);
                    font-size: 13px; color: #a7f3d0; background: rgba(16, 185, 129, 0.85);
                    padding: 5px 15px; border-radius: 8px; white-space: nowrap;
                    display: none; border: 1px solid #10b981; font-weight: bold;
                }
                #sf-ms-log {
                    position: absolute; bottom: -30px; left: 50%; transform: translateX(-50%);
                    font-size: 11px; color: #fca5a5; background: rgba(0,0,0,0.8);
                    padding: 3px 8px; border-radius: 4px; display: none; white-space: nowrap;
                }
                #sf-ms-log.show { display: block; }
            </style>

            <div class="sf-ms-close" id="sf-ms-hide-btn">✖</div>

            <div class="sf-ms-item">
                <span class="sf-ms-label">🎰 رصيد:</span>
                <span class="sf-ms-value" id="sf-ms-free-val">0</span>
            </div>

            <div class="sf-ms-item">
                <span class="sf-ms-label">🔢 ألعب:</span>
                <input type="number" id="sf-ms-count-input" class="sf-ms-input" value="1" min="1" max="999">
            </div>

            <button id="sf-ms-play-btn" class="sf-ms-btn-play">▶️ تشغيل</button>

            <div id="sf-ms-log"></div>
        `;

        document.body.appendChild(topBarUI);

        // ربط الأحداث
        document.getElementById('sf-ms-hide-btn').onclick = () => {
            topBarUI.style.display = 'none';
            isUIHidden = true; // نمنع ظهورها مجدداً حتى يتم إعادة تحميل الصفحة
            stopAutoSpin();
            logMessage('تم إخفاء الواجهة وإيقاف اللعب.', true);
        };

        document.getElementById('sf-ms-play-btn').onclick = () => {
            if (isPlaying) {
                stopAutoSpin();
            } else {
                startAutoSpin();
            }
        };

        updateUIData();
    }

    function updateUIData() {
        if (!topBarUI) return;
        let freeEl = document.getElementById('sf-ms-free-val');
        let progressEl = document.getElementById('sf-ms-progress');

        // عرض رصيد العملات الحقيقي ليتطابق مع اللعبة 100%
        if (freeEl) freeEl.innerText = currentTokens;
        
        if (progressEl && isPlaying) {
            progressEl.innerText = `(${completedSpins}/${targetSpins})`;
        } else if (progressEl) {
            progressEl.innerText = '';
        }
    }

    function logMessage(msg, keep) {
        if (keep === undefined) keep = false;
        console.log('[MiniSlot2Auto] ' + msg);
        let logEl = document.getElementById('sf-ms-log');
        if (logEl) {
            logEl.innerText = msg;
            logEl.classList.add('show');
            if (!keep) {
                setTimeout(() => logEl.classList.remove('show'), 4000);
            }
        }
    }

    // ==========================================
    // 4. محرك اللعب التلقائي (Auto-Spin Engine)
    // ==========================================
    function startAutoSpin() {
        let gw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        refreshFreeSpins(gw);

        let countInput = document.getElementById('sf-ms-count-input');
        targetSpins = parseInt(countInput.value) || 1;

        if (targetSpins <= 0) {
            logMessage('⚠️ أدخل عدد دورات صحيح!');
            return;
        }

        if ((currentFreeSpins + currentTokens) <= 0) {
            logMessage('⚠️ لا يوجد رصيد أو دورات مجانية!');
            return;
        }

        isPlaying = true;
        completedSpins = 0;
        totalRewards = {};
        
        // إخفاء صندوق الجائزة السابق
        let rewardBox = document.getElementById('sf-ms-reward-box');
        if (rewardBox) rewardBox.style.display = 'none';

        let playBtn = document.getElementById('sf-ms-play-btn');
        playBtn.innerText = '⏸️ إيقاف';
        playBtn.classList.add('stop');
        countInput.disabled = true;

        logMessage('▶️ جاري اللعب التلقائي... (0/' + targetSpins + ')', true);
        updateUIData();
        executeSpinCycle();
    }

    function stopAutoSpin() {
        isPlaying = false;
        if (spinTimeout) {
            clearTimeout(spinTimeout);
            spinTimeout = null;
        }
        spinLock = false;

        let playBtn = document.getElementById('sf-ms-play-btn');
        let countInput = document.getElementById('sf-ms-count-input');
        if (playBtn) {
            playBtn.innerText = '▶️ تشغيل';
            playBtn.classList.remove('stop');
        }
        if (countInput) countInput.disabled = false;

        // ملخص النتائج
        if (completedSpins > 0) {
            let summary = '⏸️ انتهى! ' + completedSpins + ' دورة';
            let rewardList = Object.keys(totalRewards);
            if (rewardList.length > 0) {
                let gw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
                let names = rewardList.map(id => {
                    let name = id;
                    try {
                        let item = gw.Config.Store_GetItemData(Number(id));
                        if (item && item.name) name = item.name;
                    } catch(e) { /* fallback to id */ }
                    return name + ' x' + totalRewards[id];
                });
                summary += ' | 🎁 ' + names.join(', ');
            }
            logMessage(summary, true);
        } else {
            logMessage('⏸️ تم الإيقاف.');
        }

        updateUIData();
    }

    async function executeSpinCycle() {
        if (!isPlaying) return;
        if (spinLock) return;

        let inputEl = document.getElementById('sf-ms-count-input');
        let targetSpins = inputEl ? Number(inputEl.value) : 1;
        if (isNaN(targetSpins) || targetSpins <= 0) targetSpins = 99999;

        if (completedSpins >= targetSpins) {
            logMessage('✅ اكتملت جميع الدورات! (' + completedSpins + ')', true);
            stopAutoSpin();
            return;
        }

        let gw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        refreshFreeSpins(gw);

        if ((currentFreeSpins + currentTokens) <= 0) {
            logMessage('⚠️ لا يوجد رصيد أو دورات مجانية!', true);
            stopAutoSpin();
            return;
        }

        spinLock = true;

        try {
            // البحث عن اللوحة والزر
            let popups = gw.LayerManager.UI_Popup.$children || gw.LayerManager.UI_Popup.children || [];
            let slotPanel = null;
            for (let i = 0; i < popups.length; i++) {
                let skin = popups[i].skinName || '';
                if (typeof skin === 'string' && skin.toLowerCase().includes('minislot2')) {
                    slotPanel = popups[i];
                    break;
                }
            }

            if (slotPanel && slotPanel.btnSpin) {
                // التحقق من حالة الزر الطبيعية (لا يمكننا تخطي الأنميشن لأن السيرفر يحظر السرعة العالية)
                let isLocked = (slotPanel.btnSpin.touchEnabled === false) || (slotPanel.btnSpin.enabled === false) || slotPanel.isSpinning;
                
                if (isLocked) {
                    spinLock = false;
                    spinTimeout = setTimeout(executeSpinCycle, 500); // انتظر حتى يفك السيرفر واللعبة القفل طبيعياً
                    return;
                }

                // محاكاة النقر البشري الطبيعي
                slotPanel.btnSpin.dispatchEventWith("touchTap");
                
                // ننتظر 1.5 ثانية. إذا كانت الضغطة حقيقية، سيتم قفل الزر تلقائياً.
                // وإذا كانت مجرد إغلاق لنافذة جائزة، سيبقى مفتوحاً وسنضغط مجدداً بسرعة!
                spinLock = false;
                spinTimeout = setTimeout(executeSpinCycle, 1500);

            } else {
                spinLock = false;
                logMessage('⚠️ تعذر العثور على زر التشغيل الأصلي!', true);
                stopAutoSpin();
            }

        } catch (e) {
            spinLock = false;
            console.error("[MiniSlot2Auto]", e);
            logMessage('⚠️ حدث خطأ غير متوقع.', true);
            stopAutoSpin();
        }
    }

    // ==========================================
    // 5. نظام رصد النوافذ الدقيق (Native Panel Detection)
    // ==========================================
    function setupPanelDetector() {
        let gw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        
        // فحص دوري ذكي لضمان ظهور الشريط فقط عندما تكون اللوحة مفتوحة حقاً
        setInterval(() => {
            if (gw.LayerManager && gw.LayerManager.UI_Popup) {
                let popups = gw.LayerManager.UI_Popup.$children || gw.LayerManager.UI_Popup.children || [];
                let isSlotOpen = false;
                
                for (let i = 0; i < popups.length; i++) {
                    let skin = popups[i].skinName || '';
                    if (typeof skin === 'string' && skin.toLowerCase().includes('minislot2')) {
                        isSlotOpen = true;
                        break;
                    }
                }
                
                if (isSlotOpen) {
                    // إذا اللوحة مفتوحة والشريط مخفي (ولم يقم المستخدم بإغلاقه يدوياً لهذه الجلسة)
                    if (!isUIHidden && (!topBarUI || topBarUI.style.display === 'none')) {
                        refreshFreeSpins(gw);
                        showTopBarUI();
                    }
                } else {
                    // إذا اللوحة مغلقة، نخفي الشريط ونصفر حالة الإخفاء ليظهر في المرة القادمة
                    if (topBarUI && topBarUI.style.display !== 'none') {
                        topBarUI.style.display = 'none';
                        isUIHidden = false; // تصفير حتى يظهر مجدداً عند فتح اللوحة مرة أخرى
                        if (typeof stopAutoSpin === 'function') stopAutoSpin();
                    }
                }
            }
        }, 1000);
        
        console.log('[MiniSlot2Auto] ✅ تم تفعيل رصد النوافذ الداخلي بدقة.');
    }

    // ==========================================
    // 6. التشغيل الأساسي
    // ==========================================
    setupInterceptor();
    setupPanelDetector();

    console.log('[MiniSlot2Auto] ✅ جاهز للعمل. الشريط سيظهر تلقائياً داخل اللوحة فقط.');

})();


// --- File: features/ProductionSchedulerModule.js ---
// --- features\ProductionSchedulerModule.js ---
window.SF = window.SF || {};

SF.ProductionSchedulerModule = class ProductionSchedulerModule extends SF.ModuleBase {
    constructor() {
        super('production_scheduler', 'جدولة الإنتاج', '🏭');
        this.items = [];
        this.schedules = {};
        this.overlays = {};
        this.loopTimer = null;
        this.posTimer = null;
        this.loopSpeed = 2000;
        this._logLines = [];
        this._overlayContainer = null;
    }

    render() {
        return `
        <div class="sf-card">
            <p style="color:var(--sf-text-muted); font-size:12px; text-align:center; margin-bottom:10px;">
                يعرض بطاقات التحكم مباشرة فوق كل آلة وحيوان على الخريطة.
            </p>
            <div style="display:flex; gap:8px; margin-bottom:10px; align-items:center;">
                <button id="sf-ps-scan" class="sf-btn" style="flex:1;">🔍 إظهار على الخريطة</button>
                <button id="sf-ps-hide" class="sf-btn" style="background:#c0392b; flex:0.5;">إخفاء</button>
            </div>
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px; background:rgba(0,0,0,0.3); padding:8px; border-radius:6px;">
                <span style="font-size:12px; color:#aaa;">⏱️ سرعة:</span>
                <select id="sf-ps-speed" style="flex:1; background:#1a1a2e; color:#fff; border:1px solid #333; border-radius:4px; padding:4px;">
                    <option value="500">⚡ فوري (0.5 ث)</option>
                    <option value="1000">🚀 سريع (1 ث)</option>
                    <option value="2000" selected>⏩ متوسط (2 ث)</option>
                    <option value="5000">🐌 عادي (5 ث)</option>
                </select>
            </div>
            <div style="display:flex; gap:8px;">
                <button id="sf-ps-start-all" class="sf-btn" style="flex:1; background:#27ae60;">▶️ تشغيل الكل</button>
                <button id="sf-ps-stop-all" class="sf-btn" style="flex:1; background:#c0392b;">⏹️ إيقاف الكل</button>
            </div>
            <div id="sf-ps-log" style="max-height:100px; overflow-y:auto; margin-top:8px; font-size:10px; color:#666; background:rgba(0,0,0,0.2); padding:4px; border-radius:4px; direction:rtl;"></div>
        </div>`;
    }

    bindEvents() {
        const c = this.container;
        if (!c) return;
        c.querySelector('#sf-ps-scan')?.addEventListener('click', () => this.showOverlays());
        c.querySelector('#sf-ps-hide')?.addEventListener('click', () => this.hideOverlays());
        c.querySelector('#sf-ps-speed')?.addEventListener('change', (e) => {
            this.loopSpeed = parseInt(e.target.value) || 2000;
            if (this.loopTimer) { this._stopLoop(); this._startLoop(); }
        });
        c.querySelector('#sf-ps-start-all')?.addEventListener('click', () => this._startAll());
        c.querySelector('#sf-ps-stop-all')?.addEventListener('click', () => this._stopAll());
    }

    // ═══════════════════════════════════════
    // OVERLAY SYSTEM (In-Game Floating Cards)
    // ═══════════════════════════════════════
    _ensureContainer() {
        if (this._overlayContainer && document.body.contains(this._overlayContainer)) return;
        this._overlayContainer = document.createElement('div');
        this._overlayContainer.id = 'sf-ps-overlay-root';
        this._overlayContainer.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:9000;';
        document.body.appendChild(this._overlayContainer);
    }

    showOverlays() {
        this.hideOverlays();
        this._ensureContainer();
        this._scanItems();

        this.items.forEach(item => {
            const el = this._createOverlayCard(item);
            if (el) {
                this._overlayContainer.appendChild(el);
                this.overlays[item.key] = el;
            }
        });

        this._startPositionUpdater();
        this._log(`📍 ${this.items.length} عنصر على الخريطة`);
    }

    hideOverlays() {
        this._stopPositionUpdater();
        if (this._overlayContainer) {
            this._overlayContainer.innerHTML = '';
        }
        this.overlays = {};
    }

    _scanItems() {
        const gw = unsafeWindow;
        this.items = [];
        try {
            const moList = gw.GameGridData?.uidDictionary
                ? Object.values(gw.GameGridData.uidDictionary) : [];

            moList.forEach(mo => {
                if (!mo?.configData) return;
                const cn = mo.className || mo.configData?.className || '';
                if (cn !== 'Machine' && cn !== 'Animal') return;

                const cd = mo.configData;
                const sd = mo.serverData || {};
                const key = `${cn === 'Machine' ? 'M' : 'A'}_${cd.id}_${sd.x || sd.map_x}_${sd.y || sd.map_y}`;

                const item = {
                    key, type: cn, id: cd.id,
                    name: cd.name_ar || cd.name || `${cn} ${cd.id}`,
                    x: parseInt(sd.x || sd.map_x) || 0,
                    y: parseInt(sd.y || sd.map_y) || 0,
                    mo, products: []
                };

                if (cn === 'Machine' && cd.raw_material && cd.product) {
                    const rawMats = cd.raw_material[0];
                    const prods = cd.product;
                    if (Array.isArray(rawMats) && Array.isArray(prods)) {
                        for (let i = 0; i < Math.min(rawMats.length, prods.length); i++) {
                            let pName = '';
                            try {
                                const pc = gw.Config?.Store_GetItemData(prods[i]);
                                pName = pc ? (pc.name_ar || pc.name) : '';
                            } catch(e) {}
                            item.products.push({
                                index: i, rawMaterialId: rawMats[i],
                                productId: prods[i], name: pName || `منتج #${i + 1}`
                            });
                        }
                    }
                }
                this.items.push(item);
            });
        } catch(e) {}
    }

    _createOverlayCard(item) {
        const div = document.createElement('div');
        div.dataset.key = item.key;
        const color = item.type === 'Machine' ? '#3498db' : '#e67e22';
        const icon = item.type === 'Machine' ? '🏭' : '🐄';

        div.style.cssText = `
            position:absolute; pointer-events:auto; background:rgba(15,15,30,0.92);
            border:2px solid ${color}; border-radius:8px; padding:6px 8px;
            min-width:160px; max-width:220px; font-family:sans-serif; direction:rtl;
            box-shadow: 0 2px 12px rgba(0,0,0,0.6); transform:translate(-50%, -100%);
            transition: opacity 0.2s;
        `;

        let innerHtml = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                <span style="font-size:11px; font-weight:bold; color:${color}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:120px;">${icon} ${item.name}</span>
                <div style="display:flex; gap:3px;">
                    <button class="sf-ps-o-start" data-key="${item.key}" style="background:#27ae60; border:none; color:#fff; width:22px; height:20px; border-radius:3px; cursor:pointer; font-size:10px;">▶</button>
                    <button class="sf-ps-o-stop" data-key="${item.key}" style="background:#c0392b; border:none; color:#fff; width:22px; height:20px; border-radius:3px; cursor:pointer; font-size:10px;">⏹</button>
                </div>
            </div>`;

        if (item.type === 'Machine' && item.products.length > 1) {
            // Product selector + quantity for machines with multiple products
            let opts = item.products.map((p, i) =>
                `<option value="${i}" style="font-size:10px;">${p.name}</option>`
            ).join('');
            innerHtml += `
            <div style="display:flex; gap:4px; align-items:center; margin-bottom:3px;">
                <select class="sf-ps-o-product" data-key="${item.key}" style="flex:1; background:#1a1a2e; color:#fff; border:1px solid #444; border-radius:3px; padding:2px; font-size:10px; max-width:110px;">
                    ${opts}
                </select>
                <span style="color:#888; font-size:9px;">×</span>
                <input type="number" min="0" value="0" class="sf-ps-o-qty" data-key="${item.key}"
                    style="width:35px; background:#1a1a2e; color:#fff; border:1px solid #444; border-radius:3px; padding:2px; text-align:center; font-size:10px;">
                <button class="sf-ps-o-add" data-key="${item.key}" style="background:#8e44ad; border:none; color:#fff; width:20px; height:20px; border-radius:3px; cursor:pointer; font-size:10px;">+</button>
            </div>
            <div class="sf-ps-o-queue" data-key="${item.key}" style="font-size:9px; color:#aaa; max-height:50px; overflow-y:auto;"></div>`;
        } else if (item.type === 'Machine') {
            // Single product machine
            innerHtml += `
            <div style="display:flex; gap:4px; align-items:center; font-size:10px; margin-bottom:3px;">
                <span style="color:#aaa;">العدد:</span>
                <input type="number" min="0" value="0" class="sf-ps-o-qty" data-key="${item.key}" data-pidx="0"
                    style="width:40px; background:#1a1a2e; color:#fff; border:1px solid #444; border-radius:3px; padding:2px; text-align:center; font-size:10px;">
                <span style="color:#666; font-size:9px;">(0=∞)</span>
            </div>`;
        } else {
            // Animal
            innerHtml += `
            <div style="display:flex; gap:4px; align-items:center; font-size:10px; margin-bottom:3px;">
                <span style="color:#aaa;">الدورات:</span>
                <input type="number" min="0" value="0" class="sf-ps-o-cycles" data-key="${item.key}"
                    style="width:40px; background:#1a1a2e; color:#fff; border:1px solid #444; border-radius:3px; padding:2px; text-align:center; font-size:10px;">
                <span style="color:#666; font-size:9px;">(0=∞)</span>
            </div>`;
        }

        innerHtml += `<div class="sf-ps-o-status" data-key="${item.key}" style="font-size:10px; color:#666; margin-top:2px;">● متوقف</div>`;
        div.innerHTML = innerHtml;

        // Bind events
        div.querySelector('.sf-ps-o-start')?.addEventListener('click', () => this._startOne(item.key));
        div.querySelector('.sf-ps-o-stop')?.addEventListener('click', () => this._stopOne(item.key));

        // Queue add button for multi-product machines
        const addBtn = div.querySelector('.sf-ps-o-add');
        if (addBtn) {
            addBtn.addEventListener('click', () => this._addToQueue(item.key));
        }

        return div;
    }

    _addToQueue(key) {
        const item = this.items.find(i => i.key === key);
        if (!item) return;

        const overlay = this.overlays[key];
        if (!overlay) return;

        const selEl = overlay.querySelector(`.sf-ps-o-product[data-key="${key}"]`);
        const qtyEl = overlay.querySelector(`.sf-ps-o-qty[data-key="${key}"]`);
        if (!selEl || !qtyEl) return;

        const pidx = parseInt(selEl.value);
        const qty = parseInt(qtyEl.value) || 0;
        if (qty <= 0) return;

        if (!this.schedules[key]) {
            this.schedules[key] = { queue: [], currentQueueIdx: 0, running: false, completedCycles: 0, targetCycles: 0 };
        }

        const prod = item.products[pidx];
        this.schedules[key].queue.push({
            productIndex: pidx,
            rawMaterialId: prod?.rawMaterialId,
            productId: prod?.productId,
            name: prod?.name || `#${pidx}`,
            target: qty, done: 0
        });

        qtyEl.value = '0';
        this._renderQueue(key);
        this._log(`➕ ${item.name}: ${prod?.name} × ${qty}`);
    }

    _renderQueue(key) {
        const sched = this.schedules[key];
        const overlay = this.overlays[key];
        if (!overlay || !sched) return;

        const queueDiv = overlay.querySelector(`.sf-ps-o-queue[data-key="${key}"]`);
        if (!queueDiv) return;

        if (sched.queue.length === 0) {
            queueDiv.innerHTML = '';
            return;
        }

        let html = sched.queue.map((q, i) => {
            const active = i === sched.currentQueueIdx && sched.running;
            const color = active ? '#2ecc71' : (q.done >= q.target && q.target > 0 ? '#27ae60' : '#888');
            return `<div style="color:${color};">${active ? '▶' : '•'} ${q.name} ${q.done}/${q.target}</div>`;
        }).join('');
        queueDiv.innerHTML = html;
    }

    // ═══════════════════════════════════════
    // POSITION TRACKING
    // ═══════════════════════════════════════
    _startPositionUpdater() {
        this._stopPositionUpdater();
        const update = () => {
            this._updatePositions();
            this.posTimer = requestAnimationFrame(update);
        };
        this.posTimer = requestAnimationFrame(update);
    }

    _stopPositionUpdater() {
        if (this.posTimer) {
            cancelAnimationFrame(this.posTimer);
            this.posTimer = null;
        }
    }

    _updatePositions() {
        const gw = unsafeWindow;
        const canvas = document.querySelector('canvas');
        if (!canvas) return;

        const canvasRect = canvas.getBoundingClientRect();
        let stageW, stageH;
        try {
            const stage = gw.egret?.lifecycle?.stage || gw.egret?.MainContext?.instance?.stage;
            stageW = stage?.stageWidth || canvas.width;
            stageH = stage?.stageHeight || canvas.height;
        } catch(e) {
            stageW = canvas.width;
            stageH = canvas.height;
        }
        const scaleX = canvasRect.width / stageW;
        const scaleY = canvasRect.height / stageH;

        this.items.forEach(item => {
            const el = this.overlays[item.key];
            if (!el) return;

            const pos = this._getScreenPos(item, gw, scaleX, scaleY, canvasRect);
            if (pos) {
                el.style.left = pos.x + 'px';
                el.style.top = pos.y + 'px';
                el.style.display = '';
            } else {
                el.style.display = 'none';
            }
        });
    }

    _getScreenPos(item, gw, scaleX, scaleY, canvasRect) {
        try {
            const mo = this._getFreshMO(item);
            if (!mo) return null;

            // Try Egret localToGlobal on the display object
            const view = mo.view || mo._view || mo.display || mo.sprite;
            if (view && typeof view.localToGlobal === 'function') {
                const p = view.localToGlobal(0, 0);
                return {
                    x: canvasRect.left + p.x * scaleX,
                    y: canvasRect.top + p.y * scaleY - 20
                };
            }

            // Fallback: traverse parent chain
            if (view && typeof view.x === 'number') {
                let x = view.x, y = view.y;
                let parent = view.parent;
                while (parent) {
                    x = x * (parent.scaleX || 1) + parent.x;
                    y = y * (parent.scaleY || 1) + parent.y;
                    parent = parent.parent;
                }
                return {
                    x: canvasRect.left + x * scaleX,
                    y: canvasRect.top + y * scaleY - 20
                };
            }
        } catch(e) {}
        return null;
    }

    // ═══════════════════════════════════════
    // SCHEDULE MANAGEMENT
    // ═══════════════════════════════════════
    _startOne(key) {
        const item = this.items.find(i => i.key === key);
        if (!item) return;

        if (!this.schedules[key]) {
            this.schedules[key] = { queue: [], currentQueueIdx: 0, running: false, completedCycles: 0, targetCycles: 0 };
        }
        const sched = this.schedules[key];

        if (item.type === 'Machine') {
            // Read from queue (already added via + button) or read single qty
            if (sched.queue.length === 0) {
                const overlay = this.overlays[key];
                const qtyEl = overlay?.querySelector(`.sf-ps-o-qty[data-key="${key}"]`);
                const qty = parseInt(qtyEl?.value) || 0;
                const selEl = overlay?.querySelector(`.sf-ps-o-product[data-key="${key}"]`);
                const pidx = parseInt(selEl?.value) || 0;

                if (qty > 0 && item.products[pidx]) {
                    const p = item.products[pidx];
                    sched.queue = [{ productIndex: pidx, rawMaterialId: p.rawMaterialId, productId: p.productId, name: p.name, target: qty, done: 0 }];
                } else {
                    // Run current product infinitely
                    sched.queue = [{ productIndex: -1, name: 'المنتج الحالي', target: 0, done: 0 }];
                }
            }
            sched.currentQueueIdx = sched.queue.findIndex(q => q.done < q.target || q.target === 0);
            if (sched.currentQueueIdx < 0) sched.currentQueueIdx = 0;
        } else {
            // Animal
            const overlay = this.overlays[key];
            const cycEl = overlay?.querySelector(`.sf-ps-o-cycles[data-key="${key}"]`);
            sched.targetCycles = parseInt(cycEl?.value) || 0;
            sched.completedCycles = 0;
        }

        sched.running = true;
        this._updateOverlayStatus(key);
        this._renderQueue(key);
        this._log(`✅ بدأ: ${item.name}`);
        this._startLoop();
    }

    _stopOne(key) {
        if (this.schedules[key]) {
            this.schedules[key].running = false;
            this._updateOverlayStatus(key);
            this._renderQueue(key);
        }
        if (!Object.values(this.schedules).some(s => s.running)) this._stopLoop();
    }

    _startAll() { this.items.forEach(item => this._startOne(item.key)); }
    _stopAll() { Object.keys(this.schedules).forEach(k => this._stopOne(k)); this._stopLoop(); }

    _updateOverlayStatus(key) {
        const sched = this.schedules[key];
        const item = this.items.find(i => i.key === key);

        // Update overlay status
        const overlay = this.overlays[key];
        if (!overlay) return;
        const statusEl = overlay.querySelector(`.sf-ps-o-status[data-key="${key}"]`);
        if (!statusEl) return;

        if (!sched?.running) {
            statusEl.style.color = '#666';
            statusEl.textContent = '● متوقف';
            return;
        }

        statusEl.style.color = '#2ecc71';
        if (item?.type === 'Machine') {
            const cur = sched.queue[sched.currentQueueIdx];
            if (!cur) { statusEl.textContent = '✅ اكتمل!'; return; }
            if (cur.target === 0) statusEl.textContent = `🔄 ${cur.name} — ${cur.done}`;
            else statusEl.textContent = `🔄 ${cur.name} ${cur.done}/${cur.target}`;
        } else {
            const t = sched.targetCycles === 0 ? '∞' : sched.targetCycles;
            statusEl.textContent = `🔄 ${sched.completedCycles}/${t}`;
        }

        // Also update the panel status
        const panelEl = this.container?.querySelector(`.sf-ps-status[data-key="${key}"]`);
        if (panelEl) panelEl.textContent = statusEl.textContent;
    }

    // ═══════════════════════════════════════
    // MAIN LOOP
    // ═══════════════════════════════════════
    _startLoop() {
        if (this.loopTimer) return;
        this.loopTimer = setInterval(() => this._checkAll(), this.loopSpeed);
    }

    _stopLoop() {
        if (this.loopTimer) { clearInterval(this.loopTimer); this.loopTimer = null; }
    }

    _checkAll() {
        const keys = Object.keys(this.schedules).filter(k => this.schedules[k].running);
        if (keys.length === 0) { this._stopLoop(); return; }
        keys.forEach(key => {
            try { this._processItem(key); } catch(e) { this._log(`❌ ${key}: ${e.message}`); }
        });
    }

    _processItem(key) {
        const sched = this.schedules[key];
        const item = this.items.find(i => i.key === key);
        if (!item || !sched?.running) return;

        const mo = this._getFreshMO(item);
        if (!mo) return;
        const sd = mo.serverData || {};

        if (item.type === 'Machine') this._processMachine(key, item, mo, sd, sched);
        else this._processAnimal(key, item, mo, sd, sched);
    }

    _processMachine(key, item, mo, sd, sched) {
        const gw = unsafeWindow;
        const gc = gw.GF?.gameController;

        const hasProducts = sd.products && (
            (Array.isArray(sd.products) && sd.products.length > 0) ||
            (typeof sd.products === 'number' && sd.products > 0));

        if (hasProducts) {
            try { if (gc?._collectMapObject) gc._collectMapObject(mo); } catch(e) {}
            const cur = sched.queue[sched.currentQueueIdx];
            if (cur) {
                cur.done++;
                this._log(`📦 ${item.name}: ${cur.name} ${cur.done}/${cur.target || '∞'}`);
                if (cur.target > 0 && cur.done >= cur.target) {
                    sched.currentQueueIdx++;
                    if (sched.currentQueueIdx >= sched.queue.length) {
                        sched.running = false;
                        this._log(`🎉 ${item.name}: اكتمل!`);
                    }
                }
            }
            this._updateOverlayStatus(key);
            this._renderQueue(key);
            return;
        }

        const rawMats = sd.raw_materials;
        const isIdle = !rawMats || (Array.isArray(rawMats) && rawMats.every(r => !r || (Array.isArray(r) && r.length === 0)));

        if (isIdle) {
            const cur = sched.queue[sched.currentQueueIdx];
            if (cur && cur.productIndex >= 0) {
                const curSel = parseInt(sd.selected_raw_material) || 0;
                if (curSel !== cur.productIndex && curSel !== cur.productIndex + 1) {
                    this._log(`🔄 تبديل: ${item.name} → ${cur.name}`);
                    try { gw.NetUtils.enqueue('save_selected_material.save_data', { id: item.id, x: item.x, y: item.y, flip: 0, material: cur.productIndex }); } catch(e) {}
                    return;
                }
            }
            try {
                if (gc?._refillMapObject) gc._refillMapObject(mo);
                else if (gc?.refillMapObject) gc.refillMapObject(mo);
                else if (gc?._feedMapObject) gc._feedMapObject(mo);
            } catch(e) {}
            this._updateOverlayStatus(key);
        }
    }

    _processAnimal(key, item, mo, sd, sched) {
        const gc = unsafeWindow.GF?.gameController;

        if (sched.targetCycles > 0 && sched.completedCycles >= sched.targetCycles) {
            sched.running = false;
            this._log(`🎉 ${item.name}: ${sched.completedCycles} دورة`);
            this._updateOverlayStatus(key);
            return;
        }

        const hasProducts = (typeof sd.products === 'number' && sd.products > 0) ||
                           (Array.isArray(sd.products) && sd.products.length > 0);
        if (hasProducts) {
            try { if (gc?._collectMapObject) gc._collectMapObject(mo); } catch(e) {}
            sched.completedCycles++;
            this._log(`📦 ${item.name}: دورة ${sched.completedCycles}`);
            this._updateOverlayStatus(key);
            return;
        }

        const needsFeed = sd.raw_materials === 0 || sd.raw_materials === '0' || sd.raw_materials === false;
        if (needsFeed) {
            try {
                if (gc?._feedMapObject) gc._feedMapObject(mo);
                else if (gc?.feedMapObject) gc.feedMapObject(mo);
            } catch(e) {}
        }
    }

    // ═══════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════
    _getFreshMO(item) {
        try {
            const moList = unsafeWindow.GameGridData?.uidDictionary
                ? Object.values(unsafeWindow.GameGridData.uidDictionary) : [];
            return moList.find(mo => {
                if (!mo?.configData) return false;
                const sd = mo.serverData || {};
                return mo.configData.id === item.id &&
                    (parseInt(sd.x || sd.map_x) || 0) === item.x &&
                    (parseInt(sd.y || sd.map_y) || 0) === item.y;
            }) || null;
        } catch(e) { return null; }
    }

    _log(msg) {
        const ts = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        this._logLines.unshift(`[${ts}] ${msg}`);
        if (this._logLines.length > 50) this._logLines.length = 50;
        const el = this.container?.querySelector('#sf-ps-log');
        if (el) el.innerHTML = this._logLines.join('<br>');
    }
};

SF.modules.register(new SF.ProductionSchedulerModule());


// --- System Initialization ---
(function() {
    'use strict';
    console.log('[SupremeFarm Modular] Initializing System V2.0 (Cloud Bundle)...');
    const initApp = () => {
        if(!window.SF) window.SF = {};
        if(!window.SF.SplashScreen) {
            window.SF.ui = new window.SF.UIManager();
            return;
        }
        const splash = new window.SF.SplashScreen();
        splash.show(() => {
            window.SF.ui = new window.SF.UIManager();
        });
    };

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        initApp();
    } else {
        window.addEventListener('DOMContentLoaded', initApp);
    }
})();
