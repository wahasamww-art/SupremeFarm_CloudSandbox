// SupremeFarm Pro - cloud_bundle.js
// This file is fetched and executed by the Supreme Loader userscript.
// Do NOT install this file directly in Tampermonkey.
// Repo: https://github.com/wahasamww-art/SupremeFarm_CloudSandbox

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
            const urlStr = (this._sf_url || '').toString().toLowerCase();

            // Aggressive tracking/telemetry block at the network level
            if (urlStr.match(/\b(log|track|analytic|report|metrics|adjust\.com|appsflyer|sentry|datadog|telemetry|pixel|bugsnag)\b/) && 
                !urlStr.includes('login') && !urlStr.includes('dialog')) {
                // If it's gateway.php, maybe it has a tracking parameter? 
                // But don't block gateway.php entirely!
                if (!urlStr.includes('gateway.php')) {
                    console.log(`[SupremeFarm Modular] 🛑 XHR BLOCKED TELEMETRY: ${this._sf_url}`);
                    // Trigger error to abort silently without sending to network
                    if (this.onerror) this.onerror(new ProgressEvent('error'));
                    return;
                }
            }

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

            // GEMINI.md Protocol: Convert to Blob with application/x-amf to fix 0-byte bug and prevent CORS tracking issues
            if (isGame && body && body instanceof Uint8Array) {
                arguments[0] = new Blob([body.buffer], {type: "application/x-amf"});
            }

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
            const urlStr = (url || '').toString().toLowerCase();

            if (urlStr.match(/\b(log|track|analytic|report|metrics|adjust\.com|appsflyer|sentry|datadog|telemetry|pixel|bugsnag)\b/) && 
                !urlStr.includes('login') && !urlStr.includes('dialog')) {
                if (!urlStr.includes('gateway.php')) {
                    console.log(`[SupremeFarm Modular] 🛑 Fetch BLOCKED TELEMETRY: ${url}`);
                    return Promise.reject(new TypeError('Failed to fetch'));
                }
            }

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
        const YIELD_INTERVAL = 500; // yield every 500 matches to keep UI alive
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
        const BATCH_SIZE = 200;
        const BATCH_DELAY_MS = 0;

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

SF.ZeroGasModule = class ZeroGasModule {
    constructor() {
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
                            
                            // Layer 1.5: Aggressively block ALL tracking, error reporting, and telemetry!
                            const actLow = (action || '').toLowerCase();
                            if (actLow.match(/\b(log|track|analytic|report|metrics|adjust\.com|appsflyer|sentry|datadog|telemetry|pixel|bugsnag|error|debug|monitor|detect|cheat|ban|suspicious)\b/) && 
                                !actLow.includes('login') && !actLow.includes('dialog')) {
                                console.log(`[SF-ZeroGas] 🛑 BLOCKED TELEMETRY: ${action}`);
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

// Initialize ZeroGas in background
new SF.ZeroGasModule();


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
        this.schedules = (window.SF && window.SF.StorageManager) ? window.SF.StorageManager.get('sf-production-schedules', {}) : {};
        this.favorites = (window.SF && window.SF.StorageManager) ? window.SF.StorageManager.get('sf-ps-favorites', {}) : {};
        this.badges = {};
        this.loopTimer = null;
        this.posTimer = null;
        this.loopSpeed = 3000;
        this._logLines = [];
        this._badgeContainer = null;
        this._autoInitTimer = null;
        this._autoInitAttempts = 0;
        this._waitingProductChange = {};
        this.activeMachineKey = null;
        this.activeFilter = 'all';
        this._missingCounter = {}; // عداد غياب لكل item ← حماية Race Condition
        this.pinnedBadges = (window.SF && window.SF.StorageManager) ? window.SF.StorageManager.get('sf-ps-pinned', {}) : {};
        this._mouseX = -1;
        this._mouseY = -1;
    }

    _normalizeArabic(text) {
        if (!text) return '';
        return text.replace(/[أإآ]/g, 'ا')
                   .replace(/ة/g, 'ه')
                   .replace(/ى/g, 'ي')
                   .replace(/[\u064B-\u065F]/g, '');
    }

    _log(msg) {
        console.log(`[Scheduler] ${msg}`);
    }

    _saveSchedules() {
        if (!window.SF || !window.SF.StorageManager) return;
        window.SF.StorageManager.set('sf-production-schedules', this.schedules);
        window.SF.StorageManager.set('sf-ps-favorites', this.favorites);
        window.SF.StorageManager.set('sf-ps-pinned', this.pinnedBadges);
    }

    render() {
        return `
        <div class="sf-card" style="padding: 20px; display:flex; flex-direction:column; height: 100%; box-sizing: border-box;">
            <div style="display:flex; gap:10px; margin-bottom:10px;">
                <button id="sf-ps-tab-machines" class="sf-btn" style="flex:1;background:#3498db;font-size:16px;padding:12px;border-radius:8px;font-weight:bold;box-shadow:0 0 10px rgba(52,152,219,0.5);color:#fff;">⚙ الآلات</button>
                <button id="sf-ps-tab-animals" class="sf-btn" style="flex:1;background:#333;font-size:16px;padding:12px;border-radius:8px;font-weight:bold;color:#bbb;">🐄 الحيوانات</button>
            </div>
            
            <div style="display:flex; gap:5px; margin-bottom:10px; background:#1a1a2e; padding:5px; border-radius:6px; border:1px solid #333;">
                <button class="sf-ps-filter-btn sf-btn" data-filter="all" style="flex:1;background:#8e44ad;font-size:13px;padding:8px;border-radius:4px;color:#fff;font-weight:bold;">الكل</button>
                <button class="sf-ps-filter-btn sf-btn" data-filter="running" style="flex:1;background:transparent;font-size:13px;padding:8px;border-radius:4px;color:#aaa;font-weight:bold;">🟢 تعمل حالياً</button>
                <button class="sf-ps-filter-btn sf-btn" data-filter="idle" style="flex:1;background:transparent;font-size:13px;padding:8px;border-radius:4px;color:#aaa;font-weight:bold;">⚪ متوقفة</button>
            </div>

            <div id="sf-ps-view-machines" style="flex:1; display:flex; flex-direction:column;">
                <div id="sf-ps-machine-header-wrap">
                    <input id="sf-ps-search-machine" type="text" placeholder="🔍 ابحث عن آلة..." style="width:100%;background:#1a1a2e;color:#fff;border:1px solid #444;border-radius:6px;padding:12px;font-size:14px;margin-bottom:12px;box-sizing:border-box;">
                </div>
                <div id="sf-ps-machines-list" style="flex:1; overflow-y:auto; padding-right:5px; min-height:350px;"></div>
            </div>

            <div id="sf-ps-view-animals" style="flex:1; display:none; flex-direction:column;">
                <input id="sf-ps-search-animal" type="text" placeholder="🔍 ابحث عن حيوان..." style="width:100%;background:#1a1a2e;color:#fff;border:1px solid #444;border-radius:6px;padding:12px;font-size:14px;margin-bottom:12px;box-sizing:border-box;">
                <div id="sf-ps-animals-list" style="flex:1; overflow-y:auto; padding-right:5px; min-height:350px;"></div>
            </div>

            <div style="display:flex;gap:10px;margin-top:20px;">
                <button id="sf-ps-start-all" class="sf-btn" style="flex:1;background:#27ae60;font-size:15px;padding:12px;border-radius:8px;font-weight:bold;color:#fff;">▶ تشغيل الكل</button>
                <button id="sf-ps-stop-all" class="sf-btn" style="flex:1;background:#c0392b;font-size:15px;padding:12px;border-radius:8px;font-weight:bold;color:#fff;">⏹ إيقاف الكل</button>
            </div>
        </div>`;
    }

    bindEvents() {
        const c = this.container;
        if (!c) return;
        c.querySelector('#sf-ps-start-all')?.addEventListener('click', () => this._startAll());
        c.querySelector('#sf-ps-stop-all')?.addEventListener('click', () => this._stopAll());
        
        c.querySelector('#sf-ps-tab-machines')?.addEventListener('click', (e) => {
            e.target.style.background = '#3498db'; e.target.style.color = '#fff'; e.target.style.boxShadow = '0 0 10px rgba(52,152,219,0.5)';
            const animTab = c.querySelector('#sf-ps-tab-animals');
            animTab.style.background = '#333'; animTab.style.color = '#bbb'; animTab.style.boxShadow = 'none';
            
            c.querySelector('#sf-ps-view-machines').style.display = 'flex';
            c.querySelector('#sf-ps-view-animals').style.display = 'none';
        });
        
        c.querySelector('#sf-ps-tab-animals')?.addEventListener('click', (e) => {
            e.target.style.background = '#3498db'; e.target.style.color = '#fff'; e.target.style.boxShadow = '0 0 10px rgba(52,152,219,0.5)';
            const machTab = c.querySelector('#sf-ps-tab-machines');
            machTab.style.background = '#333'; machTab.style.color = '#bbb'; machTab.style.boxShadow = 'none';
            
            c.querySelector('#sf-ps-view-machines').style.display = 'none';
            c.querySelector('#sf-ps-view-animals').style.display = 'flex';
        });

        c.querySelector('#sf-ps-search-animal')?.addEventListener('input', (e) => this._filterList('animal', e.target.value));
        c.querySelector('#sf-ps-search-machine')?.addEventListener('input', (e) => this._filterList('machine', e.target.value));
        
        c.querySelectorAll('.sf-ps-filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                c.querySelectorAll('.sf-ps-filter-btn').forEach(b => {
                    b.style.background = 'transparent';
                    b.style.color = '#aaa';
                });
                e.target.style.background = '#8e44ad';
                e.target.style.color = '#fff';
                this.activeFilter = e.target.dataset.filter;
                this._renderMachines();
                this._renderAnimals();
            });
        });
        
        c.addEventListener('click', (e) => {
            const tgt = e.target;
            if (tgt.classList.contains('sf-ps-start-btn')) { this._startOne(tgt.dataset.key); if (this.activeMachineKey === tgt.dataset.key) this._renderMachines(); }
            else if (tgt.classList.contains('sf-ps-stop-btn')) { this._stopOne(tgt.dataset.key); if (this.activeMachineKey === tgt.dataset.key) this._renderMachines(); }
            else if (tgt.classList.contains('sf-ps-rmq')) { this._removeFromQueue(tgt.dataset.key, parseInt(tgt.dataset.idx)); if (this.activeMachineKey === tgt.dataset.key) this._renderMachines(); }
            else if (tgt.classList.contains('sf-ps-move-btn')) { this._moveQueueItem(tgt.dataset.key, parseInt(tgt.dataset.idx), parseInt(tgt.dataset.dir)); }
            else if (tgt.classList.contains('sf-ps-animal-smart-btn')) {
                const parent = tgt.closest('.sf-ps-item-animal');
                const qtyInput = parent.querySelector('.sf-ps-cycles');
                this._startAnimalSmart(tgt.dataset.key, parseInt(qtyInput.value) || 0);
            }
            else if (tgt.classList.contains('sf-ps-manage-btn')) { this.activeMachineKey = tgt.dataset.key; this._renderMachines(); }
            else if (tgt.classList.contains('sf-ps-back-btn')) { this.activeMachineKey = null; this._renderMachines(); }
            else if (tgt.classList.contains('sf-ps-add-prod-btn')) {
                const idx = parseInt(tgt.dataset.idx);
                const parent = tgt.closest('.sf-ps-prod-item');
                const qtyInput = parent.querySelector('.sf-ps-prod-qty');
                this._addToQueue(tgt.dataset.key, idx, parseInt(qtyInput.value) || 0);
            }
            else if (tgt.classList.contains('sf-ps-add-chain-btn')) {
                const idx = parseInt(tgt.dataset.idx);
                const parent = tgt.closest('.sf-ps-prod-item');
                const qtyInput = parent.querySelector('.sf-ps-prod-qty');
                const overrides = {};
                parent.querySelectorAll('.sf-ps-source-select').forEach(sel => {
                    const rmId = sel.dataset.rmId;
                    const key = sel.value;
                    if (key) { overrides[rmId] = key; }
                });
                this._addChainToQueue(tgt.dataset.key, idx, parseInt(qtyInput.value) || 0, overrides);
            }
            else if (tgt.classList.contains('sf-ps-fav-btn')) {
                this._toggleFavorite(tgt.dataset.key);
            }
            else if (tgt.classList.contains('sf-ps-nav-btn')) {
                const item = this.items.find(i => i.key === tgt.dataset.key);
                if (item) this._navigateToItem(item);
            }
            else if (tgt.classList.contains('sf-ps-nav-source-btn')) {
                const key = tgt.dataset.key;
                const id = tgt.dataset.id;
                if (key && key !== 'undefined') {
                    const item = this.items.find(i => i.key === key);
                    if (item) this._navigateToItem(item);
                } else if (id && id !== 'undefined') {
                    this._navigateToItem({ id: parseInt(id), name: tgt.innerText });
                }
            }
        });

        document.addEventListener('mousemove', (e) => {
            this._mouseX = e.clientX;
            this._mouseY = e.clientY;
        });

        document.addEventListener('click', (e) => {
            if (e.target.closest('#sf-ps-view-machines') || e.target.closest('#sf-ps-view-animals')) return;
            
            let clickedBadgeKey = null;
            Object.keys(this.badges).forEach(key => {
                const badge = this.badges[key];
                if (!badge || badge.style.display === 'none') return;
                const rect = badge.getBoundingClientRect();
                const dist = Math.hypot((rect.left + rect.width/2) - e.clientX, (rect.top + rect.height/2) - e.clientY);
                if (dist < 40) {
                    clickedBadgeKey = key;
                }
            });

            if (clickedBadgeKey) {
                if (this.pinnedBadges[clickedBadgeKey]) {
                    delete this.pinnedBadges[clickedBadgeKey];
                    this._log(`📍 تم إلغاء تثبيت المؤشر`);
                } else {
                    this.pinnedBadges[clickedBadgeKey] = true;
                    this._log(`📌 تم تثبيت المؤشر`);
                }
                this._saveSchedules();
            }
        });

        this._scheduleAutoInit();
    }

    onDeactivate() {
        this._stopLoop();
        if (this._autoInitTimer) { clearInterval(this._autoInitTimer); this._autoInitTimer = null; }
        if (this._syncTimer) { clearInterval(this._syncTimer); this._syncTimer = null; }
        if (this.posTimer) { clearInterval(this.posTimer); this.posTimer = null; }
        if (this._badgeContainer) { this._badgeContainer.remove(); this._badgeContainer = null; }
    }

    _scheduleAutoInit() {
        this._autoInitAttempts = 0;
        this._autoInitTimer = setInterval(() => {
            this._autoInitAttempts++;
            const dict = unsafeWindow.GameGridData?.uidDictionary;
            if (dict && Object.keys(dict).length > 0) {
                clearInterval(this._autoInitTimer);
                this._autoInitTimer = null;
                this._autoInit();
            } else if (this._autoInitAttempts >= 20) {
                clearInterval(this._autoInitTimer);
                this._autoInitTimer = null;
            }
        }, 3000);
    }

    _autoInit() {
        this._syncItems();
        this._ensureBadgeContainer();
        this._startPositionUpdater();
        
        if (!this._syncTimer) this._syncTimer = setInterval(() => this._syncItems(), 3000);

        const runningKeys = Object.keys(this.schedules).filter(k => this.schedules[k].running);
        if (runningKeys.length > 0) {
            this._log(`🔄 استئناف ${runningKeys.length} مهام مجدولة سابقة`);
            runningKeys.forEach(k => this._updateBadge(k));
            this._startLoop();
        }

        this._log(`📍 ${this.items.length} عنصر (${this.items.filter(i=>i.type==='Machine').length} آلة, ${this.items.filter(i=>i.type==='Animal').length} حيوان)`);
    }

    _syncItems() {
        const gw = unsafeWindow;
        const dict = gw.GameGridData?.uidDictionary;
        if (!dict) return;

        const currentScene = gw.GF?.loginModel?.AppData?.scene_select || 1;
        if (this._lastScene !== currentScene) {
            this.items = [];
            Object.values(this.badges).forEach(b => b.remove());
            this.badges = {};
            this._lastScene = currentScene;
        }

        let changed = false;
        const currentUids = new Set(Object.keys(dict));

        for (let i = this.items.length - 1; i >= 0; i--) {
            const item = this.items[i];
            if (!item.mo || !currentUids.has(String(item.mo.map_unique_id))) {
                if (this.badges[item.key]) { this.badges[item.key].remove(); delete this.badges[item.key]; }
                this.items.splice(i, 1);
                changed = true;
            }
        }
        this._missingCounter = {};

        Object.values(dict).forEach(mo => {
            if (!mo) return;
            const cn = mo.__class__ || '';
            const cd = mo.configData || {};
            const isMachine = cn === 'Machine' && cd.raw_material && cd.product;
            const isAnimal = cn === 'Animal' || (cd.type === 'animals' && cd.sub_type === 'working');
            if (!isMachine && !isAnimal) return;

            const sd = mo.serverData || {};
            const objType = isMachine ? 'Machine' : 'Animal';
            const x = parseInt(sd.x || sd.map_x) || 0;
            const y = parseInt(sd.y || sd.map_y) || 0;
            const newKey = `${objType[0]}_${currentScene}_${cd.id || mo.id}_${x}_${y}`;

            let reqMatsIds = [];
            let reqMats = [];
            let isMachineParsed = isMachine && cd.raw_material && cd.product;

            if (isAnimal && cd.raw_material) {
                let rm = cd.raw_material;
                if (typeof rm === 'string') { try { rm = JSON.parse(rm); } catch(e) { rm = rm.split(','); } }
                if (!Array.isArray(rm)) rm = rm ? [rm] : [];
                reqMatsIds = rm.map(x => parseInt(x) || x);
                
                reqMats = reqMatsIds.map(id => {
                    let mName = '';
                    try {
                        const c = gw.Config?.Store_GetItemData(id);
                        mName = c ? (c.name_ar || c.name) : '';
                    } catch(e) {}
                    return { id: id, name: mName || `مادة ${id}` };
                });
            }

            let item = this.items.find(i => i.mo && i.mo.map_unique_id === mo.map_unique_id);
            if (item) {
                if (item.x !== x || item.y !== y) {
                    const oldKey = item.key;
                    item.x = x; item.y = y; item.key = newKey;
                    
                    if (this.schedules[oldKey]) {
                        this.schedules[newKey] = this.schedules[oldKey];
                        delete this.schedules[oldKey];
                    }
                    if (this.badges[oldKey]) {
                        this.badges[newKey] = this.badges[oldKey];
                        delete this.badges[oldKey];
                    }
                    // REMOVED: changed = true; (This caused the massive lag every 3s when animals moved)
                }
            } else {
                item = {
                    key: newKey, type: objType,
                    id: cd.id || mo.id,
                    name: cd.name_ar || cd.name || `${objType} ${cd.id || mo.id}`,
                    x, y, mo, uid: mo.map_unique_id, products: [],
                    reqMats: reqMats,
                    rawMaterialId: reqMatsIds[0] || null,
                    productId: isAnimal ? (Array.isArray(cd.product) ? cd.product[0] : cd.product) : null
                };

                if (isMachineParsed) {
                    let rawMats = cd.raw_material;
                    if (typeof rawMats === 'string') { try { rawMats = JSON.parse(rawMats); } catch(e) { rawMats = rawMats.split(','); } }
                    if (!Array.isArray(rawMats)) rawMats = [rawMats];
                    
                    let dynamicMats = Array.isArray(rawMats[0]) ? rawMats[0] : rawMats;
                    let fixedMats = Array.isArray(rawMats[0]) ? rawMats.slice(1) : [];

                    let prods = cd.product;
                    if (typeof prods === 'string') { try { prods = JSON.parse(prods); } catch(e) { prods = prods.split(','); } }
                    if (!Array.isArray(prods)) prods = [prods];

                    for (let i = 0; i < Math.min(dynamicMats.length, prods.length); i++) {
                        let pName = '';
                        try {
                            const pc = gw.Config?.Store_GetItemData(prods[i]);
                            pName = pc ? (pc.name_ar || pc.name) : '';
                        } catch(e) {}
                        
                        let pReqIds = [];
                        if (dynamicMats[i] !== undefined) pReqIds.push(parseInt(dynamicMats[i]) || dynamicMats[i]);
                        fixedMats.forEach(m => pReqIds.push(parseInt(m) || m));
                        
                        let pReqMats = pReqIds.map(id => {
                            let mName = '';
                            try {
                                const c = gw.Config?.Store_GetItemData(id);
                                mName = c ? (c.name_ar || c.name) : '';
                            } catch(e) {}
                            return { id: id, name: mName || `مادة ${id}` };
                        });

                        item.products.push({ 
                            index: i, 
                            rawMaterialId: pReqIds[0], 
                            reqMats: pReqMats,
                            productId: parseInt(prods[i]) || prods[i], 
                            name: pName || `منتج #${i+1}` 
                        });
                    }
                }
                this.items.push(item);
                changed = true;
            }
        });

        if (changed) {
            this._renderAnimals();
            this._renderMachines();
            this._saveSchedules();
        }

        if (Object.values(this.schedules).some(s => s.running)) {
            this._startLoop();
        }
    }

    _renderAnimals() {
        if (this._animRenderTimer) clearTimeout(this._animRenderTimer);
        this._animRenderTimer = setTimeout(() => this._doRenderAnimals(), 150);
    }
    _doRenderAnimals() {
        const container = this.container?.querySelector('#sf-ps-animals-list');
        if (!container) return;
        const animals = this.items.filter(i => i.type === 'Animal');
        if (animals.length === 0) { container.innerHTML = '<div style="color:#777;font-size:13px;text-align:center;padding:10px;">لا يوجد حيوانات على الأرض</div>'; return; }

        const renderAnimal = (item) => {
            const sched = this.schedules[item.key];
            const running = sched?.running;
            const cycles = sched?.targetCycles || 0;
            const done = sched?.completedCycles || 0;
            const isFav = !!this.favorites[item.key];
            const reqHtml = (item.reqMats || []).map(rm => {
                const count = this._getInventoryCount(rm.id);
                const color = count > 0 ? '#2ecc71' : '#e74c3c';
                const matIcon = this._getItemIconUrl(rm.id, '🌱', 18);
                return `<span style="background:rgba(0,0,0,0.3);padding:2px 4px;border-radius:3px;margin-left:4px;display:inline-flex;align-items:center;gap:4px;">${matIcon} ${rm.name}: <strong style="color:${color};">${count}</strong></span>`;
            }).join('');
            
            const prodCount = item.productId ? this._getInventoryCount(item.productId) : 0;
            return `<div class="sf-ps-item sf-ps-item-animal" data-key="${item.key}" data-name="${item.name}" style="background:rgba(230,126,34,0.1);border:1px solid ${isFav ? '#f39c12' : '#e67e2244'};border-radius:8px;padding:8px 12px;margin-bottom:6px;box-shadow:0 2px 4px rgba(0,0,0,0.2);">
                <div style="display:flex;align-items:center;justify-content:space-between;">
                    <div style="display:flex;align-items:center;gap:16px;">
                        <div style="background:rgba(0,0,0,0.3);border-radius:16px;padding:6px;display:flex;align-items:center;justify-content:center;box-shadow:inset 0 0 10px rgba(0,0,0,0.5), 0 2px 4px rgba(0,0,0,0.3);min-width:110px;min-height:110px;">
                            ${this._getItemIconUrl(item.id, '🐄', 96)}
                        </div>
                        <div style="display:flex;flex-direction:column;gap:4px;">
                            <span style="color:#e67e22;font-size:16px;font-weight:bold;display:flex;align-items:center;gap:6px;">
                                <span>${item.name}</span>${isFav ? ' <span style="color:#f39c12;font-size:12px;">⭐</span>' : ''}
                            </span>
                            ${(reqHtml || prodCount > 0) ? `
                            <div style="font-size:11px;color:#bbb;display:flex;flex-wrap:wrap;gap:8px;line-height:1.4;margin-top:6px;align-items:center;">
                                ${reqHtml}
                                ${item.productId ? `<span style="background:rgba(243,156,18,0.2);padding:4px 8px;border-radius:4px;color:#f39c12;border:1px solid rgba(243,156,18,0.4);font-size:14px;font-weight:bold;box-shadow:0 1px 3px rgba(0,0,0,0.2);">المخزون: <strong style="font-size:16px;">${prodCount}</strong></span>` : ''}
                            </div>
                            ` : ''}
                        </div>
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;">
                        <button class="sf-ps-fav-btn" data-key="${item.key}" style="background:${isFav ? 'rgba(243,156,18,0.3)' : 'rgba(255,255,255,0.05)'};border:1px solid ${isFav ? '#f39c12' : '#555'};color:${isFav ? '#f39c12' : '#777'};padding:4px 7px;border-radius:4px;cursor:pointer;font-size:14px;" title="${isFav ? 'إزالة من المفضلة' : 'إضافة للمفضلة'}">${isFav ? '⭐' : '☆'}</button>
                        <button class="sf-ps-nav-btn" data-key="${item.key}" style="background:rgba(52,152,219,0.15);border:1px solid #3498db44;color:#3498db;padding:4px 7px;border-radius:4px;cursor:pointer;font-size:14px;" title="انتقل لهذا الحيوان">🎯</button>
                        <span style="color:#aaa;font-size:15px;font-weight:bold;">دورات:</span>
                        <input type="number" min="0" value="${cycles}" class="sf-ps-cycles" data-key="${item.key}" style="width:60px;background:#1a1a2e;color:#fff;border:1px solid #777;border-radius:6px;text-align:center;font-size:16px;font-weight:bold;padding:6px;outline:none;box-shadow:inset 0 0 5px rgba(0,0,0,0.5);" title="0 = مستمر بدون توقف">
                        ${running
                            ? `<button class="sf-ps-stop-btn" data-key="${item.key}" style="background:#c0392b;border:none;color:#fff;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:bold;box-shadow:0 1px 3px rgba(0,0,0,0.4);">⏹ إيقاف</button>`
                            : `<button class="sf-ps-start-btn" data-key="${item.key}" style="background:#27ae60;border:none;color:#fff;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:bold;box-shadow:0 1px 3px rgba(0,0,0,0.4);">▶ تشغيل</button>`
                        }
                        <button class="sf-ps-animal-smart-btn" data-key="${item.key}" style="background:linear-gradient(to bottom, #2ecc71, #27ae60);border:1px solid #1e8449;color:#fff;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:bold;margin-left:4px;box-shadow:0 1px 3px rgba(0,0,0,0.4);">➕ ذكية</button>
                    </div>
                </div>
                ${sched?.error ? `<div style="color:#e74c3c;font-size:12px;margin-top:6px;background:rgba(231,76,60,0.1);padding:4px;border-radius:4px;text-align:center;">⚠️ ${sched.error}</div>` : ''}
                ${running && !sched?.error ? `<div style="color:#2ecc71;font-size:12px;margin-top:6px;background:rgba(46,204,113,0.1);padding:4px;border-radius:4px;text-align:center;">🔄 تم إنجاز: ${done} ${cycles ? `من أصل ${cycles}` : 'دورة'}</div>` : ''}
            </div>`;
        };

        const sortByFav = (a, b) => (this.favorites[b.key] ? 1 : 0) - (this.favorites[a.key] ? 1 : 0);

        const running = animals.filter(item => this.schedules[item.key]?.running).sort(sortByFav);
        const idle = animals.filter(item => !this.schedules[item.key]?.running).sort(sortByFav);

        let html = '';
        if (this.activeFilter === 'all' || this.activeFilter === 'running') {
            if (running.length > 0) {
                html += `<div class="sf-ps-section-header" style="font-size:14px;color:#e67e22;margin:10px 0 5px 0;font-weight:bold;border-bottom:1px solid #e67e22;padding-bottom:4px;">🐄 حيوانات تعمل حالياً (${running.length})</div>`;
                html += running.map(renderAnimal).join('');
            }
        }
        if (this.activeFilter === 'all' || this.activeFilter === 'idle') {
            if (idle.length > 0) {
                html += `<div class="sf-ps-section-header" style="font-size:14px;color:#aaa;margin:15px 0 5px 0;font-weight:bold;border-bottom:1px solid #444;padding-bottom:4px;">🐄 حيوانات متوقفة (${idle.length})</div>`;
                html += idle.map(renderAnimal).join('');
            }
        }

        if (!html) html = '<div style="color:#777;font-size:13px;text-align:center;padding:10px;">لا يوجد عناصر تطابق الفلتر الحالي</div>';

        let activeEl = document.activeElement;
        let activeFocusedId = activeEl ? activeEl.id : null;
        let selStart = 0, selEnd = 0;
        try { selStart = activeEl.selectionStart; selEnd = activeEl.selectionEnd; } catch(e) {}

        const st = container.scrollTop;
        container.innerHTML = html;
        container.scrollTop = st;
        this._processImgQueue();
        
        const searchInput = this.container?.querySelector('#sf-ps-search-animal');
        if (searchInput && searchInput.value) {
            this._filterList('animal', searchInput.value);
        }

        if (activeFocusedId === 'sf-ps-search-animal') {
            setTimeout(() => {
                const s = this.container?.querySelector('#sf-ps-search-animal');
                if (s) { s.focus(); try { s.setSelectionRange(selStart, selEnd); } catch(e) {} }
            }, 10);
        }
    }


    _getDependencyProgressHtml(reqMats) {
        if (!reqMats || reqMats.length === 0) return '';
        let html = '';
        reqMats.forEach(rm => {
            const producers = this.items.filter(i => {
                if (i.type === 'Machine') return i.products.some(p => p.productId == rm.id);
                if (i.type === 'Animal') return i.productId == rm.id;
                return false;
            });
            
            producers.forEach(prodItem => {
                const s = this.schedules[prodItem.key];
                if (s && s.running) {
                    let progressText = '';
                    if (prodItem.type === 'Machine') {
                        const relatedQs = s.queue.filter(q => q.productId == rm.id);
                        if (relatedQs.length > 0) {
                            const done = relatedQs.reduce((sum, q) => sum + q.done, 0);
                            const target = relatedQs.reduce((sum, q) => sum + q.target, 0);
                            progressText = target > 0 ? `${done}/${target}` : `${done}/∞`;
                            html += `<span style="background:rgba(0,0,0,0.6);padding:3px 8px;border-radius:4px;font-size:12px;margin-right:6px;border:1px solid #555;display:inline-flex;align-items:center;gap:4px;box-shadow:inset 0 0 5px rgba(0,0,0,0.8);">${this._getItemIconUrl(prodItem.id, '⚙', 16)} <span style="color:#3498db;font-weight:bold;">${prodItem.name}</span> <strong style="color:#f39c12;">(${progressText})</strong></span>`;
                        }
                    } else {
                        progressText = s.targetCycles > 0 ? `${s.completedCycles}/${s.targetCycles}` : `${s.completedCycles}/∞`;
                        html += `<span style="background:rgba(0,0,0,0.6);padding:3px 8px;border-radius:4px;font-size:12px;margin-right:6px;border:1px solid #555;display:inline-flex;align-items:center;gap:4px;box-shadow:inset 0 0 5px rgba(0,0,0,0.8);">${this._getItemIconUrl(prodItem.id, '🐄', 16)} <span style="color:#e67e22;font-weight:bold;">${prodItem.name}</span> <strong style="color:#f39c12;">(${progressText})</strong></span>`;
                    }
                }
            });
        });
        return html ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap;">${html}</div>` : '';
    }

    _renderMachines() {
        if (this._machRenderTimer) clearTimeout(this._machRenderTimer);
        this._machRenderTimer = setTimeout(() => this._doRenderMachines(), 150);
    }
    _doRenderMachines() {
        const container = this.container?.querySelector('#sf-ps-machines-list');
        if (!container) return;

        let activeEl = document.activeElement;
        let activeFocusedId = activeEl ? activeEl.id : null;
        let activeFocusedClass = activeEl ? activeEl.className : null;
        let selStart = 0, selEnd = 0;
        let prodSearchVal = '';
        try { 
            selStart = activeEl.selectionStart; 
            selEnd = activeEl.selectionEnd; 
        } catch(e) {}
        
        if (this.activeMachineKey) {
            const ps = container.querySelector('.sf-ps-prod-search');
            if (ps) prodSearchVal = ps.value;
        }

        const headerWrap = this.container?.querySelector('#sf-ps-machine-header-wrap');
        if (this.activeMachineKey) {
            if (headerWrap) headerWrap.style.display = 'none';
            const item = this.items.find(i => i.key === this.activeMachineKey);
            if (!item) { this.activeMachineKey = null; return this._renderMachines(); }
            const sched = this.schedules[item.key] || {};
            const running = sched.running;
            const queue = sched.queue || [];

            let queueHtml = '';
            if (queue.length > 0) {
                queueHtml = `<div style="margin-top:12px;padding:10px;background:rgba(0,0,0,0.4);border-radius:8px;border:1px solid #444;box-shadow:inset 0 0 10px rgba(0,0,0,0.5);">
                    <div style="font-size:14px;font-weight:bold;color:#f39c12;margin-bottom:8px;border-bottom:1px solid #333;padding-bottom:6px;">📋 طابور الإنتاج الحالي:</div>
                    ${queue.map((q, idx) => {
                        const isCurrent = sched?.currentQueueIdx === idx;
                        const isDone = q.target > 0 && q.done >= q.target;
                        const color = q.error ? '#e74c3c' : (isDone ? '#27ae60' : (isCurrent && running ? '#f39c12' : '#aaa'));
                        const icon = q.error ? '⚠️' : (isDone ? '✅' : (isCurrent && running ? '▶' : '⏳'));
                        const errorMsg = q.error ? `<br><span style="color:#e74c3c;font-size:11px;">${q.error}</span>` : '';
                        const qIconHtml = q.productId ? `<div style="background:rgba(0,0,0,0.5);border-radius:6px;padding:4px;display:inline-flex;align-items:center;justify-content:center;min-width:48px;min-height:48px;box-shadow:inset 0 0 5px rgba(0,0,0,0.8);">${this._getItemIconUrl(q.productId, '📦', 44)}</div>` : '';
                        const pInfo = item.products.find(p => p.index === q.productIndex);
                        let reqs = [];
                        if (pInfo && pInfo.reqMats && pInfo.reqMats.length > 0) reqs = pInfo.reqMats;
                        else if (q.rawMaterialId) reqs = [{ id: q.rawMaterialId }];
                        const depsHtml = this._getDependencyProgressHtml(reqs);

                        return `<div style="display:flex;flex-direction:column;font-size:14px;color:${color};padding:8px 0;border-bottom:${idx<queue.length-1?'1px solid #222':'none'};">
                            <div style="display:flex;align-items:center;justify-content:space-between;">
                                <span style="display:flex;align-items:center;gap:8px;font-weight:bold;">
                                    <span style="font-size:16px;">${icon}</span>
                                    ${qIconHtml}
                                    <span>${q.name}</span> ×${q.target||'∞'} 
                                    <span style="font-size:12px;opacity:0.7;font-weight:normal;">${isDone ? '' : `(${q.done} من ${q.target||'∞'})`}</span>
                                    ${errorMsg}
                                </span>
                                <div style="display:flex;gap:6px;">
                                    ${idx > 0 ? `<button class="sf-ps-move-btn" data-dir="-1" data-key="${item.key}" data-idx="${idx}" style="background:#2980b9;border:none;color:#fff;cursor:pointer;font-size:12px;padding:4px 8px;border-radius:4px;font-weight:bold;box-shadow:0 1px 3px rgba(0,0,0,0.3);">▲</button>` : ''}
                                    ${idx < queue.length - 1 ? `<button class="sf-ps-move-btn" data-dir="1" data-key="${item.key}" data-idx="${idx}" style="background:#2980b9;border:none;color:#fff;cursor:pointer;font-size:12px;padding:4px 8px;border-radius:4px;font-weight:bold;box-shadow:0 1px 3px rgba(0,0,0,0.3);">▼</button>` : ''}
                                    <button class="sf-ps-rmq" data-key="${item.key}" data-idx="${idx}" style="background:#e74c3c22;border:1px solid #e74c3c;color:#e74c3c;cursor:pointer;font-size:12px;padding:4px 8px;border-radius:4px;font-weight:bold;box-shadow:0 1px 3px rgba(0,0,0,0.2);">✕ حذف</button>
                                </div>
                            </div>
                            ${depsHtml}
                        </div>`;
                    }).join('')}
                </div>`;
            }

            container.innerHTML = `
            <div class="sf-ps-manage-view" data-key="${item.key}" style="background:rgba(52,152,219,0.05);border:1px solid #3498db44;border-radius:8px;padding:12px;box-shadow:inset 0 0 10px rgba(0,0,0,0.5); display:flex; flex-direction:column; height:100%;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;border-bottom:1px solid #333;padding-bottom:8px; gap:10px;">
                    <span style="color:#3498db;font-size:20px;font-weight:bold; white-space:nowrap; display:flex; align-items:center; gap:8px;">${this._getItemIconUrl(item.id, '⚙️', 32)} ${item.name}</span>
                    <div style="display:flex; align-items:center; gap:8px; flex:1;">
                        <span style="font-size:14px;font-weight:bold;color:#ecf0f1;white-space:nowrap;">إضافة للجدولة:</span>
                        <input type="text" class="sf-ps-prod-search" value="${prodSearchVal}" placeholder="🔍 بحث ذكي..." style="flex:1;background:#1a1a2e;color:#fff;border:1px solid #555;border-radius:6px;padding:8px 10px;font-size:13px;box-shadow:inset 0 0 5px rgba(0,0,0,0.5);">
                    </div>
                    <button class="sf-ps-back-btn" style="background:#444;border:none;color:#fff;padding:8px 12px;border-radius:4px;cursor:pointer;font-size:13px;font-weight:bold;white-space:nowrap;">⬅️ عودة للقائمة</button>
                </div>
                <div style="display:flex;gap:8px;margin-bottom:12px;">
                    ${running 
                        ? `<button class="sf-ps-stop-btn" data-key="${item.key}" style="width:100%;background:#c0392b;border:none;color:#fff;padding:8px;border-radius:6px;cursor:pointer;font-size:14px;font-weight:bold;">⏹ إيقاف الآلة</button>`
                        : `<button class="sf-ps-start-btn" data-key="${item.key}" style="width:100%;background:#27ae60;border:none;color:#fff;padding:8px;border-radius:6px;cursor:pointer;font-size:14px;font-weight:bold;">▶ تشغيل الآلة</button>`
                    }
                </div>
                <div class="sf-ps-manage-queue" style="max-height: 150px; overflow-y: auto;">${queueHtml}</div>
                <div style="margin-top:16px;border-top:1px solid #444;padding-top:16px; flex:1; display:flex; flex-direction:column; position:relative;">
                    <div class="sf-ps-prod-list" style="position:relative; flex:1; overflow-y:auto; padding-right:4px;">
                        <div style="position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); opacity:0.25; pointer-events:none; z-index:0; display:flex; align-items:center; justify-content:center; width: 100%; height: 100%;">
                            ${this._getItemIconUrl(item.id, '⚙️', 250)}
                        </div>
                        <div style="position:relative; z-index:1;">
                        ${item.products.map((p, i) => {
                            const pNameSafe = (p.name || '').replace(/"/g, '&quot;');
                            
                            const reqHtml = (p.reqMats || []).map(rm => {
                                const count = this._getInventoryCount(rm.id);
                                const color = count > 0 ? '#2ecc71' : '#e74c3c';
                                const matIcon = this._getItemIconUrl(rm.id, '🌱', 24);
                                
                                let chainHtml = '';
                                if (rm.id) {
                                    const producers = this._findAllProducers(rm.id);
                                    if (producers.length > 0) {
                                        const pIconHtml = this._getItemIconUrl(producers[0].id, '⚙️', 20);

                                        if (producers.length === 1) {
                                            const producer = producers[0];
                                            let btnStyle = 'background-color: #555; color: white;';
                                            if (producer.status === 'placed' || producer.status === 'animal_placed') btnStyle = 'background-color: #2196F3; color: white;';
                                            else if (producer.status === 'missing') btnStyle = 'background-color: #F44336; color: white;';
                                            else if (producer.status === 'animal') btnStyle = 'background-color: #FF9800; color: white;';
                                            else if (producer.status === 'tree') btnStyle = 'background-color: #4CAF50; color: white;';
                                            else if (producer.status === 'seed') btnStyle = 'background-color: #8BC34A; color: black;';

                                            chainHtml = `<div style="display:flex;align-items:center;margin-right:6px;"><button class="sf-ps-nav-source-btn" data-key="${producer.key || ''}" data-id="${producer.id || ''}" style="${btnStyle} cursor: pointer; border: none; padding: 4px 8px; border-radius: 4px; font-size: 13px; margin-bottom: 5px; box-shadow:0 1px 3px rgba(0,0,0,0.3); font-weight:bold; display:flex; align-items:center; gap:6px;"><div style="background:rgba(0,0,0,0.3);border-radius:4px;padding:2px;display:flex;">${pIconHtml}</div>${producer.name}</button><input type="hidden" class="sf-ps-source-select" data-rm-id="${rm.id}" value="${producer.key || ''}"></div>`;
                                        } else {
                                            chainHtml = `<div style="display:flex;align-items:center;margin-right:6px;margin-bottom:5px;background:#2c3e50; border:1px solid #34495e; border-radius:4px; box-shadow:0 1px 3px rgba(0,0,0,0.3);"><div style="background:rgba(0,0,0,0.3);padding:2px 4px;display:flex;align-items:center;border-top-right-radius:4px;border-bottom-right-radius:4px;">${pIconHtml}</div><select class="sf-ps-source-select" data-rm-id="${rm.id}" style="background:transparent; color:#fff; border:none; padding:4px 8px; font-size:12px; outline:none; font-weight:bold; max-width:140px; cursor:pointer;">`;
                                            producers.forEach(producer => {
                                                const isPlaced = (producer.status === 'placed' || producer.status === 'animal_placed');
                                                chainHtml += `<option value="${producer.key || ''}" style="color:#000" ${isPlaced ? 'selected' : ''}>${producer.name}</option>`;
                                            });
                                            chainHtml += `</select></div>`;
                                        }
                                    } else {
                                        chainHtml = `<span style="background:#e74c3c22;border:1px dashed #e74c3c;padding:4px 10px;border-radius:6px;font-size:14px;font-weight:bold;color:#ff7675;margin-right:8px;box-shadow:inset 0 0 5px rgba(231,76,60,0.2);">🚫 لا يوجد مصدر معروف</span>`;
                                    }
                                }
                                
                                return `<span style="background:rgba(0,0,0,0.4);padding:6px 10px;border-radius:8px;margin-left:8px;display:inline-flex;align-items:center;border:1px solid rgba(255,255,255,0.08);box-shadow:0 2px 4px rgba(0,0,0,0.3);">
                                    ${matIcon} <span style="margin-left:8px;font-size:16px;color:#ecf0f1;font-weight:bold;">${rm.name}: <strong style="color:${color};margin:0 4px;font-size:18px;">${count}</strong></span>
                                    ${chainHtml}
                                </span>`;
                            }).join('');
                            const prodCount = p.productId ? this._getInventoryCount(p.productId) : 0;
                            return `
                        <div class="sf-ps-prod-item" data-name="${pNameSafe}" style="display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,0.05);padding:10px 12px;border-radius:10px;margin-bottom:8px;border:1px solid rgba(255,255,255,0.1);box-shadow:0 2px 6px rgba(0,0,0,0.3);">
                            <div style="display:flex;align-items:center;gap:14px;flex:1;">
                                <div style="background:rgba(0,0,0,0.4);border-radius:12px;padding:4px;display:flex;align-items:center;justify-content:center;box-shadow:inset 0 0 8px rgba(0,0,0,0.7);min-width:64px;min-height:64px;">
                                    ${p.productId ? this._getItemIconUrl(p.productId, '📦', 56) : ''}
                                </div>
                                <div style="display:flex;flex-direction:column;gap:6px;">
                                    <span style="font-size:18px;color:#fff;font-weight:bold;text-shadow:0 1px 2px rgba(0,0,0,0.8);">${p.name}</span>
                                    <div style="display:flex;flex-wrap:wrap;gap:6px;line-height:1.6;align-items:center;">
                                        ${reqHtml}
                                    </div>
                                </div>
                            </div>
                            <div style="display:flex;flex-direction:column;align-items:center;gap:8px;">
                                <div style="display:flex;align-items:center;gap:8px;">
                                    <input type="number" min="0" value="1" class="sf-ps-prod-qty" data-idx="${i}" style="width:55px;background:#111;color:#fff;border:1px solid #777;border-radius:6px;text-align:center;font-size:15px;font-weight:bold;padding:6px;outline:none;box-shadow:inset 0 0 5px rgba(0,0,0,0.5);" title="0 = بلا حدود">
                                    <button class="sf-ps-add-chain-btn" data-key="${item.key}" data-idx="${i}" style="background:linear-gradient(to bottom, #2ecc71, #27ae60);border:1px solid #1e8449;color:#fff;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:14px;font-weight:bold;box-shadow:0 2px 4px rgba(0,0,0,0.4);" title="جدولة هذا المنتج وكل مواده الخام">➕ جدولة ذكية</button>
                                    <button class="sf-ps-add-prod-btn" data-key="${item.key}" data-idx="${i}" style="background:linear-gradient(to bottom, #9b59b6, #8e44ad);border:1px solid #732d91;color:#fff;padding:8px 14px;border-radius:6px;cursor:pointer;font-size:14px;font-weight:bold;box-shadow:0 2px 4px rgba(0,0,0,0.4);">إضافة</button>
                                </div>
                                <span style="background:rgba(243,156,18,0.2);padding:4px 8px;border-radius:4px;color:#f39c12;border:1px solid rgba(243,156,18,0.4);font-size:13px;font-weight:bold;box-shadow:0 1px 3px rgba(0,0,0,0.2); width:100%; text-align:center; box-sizing:border-box;">المخزون: <strong style="font-size:15px;">${prodCount}</strong></span>
                            </div>
                        </div>
                        `;
                        }).join('')}
                        </div>
                    </div>
                </div>
            </div>`;
            const searchInput = container.querySelector('.sf-ps-prod-search');
            if (searchInput) {
                if (prodSearchVal) {
                    const term = this._normalizeArabic(prodSearchVal.toLowerCase());
                    container.querySelectorAll('.sf-ps-prod-item').forEach(el => {
                        const itemName = this._normalizeArabic((el.dataset.name || el.getAttribute('data-name') || '').toLowerCase());
                        el.style.display = itemName.includes(term) ? 'flex' : 'none';
                    });
                }
                searchInput.addEventListener('input', (e) => {
                    const term = this._normalizeArabic(e.target.value.toLowerCase());
                    container.querySelectorAll('.sf-ps-prod-item').forEach(el => {
                        const itemName = this._normalizeArabic((el.dataset.name || el.getAttribute('data-name') || '').toLowerCase());
                        el.style.display = itemName.includes(term) ? 'flex' : 'none';
                    });
                });
            }
            this._processImgQueue();
            
            if (activeFocusedClass && activeFocusedClass.includes('sf-ps-prod-search')) {
                setTimeout(() => {
                    const ps = container.querySelector('.sf-ps-prod-search');
                    if (ps) { ps.focus(); try { ps.setSelectionRange(selStart, selEnd); } catch(e) {} }
                }, 10);
            }
            return;
        }

        if (headerWrap) headerWrap.style.display = 'flex';
        const machines = this.items.filter(i => i.type === 'Machine');
        if (machines.length === 0) { container.innerHTML = '<div style="color:#777;font-size:13px;text-align:center;padding:10px;">لا يوجد آلات على الأرض</div>'; return; }

        const renderMachine = (item) => {
            const sched = this.schedules[item.key];
            const running = sched?.running;
            const queue = sched?.queue || [];
            const isFav = !!this.favorites[item.key];
            return `<div class="sf-ps-item sf-ps-item-machine" data-key="${item.key}" data-name="${item.name}" style="background:rgba(52,152,219,0.1);border:1px solid ${isFav ? '#f39c12' : '#3498db44'};border-radius:8px;padding:8px 12px;margin-bottom:6px;box-shadow:0 2px 4px rgba(0,0,0,0.2);">
                <div style="display:flex;align-items:center;justify-content:space-between;">
                    <div style="display:flex;align-items:center;gap:16px;">
                        <div style="background:rgba(0,0,0,0.3);border-radius:16px;padding:6px;display:flex;align-items:center;justify-content:center;box-shadow:inset 0 0 10px rgba(0,0,0,0.5), 0 2px 4px rgba(0,0,0,0.3);min-width:110px;min-height:110px;">
                            ${this._getItemIconUrl(item.id, '⚙️', 96)}
                        </div>
                        <div style="display:flex;flex-direction:column;gap:4px;">
                            <span style="color:#3498db;font-size:16px;font-weight:bold;display:flex;align-items:center;gap:6px;">
                                <span>${item.name}</span>${isFav ? ' <span style="color:#f39c12;font-size:12px;">⭐</span>' : ''}
                            </span>
                            <span style="font-size:11px;color:#aaa;background:rgba(255,255,255,0.05);padding:2px 6px;border-radius:3px;display:inline-block;width:max-content;">${queue.length > 0 ? `الجدولة: <strong>${queue.length}</strong> منتجات` : 'لا يوجد منتجات مجدولة'}</span>
                        </div>
                    </div>
                    <div style="display:flex;gap:6px;align-items:center;">
                        <button class="sf-ps-fav-btn" data-key="${item.key}" style="background:${isFav ? 'rgba(243,156,18,0.3)' : 'rgba(255,255,255,0.05)'};border:1px solid ${isFav ? '#f39c12' : '#555'};color:${isFav ? '#f39c12' : '#777'};padding:5px 8px;border-radius:4px;cursor:pointer;font-size:14px;" title="${isFav ? 'إزالة من المفضلة' : 'إضافة للمفضلة'}">${isFav ? '⭐' : '☆'}</button>
                        <button class="sf-ps-nav-btn" data-key="${item.key}" style="background:rgba(52,152,219,0.15);border:1px solid #3498db44;color:#3498db;padding:5px 8px;border-radius:4px;cursor:pointer;font-size:14px;" title="انتقل لهذه الآلة">🎯</button>
                        <button class="sf-ps-manage-btn" data-key="${item.key}" style="background:#34495e;border:1px solid #2c3e50;color:#fff;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:bold;">⚙️ إدارة</button>
                        ${running
                            ? `<button class="sf-ps-stop-btn" data-key="${item.key}" style="background:#c0392b;border:none;color:#fff;padding:6px 10px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:bold;">⏹</button>`
                            : `<button class="sf-ps-start-btn" data-key="${item.key}" style="background:#27ae60;border:none;color:#fff;padding:6px 10px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:bold;">▶</button>`
                        }
                    </div>
                </div>
            </div>`;
        };

        const sortByFav = (a, b) => (this.favorites[b.key] ? 1 : 0) - (this.favorites[a.key] ? 1 : 0);

        const running = machines.filter(item => this.schedules[item.key]?.running).sort(sortByFav);
        const idle = machines.filter(item => !this.schedules[item.key]?.running).sort(sortByFav);

        let html = '';
        if (this.activeFilter === 'all' || this.activeFilter === 'running') {
            if (running.length > 0) {
                html += `<div class="sf-ps-section-header" style="font-size:14px;color:#2ecc71;margin:10px 0 5px 0;font-weight:bold;border-bottom:1px solid #2ecc71;padding-bottom:4px;">⚙ آلات تعمل حالياً (${running.length})</div>`;
                html += running.map(renderMachine).join('');
            }
        }
        if (this.activeFilter === 'all' || this.activeFilter === 'idle') {
            if (idle.length > 0) {
                html += `<div class="sf-ps-section-header" style="font-size:14px;color:#aaa;margin:15px 0 5px 0;font-weight:bold;border-bottom:1px solid #444;padding-bottom:4px;">⚙ آلات متوقفة (${idle.length})</div>`;
                html += idle.map(renderMachine).join('');
            }
        }

        if (!html) html = '<div style="color:#777;font-size:13px;text-align:center;padding:10px;">لا يوجد عناصر تطابق الفلتر الحالي</div>';

        const st = container.scrollTop;
        container.innerHTML = html;
        container.scrollTop = st;
        this._processImgQueue();
        
        const searchInput = this.container?.querySelector('#sf-ps-search-machine');
        if (searchInput && searchInput.value) {
            this._filterList('machine', searchInput.value);
        }
        
        if (activeFocusedId === 'sf-ps-search-machine') {
            setTimeout(() => {
                const s = this.container?.querySelector('#sf-ps-search-machine');
                if (s) { s.focus(); try { s.setSelectionRange(selStart, selEnd); } catch(e) {} }
            }, 10);
        }
    }


    _filterList(type, query) {
        const listId = type === 'animal' ? '#sf-ps-animals-list' : '#sf-ps-machines-list';
        const container = this.container?.querySelector(listId);
        if (!container) return;
        const q = this._normalizeArabic((query || '').trim().toLowerCase());

        let visibleCount = 0;
        container.querySelectorAll('.sf-ps-item').forEach(el => {
            const itemName = this._normalizeArabic((el.dataset.name || '').toLowerCase());
            const show = !q || itemName.includes(q);
            el.style.display = show ? '' : 'none';
            if (show) visibleCount++;
        });

        const catalogId = `sf-ps-catalog-${type}`;
        let catalogEl = container.querySelector(`#${catalogId}`);
        if (catalogEl) catalogEl.remove();

        if (q && q.length >= 2) {
            try {
                const pool = unsafeWindow.GF?.shopController?.shopModel?._allMachine || [];
                const farmIds = new Set(this.items.map(i => i.id));
                const itemType = type === 'animal' ? 'animals' : 'buildings';

                const catalogMatches = pool.filter(cd => {
                    if (!cd || !cd.name) return false;
                    if (itemType === 'buildings' && cd.type !== 'buildings') return false;
                    if (itemType === 'animals' && cd.type !== 'animals') return false;
                    if (farmIds.has(cd.id)) return false;
                    return this._normalizeArabic(cd.name.toLowerCase()).includes(q);
                }).slice(0, 5);

                if (catalogMatches.length > 0) {
                    catalogEl = document.createElement('div');
                    catalogEl.id = catalogId;
                    catalogEl.style.cssText = 'border-top:1px solid #444;margin-top:6px;padding-top:6px;';
                    catalogEl.innerHTML = `<div style="color:#aaa;font-size:11px;padding:2px 4px;">غير موجود في مزرعتك:</div>`;

                    catalogMatches.forEach(cd => {
                        const buyInfo = this._getItemBuyInfo(cd);
                        const row = document.createElement('div');
                        row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px;background:rgba(0,0,0,0.2);border-radius:4px;margin:3px 0;font-size:12px;';
                        row.innerHTML = `
                            <span style="flex:1;color:#ccc;">${cd.name}</span>
                            <span style="color:#f39c12;font-size:11px;">${buyInfo.where}</span>
                            <span style="color:#aaa;font-size:11px;">${buyInfo.priceText}</span>
                        `;
                        catalogEl.appendChild(row);
                    });

                    container.appendChild(catalogEl);
                }
            } catch(e) {}
        }
    }

    _addToQueue(key, prodIdx, qty) {
        const item = this.items.find(i => i.key === key);
        if (!item || !item.products[prodIdx]) return;

        if (!this.schedules[key]) this.schedules[key] = { queue: [], currentQueueIdx: 0, running: false, completedCycles: 0, targetCycles: 0 };
        const p = item.products[prodIdx];
        this.schedules[key].queue.push({ productIndex: prodIdx, rawMaterialId: p.rawMaterialId, productId: p.productId, name: p.name, target: qty, done: 0 });
        this._log(`➕ ${item.name}: ${p.name} ×${qty || '∞'}`);
        this._saveSchedules();
        if (this.activeMachineKey === key) this._renderMachines();
    }

    _recalcQueueIdx(sched) {
        if (!sched || !sched.queue) return;
        let found = false;
        
        const item = this.items.find(i => this.schedules[i.key] === sched);

        for (let i = 0; i < sched.queue.length; i++) {
            const q = sched.queue[i];
            
            let matId = q.rawMaterialId;
            if (Array.isArray(matId)) matId = null; 
            
            if (!matId && item && item.products) {
                const p = item.products.find(prod => prod.index === q.productIndex);
                if (p && p.rawMaterialId) {
                    matId = p.rawMaterialId;
                    q.rawMaterialId = matId;
                }
            }
            let hasStock = true;
            let missingName = null;
            
            if (item && item.products) {
                const p = item.products.find(prod => prod.index === q.productIndex);
                if (p && p.reqMats && p.reqMats.length > 0) {
                    for (let rm of p.reqMats) {
                        const invCount = this._getInventoryCount(rm.id);
                        if (invCount < 1) {
                            hasStock = false;
                            missingName = rm.name || this._getItemSourceHint(rm.id);
                            break;
                        }
                    }
                } else if (matId) {
                    const invCount = this._getInventoryCount(matId);
                    if (invCount < 1) {
                        hasStock = false;
                        missingName = this._getItemSourceHint(matId);
                    }
                }
            } else if (matId) {
                const invCount = this._getInventoryCount(matId);
                if (invCount < 1) {
                    hasStock = false;
                    missingName = this._getItemSourceHint(matId);
                }
            }

            if (!hasStock) {
                q.error = `ينقصك: ${missingName}`;
            } else {
                q.error = null;
            }

            if (q.target === 0 || q.done < q.target) {
                sched.currentQueueIdx = i;
                found = true;
                break;
            }
        }
        if (!found) {
            sched.currentQueueIdx = sched.queue.length;
        }
    }

    _removeFromQueue(key, idx) {
        if (!this.schedules[key]) return;
        this.schedules[key].queue.splice(idx, 1);
        this._recalcQueueIdx(this.schedules[key]);
        if (this.schedules[key].queue.length === 0) this.schedules[key].running = false;
        this._saveSchedules();
        this._renderMachines();
    }

    _moveQueueItem(key, idx, dir) {
        if (!this.schedules[key]) return;
        const q = this.schedules[key].queue;
        const targetIdx = idx + dir;
        if (targetIdx < 0 || targetIdx >= q.length) return;

        const temp = q[idx];
        q[idx] = q[targetIdx];
        q[targetIdx] = temp;

        this._recalcQueueIdx(this.schedules[key]);

        this._saveSchedules();
        if (this.activeMachineKey === key) this._renderMachines();
    }


    _startAnimalSmart(key, qty) {
        const item = this.items.find(i => i.key === key);
        if (!item) return;
        
        const dependentKeys = [];
        if (item.reqMats && item.reqMats.length > 0) {
            this._collectDependencyKeys({ reqMats: item.reqMats }, qty, dependentKeys, {}, true);
        }
        
        if (!this.schedules[key]) this.schedules[key] = { running: false, completedCycles: 0, targetCycles: 0 };
        this.schedules[key].targetCycles = qty > 0 ? this.schedules[key].completedCycles + qty : 0;
        
        this._startOne(key, true);
        
        dependentKeys.forEach(depKey => {
            const s = this.schedules[depKey];
            if (s) {
                if (s.queue && s.queue.length > 0) this._startOne(depKey, true);
                else if (s.targetCycles !== undefined) this._startOne(depKey, true);
            }
        });
        
        this._log(`✅ تم تفعيل الجدولة الذكية للحيوان: ${item.name}`);
    }

    _startOne(key, isSmart = false) {
        const item = this.items.find(i => i.key === key);
        if (!item) return;
        if (!this.schedules[key]) this.schedules[key] = { queue: [], currentQueueIdx: 0, running: false, completedCycles: 0, targetCycles: 0 };
        const sched = this.schedules[key];

        if (item.type === 'Machine') {
            if (sched.queue.length === 0) { this._log(`⚠️ ${item.name}: أضف منتجات أولاً`); return; }
            if (!isSmart) {
                sched.queue.forEach(q => q.done = 0);
            }
            sched.currentQueueIdx = 0;
            this._recalcQueueIdx(sched);
        } else {
            if (!isSmart) {
                const cycEl = this.container?.querySelector(`.sf-ps-cycles[data-key="${key}"]`);
                sched.targetCycles = parseInt(cycEl?.value) || 0;
                sched.completedCycles = 0;
            }
        }

        sched.running = true;
        this._saveSchedules();
        this._log(`✅ ${item.name}: بدأ`);
        this._renderAnimals();
        this._renderMachines();
        this._updateBadge(key);
        this._startLoop();
    }

    _stopOne(key) {
        if (this.schedules[key]) { this.schedules[key].running = false; this._updateBadge(key); }
        delete this._waitingProductChange[key];
        this._saveSchedules();
        this._renderAnimals();
        this._renderMachines();
        if (!Object.values(this.schedules).some(s => s.running)) this._stopLoop();
    }

    _startAll() { this.items.forEach(item => { const s = this.schedules[item.key]; if (item.type === 'Animal' || (s && s.queue.length > 0)) this._startOne(item.key); }); }
    _stopAll() { Object.keys(this.schedules).forEach(k => this._stopOne(k)); this._stopLoop(); }

    _ensureBadgeContainer() {
        if (this._badgeContainer && document.body.contains(this._badgeContainer)) return;
        this._badgeContainer = document.createElement('div');
        this._badgeContainer.id = 'sf-ps-badge-root';
        this._badgeContainer.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9000;';
        document.body.appendChild(this._badgeContainer);
    }

    _updateBadge(key) {
        const sched = this.schedules[key];
        const item = this.items.find(i => i.key === key);
        if (!item) return;
        if (!sched?.running) { if (this.badges[key]) { this.badges[key].remove(); delete this.badges[key]; } return; }

        if (!this.badges[key]) {
            const b = document.createElement('div');
            b.style.cssText = 'position:absolute;background:rgba(20,20,30,0.85);color:#fff;padding:8px 12px;border-radius:8px;font-size:13px;font-weight:bold;font-family:sans-serif;white-space:nowrap;transform:translate(-50%,-100%);border:1px solid #3498db;box-shadow:0 4px 10px rgba(0,0,0,0.5);pointer-events:auto;z-index:9000;display:flex;flex-direction:column;gap:4px;cursor:default;transition:opacity 0.2s;';
            b.addEventListener('mouseenter', () => b._isHovered = true);
            b.addEventListener('mouseleave', () => b._isHovered = false);
            this._ensureBadgeContainer();
            this._badgeContainer.appendChild(b);
            this.badges[key] = b;
        }
        const b = this.badges[key];
        
        let reportHtml = `<div style="color:#f39c12;font-size:14px;border-bottom:1px solid #444;padding-bottom:4px;margin-bottom:4px;">${item.name}</div>`;
        const p = this._getFreshMO(item);
        const isReady = p?.serverData?.products > 0 || (Array.isArray(p?.serverData?.products) && p?.serverData?.products.length > 0);
        
        if (isReady) reportHtml += `<div>📦 حالة الإنتاج: <span style="color:#2ecc71">جاهز للجمع</span></div>`;
        
        let producedId = null;
        if (item.type === 'Machine') {
            const cur = sched.queue[sched.currentQueueIdx];
            if (cur) {
                producedId = cur.productId;
                reportHtml += `<div>الهدف الحالي: <span style="color:#3498db">${cur.name}</span></div>`;
                reportHtml += `<div>الإنجاز: <span style="color:#2ecc71">${cur.done}</span> / ${cur.target || '∞'}</div>`;
            } else {
                reportHtml += `<div>الإنجاز: <span style="color:#2ecc71">✅ مكتمل</span></div>`;
            }
        } else {
            producedId = item.productId;
            reportHtml += `<div>الإنجاز: <span style="color:#2ecc71">${sched.completedCycles}</span> / ${sched.targetCycles || '∞'}</div>`;
        }

        if (sched.error) reportHtml += `<div style="color:#e74c3c;">⚠️ ${sched.error}</div>`;

        // Check if serving anyone
        let serving = [];
        if (producedId) {
            Object.keys(this.schedules).forEach(k => {
                if (k === key) return;
                const otherSched = this.schedules[k];
                if (!otherSched.running) return;
                const otherItem = this.items.find(i => i.key === k);
                if (!otherItem) return;
                
                if (otherItem.type === 'Machine') {
                    const oCur = otherSched.queue[otherSched.currentQueueIdx];
                    if (oCur) {
                        const oProd = otherItem.products.find(x => x.index === oCur.productIndex);
                        if (oProd && oProd.reqMats && oProd.reqMats.some(r => r.id == producedId)) {
                            serving.push(otherItem.name);
                        } else if (oCur.rawMaterialId == producedId) {
                            serving.push(otherItem.name);
                        }
                    }
                } else if (otherItem.type === 'Animal') {
                    if (otherItem.reqMats && otherItem.reqMats.some(r => r.id == producedId)) {
                        serving.push(otherItem.name);
                    }
                }
            });
        }
        
        if (serving.length > 0) {
            reportHtml += `<div style="color:#9b59b6;font-size:11px;margin-top:2px;">🔗 يخدم: ${serving.join('، ')}</div>`;
        } else {
            reportHtml += `<div style="color:#95a5a6;font-size:11px;margin-top:2px;">⭐ يعمل لنفسه (آلة أساسية)</div>`;
        }
        
        b.innerHTML = reportHtml;
    }

    _startPositionUpdater() {
        if (this.posTimer) return;
        this.posTimer = setInterval(() => this._positionBadges(), 500);
    }

    _positionBadges() {
        const gw = unsafeWindow;
        const canvas = document.querySelector('canvas');
        if (!canvas) return;
        
        let hideAll = false;
        try {
            if (gw.GF?.windowManager?.getOpenWindows && gw.GF.windowManager.getOpenWindows().length > 0) hideAll = true;
            if (gw.App?.PopUpManager?.getPopUps && gw.App.PopUpManager.getPopUps().length > 0) hideAll = true;
            if (gw.PopUpManager?.getPopUps && gw.PopUpManager.getPopUps().length > 0) hideAll = true;
            if (gw.App?.ControllerManager?.getControllerModel("WindowManager")?.getOpenWindows && gw.App.ControllerManager.getControllerModel("WindowManager").getOpenWindows().length > 0) hideAll = true;
            if (gw.GF?.guiManager?.getOpenWindows && gw.GF.guiManager.getOpenWindows().length > 0) hideAll = true;
            
            if (gw.LayerManager) {
                const isVisible = (layer) => {
                    if (!layer || layer.numChildren === 0) return false;
                    const children = layer.$children || layer.children || [];
                    for (let i = 0; i < children.length; i++) {
                        if (children[i].visible !== false && children[i].alpha !== 0) return true;
                    }
                    return false;
                };
                if (isVisible(gw.LayerManager.UI_Popup)) hideAll = true;
                if (isVisible(gw.LayerManager.UI_Message)) hideAll = true;
                if (isVisible(gw.LayerManager.UI_Tutorial)) hideAll = true;
            }
        } catch(e) {}

        const rect = canvas.getBoundingClientRect();
        let stageW, stageH;
        try { const s = gw.egret.lifecycle.stage; stageW = s.stageWidth; stageH = s.stageHeight; } catch(e) { stageW = canvas.width; stageH = canvas.height; }
        const scX = rect.width / stageW, scY = rect.height / stageH;

        Object.keys(this.badges).forEach(key => {
            const badge = this.badges[key];
            const item = this.items.find(i => i.key === key);
            if (!badge || !item || hideAll) {
                if (badge) badge.style.display = 'none';
                return;
            }
            try {
                const mo = this._getFreshMO(item);
                if (!mo || typeof mo.localToGlobal !== 'function') { badge.style.display = 'none'; return; }
                const p = new gw.egret.Point(0, 0);
                mo.localToGlobal(0, 0, p);
                const sx = rect.left + p.x * scX, sy = rect.top + p.y * scY - 20;
                
                const isHovered = badge._isHovered || Math.hypot(sx - this._mouseX, sy - this._mouseY) < 120;
                const isPinned = this.pinnedBadges[key];
                const isActive = this.activeMachineKey === key;
                
                if ((isHovered || isPinned || isActive) && sx > rect.left - 30 && sx < rect.right + 30 && sy > rect.top - 30 && sy < rect.bottom + 30) {
                    badge.style.left = sx + 'px'; badge.style.top = sy + 'px'; badge.style.display = '';
                } else { badge.style.display = 'none'; }
            } catch(e) { badge.style.display = 'none'; }
        });
    }

    _startLoop() { if (this.loopTimer) return; this.loopTimer = setInterval(() => this._checkAll(), this.loopSpeed); }
    _stopLoop() { if (this.loopTimer) { clearInterval(this.loopTimer); this.loopTimer = null; } }

    _checkAll() {
        const keys = Object.keys(this.schedules).filter(k => this.schedules[k].running);
        if (keys.length === 0) { this._stopLoop(); return; }
        keys.forEach(key => { try { this._processItem(key); } catch(e) { this._log(`❌ ${key}: ${e.message}`); } });
        try { unsafeWindow.NetUtils.flush(); } catch(e) {}
        this._saveSchedules();
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
        if (!gc) return;

        const hasProducts = typeof mo.can_collect === 'function' ? mo.can_collect() : false;
        if (hasProducts) {
            const now = Date.now();
            if (sched.__last_collect_time && now - sched.__last_collect_time < 15000) return;
            sched.__last_collect_time = now;
            
            try { 
                if (gc._collectMapObject) {
                    gc._collectMapObject(mo);
                } else if (mo.collect) {
                    mo.collect();
                }
            } catch(e) {}
            
            const curSel = parseInt(sd.selected_raw_material) || 0;
            let collectedItem = sched.queue.find(q => q.productIndex === curSel && (q.target === 0 || q.done < q.target));
            if (!collectedItem) collectedItem = sched.queue[sched.currentQueueIdx];
            
            if (collectedItem) {
                collectedItem.done++;
                this._log(`📦 ${item.name}: ${collectedItem.name} ${collectedItem.done}/${collectedItem.target||'∞'}`);
            }

            this._recalcQueueIdx(sched);
            if (sched.currentQueueIdx >= sched.queue.length) {
                sched.running = false;
                this._log(`🎉 ${item.name}: اكتمل!`);
                delete this.schedules[key];
                this._saveSchedules();
            }
            try { gw.NetUtils.flush(); } catch(e) {}
            this._updateBadge(key); this._renderMachines(); return;
        }

        const rawMats = sd.raw_materials;
        const isIdle = !rawMats || rawMats === '0' || rawMats === 0 || (Array.isArray(rawMats) && rawMats.every(r => !r || (Array.isArray(r) && r.length === 0)));
        if (isIdle) {
            this._recalcQueueIdx(sched);
            if (sched.currentQueueIdx >= sched.queue.length) {
                sched.running = false; delete this.schedules[key]; this._saveSchedules(); this._updateBadge(key); this._renderMachines(); return;
            }

            const next = sched.queue[sched.currentQueueIdx];
            if (next && next.productIndex >= 0) {
                const curSel = parseInt(sd.selected_raw_material) || 0;
                if (curSel !== next.productIndex) {
                    this._log(`🔄 ${item.name} إلى ${next.name}`);
                    try { gw.NetUtils.enqueue('save_selected_material.save_data', { id: item.id, x: item.x, y: item.y, flip: 0, material: next.productIndex }); } catch(e) {}
                    sd.selected_raw_material = next.productIndex;
                    if (mo.selected_raw_material !== undefined) mo.selected_raw_material = next.productIndex;
                    if (typeof mo.setRawMaterial === 'function') { try { mo.setRawMaterial(next.productIndex); } catch(e) {} }
                    try { gw.NetUtils.flush(); } catch(e) {}
                }
                if (next.error) {
                    // SMART DEPENDENCY INJECTION
                    let missingMatId = null;
                    const p = item.products.find(prod => prod.index === next.productIndex);
                    if (p) {
                        if (p.reqMats && p.reqMats.length > 0) {
                            for (let rm of p.reqMats) {
                                if (this._getInventoryCount(rm.id) < 1) { missingMatId = rm.id; break; }
                            }
                        } else if (p.rawMaterialId && this._getInventoryCount(p.rawMaterialId) < 1) {
                            missingMatId = p.rawMaterialId;
                        }
                    } else if (next.rawMaterialId && this._getInventoryCount(next.rawMaterialId) < 1) {
                        missingMatId = next.rawMaterialId;
                    }

                    if (missingMatId) {
                        const producer = this._findMachineProducing(missingMatId);
                        if (producer && (producer.status === 'placed' || producer.status === 'animal_placed')) {
                            const prodSched = this.schedules[producer.key];
                            if (prodSched) {
                                let changed = false;
                                if (producer.type === 'Machine') {
                                    const alreadyInQueue = prodSched.queue.some(q => q.productId == missingMatId);
                                    if (!alreadyInQueue) {
                                        const prodItem = this.items.find(i => i.key === producer.key);
                                        const pData = prodItem.products[producer.productIndex];
                                        if (pData) {
                                            prodSched.queue.push({ productIndex: producer.productIndex, rawMaterialId: pData.rawMaterialId, productId: pData.productId, name: pData.name, target: 1, done: 0 });
                                            changed = true;
                                        }
                                    }
                                } else if (producer.type === 'Animal') {
                                    if (!prodSched.running && prodSched.targetCycles === 0) {
                                        prodSched.targetCycles = 1;
                                        changed = true;
                                    } else if (prodSched.targetCycles > 0) {
                                        prodSched.targetCycles++;
                                        changed = true;
                                    }
                                }
                                if (!prodSched.running) {
                                    prodSched.running = true;
                                    changed = true;
                                    this._log(`🔗 السلسلة الذكية: تم تشغيل ${producer.type === 'Machine' ? 'الآلة' : 'الحيوان'} لإنتاج طلب.`);
                                }
                                if (changed) {
                                    this._saveSchedules();
                                    this._renderMachines();
                                    this._renderAnimals();
                                }
                            }
                        }
                    }
                    this._updateBadge(key);
                    return;
                }
                
                try {
                    const p = item.products.find(prod => prod.index === next.productIndex);
                    if (p && p.reqMats && p.reqMats.length > 0 && gc._refillMapObject) {
                        for (let s = 0; s < p.reqMats.length; s++) {
                            const mId = p.reqMats[s].id;
                            const slotNum = s + 1;
                            try { gc._refillMapObject(mo, mId, slotNum, false); } catch(e) {}
                        }
                        this._updateBadge(key);
                        this._log(`▶ بدء ${item.name}: ${next.name}`);
                    } else {
                        const slot = 1;
                        const matId = next.rawMaterialId || (mo.getRawMaterialId ? mo.getRawMaterialId(slot) : null);
                        if (matId) { 
                            this._sendZeroGasRefill(mo, matId, slot);
                            this._updateBadge(key); 
                            this._log(`▶ بدء ${item.name}: ${next.name}`);
                        } else {
                            if (gc._clickMapObject) gc._clickMapObject(mo);
                            this._updateBadge(key);
                            this._log(`▶ بدء (نقرة) ${item.name}: ${next.name}`);
                        }
                    }
                } catch(e) {
                    this._log(`⚠️ خطأ في تشغيل ${item.name}`);
                }
            }
        } else {
            this._recalcQueueIdx(sched);
            const next = sched.queue[sched.currentQueueIdx];
            if (next && next.productIndex >= 0) {
                const curSel = parseInt(sd.selected_raw_material) || 0;
                if (curSel !== next.productIndex) {
                    this._log(`[Scheduler] ${item.name}: busy — pre-set next product: "${next.name}"`);
                    try { gw.NetUtils.enqueue('save_selected_material.save_data', { id: item.id, x: item.x, y: item.y, flip: 0, material: next.productIndex }); } catch(e) {}
                    sd.selected_raw_material = next.productIndex;
                    if (mo.selected_raw_material !== undefined) mo.selected_raw_material = next.productIndex;
                    if (typeof mo.setRawMaterial === "function") { try { mo.setRawMaterial(next.productIndex); } catch(e) {} }
                    try { gw.NetUtils.flush(); } catch(e) {}
                    this._updateBadge(key);
                }
            }
        }
    }

    _processAnimal(key, item, mo, sd, sched) {
        const gc = unsafeWindow.GF?.gameController;
        if (!gc) return;

        if (sched.targetCycles > 0 && sched.completedCycles >= sched.targetCycles) {
            sched.running = false;
            this._log(`🎉 ${item.name}: ${sched.completedCycles} دورة`);
            delete this.schedules[key];
            this._saveSchedules();
            this._renderAnimals(); this._updateBadge(key); return;
        }

        const hasProducts = typeof mo.can_collect === 'function' ? mo.can_collect() : false;
        if (hasProducts) {
            const now = Date.now();
            if (sched.__last_collect_time && now - sched.__last_collect_time < 15000) return;
            sched.__last_collect_time = now;
            
            try { 
                if (gc._collectMapObject) {
                    gc._collectMapObject(mo);
                } else if (mo.collect) {
                    mo.collect();
                }
            } catch(e) {}
            sched.completedCycles++;
            this._log(`📦 ${item.name}: دورة ${sched.completedCycles}`);
            this._renderAnimals(); this._updateBadge(key); return;
        }

        const needsFeed = sd.raw_materials === 0 || sd.raw_materials === '0' || sd.raw_materials === false;
        if (needsFeed) {
            try {
                const matId = mo.raw_material_id || mo.configData?.raw_material;
                if (matId) {
                    const invCount = this._getInventoryCount(matId);
                    if (invCount < 1) {
                        // SMART DEPENDENCY INJECTION
                        const producer = this._findMachineProducing(matId);
                        if (producer && (producer.status === 'placed' || producer.status === 'animal_placed')) {
                            const prodSched = this.schedules[producer.key];
                            if (prodSched) {
                                let changed = false;
                                if (producer.type === 'Machine') {
                                    const alreadyInQueue = prodSched.queue.some(q => q.productId == matId);
                                    if (!alreadyInQueue) {
                                        const prodItem = this.items.find(i => i.key === producer.key);
                                        const pData = prodItem.products[producer.productIndex];
                                        if (pData) {
                                            prodSched.queue.push({ productIndex: producer.productIndex, rawMaterialId: pData.rawMaterialId, productId: pData.productId, name: pData.name, target: 1, done: 0 });
                                            changed = true;
                                        }
                                    }
                                } else if (producer.type === 'Animal') {
                                    if (!prodSched.running && prodSched.targetCycles === 0) {
                                        prodSched.targetCycles = 1;
                                        changed = true;
                                    } else if (prodSched.targetCycles > 0) {
                                        prodSched.targetCycles++;
                                        changed = true;
                                    }
                                }
                                if (!prodSched.running) {
                                    prodSched.running = true;
                                    changed = true;
                                    this._log(`🔗 السلسلة الذكية: تم تشغيل ${producer.type === 'Machine' ? 'الآلة' : 'الحيوان'} لإنتاج طلب.`);
                                }
                                if (changed) {
                                    this._saveSchedules();
                                    this._renderMachines();
                                    this._renderAnimals();
                                }
                            }
                        }
                        sched.error = `ينتظر: ${this._getItemSourceHint(matId)}`;
                        this._updateBadge(key);
                        return;
                    } else {
                        sched.error = null;
                    }
                }
                if (matId && (!mo.canFeed || mo.canFeed())) { 
                    this._sendZeroGasFeed(mo, matId);
                }
            } catch(e) {}
        }
    }

    _sendZeroGasRefill(mo, matId, slot) {
        try {
            const gc = unsafeWindow.GF?.gameController;
            if (gc && typeof gc._refillMapObject === 'function') {
                gc._refillMapObject(mo, matId, slot, false);
            } else {
                const gw = unsafeWindow;
                if (gw.NetUtils && typeof gw.NetUtils.enqueue === 'function') {
                    const sd = mo.serverData || {};
                    const payload = {
                        id: mo.id || mo.configData?.id,
                        x: parseInt(sd.x || sd.map_x) || 0,
                        y: parseInt(sd.y || sd.map_y) || 0,
                        flip: mo.flip ? 1 : 0,
                        material: matId,
                        material_id: matId,
                        slot: slot
                    };
                    delete payload.isAuto; delete payload.automatic; delete payload.is_auto; delete payload.op_cost; delete payload.use_op;
                    gw.NetUtils.enqueue("refill_machine.save_data", payload);
                    if (mo.setRawMaterial) mo.setRawMaterial(matId, slot);
                }
            }
        } catch(e) {}
    }

    _sendZeroGasFeed(mo, matId) {
        try {
            const gc = unsafeWindow.GF?.gameController;
            if (gc && typeof gc._feedMapObject === 'function') {
                gc._feedMapObject(mo, matId, false);
            } else {
                const gw = unsafeWindow;
                if (gw.NetUtils && typeof gw.NetUtils.enqueue === 'function') {
                    const sd = mo.serverData || {};
                    const payload = {
                        id: mo.id || mo.configData?.id,
                        x: parseInt(sd.x || sd.map_x) || 0,
                        y: parseInt(sd.y || sd.map_y) || 0,
                        flip: mo.flip ? 1 : 0,
                        material: matId,
                        material_id: matId
                    };
                    delete payload.isAuto; delete payload.automatic; delete payload.is_auto; delete payload.op_cost; delete payload.use_op;
                    gw.NetUtils.enqueue("feed_animal.save_data", payload);
                    if (mo.feed) mo.feed(matId);
                }
            }
        } catch(e) {}
    }

    _findAllProducers(productId) {
        let producers = [];
        let placedDict = {};
        let counts = {};
        
        for (let i = 0; i < this.items.length; i++) {
            let itm = this.items[i];
            let isMatch = false;
            let pIdx = -1;
            if (itm.type === 'Machine' && itm.products) {
                pIdx = itm.products.findIndex(x => x.productId == productId);
                if (pIdx !== -1) isMatch = true;
            } else if (itm.type === 'Animal' && String(itm.productId) === String(productId)) {
                isMatch = true;
            }
            if (isMatch) {
                placedDict[itm.id] = true;
                counts[itm.id] = (counts[itm.id] || 0) + 1;
                let sched = this.schedules[itm.key];
                producers.push({ 
                    status: itm.type === 'Machine' ? 'placed' : 'animal_placed', 
                    type: itm.type,
                    name: itm.name, 
                    key: itm.key, 
                    id: itm.id, 
                    productIndex: pIdx,
                    isRunning: sched && sched.running
                });
            }
        }
        
        let currentCounts = {};
        producers.forEach(p => {
            let stateText = p.isRunning ? ' (تعمل)' : ' (متاحة)';
            if (counts[p.id] > 1) {
                currentCounts[p.id] = (currentCounts[p.id] || 0) + 1;
                p.name = `${p.name} #${currentCounts[p.id]}${stateText}`;
            } else {
                p.name = `${p.name}${stateText}`;
            }
        });

        try {
            const gw = unsafeWindow;
            const allItems = gw.ConfigData || (gw.Config && gw.Config.originData ? (gw.Config.originData.items || gw.Config.originData) : null);
            if (allItems) {
                for (let k in allItems) {
                    let cd = allItems[k];
                    if (!cd || !cd.product) continue;
                    let prods = typeof cd.product === 'string' ? cd.product.split(',') : (Array.isArray(cd.product) ? cd.product : [cd.product]);
                    if (!prods.some(pr => String(pr) === String(productId))) continue;
                    if (placedDict[cd.id]) continue;

                    const itemName = cd.name_ar || cd.name || `#${cd.id}`;
                    const type = (cd.type || '').toLowerCase();
                    const sub = (cd.sub_type || '').toLowerCase();
                    let status = 'missing';
                    if (type === 'animals' || sub === 'working') status = 'animal';
                    else if (type === 'trees') status = 'tree';
                    else if (type === 'seeds' || type === 'crops') status = 'seed';
                    producers.push({ status, type: status === 'animal' ? 'Animal' : 'Unknown', name: (status === 'animal' ? '🐄 ' : (status === 'tree' ? '🌳 ' : (status === 'seed' ? '🌱 ' : '⚙️ '))) + itemName, id: cd.id, productIndex: -1 });
                }
            }
        } catch(e) {}
        
        producers.sort((a, b) => {
            if (a.isRunning && !b.isRunning) return 1;
            if (!a.isRunning && b.isRunning) return -1;
            return 0;
        });

        return producers;
    }

    _findMachineProducing(productId) {
        const all = this._findAllProducers(productId);
        const placed = all.find(p => p.status === 'placed' || p.status === 'animal_placed');
        return placed || all[0] || { status: 'missing', name: '❓ مصدر غير معروف', id: null };
    }

    _addChainToQueue(key, prodIdx, targetQty, overrides = {}) {
        const item = this.items.find(i => i.key === key);
        if (!item || !item.products[prodIdx]) return;
        
        const p = item.products[prodIdx];
        
        // Dry-run to check if dependencies are already running
        const dependentKeys = [];
        this._collectDependencyKeys(p, targetQty, dependentKeys, overrides, false);
        
        const runningDeps = dependentKeys.filter(depKey => this.schedules[depKey] && this.schedules[depKey].running);
        if (runningDeps.length > 0) {
            const depNames = runningDeps.map(depKey => {
                const i = this.items.find(it => it.key === depKey);
                return i ? i.name : '';
            }).filter(Boolean).join('، ');
            
            const proceed = confirm(`هناك مصادر تعمل حالياً للجدولة المطلوبة:
${depNames}

هل تريد الإضافة للجدولة وتشغيلهم على أي حال؟`);
            if (!proceed) return;
        }

        // Apply to queue
        this._addToQueue(key, prodIdx, targetQty);
        
        dependentKeys.length = 0;
        this._collectDependencyKeys(p, targetQty, dependentKeys, overrides, true);
        
        this._startOne(key, true);
        
        dependentKeys.forEach(depKey => {
            const s = this.schedules[depKey];
            if (s) {
                if (s.queue && s.queue.length > 0) this._startOne(depKey, true);
                else if (s.targetCycles !== undefined) this._startOne(depKey, true);
            }
        });
        
        this._log(`تم الجدولة الذكية بنجاح وتفعيل المصادر المرتبطة.`);
    }

    _collectDependencyKeys(productConfig, targetQty, resultKeys, overrides = {}, applyToQueue = true) {
        if (!productConfig.reqMats) return;
        
        productConfig.reqMats.forEach(rm => {
            let producerKey = overrides[rm.id];
            let producer = null;
            if (producerKey) {
                const pItem = this.items.find(i => i.key === producerKey);
                if (pItem) {
                    producer = { key: pItem.key, status: pItem.type === 'Animal' ? 'animal_placed' : 'placed' };
                }
            } 
            if (!producer) {
                producer = this._findMachineProducing(rm.id);
            }

            if (producer && (producer.status === 'placed' || producer.status === 'animal_placed')) {
                const pItem = this.items.find(i => i.key === producer.key);
                if (pItem) {
                    if (pItem.type === 'Machine') {
                        const childProdIdx = pItem.products.findIndex(x => x.productId == rm.id);
                        if (childProdIdx !== -1) {
                            if (applyToQueue) this._addToQueue(producer.key, childProdIdx, targetQty);
                            if (!resultKeys.includes(producer.key)) resultKeys.push(producer.key);
                            this._collectDependencyKeys(pItem.products[childProdIdx], targetQty, resultKeys, overrides, applyToQueue);
                        }
                    } else if (pItem.type === 'Animal') {
                        if (applyToQueue) {
                            if (!this.schedules[producer.key]) this.schedules[producer.key] = { queue: [], running: false, completedCycles: 0, targetCycles: 0 };
                            // Accumulate target correctly (or set to infinite if 0)
                            const s = this.schedules[producer.key];
                            if (targetQty > 0) {
                                if (s.targetCycles > 0 || !s.running) {
                                    s.targetCycles = Math.max(s.targetCycles, s.completedCycles) + targetQty;
                                }
                            } else {
                                s.targetCycles = 0;
                            }
                        }
                        if (!resultKeys.includes(producer.key)) resultKeys.push(producer.key);
                        if (pItem.reqMats && pItem.reqMats.length > 0) {
                            this._collectDependencyKeys({ reqMats: pItem.reqMats }, targetQty, resultKeys, overrides, applyToQueue);
                        }
                    }
                }
            }
        });
    }


    _getInventoryCount(id) {
        if (!id) return 0;
        let count = 0;
        const gw = unsafeWindow;
        
        try {
            let rc = gw.Config?.Store_GetItemData ? gw.Config.Store_GetItemData(id) : null;
            if (rc && (rc.product || rc.product_id)) {
                id = rc.product || rc.product_id;
            }
        } catch(e) {}
        
        try {
            if (gw.GF?.loginModel && typeof gw.GF.loginModel.getStorageQtyById === 'function') {
                const c = gw.GF.loginModel.getStorageQtyById(id);
                if (c !== undefined && c !== null) count = Math.max(count, parseInt(c) || 0);
            }
        } catch(e) {}
        
        try {
            const sd = gw.GF?.loginModel?.AppData?.storage;
            if (sd && sd[id] !== undefined) {
                count = Math.max(count, parseInt(sd[id]) || 0);
            }
        } catch(e) {}
        
        try {
            const sd = gw.GF?.loginModel?.AppData?.items;
            if (sd) {
                if (Array.isArray(sd)) {
                    const it = sd.find(i => String(i.id) === String(id));
                    if (it) count = Math.max(count, parseInt(it.count) || 0);
                } else if (sd[id]) {
                    count = Math.max(count, parseInt(sd[id].count || sd[id]) || 0);
                }
            }
        } catch(e) {}
        
        try {
            const bag = gw.App?.ControllerManager?.getControllerModel("Bag");
            if (bag && typeof bag.getItemCount === 'function') {
                const c = bag.getItemCount(id);
                if (c !== undefined && c !== null) count = Math.max(count, parseInt(c) || 0);
            }
        } catch(e) {}
        
        return count;
    }

    _getItemSourceHint(id) {
        try {
            const pool = unsafeWindow.GF?.shopController?.shopModel?._allMachine || [];
            const cd = pool.find(x => x.id == id);
            if (cd) return cd.name || 'مكون مطلوب';
            const gw = unsafeWindow;
            const cfg = gw.Config?.Store_GetItemData ? gw.Config.Store_GetItemData(id) : null;
            if (cfg) return cfg.name || cfg.localeName || 'مجهول';
        } catch(e) {}
        return 'مكون مطلوب';
    }

    _getItemBuyInfo(cd) {
        if (!cd) return { where: '🛒 المتجر', priceText: '' };
        const type = cd.type || '';
        const subType = cd.sub_type || '';
        let where = '🛒 المتجر';
        if (type === 'animals') where = '🐄 متجر الحيوانات';
        else if (type === 'buildings' && subType === 'working') where = '🏭 المتجر - الآلات';
        else if (type === 'buildings') where = '🏗️ المتجر - المباني';
        let priceText = '';
        if (cd.rp_price) priceText = `${cd.rp_price} 💎`;
        else if (cd.price) priceText = `${cd.price} 🪙`;
        if (cd.level > 1) priceText += ` (LV${cd.level}+)`;
        return { where, priceText };
    }

    _getItemIconUrl(itemId, fallbackEmoji = '⚙️', size = 24) {
        if (!itemId) return fallbackEmoji;
        this._imgLoadQueue = this._imgLoadQueue || [];
        const imgId = `sf-ps-img-${itemId}-${Math.random().toString(36).substring(2, 9)}`;
        this._imgLoadQueue.push({ id: imgId, itemId: itemId, fallback: fallbackEmoji });
        return `<img id="${imgId}" src="" style="width:${size}px;height:${size}px;object-fit:contain;" onerror="this.outerHTML='${fallbackEmoji}'">`;
    }

    _processImgQueue() {
        if (!this._imgLoadQueue || this._imgLoadQueue.length === 0) return;
        const tasks = [...this._imgLoadQueue];
        this._imgLoadQueue = [];
        const gw = unsafeWindow;
        if (!gw.Url || !gw.RES) return;

        tasks.forEach(task => {
            try {
                let resKey = gw.Url.Store_GetUrl_75 ? gw.Url.Store_GetUrl_75(task.itemId) : gw.Url.Store_GetUrl_100(task.itemId);
                gw.RES.getResAsync(resKey, function(texture) {
                    let el = document.getElementById(task.id);
                    if (!el) return;
                    if (texture && texture.toDataURL) {
                        el.src = texture.toDataURL("image/png");
                    } else {
                        let path = gw.Url.getImagePath(resKey);
                        if (path) {
                            gw.RES.getResAsync(path, function(tex2) {
                                if (tex2 && tex2.toDataURL) el.src = tex2.toDataURL("image/png");
                                else el.outerHTML = task.fallback;
                            }, this);
                        } else {
                            el.outerHTML = task.fallback;
                        }
                    }
                }, this);
            } catch(e) {
                let el = document.getElementById(task.id);
                if (el) el.outerHTML = task.fallback;
            }
        });
    }


    _getFreshMO(item) {
        try {
            const dict = unsafeWindow.GameGridData?.uidDictionary;
            if (!dict) return null;
            if (item.uid && dict[item.uid]) return dict[item.uid];
            if (item.mo && item.mo.map_unique_id && dict[item.mo.map_unique_id]) {
                item.uid = item.mo.map_unique_id;
                return dict[item.uid];
            }
            return Object.values(dict).find(mo => {
                if (!mo) return false;
                const cd = mo.configData || {};
                const sd = mo.serverData || {};
                if ((cd.id || mo.id) === item.id && (parseInt(sd.x || sd.map_x) || 0) === item.x && (parseInt(sd.y || sd.map_y) || 0) === item.y) {
                    item.uid = mo.map_unique_id;
                    return true;
                }
                return false;
            }) || null;
        } catch(e) { return null; }
    }

    // ═══════════════════════════════════════
    // FAVORITES
    // ═══════════════════════════════════════
    _toggleFavorite(key) {
        if (this.favorites[key]) {
            delete this.favorites[key];
        } else {
            this.favorites[key] = true;
        }
        this._saveSchedules();
        this._renderMachines();
        this._renderAnimals();
    }

    // ═══════════════════════════════════════
    // NAVIGATE TO ITEM
    // ═══════════════════════════════════════
    _navigateByMaterialId(matId) {
        if (!matId) return;
        const producer = this._findMachineProducing(matId);
        if (!producer || producer.status === 'unknown') {
            this._log(`❓ لا يوجد مصدر معروف للمادة.`);
            return;
        }

        if (producer.status === 'placed' || producer.status === 'animal_placed') {
            const item = this.items.find(i => i.key === producer.key);
            if (item) {
                const c = this.container;
                if (item.type === 'Machine') {
                    if (c) { const tab = c.querySelector('#sf-ps-tab-machines'); if (tab) tab.click(); }
                    this.activeMachineKey = item.key;
                    this._renderMachines();
                } else if (item.type === 'Animal') {
                    if (c) { const tab = c.querySelector('#sf-ps-tab-animals'); if (tab) tab.click(); }
                    const searchInput = c?.querySelector('#sf-ps-search-animal');
                    if (searchInput) {
                        searchInput.value = item.name;
                        this._filterList('animal', item.name);
                    }
                }
                this._navigateToItem(item);
            }
        } else {
            // Missing machine, animal, tree, or seed
            if (producer.id) {
                this._navigateToItem({ id: producer.id, name: producer.name });
            } else {
                this._log(`❓ المصدر غير موجود في المتجر.`);
            }
        }
    }

    _navigateToItem(item) {
        const gw = unsafeWindow;
        const mo = this._getFreshMO(item);

        // 1. الآلة موجودة على الخريطة — انتقل إليها
        if (mo) {
            try {
                const gc = gw.GF?.gameController;
                if (gc && typeof gc._clickMapObject === 'function') {
                    gc._clickMapObject(mo);
                    this._log(`🎯 انتقل إلى: ${item.name}`);
                    return;
                }
            } catch(e) {}
            try {
                const mapCtrl = gw.GF?.mapController;
                if (mapCtrl && typeof mapCtrl.centerOnObject === 'function') {
                    mapCtrl.centerOnObject(mo);
                    this._log(`🎯 تمت المركزة على: ${item.name}`);
                    return;
                }
                if (mapCtrl && typeof mapCtrl.panTo === 'function') {
                    mapCtrl.panTo(item.x, item.y);
                    this._log(`🎯 تمت المركزة على: ${item.name} (${item.x}, ${item.y})`);
                    return;
                }
            } catch(e) {}
            this._log(`🎯 ${item.name} موجود في الموقع (${item.x}, ${item.y})`);
            return;
        }

        // 2. غير موجود على الخريطة — ابحث في كتالوج اللعبة
        try {
            const pool = gw.GF?.shopController?.shopModel?._allMachine || [];
            const cd = pool.find(x => x.id == item.id);
            if (cd) {
                const info = this._getItemBuyInfo(cd);
                this._log(`🛒 ${item.name} غير موضوع — ${info.where} | السعر: ${info.priceText}`);
                // حاول فتح المتجر
                try {
                    const sc = gw.GF?.shopController;
                    if (sc) {
                        const openFns = ['openShop', 'showShop', 'openStore', 'show'];
                        for (const fn of openFns) {
                            if (typeof sc[fn] === 'function') {
                                sc[fn](cd.id);
                                this._log(`🏪 تم فتح المتجر على: ${item.name}`);
                                break;
                            }
                        }
                    }
                } catch(e2) {}
                return;
            }
        } catch(e) {}

        // 3. Fallback — فحص المستودع
        if (item.id) {
            const count = this._getInventoryCount(item.id);
            if (count > 0) {
                this._log(`📦 ${item.name} موجود في المستودع (${count} قطعة)`);
            } else {
                this._log(`❓ ${item.name} غير موجود على الأرض ولا في المستودع`);
            }
        }
    }
};

// Register module
SF.modules.register(new SF.ProductionSchedulerModule());



// --- File: features/CustomBackgroundModule.js ---
// --- features/CustomBackgroundModule.js ---
window.SF = window.SF || {};

SF.CustomBackgroundModule = class CustomBackgroundModule {
    constructor() {
        this.base64Img = "data:image/jpeg;base64,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";
        this.injectBackground();
    }
    
    injectBackground() {
        // 1. Inject CSS for common background containers (letterboxing areas)
        const style = document.createElement('style');
        style.textContent = `
            body, html, #GameDiv, .egret-player, #loading, #bgDiv, #splash {
                background-image: url('${this.base64Img}') !important;
                background-size: cover !important;
                background-position: center center !important;
                background-repeat: no-repeat !important;
            }
        `;
        
        if (document.head) {
            document.head.appendChild(style);
        } else {
            document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style));
        }

        // Targeted Background Replacement
        const isBgUrl = (url) => {
            if (typeof url !== 'string') return false;
            const u = url.toLowerCase();
            return u.includes('preloaderbg.webp') || u.includes('loaderskin_bg.webp') || u.includes('login.webp');
        };

        // 1. Intercept Image loading (covers both Image.prototype and HTMLImageElement.prototype)
        const proto = typeof HTMLImageElement !== 'undefined' ? HTMLImageElement.prototype : (typeof Image !== 'undefined' ? Image.prototype : null);
        
        if (proto) {
            const originalImageSrc = Object.getOwnPropertyDescriptor(proto, 'src');
            if (originalImageSrc && originalImageSrc.set) {
                const self = this;
                Object.defineProperty(proto, 'src', {
                    set: function(val) {
                        let newVal = val;
                        if (isBgUrl(val)) {
                            newVal = self.base64Img;
                            console.log('[SupremeFarm] Intercepted Image.src background:', val);
                        }
                        return originalImageSrc.set.call(this, newVal);
                    },
                    get: function() {
                        return originalImageSrc.get.call(this);
                    }
                });
            }
        }

        // 2. Intercept XHR open to rewrite URLs (just in case Egret uses XHR for WebGL textures)
        const origXhrOpen = window.XMLHttpRequest.prototype.open;
        const self = this;
        window.XMLHttpRequest.prototype.open = function(method, url) {
            let newUrl = url;
            if (isBgUrl(url)) {
                newUrl = self.base64Img;
                console.log('[SupremeFarm] Intercepted XHR background:', url);
            }
            return origXhrOpen.apply(this, [method, newUrl, ...Array.from(arguments).slice(2)]);
        };

        // 3. Intercept Fetch to rewrite URLs
        if (window.fetch) {
            const origFetch = window.fetch;
            window.fetch = function() {
                const args = Array.from(arguments);
                let url = args[0] instanceof Request ? args[0].url : args[0];
                if (isBgUrl(url)) {
                    console.log('[SupremeFarm] Intercepted Fetch background:', url);
                    if (args[0] instanceof Request) {
                        args[0] = new Request(self.base64Img, args[0]);
                    } else {
                        args[0] = self.base64Img;
                    }
                }
                return origFetch.apply(this, args);
            };
        }
    }
};

new SF.CustomBackgroundModule();


// --- File: features/AMFProbeModule.js ---
window.SF = window.SF || {};

SF.AMFProbeModule = class extends SF.ModuleBase {
    constructor() {
        super('amf_probe', 'AMF Probe (Debug)', 'fa-bug');
        this.recordedActions = [];
        this.injectHook();
    }

    injectHook() {
        const checkAndHook = () => {
            const gw = unsafeWindow;
            if (gw.NetUtils && gw.NetUtils.enqueue && !gw.NetUtils._sf_hooked) {
                const origEnqueue = gw.NetUtils.enqueue;
                gw.NetUtils.enqueue = function(action, params, successCb, failCb) {
                    if (action && typeof action === 'string' && !action.includes('login.login') && !action.includes('activity.check') && !action.includes('friend.get') && !action.includes('chat.')) {
                        SF.bus.emit('amf:intercepted', { action: action, params: params });
                    }
                    return origEnqueue.apply(this, arguments);
                };
                gw.NetUtils._sf_hooked = true;
                console.log('[SF Probe] NetUtils.enqueue hooked!');
            }
        };

        if (document.body) checkAndHook();
        setInterval(checkAndHook, 2000);

        SF.bus.on('amf:intercepted', (data) => {
            this.recordedActions.push(data);
            if (this.recordedActions.length > 20) this.recordedActions.shift();
            this.update();
        });
    }

    render() {
        return `
            <div style="padding:15px; direction:rtl;">
                <h3 style="color:#e74c3c; margin-bottom:15px;">🔍 جهاز رصد أوامر اللعبة (Probe)</h3>
                <p style="color:#aaa; font-size:13px;">قم بدمج عنصر واحد في خريطة "رحلة إلى أوراسيا" وسوف يظهر كود الأمر هنا فوراً لاستخلاصه:</p>
                <button id="sf-scan-merge" style="background:#3498db; color:#fff; border:none; padding:8px 12px; border-radius:5px; cursor:pointer; margin-bottom:10px;">فحص متغيرات اللعبة (Merge Scan)</button>
                <div id="sf-probe-logs" style="background:#111; padding:10px; border-radius:8px; max-height:400px; overflow-y:auto; font-family:monospace; direction:ltr; text-align:left;">
                    <div style="color:#777;">Waiting for actions...</div>
                </div>
            </div>
        `;
    }

    bindEvents() {
        const c = this.container;
        if (!c) return;
        const btn = c.querySelector('#sf-scan-merge');
        if (btn) {
            btn.addEventListener('click', () => {
                const gw = unsafeWindow;
                let found = [];
                for (let key in gw) {
                    if (typeof key === 'string' && key.toLowerCase().includes('merge')) {
                        found.push(key);
                    }
                }
                
                // Also check GF object
                let gfFound = [];
                if (gw.GF) {
                    for (let key in gw.GF) {
                        if (typeof key === 'string' && key.toLowerCase().includes('merge')) {
                            gfFound.push('GF.' + key);
                        }
                    }
                }
                
                this.recordedActions.push({
                    action: 'SCAN_RESULT',
                    params: { window: found, GF: gfFound }
                });
                this.update();
            });
        }
    }

    update() {
        const c = this.container;
        if (!c) return;
        const logsDiv = c.querySelector('#sf-probe-logs');
        if (!logsDiv) return;

        if (this.recordedActions.length === 0) {
            logsDiv.innerHTML = '<div style="color:#777;">Waiting for actions...</div>';
            return;
        }

        logsDiv.innerHTML = this.recordedActions.slice().reverse().map(req => {
            return `
                <div style="margin-bottom:10px; border-bottom:1px solid #333; padding-bottom:5px;">
                    <div style="color:#2ecc71; font-weight:bold;">${req.action}</div>
                    <pre style="color:#3498db; font-size:11px; margin:5px 0;">${JSON.stringify(req.params || {}, null, 2)}</pre>
                </div>
            `;
        }).join('');
    }
};

SF.modules.register(new SF.AMFProbeModule());


// --- File: features/MergeAutoPlayModule.js ---
window.SF = window.SF || {};

SF.MergeAutoPlayModule = class extends SF.ModuleBase {
    constructor() {
        super('merge_autoplay', 'روبوت الدمج (Auto Merge)', 'fa-magic');
        this.isRunning = false;
        this.loopTimer = null;
        this.mapId = 1;
        this.floatingPanel = null;
        this.pendingMerges = new Set();
        
        SF.bus.on('amf:intercepted', (data) => {
            if (data.action && data.action.includes('Merge') && data.params && data.params.mapId) {
                this.mapId = data.params.mapId;
            }
        });

        this.initFloatingPanel();
    }

    initFloatingPanel() {
        if (this.floatingPanel) return;

        const panel = document.createElement('div');
        panel.id = 'sf-merge-floating-panel';
        panel.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 300px;
            background: rgba(30, 30, 30, 0.95);
            border: 2px solid #3498db;
            border-radius: 12px;
            padding: 15px;
            z-index: 99999;
            color: white;
            direction: rtl;
            box-shadow: 0 0 15px rgba(0,0,0,0.5);
            display: none; /* Hidden by default */
            transition: opacity 0.3s;
        `;
        
        panel.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #444; padding-bottom:10px; margin-bottom:10px;">
                <h3 style="margin:0; color:#3498db; font-size:16px;">🤖 روبوت الدمج الذكي</h3>
                <span id="sf-merge-status" style="color:#e74c3c; font-size:12px; font-weight:bold;">متوقف</span>
            </div>
            
            <div style="margin-bottom:10px;">
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px;">
                    <input type="radio" name="sf_merge_mode" value="merge_all" checked> 
                    <span>دمج كل شيء (أقصى مستوى)</span>
                </label>
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; margin-top:5px;">
                    <input type="radio" name="sf_merge_mode" value="orders_only"> 
                    <span>إنهاء الطلبات فقط (ذكي)</span>
                </label>
            </div>

            <div style="display:flex; gap:10px;">
                <button id="sf-merge-start" style="flex:1; background:#2ecc71; color:white; border:none; padding:8px; border-radius:5px; cursor:pointer; font-weight:bold;">▶ تشغيل</button>
                <button id="sf-merge-stop" style="flex:1; background:#e74c3c; color:white; border:none; padding:8px; border-radius:5px; cursor:pointer; font-weight:bold; display:none;">⏹ إيقاف</button>
            </div>
            
            <div id="sf-merge-hint" style="margin-top:10px; font-size:11px; color:#aaa; text-align:center;">
                جاهز للعمل...
            </div>
        `;
        
        document.body.appendChild(panel);
        this.floatingPanel = panel;

        // Auto-detect if merge map is open
        setInterval(() => {
            const mapDict = this.findMapDictionary();
            if (mapDict) {
                if (panel.style.display === 'none') {
                    panel.style.display = 'block';
                    panel.style.opacity = '1';
                }
            } else {
                if (panel.style.display === 'block') {
                    panel.style.opacity = '0';
                    setTimeout(() => panel.style.display = 'none', 300);
                    if (this.isRunning) panel.querySelector('#sf-merge-stop').click();
                }
            }
        }, 1500);

        // Bind panel events
        panel.querySelector('#sf-merge-start').addEventListener('click', () => {
            const mode = panel.querySelector('input[name="sf_merge_mode"]:checked').value;
            this.startSmartBot(mode);
            panel.querySelector('#sf-merge-start').style.display = 'none';
            panel.querySelector('#sf-merge-stop').style.display = 'block';
            panel.querySelector('#sf-merge-status').innerText = 'يعمل...';
            panel.querySelector('#sf-merge-status').style.color = '#2ecc71';
        });

        panel.querySelector('#sf-merge-stop').addEventListener('click', () => {
            this.stopSmartBot();
            panel.querySelector('#sf-merge-stop').style.display = 'none';
            panel.querySelector('#sf-merge-start').style.display = 'block';
            panel.querySelector('#sf-merge-status').innerText = 'متوقف';
            panel.querySelector('#sf-merge-status').style.color = '#e74c3c';
            panel.querySelector('#sf-merge-hint').innerText = 'تم الإيقاف.';
        });
    }

    render() {
        return `
            <div style="padding:15px; direction:rtl;">
                <h3 style="color:#3498db;">روبوت الدمج الذكي مفعّل</h3>
                <p style="color:#aaa; font-size:13px;">تم نقل هذه الأداة لتظهر مباشرة كشاشة عائمة (نافذة ذكية) <b>فقط عندما تقوم بفتح خريطة الدمج</b>.</p>
                <p style="color:#e67e22; font-size:13px;">لتفعيل خيار "إنهاء الطلبات فقط"، نحتاج منك إكمال <b>طلب واحد بيدك</b> بينما الرادار يعمل لكي يتعلم الروبوت أمر تسليم الطلبات الخاص بحسابك.</p>
            </div>
        `;
    }
    
    bindEvents() {}
    update() {}

    startSmartBot(mode) {
        if (this.isRunning) return;
        this.isRunning = true;
        
        this.loopTimer = setInterval(() => {
            const mapDict = this.findMapDictionary();
            const hint = this.floatingPanel.querySelector('#sf-merge-hint');
            
            if (!mapDict) {
                this.stopSmartBot();
                return;
            }

            if (mode === 'merge_all') {
                hint.innerText = 'جاري دمج كل العناصر المتاحة...';
                this.doMergeAll(mapDict);
            } else if (mode === 'orders_only') {
                hint.innerText = 'جاري فحص الخريطة لتسليم الطلبات...';
                this.doOrders(model, mapDict);
            }
            
        }, 1500); // Check every 1.5 seconds to prevent server out of sync
    }

    stopSmartBot() {
        this.isRunning = false;
        if (this.loopTimer) clearInterval(this.loopTimer);
        this.loopTimer = null;
        this.pendingMerges.clear();
    }

    doOrders(model, mapDict) {
        try {
            let orders = model.currOrder || (model.mgData ? model.mgData.order : null) || model.orders || model.orderData;
            
            if (!orders || !Array.isArray(orders)) {
                this.log('لم يتم العثور على قائمة الطلبات في الذاكرة!', true);
                return;
            }

            let orderSubmitted = false;
            let allNeededIds = new Set();
            
            // First pass: collect all needed IDs across all active orders
            for (let order of orders) {
                if (!order || !order.item) continue;
                const itemStr = String(order.item);
                const neededIds = itemStr.split(',').map(s => Number(s));
                for (let id of neededIds) {
                    allNeededIds.add(id);
                }
            }
            
            for (let order of orders) {
                if (!order || !order.item) continue;
                
                const itemStr = String(order.item);
                const neededIds = itemStr.split(',').map(s => Number(s));
                let foundTags = [];
                
                for (let reqId of neededIds) {
                    let foundTag = null;
                    for (let key in mapDict) {
                        if (key.match(/^\d+_\d+$/)) {
                            if (this.pendingMerges.has(key)) continue;
                            const item = mapDict[key];
                            // Must NOT be locked
                            if (item && item.id === reqId && !item.lock && !item.isLock && !foundTags.includes(key)) {
                                foundTag = key;
                                break;
                            }
                        }
                    }
                    if (foundTag) {
                        foundTags.push(foundTag);
                    }
                }
                
                // If all items are available
                if (foundTags.length === neededIds.length) {
                    this.log(`الطلب [${order.index}] جاهز! جاري التسليم...`);
                    
                    const gw = unsafeWindow;
                    const controller = gw.GF.mG3GreeceMergeController || gw.GF.mgMergeController || gw.GF.mergeNewController || gw.GF.mergeController;
                    
                    if (controller) {
                        if (typeof controller.finishOrder === 'function') {
                            controller.finishOrder(order.index);
                        } else if (typeof controller.sendFinishOrder === 'function') {
                            controller.sendFinishOrder(order.index);
                        } else {
                            const endpoint = this.mapId >= 90000 ? "MergeGame/GreeceMerge" : "MergeGame/Merge";
                            gw.NetUtils.enqueue(endpoint, {
                                action: "finishOrder",
                                index: order.index,
                                mapId: this.mapId
                            });
                        }
                    }

                    for (let tag of foundTags) {
                        this.pendingMerges.add(tag);
                    }
                    
                    orderSubmitted = true;
                    return; // Do one order per tick
                }
            }

            if (!orderSubmitted) {
                const hint = this.floatingPanel.querySelector('#sf-merge-hint');
                hint.innerText = 'جاري دمج العناصر لتوفير طلباتك...';
                this.doMergeAll(mapDict, allNeededIds);
            }
        } catch (e) {
            this.log('خطأ أثناء قراءة الطلبات: ' + e.message, true);
        }
    }
            
    doMergeAll(mapDict, protectedIds = new Set()) {
        const unlockedItems = {};
        const lockedItems = {};
        
        for (let pos of this.pendingMerges) {
            if (!mapDict[pos]) this.pendingMerges.delete(pos);
        }

        for (let key in mapDict) {
            if (key.match(/^\d+_\d+$/)) {
                if (this.pendingMerges.has(key)) continue;
                
                const item = mapDict[key];
                if (item && typeof item === 'object' && item.id) {
                    // DO NOT merge this item if it is actively needed by an order!
                    // This prevents merging an item that we have prepared for a task.
                    if (protectedIds.has(item.id)) {
                        continue;
                    }

                    // Separate locked (ice) and unlocked items
                    if (item.lock === 1 || item.isLock || item.locked) {
                        if (!lockedItems[item.id]) lockedItems[item.id] = [];
                        lockedItems[item.id].push(key);
                    } else {
                        if (!unlockedItems[item.id]) unlockedItems[item.id] = [];
                        unlockedItems[item.id].push(key);
                    }
                }
            }
        }

        for (let id in unlockedItems) {
            const freePos = unlockedItems[id];
            
            // Priority 1: Merge free item into a locked item (frees the ice block)
            if (lockedItems[id] && lockedItems[id].length > 0) {
                const from = freePos[0];
                const to = lockedItems[id][0];
                
                this.pendingMerges.add(from);
                this.pendingMerges.add(to);
                
                this.sendAction("move", from, to, () => {
                    this.pendingMerges.delete(from);
                    this.pendingMerges.delete(to);
                });
                return;
            }
            
            // Priority 2: Merge two free items
            if (freePos.length >= 2) {
                const from = freePos[0];
                const to = freePos[1];
                
                this.pendingMerges.add(from);
                this.pendingMerges.add(to);
                
                this.sendAction("move", from, to, () => {
                    this.pendingMerges.delete(from);
                    this.pendingMerges.delete(to);
                });
                return;
            }
        }

        // Priority 3: Tap a Generator if we have empty space
        let emptyCount = 0;
        let emptyPos = null;
        for (let r = 0; r < 7; r++) {
            for (let c = 0; c < 9; c++) {
                if (!mapDict[r + "_" + c] || Object.keys(mapDict[r + "_" + c]).length === 0) {
                    emptyCount++;
                    emptyPos = r + "_" + c;
                }
            }
        }

        if (emptyCount > 0 && emptyPos) {
            for (let key in mapDict) {
                if (key.match(/^\d+_\d+$/)) {
                    let item = mapDict[key];
                    // Generators usually have a 'qty' property representing their charges
                    if (item && item.qty !== undefined && item.qty > 0) {
                        this.log(`جاري الضغط على المولد...`);
                        
                        // Attempt to extract newId from production pool or noLuckId
                        let predictedId = item.noLuckId || 0;
                        try {
                            const pool = model.mgData?.production_pool?.[item.id];
                            if (pool) {
                                const arr = pool[item.level || 1] || pool[Object.keys(pool)[0]];
                                if (arr && arr.length > 0) predictedId = arr[0];
                            }
                        } catch (e) {}

                        const endpoint = this.mapId >= 90000 ? "MergeGame/GreeceMerge" : "MergeGame/Merge";
                        const gw = unsafeWindow;
                        
                        gw.NetUtils.enqueue(endpoint, {
                            action: "production",
                            from: key,
                            to: emptyPos,
                            newId: predictedId,
                            mapId: this.mapId
                        });
                        
                        return; // One tap per tick
                    }
                }
            }
        }
    }

    findMapDictionary() {
        const gw = unsafeWindow;
        if (!gw.GF) return null;

        const models = [
            gw.GF.mgMergeModel, gw.GF.mergeNewModel, gw.GF.merge3Model, 
            gw.GF.mG3GreeceMergeModel, gw.GF.mergeModel, gw.GF.merge2Model
        ];

        for (let model of models) {
            if (!model) continue;
            let queue = [model];
            let visited = new Set();
            
            while(queue.length > 0) {
                let obj = queue.shift();
                if (visited.has(obj)) continue;
                visited.add(obj);
                
                if (obj && typeof obj === 'object') {
                    let hasCoords = false;
                    for (let k in obj) {
                        if (k.match(/^\d+_\d+$/) && obj[k] && typeof obj[k] === 'object' && obj[k].id !== undefined) {
                            hasCoords = true;
                            break;
                        }
                    }
                    if (hasCoords) return obj;
                    
                    if (visited.size < 100) {
                        for (let k in obj) {
                            if (obj[k] && typeof obj[k] === 'object' && !k.startsWith('_')) {
                                queue.push(obj[k]);
                            }
                        }
                    }
                }
            }
        }
        return null;
    }

    sendAction(actionType, from, to, successCb) {
        const gw = unsafeWindow;
        if (!gw.NetUtils || !gw.NetUtils.enqueue) return;

        const payload = {
            action: actionType,
            from: from,
            to: to,
            mapId: this.mapId
        };
        
        let endpoint = "MergeGame/Merge";
        // From AMF logs: Greece map (90001) uses MergeGame/GreeceMerge for production!
        if (this.mapId >= 90000 && actionType === 'production') {
            endpoint = "MergeGame/GreeceMerge";
        }
        
        gw.NetUtils.enqueue(endpoint, payload, () => {
            if (successCb) successCb();
        }, () => {
            if (successCb) successCb(); // clear pending even on fail
        });
    }
};

SF.modules.register(new SF.MergeAutoPlayModule());


// --- File: features/MergeDumperModule.js ---
window.SF = window.SF || {};

SF.MergeDumperModule = class extends SF.ModuleBase {
    constructor() {
        super('merge_dumper', 'كاشف أسرار الدمج (Dumper)', 'fa-bug');
        this.dumped = false;
    }

    render() {
        return `
            <div style="padding:15px; direction:rtl; text-align:right;">
                <h3 style="color:#e74c3c; margin-bottom:10px;"><i class="fa fa-bug"></i> أداة كشف أسرار خريطة الدمج</h3>
                <p style="color:#aaa; font-size:13px; margin-bottom:15px;">
                    هذه الأداة تقوم باستخراج ملف يحتوي على أسرار الخريطة بالكامل (خصائص العناصر، الطلبات المخفية) لكي أتمكن من برمجة خاصية "تسليم الطلبات" بذكاء دقيق.
                </p>
                <button id="sf-dump-btn" class="sf-btn" style="width:100%; background:#8e44ad; margin-bottom:10px;">
                    <i class="fa fa-download"></i> استخراج وتحميل الأسرار
                </button>
                <div id="sf-dump-status" style="color:#2ecc71; font-size:12px; display:none;">تم التحميل بنجاح! ارسل لي محتوى الملف.</div>
            </div>
        `;
    }

    bindEvents() {
        const c = this.container;
        if (!c) return;
        
        c.querySelector('#sf-dump-btn').addEventListener('click', () => {
            const gw = unsafeWindow;
            const models = [
                gw.GF?.mgMergeModel, gw.GF?.mergeNewModel, gw.GF?.merge3Model, 
                gw.GF?.mG3GreeceMergeModel, gw.GF?.mergeModel, gw.GF?.merge2Model
            ];
            
            let targetModel = null;
            let targetDict = null;

            for (let model of models) {
                if (!model) continue;
                let queue = [model];
                let visited = new Set();
                while(queue.length > 0) {
                    let obj = queue.shift();
                    if (visited.has(obj)) continue;
                    visited.add(obj);
                    if (obj && typeof obj === 'object') {
                        let hasCoords = false;
                        for (let k in obj) {
                            if (k.match(/^\d+_\d+$/) && obj[k] && typeof obj[k] === 'object' && obj[k].id !== undefined) {
                                hasCoords = true;
                                break;
                            }
                        }
                        if (hasCoords) {
                            targetModel = model;
                            targetDict = obj;
                            break;
                        }
                        if (visited.size < 100) {
                            for (let k in obj) {
                                if (obj[k] && typeof obj[k] === 'object' && !k.startsWith('_')) {
                                    queue.push(obj[k]);
                                }
                            }
                        }
                    }
                }
                if (targetDict) break;
            }

            if (!targetDict) {
                alert("لم يتم العثور على الخريطة! يرجى فتح خريطة أوراسيا أولاً.");
                return;
            }

            // Extract Orders
            let orders = targetModel.orders || targetModel.orderData || targetModel.orderList || targetModel.tasks || targetModel.taskList;
            if (!orders) {
                for (let k in targetModel) {
                    if (Array.isArray(targetModel[k]) && targetModel[k].length > 0 && targetModel[k][0].hasOwnProperty('rewards')) {
                        orders = targetModel[k];
                        break;
                    }
                }
            }

            // Extract a sample item
            let sampleItemKeys = [];
            let sampleItemFull = {};
            for (let k in targetDict) {
                if (k.match(/^\d+_\d+$/)) {
                    sampleItemKeys = Object.keys(targetDict[k]);
                    // deep clone to avoid circular
                    try {
                        sampleItemFull = JSON.parse(JSON.stringify(targetDict[k], (key, val) => {
                            if (key.startsWith('_') || typeof val === 'function') return undefined;
                            return val;
                        }));
                    } catch(e) {}
                    break;
                }
            }

            // Extract a sample order
            let currOrder = null;
            try {
                currOrder = JSON.parse(JSON.stringify(targetModel.currOrder || {}, (key, val) => {
                    if (key.startsWith('_') || typeof val === 'function') return undefined;
                    return val;
                }));
            } catch(e) {}
            
            let mgData = null;
            try {
                mgData = JSON.parse(JSON.stringify(targetModel.mgData || {}, (key, val) => {
                    if (key.startsWith('_') || typeof val === 'function') return undefined;
                    return val;
                }));
            } catch(e) {}

            const dumpData = {
                modelKeys: Object.keys(targetModel),
                itemKeys: sampleItemKeys,
                sampleItem: sampleItemFull,
                currOrder: currOrder,
                mgData: mgData
            };

            const blob = new Blob([JSON.stringify(dumpData, null, 2)], {type: "application/json"});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = "merge_secrets_dump.json";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            c.querySelector('#sf-dump-status').style.display = 'block';
        });
    }
};

SF.modules.register(new SF.MergeDumperModule());


// --- File: features/MissionDumperModule.js ---
window.SF = window.SF || {};

SF.MissionDumperModule = class extends SF.ModuleBase {
    constructor() {
        super('mission_dumper', 'استخراج دوال المهمات 🕵️', 'fa-user-secret');
    }

    render() {
        return `
            <div style="padding:15px; direction:rtl; text-align:right;">
                <h3 style="color:#f39c12; margin-bottom:10px;"><i class="fa fa-user-secret"></i> أداة استخراج دوال المهمات (بدون تخمين)</h3>
                <p style="color:#aaa; font-size:13px; margin-bottom:15px;">
                    هذه الأداة ستقوم باستخراج شيفرة اللعبة الأصلية (Source Code) الخاصة بالدمج والمهمات بدقة 100٪.
                </p>
                <button id="sf-mission-dump-btn" class="sf-btn" style="width:100%; background:#d35400; margin-bottom:10px;">
                    <i class="fa fa-download"></i> استخراج وتحميل الأكواد
                </button>
            </div>
        `;
    }

    bindEvents() {
        const c = this.container;
        if (!c) return;
        
        c.querySelector('#sf-mission-dump-btn').addEventListener('click', () => {
            const gw = unsafeWindow;
            
            const dumpData = {
                controllers: {},
                models: {}
            };

            const controllersToInspect = [
                'mG3GreeceMergeController',
                'mgMergeController',
                'mergeNewController',
                'mergeController'
            ];

            for (let name of controllersToInspect) {
                if (gw.GF && gw.GF[name]) {
                    const ctrl = gw.GF[name];
                    const methods = {};
                    
                    // Get all properties including prototype chain
                    let obj = ctrl;
                    let props = new Set();
                    while (obj) {
                        Object.getOwnPropertyNames(obj).forEach(p => props.add(p));
                        obj = Object.getPrototypeOf(obj);
                    }

                    for (let prop of props) {
                        try {
                            if (typeof ctrl[prop] === 'function') {
                                methods[prop] = ctrl[prop].toString();
                            }
                        } catch(e) {}
                    }
                    dumpData.controllers[name] = methods;
                }
            }

            const modelsToInspect = [
                'mG3GreeceMergeModel',
                'mgMergeModel',
                'mergeNewModel',
                'mergeModel'
            ];

            for (let name of modelsToInspect) {
                if (gw.GF && gw.GF[name]) {
                    const model = gw.GF[name];
                    const props = {};
                    for (let k in model) {
                        if (k.startsWith('ACTIVE_')) {
                            props[k] = model[k];
                        }
                    }
                    dumpData.models[name] = props;
                }
            }

            // Extract NetUtils enqueue if possible
            if (gw.NetUtils && gw.NetUtils.enqueue) {
                dumpData.netUtils = gw.NetUtils.enqueue.toString();
            }

            const blob = new Blob([JSON.stringify(dumpData, null, 2)], {type: "application/json"});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = "mission_functions_dump.json";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            alert("تم تحميل ملف mission_functions_dump.json بنجاح! أرسل لي محتواه الآن.");
        });
    }
};

SF.modules.register(new SF.MissionDumperModule());


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
