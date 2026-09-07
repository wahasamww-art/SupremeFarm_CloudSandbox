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
        this.base64Img = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAMCAgoLCgoLCwsLCgoLCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCggLDQoKDQgICgoBAwQEBgUGCgYGCg8NCg0NDQ0PDw8NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDf/AABEIAjwEAAMBIgACEQEDEQH/xAAdAAACAwEBAQEBAAAAAAAAAAAGBwQFCAMCAQAJ/8QAShAAAgIABAQEAwYEBQMDAgILAQIDEQAEEiEFBhMxByJBUTJhcQgUI0KBkVKhscEzYtHh8BUkckOC8RYXU5JjojQYJbI1VHOzwv/EABoBAAMBAQEBAAAAAAAAAAAAAAECAwAEBQb/xAAtEQACAgICAgICAgICAgMBAAAAAQIRITEDEkFREyJhcQQyQoEFkWKhUsHwFP/aAAwDAQACEQMRAD8Ax0IMdostixjyWJkXD8ecdNFbHlcS4cjizh4fidHksANFdlcji1ymQxKghAxOiI9MK5UNR4yvD8WsGRAxGCHHYIfXE3yeh1GyaM0Bj8vE2PYYqJ+JoO5x4m5oQdqvCOTY6gEkcTHvtj4+YVe7DC34t4hMNgdvlgS45zwD+bfASbH6Ic2e5zRe2+KfiviG+gkbfTC94ZmGkGw/XFznOR5pI6sgeu+N+xuqRCPP7Oavf64peKcbe+/88XXKHhyqP5mv3s44898uqr+Vh3GNasarKLI8cdjRoKcEKcLj02u5r0xC4pysBCGDC8feVuYRFQI1YZu9GooshxJI5G6goXgvj4WsqaomAOOnP4y0kOqtLV9MVPhVwQFT5yP1xnqwr0eOKZaYUHby+u+JWTysTppA3xS+KJdG0gk4tPC/NRhCWJLe2NWLCqugdl8M5VbWm29jBbwuTNKBqJ0jFlzLxd3XTEKxa8p8Ed0Kud6+uA5N7NhFHn+c5QKFnAFx7hGYmFkGsNCLw5fqbAkfPDCyPIDFQCK2+mN3URRL8miWOPQRgmy3Krtu1n5Ya/BvDpFayAcF7cORapRib5DNiq4RycaA04usn4YgbthlZLKrV1jpmAprcYm5MNgpw7lqNOws4uMlKb7UMWUnD6rHKWGvTCtmO5zHbFfzDzMka3e+OsyhVvAfzbLHJH2tsKFI58L5vldrHw3gzyEjOfl64C+VeW5NIA2GDzg/BmQGzuQcYzBrmHn2OA1dkYrF8Y7AIHfAhzb4ezvKzV3OI+Q8O57CkEDFVQmRw8G8SVYDtZx75iz6SIQy98LvgvhlKkgYk0PTDWVVKgEDCthM/f8AS1jl70t4M8zmhJGYu+2x/TBNzb4fJKvlFH3wsxwfMZd6J1LjJj4YAZficuWd4+6tYA9rxa8u8pDV1nHf0xx49wp5JQRtvhj8m8r2R1HH0vFHICXVEiPmFtICCsSMujvte59MMFOVYQvYV74kZHh0IPlo4iwpi2k8KGJ1g0cVGf8ACuQm6vDU43z/AAROEdgDiDmvEuDWqqbvDJsKi2KriXKMi0rDbF1wTlVEYEMAfXfDkzfC0dLI9LGFZwrhAbMEb0Dt7YDkCw0y3OirSH09cTclzfZ2BxT5nw6YnV/Q4l5TgLKKC/rhQFvl+ZAW0n1wQPlNtsDGR5UptR74MV+HAMQ1cgY/RLe+O6/PH1ovbGAR54jjvGMd1qvNtgU5i8RoIWrUDeMMk3oKHyoI9xhKeLPIkeoEbajg3k8TYivlPmI2wvuMcdeWRVbcXtgWUUWjk3hIdKsp2IxccL4NJFVEj39sNbhGXAiUV6YFefcuRGSgo74eye2d35pKxEkWQMLvPeNTElVUkj5YDsxzBMwdC388Q+BXEbYXeFOlcSWww/8AulNIdHwg+vbFzwvlGH/Ekk377nAPnuDMTrBr5DbFTxTizFemb32BxgvjT0PuXgOXzERRaYV39sB/LH2fkjlZydicVHJOZnyyClLX274c3KvEmkjtxpOG7NHLKNEZuSIztf0xxPIKggj9cXOe43EndhfyxRcV5/C/DVe/c4UyiW0fKMQ3YC/c1jtPxONRsRt7YXXFudOpZL6R7saH7YFM34hwKCGkuv2OGpsfoMfjfiAVvQP7nA1Jzd1AdbaR8z/bCb494rSMSsKFvmBX88T+XuGGaBzIdMlWAWw3T2PFLwW3N/MKBTpbWMBmQbMybRtpv2xWcC5IncurMQoJrfEb/wCg8+jfhMSL23xaKSWxWsk/jngVmmGt5CR/5XhgeFfKnQiLMl164XXG+cs9CAktgfrg55C8W9SdJiAWFD1/njT7NDKNHTnniEE1ARWfkMAGUjfLya0XSCaw4uF8iPZYMGB822+Fxz3x4tIYFU6x61WJx9Dp4wMnKRTTRjW3xDYXgO5g8MWhOtX3berwJ5rP52IL6gegOC7k3iEubIWQMCPfC045QdgtFzlnIAyka0PasG3hTzcLLTgp7Xi25l4XFDQk2HzxR8b4pE8NRqb+Qwe94oLWBocYykc62kgPy7YU3H+I5yOTRH5/bfADDz4+VtSWs9u9jEjl/wAWZerq0s/1GHXG9kHhjLyMvEQhc2pq6vbAPxnxdkDFJTfoRi84lz1ncwKVSqnY/LELg3hRGbklJZ/+e+Mkls1i+4dO/X6kSdz+mHrleaMw0YFU1emO3LPK8KrdAn2Ff1wU5XJyN8CADt2/vgTnYwqcxwMyPcgGr5+uC/lmDShUIP6DBnw7w4ttbij7d8FWS4NGh2UE+5xNybEtCz4fyDI4PcWfoMFnLvh7GnxGzg0SK8Qs7lW0nT3rvhBXJs8RrHH7AfzxQ8X8SEQgA3hV85cwSxO2tiRZwIHmzWQEBJ9cZ2Vjxpq2aUyfGoZl3omsQc7yUjXpNfI9v3whchz30yRurYaXhfxaaTzM23zONkWXH1yiZxbl+ULVbfvhccT4OzPRUj5jGiJYjveKzN8Hjbuo+uGTommJufl5zEUDagffY4THE/D+eCUSISKN16HGoOM8pE7Kb+ux/fAjxDlaVR5gSPnuP3xaE2hm7Kbg3jA3TWORbod6/vjhxbxWkVfwUJP0xcZPlWCjr8pPtuMD+a4bpJ6dNR7jY/tgtxbCsETlPxPLzAZmPSD6kYaXFeYMkK6ek/LCn4vxIPSvH2/NW/8ATHvhnLEBa9dH64EophjL2GnOHjPAIGjX46oYTnA/HDNxAhN7uu/+uOnNksCSqoGsk1tvg2yHK6aFbp4MWoLQ7rwK3iy5vOyDqWAffBnP4HrDAWJBYj3xeiReqIwtfMYqPGTK5iGIFXJFbbnDLkcnSwTnqwHyHLTqQwOkg4e/IGY1x1KwNYyrw3iWYmdVDMbO9A7Y1ZyJyWI4AWY6iPXB5ljJOEyg5xiiD71QwOc55+PMIscTU6jasWPOvJHUVmD6SPnhVcJIy8t2XbA40qHedFjwzgmejaqJHvg64RzHOBpdP17Yqs14myuPInbuMEPD+YZJYCemdQ/fGk72HpWiRFzWwYBTXuDg84TzO4F3dexwgY+Jyo/4kZonvgp5lnlSISIDVX6jC9QN+x7cJ8U1J0tV/scEeT4+jdj++Mi8p8/FmBde3vhkf/V6PXTOk+uFlBoTqmPqbMY5A3hXZTm6RQN9X03wX8M51Shr9cII4MuJ+Hg45Lk3X4WOJicXjaqYb4niL9cESiJlucpk72cEvCvElT8W2BvMoMQc1kAR2wyk0K4oa2W4+jVRGJyyXhKpknX4SRiZlObpE2NnFFMRxM5JwwDHYZcDEgQE4/OyKNzizmL1ZwA9sd0yl4q8xzKq4H+Ic/N6bDCZY6gH4yqgbkYjNxeNfnhfZfnDV64+5uGV91OA0VUQu4xz/WwxSnn4/mO2Bubk/My2RsAMCa8OkWTTJuBgqKCMSPiTSGxdYicVtdid/wCf88WXDOZIlCqq74C/FKdtYI27HGjG2FujuLUEsC14v+UOUYJzbisSOU86hgBYA0B9cXfC+aISaVd/WhgOVBqz5m+JwQeRO+I+f55atINXiu5s5X1trQb4k8O4UQoDrv7nC4CcYso9F9ffEHgWVMshDG8e+N8zojKnp2OLzg/MEC7qPNgtYCmVnOWS6YALWNticXvLPD4umGYDAZxvl2XNOSGpb98FXD+U2SPSWs/LfBpJB2yHzbnYnUqiEnt2xUcrwSRi9Nd8M7lbkYsvw7+53wXcN8Kf4sK5pYAJzhnK7TSXJbD2rBblPC2mBVaH/PbDkyPJscZG14vpIkA9BiTmzCxyHh6BWwH6YKspy1Go+f7YtpCD2Ix9Cj64nZj1lcoo7AfX1xW8w80xwjzHFrGtYQPi5kswzkhTo1G/nhlkaKt5GTF4rQN27/XHXLc+qTR7YVPJ3KzMNRjOwxzznEmLmMIQfTAor0QyOd/E8IoSPcn2OBF+Z5vKVJJ9sDZ5DzjMCF2w4OWORn0qXADAfTD1SJySWiw5L5qnYfiih88FGd4uvtireKNKDMMSeJIgC6d7xPyIU3HOZgAQBiHypnIXPmr6YsRCrGqGIMfJ0aNq3742Ahxl+JINhQ9sTcvLe+AbjxUqClgjBBy1xE9K27gYUNFvOAf0x4XNCu3bC/474nooYL3GBzJePfZSvfvsMag9RsaSbx8y8eKThXiNEV1HbBFw3PpKNS9sYDVETMyMwIHfC/5w4PJGpZm29sNiHh4G+K7mfl5Jl0sMYUz1lZdZ8oJPyx3zPBcyCCt4dPLvhvFCbAvBVNw1KsgDbDp+jWxJZni8wgIZ6Yel4j8l8RkVS2rUcGeY8OklZjZ3xUweDzRklXNe14D0XjJVQvuamGYnsjfEdOFujDSpLDBbxHlVUmVj8Q7gYPuC5iM79MWO22M34KKVIi5Hm+bpBGQg1WPnJ+fKyENGQSe9YKOX+KLK9FAGHywYZnhK/wAIB96whzSZXyoSMdYEvEuHL0MeoYsYB26O149QxWLxFbO1sSAMBvP3P3SQiM2xHcYYAcTDfHqMXhCr4kZhY9ZYH1Iwb8v+LitGpIt/XGowd8T4brWu2Ep4g+HqKC+qyPS8FvEvGdbChfMTi5y/K3XAaTsReMPFtZEnwLKPIoCoQRtfyw3OUfDsKFaTdvbBLwvgSR2Aor3xe5KAemFDKbZCvsANsUfPXCWeFgnxEVtgqEVHHieLftjEzPHCPAzMEMzNv3F4o+NcuzJUZFm+9Y1BmM6EG5GAvmHmKAGwmpvn2xjoU5MEOVvDqSRAXse2CCTwxy6U0hG3p64rMx4oNWldvSgKwH57m59R1Hb2G5wUg03saub5phRNKKNhQusA/MvP7LQoi/0GFvzN4jAbIhv3O+BTi2c4hmR5ENAdyO37YrGFgwhnZrmVKt5LP8IP98QeN8wSCIsiEL8hZ/fCP5Y4PmOuOtqJB7HtjWvAuHGWEBgKA7V8sGSUBk21Zkzi3iC8jdMHSS1b98FUXgdmQElZiyNue/bH7nDwoeTPAxqAoYE160fljSWcy7/dFjXuFr+WKzmksELa2IrjmdjjQJEAGA3Pc4jcr8MdvM7FQT37YgZrhrCWnB74mc4WsflahsQPnjn3g7LpYCTmKHowkhrPviFyBzBIfNvX/N8deXk+8ZYoVJb3OL3kPh/SPTJUsO3axgPC/JJTfkqOdSJnUMv8sD/NfLEUaroIVzVHtgx505o6cotR+mP3OnJ0WYgWUkp2PtjRdMMrQTeD+TdFGttdj/l4FPHjkmTqiSBQG77D5YGIvFSPLJpRizrtfe8FHh/ztLmzrmdVUeh9sVprJNJp2LPk/NTNmAmYND59sOOXleSJg0DAj5UMUvOHDcs2p1b8QdqwIcCjzh3Mh0XsAN6wWrVh7+C38RMpMw1SsKHpd4qOWee5ANCQ36aiP6YLuCcgyu+uUkx/M7YKOJcsZdKMZH/t3/ngdkjOTqhUcR8PmmkDvW57YZPDfDiKFQSFBr9TibkeByHToU9+5wY5XkwkgytY9huf9MLKbYmhc5TKFpPKpr/npgnyfIUsh82y/Pb+WGBlOFxJ8Cj69ziwy5HfEgdq0DvBPDuOPv5vl2GCWOCqAAA+WKHnPnVculncn9cVmT8VonjDVWMzVJ5C7iHFY493OKb/AOpobsMP5YX3ijziZIkEak3teOfK+Th0qsh859L3wAdGtjBzXN8K+uBfP8xyStpiut8Xn/0/DQBGPHGuJRZZb0iz2GCBGceZ8zL956b7i6rB3Ly7HAiuAASMcuCcqGfMNmJBS3Yx48SOL9QrGh8o9Rhm7Za8UT8hyGkkbSsB2sbYCuTuLzHMmNGoA0Bgv5L5oKVC26nbEfjPKLZeYZiKit2R3/4caNeQXimM/I8cdfJID9cW+W45ERV0fniHwDjqTRgsAGre8V2cgiJ2G/ywGQLV+LR38Y/fHXLzrJ8J1D1wteZOHwIrHWVYjYE4heFvP7KxTTa38Vdxg0FRb0M/OcoRN6Ufl/pgXzvhiL1Kd/2/2wQz+IkO4vcdxiJwXxJhmfQDRGMNUkBmf4S0YYNHq9jWBDK8qCViV8nyusaLaJWBsAjFFLyXGbK+U4ZSFszhm/CkiYODZU3RwVcT8QGjXQ0fba6wf5vkmVCSDqGKXiPCFv8AEH1sYp39mYO8qcRy8jdRmAPsaxSeOXMsUkWhWBNEbHHjmHgOW1HpkqfYHbC/4p4Wu5tWJ+VnFIxjdmt1R68FOIBZKKavnjRHFuM/h3XYenphQ8hZWLKHzA6jthxPxCJoG0+ZiDQ9sJyZkBIQvN/ORkJRQQb9MXPI3IWpdToWPzwujO8Wa1OD8Xt6Y1ZyeR0QwAoi/wCWNy/VYKRYsMzOkbaBGAx+WLKCaRBSgC/TE/mflwvKHXv6YmS8tyAjVVntvjmyUcga4rzIoIVkF/TBgIFny5XYDTQH6YBebuAlZQHYdsXLcdiihpWtq7DD5tDvKyIjjmWaGZk9L9sMLkngJkI8+xwI8yTtPJWn171i+5dy8mWIdgx/fHVJ2vyQ6oZ2Z5cZPhtvmMAXMXOkkL6JQQPQ9sEvGPFmRY9SIx/9vrgI4fxVs89zJ29arCxXlma9Bxydz1G4+Oj6WcFvC/EN1arsD9cLTg/IsXUJCnb64rOcJ5InJiUkYGJYQmtmjcr4iRndh/rgiyXGI3Wwf3xlLl7xT1Urqb9dsH2a8SU0qIzR+eFcGgUmPmxjlPkxhb8C5lk02Gv6G/5Yusp4ngbSDf37YQVwM/5rm354FOJ82UTvfyxX8OgZVLS485POxtdL+uOtCsiPzA7b1tiLxZWeqP1xZpMpOmtsS24AACQe2Kke3si5TlCo9QbzYr+Ivmol1A7fTBBydnNbFW9MF2ayKEaWIr54k5uLyXUU1gWcPifOi1uL74O+RskJ0LsfMcLzxCyKhwse/wBMFPIfLk6R6idK998PNLraFinYWcR4F0fOFvCs5lzc0ku6HTeHfwLmWJl0PbH3OKnmmNK8iC/esRhKh2rK7gkCmDSRpNYr+WnMctVqBOL/AJY5a6nxtXyGLU8oHWFQE/OqGFckMkDHMPMc4lHTXy4s04rPLQYUPX0wxuE+Hj9z/MYIct4fAnevrhe6MKbjXIsbKCBbfLt/TFhyl4fFgQUrDpy3K8a7AAn3xPTgxHbCObALfhfhQqjvW/vg04RynGu1X74vouG13xIVAMT7Mx4y+T0jYAD5YkBh7jCt8SedMxCRQpScDjc5OUBBOo4emwWMnnnnHpbLuffvhINzVmJpySxCg9sWubOZHnYEr7YEOHHMSzEJGVBPtgxWzpjVFvzjzbNHWh++3rhjeCrZhwWluvTFbF4KyPoZ/TffDQ4TlZI0CqAQB6YDqhZteAiXJ4/Pw9W8pAIwMtxPMA3pNYuclzQn5xprviRIp+Y+ILAQFUb7YkctckxkmZlGo/TFBz3zLCxUr5tJwZ8M8QcusAJNEDcYFlOrqyxzGVPYUBip4lwdzsGrEHJ+LsD3jpFzTr835BjdhejIXEPDYPRLG/rgq4NygqpXfbvjrHmkZQwcV8ziVmOcYY0skH6YawUwITkN1n1g2Prg0k4IGFGsQuW+aY8yx6Z7YJJ0Ow9cAzTWwVi5SEZOwN4q+ZOCTFaj2sYYUnDCQMRVWu+MbsZuTw6m1HUvc7nHjiHhFoAIB9zjR+biAHbEKXh2saSNsB5D2YluWOSotkdwCfS8OPhPBlhQKo2wIcT8Gzr1q+49P+HEiNs4lJ3ra8bIzaYaKpxFmz6C1Lb4qc42YSMs3f2GBzKcPlfz0bOMITx4grG5Vrq67Yi8Q5kadwkZ8vrXbFdzZyXIU9zis5N1x2mnz1glUlVjZ4LldCb4sJMqCL+WBTkrJ5gEmYeW7F4teI84KGCjb0xiIseeeWZutqRbBxz5f45Mr6DH23w9gY9GokVV3tim4RnMvKxKqLHrQwGOplDyIkhkLuunB7mt8D2Y5hhWQJ/PHLiXOQRqAtffvjCN2Fi9sRM3C2k1sT2xEg4+mjVeKbifOklAohbGMAHOXLOcUmRn8n/PngEzPFy4KdyfU9sP3iPDZM1FTeXA7y74Ioh8zXhkAXHBshlhGRK2p/UDEDhGYUOwUHQOxA9MGHN3gJJ1NcTbH0wY+GXhS0SnrC79CMM6AmCvA+L5NWXUhL3h3cMlDKpA2I2xW/8A2+ywIbQLHyGJmc5hhjFaht2Awu0NsmnJDHFXVe5A+uBbifPxolV29/8AfCu5k5xl1WNyTvZ7D9MLRSPG2OjO80xJ+a/6YA+b/FwKtx7+mw/vgJ4x4hQCPTvJKaFDAxxjI5mWO1AjQevbv74ZRY8VFPJa8S50kdSzNoH13x64dz0iISEMje5vAE/hPmpQjiYMoYagN9gd+xwf+IPMCZOCPyiiArHTinVIo5J6FPm+fXzErAHpIp32rDF4DncnGFLyFr732xScu+EkebUyoxUNvsK+eD/KeFmWWHovRYige5w05x0Il7OHMnOnDI4yF0s5HcDsf2wAeHPjr53hCi7IUnbbBhy74NZWEsH899r9P3wF8a+zyBM06ydId1rbCxcGPVaDHj3IuYkHUAAPf0xY8lmZEkDNpIU9z/TfCT474x5zLnprJ1EX1xbck+LCZg6JSbOxrGfHKrA5NYLzhnDM0xkmhk16SSVPyx04L9oLMjVGYdRU0aF7/W8NHhnBY48uywKdTg7/AFws+XbyLyHMJq1Em9N1jKSfgVuymj8aoxIfvUJUH1rBnNwDLZ1A0Db7GvbA5z1xnJ5qMFVUtdbAXiV4fcMgy8bMHIavKPc+2DLrWFTFVoIM1yxMiaVOkVV1/PCg5o5fzOXbqq7sSe94ZEPM2ccNrGmP0Zj6YCOaOZ8x8CVJZ9N6xoJ2FvyAcnO00ki67Jv1xoTmPji/9OCkeYp6HfthPcI8PJmcGXyX6VhmZnlsooX4hXdjthuSrVBjK9iB4XyZmJW8qkC++GZylyDJHdkmvS8Mvk/iCqdJUH5KNv3xeZDlqeWQ6V0R+/bAlyXgDdgBlsmpFEaT/PBNw3jZUCNIix7WRg+yPhnEnmdrP7YvshBGvw6B9Ks/riTdiNoEMhy3O6/iEIvt8sEvC+WIk/LqPz7fti2zMxsCsU/M3MphHaycJYLYQo9jsBim5kzLKlgXgMbxScMAVxOn8X4hsy6ifQb41h6ssOC86xMPNan+V4IMxGsqEI2/pvWFjkZhmZdIjKL71WCLiPKwhBPV0/K8bJmgW4nyXmdX4hDLe242H74p+fst0oNKCz7D3xfvx1CQA5c/Ik49cZ4eKDNsPng3kopNAHyjzBmmjK9E1XcjH3kzl2RpzJI2nSe2CvKcwzt+HCo09rrE7inABl06s7fMjGv0aUrLTjXO/wDApNbaq2wLceztL1JW1XuBitz3iqskeiFBuavH3gfIUjAPMSV7hfTAYqRN4DxefMLpC9OP37WMSuZYcrloTuGkP64H+a+bJlHSgTSBt7YXv/VrJE4Ib5nv++HUG8iuVBZyhk1ltro/0xdHjxTZiWrsML/gqymSoxpB9f8ATDR4NyaCpMjC++5GEcaHu0XHCOMJIhOrptXbtjvy/wAaonUNQ/iGAh4QC2xKi9xiNy3zSY2YJ5h/Ce+GSsR0XPiLyqJ7kR+wvTgW5U4lOEZFQEiwMXvBecEkcpIDHe19sFkvLAC3AwY99qvDN1hoKdaFRy9mpFmbrJ3wX5rls/HB3xBGVm6v4iUPesE6Qso8oJ+mN2QezL7w54XmFH4p2ODdtu5rCfy/Nrg6WZk+vbFzBlJpRYksfI4zyRoJW5kTqadW+J2cy2vuAR88LzJZvLxyaZCdd9/ng+fmuALsw/fCs1A5m/DyJiSBR+fb/XFDl+UZoCWUB8E//wBwow2mh++CLJLrAJ2B3wykbWxNzcvmSS5QEB9dscuO8MWI+VqFd1OHDxXgqOaIse/r++Abi3g8HunPyBw6kG0I7mTKS31Ausd/rgk4T4lSvF0/8I1VnBsnLvRGmSOx71/TA1xjKRlqC0PpRGK9kw5QLcF4fnXmFSgrf/PXBtxbkvNtIpaU0PUYqeCcrEsTExv2P+uOXOPNOeijKad/Q3/w4zy6QP2T+buQi7BmmBKjfcDHHlfhmWciOxrujfrhJS8UzDtTuyk7Hc4b/I/hXSiUOSx+e+DKFLLMmGub5bgha5Co9jYx4n56ycY0yMrCvLWKTi3hUJDc8zAegJP+uI2W8LeH2F1lvn3xNddszKDmrxwy/TZI1Hy2x38CeOjMO4K6cVvNngzCklKaDdtsE/h5yoMgdTeZWPpirlDrgyjIuOMc/Ll3aOrO9bd8BeZ5zYk2KB9xgu8QuIZEHqkeero4RHNfNpmY6RpUdsLxw9DZ8mmOReG5WWMsyqD77YBObOI5aGamUFb+Jd6xX+HvhvPJDqSYrfcXiTD9nueV21OTjWk8sZovOEcQyrkGOXS3oMeeNFlNuAw9/wD4wGQeDRim6by6d9t6/vgn5o5ekSPSJVevS8Z1eA0L7nvhzqNPce2OfKXDE0EEUcWo5mM7UUII99hio4jE9kWFGKZ0c7onZLgcKFiSL9sR+EZfW7eYAH0OI3L/AAYBtTEsPmcfOKcmzOxkisJg/ti0vCLXK8Nhheyw7+mKbxI4rqoQ2fpi95c8PmK29sflucFXBuTWY0I6+Z3OBaQaYrOWuU5/8Rhf1wXdfMOKFhR6DDPyvIMvZjt7f7YLOGctKi/CCcTlyBSoXfC+B6ohpjp/UkYIOA8gSv8AGKX6YYmQShsoGLrLLtiXcIJ8O8PI0Iv+mCLLcJRewGI/HeZliFkEke2BbinilVUpo+uE2Gmw3mg+Yv2xziS8LF+KTD8QnY9hgjy+ckMYYHv6XvhQ9Q5OXA3vHiKck4Fl4VmJEpTWLrhnK8gUAtv9cYARSRgd8c1VT+mKji2SdELFth6YVo5vzDymNL3NXjUYO+eOHRTEKw1V7YgZTlVdgsdV6kYk8tcLnQ7rqJ7k4IOO5eYigQuDk1Ijjl+wAwBHttihz3M+Xy7BRGNV1sN8E/AOVnI3kBP1xzznhunUDN5iN8azFc3Fpp6VQVU+uCvgHCii0xs4nB0UAAV6YncPQHbChOGkAWarCn8T+dY9BjjXc9yMMzmvhMpQ6Be2E5xmJYl/7gaWJ2wCvGkwe5ezY2U3ZwV5flVSTragRsMSeUY8sp1Gn1Vp+WLTnTgelklv8M1teBGN5K8nJWAJ5Z8OCZWOqk3AwX5nRBC8ZNsRsfbF/n+mI1Ze59MVXPyQpltT7OV2PqDWH62KnKTF5wfJTMSvX8vcAnFnxjN9OMg+c1WAXwQ4VJPmXJLMin+V4dnNHGsrGArRkfM4WapnQt1RUeBfHMvAGMr6WY7A1h4ZbPxONauNPveMuzcnfeZCYBfsLw0uRvC/MgATPpUflBxlonzQjvyNVc0Dspv5jHhiq7uRXzxM4fwVY127Ad8BHFM995l0LsiHc4xxxVl5xPikWm9Qx0gzqkLpN3gW4zwKMWzXoA/fAzPxQx+eMll9FwBuqG2Mqe+OJy3msjETlHmMyxixR9Rio8S2m6TGI6WAOGQqVuj3zzzrFl1Gsg36bYCsn4yp30UnvhOxPK51ZokjeicX3LmT6oZQy9Me+C1R3LhSWRuyeL+UoFvXFdw/i6SZlHQAKex98KTJcLWWXoIoY339MEPGuWczFNCq/CtbDCsnPjUTScq3YJG4wFcU8MdRLat/TBNwrLeQO9igLwG8Q4tK8jFH/CU/TBRyFlxXlUrARrNge/ywG8jZo/iJXmo0R74seI8yMjojbo+1g++GRwbk2NdLooFi8E2gL5c5EdlYy/EfhPri+n5VRY9O5Nd8GGZgYV646vk/4vbAAI7l/iTCZoq1KD7emHFk8goApQP0x4yfLsKksq7nucTuI5tEFlgte5xgnkQ7dseI8kAf74D+KeLkSCgrNX5uwwIc6eJkvQMinSvpXc3/ADxhlxtjO4pxeOM+Z1Ue17/tii4z4vJYSJbPuf7DGfs9zjCYtbSEyHej6YAZvELMF9UcbvQ8pC0MUjBsr0jHbHbx7xHnfMCMtoX132xE5s51y6uoVjIwG+ncXhW+HPLGd4hOxa41B81/FjQ+Z5HggipIlaXT3Pcn3wJRUdjOS/xF3xTxHnlQRpFQ7XWFv4mcNzsUXUVh5/bc4ZXKHDJ2lkWTyKbqh2wOc2c+5OBjBPrYKbvDQecIPbAsvDzhvEF8wi6hPYnev5Yc/CWzDZWX71SKR+39MVUnjEqhXySl1FWhFY4c+82ZnMZVi0RjRviPth222BrBYch8zx5SFquW70gb4GOdOM5ziFRLlyqk7Ej/AGxScq8zw5aO4EbMMBbDuBi95O+0RmWnoxLEvs1CsMovLRJTSK/M875rhbLBKAFI9v74dPIhMypmRRHfv2x75r5Oy3EkV5fMQPy48ZfwycZfo5ctGtVqJrHPJxePJVSb2TuMo8vUZNNr2UVvWE+fHKIF4c0htTWwwCcxZvN5DNrF1ywZqO998O3hvhblGCs/4jSAFj8ziigoZZu3oD+EcrcMzEUsgemo6Vve/peEhwqJ4c3SL5dXdhQq8P8A4v4YQQSGeJSFj3ZB6j6YFY/ELJ5qUroEYG19j88VjJ1+ASV5DHh/jBKXSCPTewsVjn4hQ59lZdKuCL1Gtv5YXPHuSzHOHylse9nt74JMnmM5LYlkr/Ku5+mJ9ersNpiy5BXp5krOCRe4HbDP4/I0rqIRoUdr3JxZ8C5GAGtl0m61P3wQcuLGjXoaRwdgO2Gck3Yn2eCnk4FMUUSamB9ANhjxDyn02DFlVe9DdsODI8KzEyeYCJfT0/3xM4byBCuz+c+vtiTkxKS2AeUmEgASIs3oxGLjhHhTJISZnoX8P9sMtIYo9hSD0AxS5vnOFWILXXtibY1+jlPyzlcsuqhfufX9MD3EvFDy1EpLXQ9sUWbzj5yYij0lP0vBrkeU1SiFFDGsV/kochy3mZd5HIB9Bi3z/I40bSEEet4JRxZQd/KMeJERuxsfI4wosYOYp4H00ZB796rE3O+I0bV1Foj3wxMtwhCDQF164TnNvg9PJIzAjSTsMCh1Xkufv2Tk3sfTEbg2Ryhct304t+T/AAxWNKZQT/PFtl+Q4U3FA3ZBwKM2vBEXmQUemgUD8xFYEeZcj947zC/4QcMfjvDlkiaOOrqrGEpkPDDMZeUvu63e5w6Qll1yZnxlgwaMOBZ1EWcTBxBs61VSA9httiq5ehmnnbUKUflwz+UuUekdW2n1wj2UvBzm4vlssgFAMB3Nd8Zv545rzOanMQfVGW2Hyw//ABX4ShRnIBWj/TGYOQuJKM0TpPc1++LxWLNHORg8I5TRZoo+2micNHi/HJBSRjsKwAcbzTLKkwGw74ZGRzqzIHjrVW+Od7KeBP8AOOfcElvK3oQMU0nBS8YkkFgdjiy5mDSSsrhtj3rHvJcQkACFbi7HbsMWuialWwRn44SwCMEA22wYcU5RkEIm67HayLxX8W5Ly7MWRtgLI+eLfKZ4rFRIK1Qs4ZsLkqPHAubTGoWtYbvYwY8A4MjnUI9O3esLbhHD5ZTVUt7acOrgJOXhuQigNvfE5tLQI2xT848O0ylW2vscDfAOYpMrOHaQ9P2J2wQcS4i2YnL/AJB2xSeK2npJSWfXD8ecBaSHlyvz/FnVYKg9rrAvxPMS5STbzKfT2wLfZzz9sVXYCrvD44vwhJzXt64HJHroV7EdzbxeXMVaBQfUCjgx4Bmkhh0a9LkepxB514OEfZvpvtgLl5ZzE0gBFp7j2wE+wGqDrKZFWBZ06nsw7/viJmuVYpRs5jI9DhkcncMWKMJ8W294i808Ehb1CE+uFB2oD+DeGUeoF5QQPnhiw5uKNK6gIA98BUPh5SEpIWPp5sJ3jPAs4sjEhtAPuaOHqzKnsenF/ESBRQaz+mKTI+IkkrlY0tR+bFPyXygJ0tk0mu59cGfCOWzApVa3xtC48Eefjs9HVGGUd8VmT4llpAQ6aCdsFEmXJAF7HvjjxXluIobAutjjWawQy3LxRi0Dgi7of3GKnmDKPK1vYruK2OO+S5XmjYvETV/DdjBJlub1Qfjx186w9hsXfMHh1C6gir9a74i8H5NzSgmGQ6VF0flhyQcIy8y6k2+h/tij45yrOit0iCpHb1wVI2AA4FzPI0lZoHSu1jFlxXmzIw2V3J3H1xFThEqL5h9b3xX8e5SgnA0oC/rW2Gw9hqisbnlc24VUICfmGLTOcekUgaSyjttjtyh4V5jLapFA0fwnFufFNI0YSZa6/MBgNJ6HUmhE+KvE3klXYgewGGd4beDWVeENIGLEX2OB/ifM4kYyJEKBsBsSOG/aAnTydEV2FYq+3WkLascnKPD4st5UDML7Y/ZTxQZ80Yokqu59cTuTuYLQO66SwvC5zHDZ486Z4xaMd/3xzRWXZn+C75n8OepJLNLIV2JUAkb/AKYTmffSSOox39TeHVzJzRGy02oEkBv746cU5UyXTBIskfriqkDKEXBwmZR5iAf54teE8pmQE+Y/yvDzyHhfDdsbOL7h3LUabKo2+WN8goneG+H8lBQoUe/r+5wf8E5B0pTnv6f82wW5zSu9gAfTAjx3xOjU6RvXz/0wjk2AIOE8FjjFAX9cTY4N9gB9BgV4b4sZc9wdXti4y3iXB67YV42Gmy4m4fRs4mQZYbYV3PHinIL6Y29Dg28MuLGWNSzDV9d8IGmFH3AY5zHT6gD54t4sp74SXjy2YUjSxCeoFjBWTRVuhkcU4jBpLSFTthZycShmk9FjB74Cn4ywy4DliTVA3eJeV5VnljHTiYD33w2EXUaHonLcGYi0owNVuMWfBeSViFXq+uKDwl5flgi0utE+uGTV0MLaIMhZaIi6G2Pp+Ek7ViWjVa4h8fzASJyd9sbYqBiGZsyWUbKp74GshyzLBmdem0B7/LEDhfPxjhkKLR1Hf/gwLcP8Q83Ixo2vrgJWWpoc/MHN16VirW38sRTw7QAZpRqPz98LCDmF4W1MhZm7Gu1+22CrhXIjZlOrM7KLsCzjN0DrgOuE8oMGEiOSvte2C6ThZO59sRuTc2hj0ruF2s+tYIxmqHbAJg3m4QALGP0eaWxi2iju7G3tiNm+HLYrBAD3OXPgy6lqJ29LOM/8xc5JnWuQgb7DGoc/yrG66XUGx6+mBMfZ8yxJ2He9gMY6OPkjEU3BsvloQrM1+wxf8xcqnORaxLoUdhddsUXixySsc8aKbX2H6YGkymZsqmrQB62BhMxOqUYzVhDwfw5zTqxWaxGCe/theZbhWa4hI8HU3Qle+2GNyFlc0scrx2xIKld6wCcleH2dXMyOqsmpiSRY7nFoNUJYc8o8uTcNARCryt8W4P8ATFjzwk8qgyRj6j3wM8Q5GzGtpOswcWaJ/wB8MHl7O68m2twzAHbubxJu2BOnYqOUeIT5acMnwE741/wCLqxq5O5Axmfk9pnideixNkKxX+fbDs8NuXMzEg6sm1XRPb5YavZPmfbIfyZQ1X74DTyRoLOnc7nF5PxtjYXzVgefxahjbpuCG9sZo5o2V2bXMTHp6PL6msFvCeTIVUBgCR+1/TETJ+IsG5G2OfC+aoWYkyDv6nCj5L/K8GRX8or+mP3F+DBgQexx5/8AqPLX/iLf1wvPHDmU9DTDKA5/hP8AocEnmy74v4a5aaLpbfpV4quWvs7ZaMHdq+uF9ybyznVRJlnaQjdls/0wxeCc5z5kmIgxVsTvvhngp3ksH7LcqZTLs3SFyeh774vuTuCkFmkFsTsDiy5c5UjSyPM3qx3N4u0ylE/TAJyk2emRaNjbA+vJ0TagBQOL2HLE7d8SxltF2QBXrtg0KmwKzXhjGStmwlVgpBoKo7DFLxXniGK99Z9l/wBcDOb50nc+ROmn8R/1NYGiqg2MPiGeVBbMFHzOBfiXiKmwjBlb5dv1wrea80em5M4Ldt2v++E/P4ople+Ys72qn+W2+Cot6KrjS2x383eLUiBgSI67hQf2wJtzvl2j1tIxf2Y0P2whOPeJGazFtl4HZSaLEE/2wZcp8hZdUWbPyMjHfQe3+mKfFjIVJL+qJ3OPiYOmAAQg7sqmv3wrOL+KUs56cSs3oL/sMaWyHN3DTC6J0pVqgvlu8L7g/hiYpFziQ0uosIwLFfTDxcY7QV2kLblzwa4i8scksZEeoMQSNx8heNAz8amiX8LK/CK+EYnZXxcOcmWJV6LJsS3lA/Q1jzzVxTMQyqBMrRt8TLTAfscLObYvShMnxDz8Oc6qQsiOPMp2H171hocmeOqzyaNLNKNiK2GCHnLm/h5yzLIw6mn4hV38sUPgbyNl0jaVBrZySD6j23wJSjKNtG6tDIbikrk9KNdYWyK7nGNPFTiEk2eZJECkMNQGNW5qXMxTBowdJ7j5fXCv5k+zm+bzEsyT1K+4XtRwvHJLZkyv4NwPSsaqAtkXgv59zTBVg3ZWUA0MJPiXD+JZSXokNK47abP+uGhy7wXiOZgLyKICo8pbuf6YWUazZ0dlIk+HTZbKlkSIsz97Hr+2F54zZE5iQRxJpe/yCiPrWCnhnhjxV2YdVVvsw7n+eOnBfDPPZOUzFhO1HUrbn++CsO7I4XgPfDrwvmjgjQSEEgE33xH8XM1m8rpDTARVRPrikH2hcyjH/tCK/MdgPpthac6c6ZjP6lKMxJ2AsgYeHHcrYnaiFxDh+SzEgJmOq/iPofljhzHzNPl5Fjy03VA7Hv8A6Yjct+AcgZTJq3OygHDB4d4fPHLo6YjUfnf/AFOOiTihO1rCKLgT8QmUiR9Cv3vv+14t+U/DvLRufKZH7lj2vBtl4YVcVqncflW9N/XfBFw/kqeY21QpfYbGsQfJ6KbWSDyvnMugcybGqCrucfuD5a2YwREk9mbB5wTkCCK/KHJ7lh/bFv0ApCrsPYCv6Yg2LaWgY4P4c35szJZv4B2/fBdBwSGMeRAPnW/745yZeyL7DHps2B29PQ41i2SEBPb9cBXN3ObRkJGNTk1t6Y9+I3OrRJSiiw2IwpuH8eZE6jEtIzeu+F7DKF5HPkOVnYB5W3PpgD8Tc/HlqKrZY/XfB7yXzR1YhrFHCr8aOLiV1iiW3Bu/ocHYEs0MTkjLyNCGC6SRfbHrjfN75VQZRqU+vcDA/wAm+JrQqkOYXQaAB9MWvNORzEyHSFdCLAO9/TAoP4ZRc5+JOXlhbQ1NWBbwE8RGZ5IpDqo+U79sTeTfDVpJamjCKt7e+CHI8s5XLZjTGo1XdbYZNIq6qhhySb7HFhnJyservXcYB+YOLzhxojtfUD/4xYZ/m5kivpEn1H/BgUczI2Z8UYVjcnysvphIce58nna1JVSaB7DBtx/j6OoJyjH32/2xQcK5VlzIII6ESmxYqhiiQo1vDLgTwxgs2osLv64IOIv8u+EjzLz7LAqwQNr0iixPtgj8MfEguCmZZQw9Sf8AXAcQkU51o53o6Rhw8l5QNAN7J3N4WXiTmIaV42DNY7euLLJ82SRmI1pQgXhKplW7QS808IhZenI+gH1usKDjngGkYaXLyh270CDhpcycLhzWzGmrb54SuYGYyU9R6nW/hskf6YsngRNoqDxOUVHKpFmrI2wQ8IybxNcb0Tvp9DhojIJnYgHjWOT3qjgH43yTmIXAC9QejDEpU9DKTLDg3PsJtZ0AbtdYJH4fl5Y2WMruMJfmnOMGCSRmz7DBxwHkzTBrV2RiLrfCOPkdO8UU/DPBN0LEt5ST6jFlH4PI0ZDvX64teWM11Ep5wGU77/74/ZvMxSuI1muu9HvjOUjdCim5hhyMYjSnfsDgQ4vx55d3a/8AKO2JPiXy0yMOkuu/fviy5C5eIW5ov3xRRVWLb0ijgzXkpB5jsBjvk+QpG3zLdOPv3G+GDkeSY3cSGo9PYDAV435WVmjpj0wKoHvhobwIydyhw7Iwv+DIWY7f82w7eDZUCMk7WNsJjwt5ShijMrpR723++LrmDn+VkIjHlugQdsNJ+AWVviPwVl3JJ1HbHDlTjTIyxUTY9cWPNHK+ZlhjYNdUaxJ4fx+OKjNGVdV9u9Yko0UcrwGuWpFtqF+5wvPGfiidEaWOr0rC48QedJ81KDEWWNT2BNVgy4ZzTlTAFmS3Xaz6/vildcslTYA8keJ08DAMC1nYb7/zxp7gOqaEMyBdQ7EYWvDfDWGSLrRAGTuoNbY6Z3nziGXjt0tU9vYYd09Cqxnf9L00BSj5Y95hYl3ZwP1xnziXitnc4CsAKkDerx8yEcywlsysjOPSyBifQsoDY47zRlV/9UAjEI8VhlTyy3jKAziNmG6pZU9ASawzOQuPLGp2LLvXz9sPLja0HqjQ/LeRUJWq8Q+M8DDmmW1wv+V/FgbgxMK7d/8ATBty5zW07bIV+vbEWmI0B3MeROSYSRk9M91ODvlfjYnjDjbbFP4lcEdkJchUUXp98DvhHzmg1RMNAvy3sP0w9YFGdPlVbYgMPpik4hyNCTa+Q+4xfRZ5O4r64i5nPputg3hbo10C/EOX81p0hw6V+uBGHlxVSQSH32OGrk87p8vr6Y+5/gsRFMoZjv8ATDKQe3sQUfL4cFAtf5hgW5h8JcwvmRxQ381XjQ2b8Oww1RsY29vTAXzDypmiCrC1H5lxaMzC94T4kzQqRPGTWy0CcGXLfinDIVANMfyn/fEnKcLUxrGdLNf5hv8Azxx5j8GEAEqUrgXa++M+rC7BLxS8SmheuiKPrW2JvIfPsWYFSDt2GOb5ZnBXMASIPzeoGF7xWfL5dvwtYN/OsN0TVLYVOtjk4j4orVRAlvniHJztmW0gAgnbbHjh3MGUQi0Or6Yu5Oa1HnWFmrt5ccrtPAySBHmqLOgj4ip/ffFxwjwmzLqHAA9SDgryPiOWA1QEewIxbZLnydiKi0x4zk6CooWmX8OMx1lPTFXvgj598M5dC9IAHa8FXEvFNk/w4wT88Q8h4kZiZjsu3ywlPZVfgqI+RvwAr0XrucUOTZsmwcNa3RA3wzOCc1MdQkUH9MQeM9KRWVYtR77YRN2Z0GTeIsRy4mO23r74UPGeYpM4HYf4S9j74553PXE0EimNPpgiXkgvlI48swCf+ofXHRGiEoOOQSynF43VbQeT5XdYa3DfFKJIlUgKewArC5XhcfUWGPzaPjI9x3x44xkRrB0fCfKCfX6Yo4oh2Zovg/FFeNSVonE+XIk9sL/lTimbZVAjAHvWGBBl3Faz5vl2xEZnPh+VOqjin59ybFCqbsfTBdkoRe+JOYyKdwL+eMKnTMrZjhUiOsLgIHO5+uDbi/hGYlVo2FGr+eC7xB5JWZep8LL2+dY78qQvNEFYUF2BOBdFm7Vn7lflVDGokVSR2wJc582gSrAvkXUAa9sONeDIgAv0GB7mLwvgnIcWHBu/fBeRIvOS74DwgRxgL2q7xJnbt64+cL4WyJTNqrHefKE1WAgeSDmoye2wxxXL7/PFi+W+e+KbmbmaOBdTDcYIVnRdIzV27YkNE+mxhAcyeJ2cnK/dVoEgUdvXBfxPnPMxqisLbSLoXvgjviYbz8Fy99WVQWHv744nlVJ7YUin0AxR8ocTE2oTWG9FO14MeXOMrqMZWq7fTC7EdxPfCuV4oE0ot/3xG44hRdekfPbBJFONeOHMsymN72FHBa9Cp5yCCckw5qPqfDY3xz5a8NcvDYA1fXtij4J4kxRoYr3LUKwS5ji0QC2xBIu8BFGmFfBuFCqCqAPYY+57hgYEXXpiDy9zBG3lWQE/XFplYwWq8M2Rd+Sm4fwjQCtbe+EVlsiF4mepTJv8XYY0ixANE3ge4xyLDMSStH0YYyGsEucOGsnnihR1+XtgO4MI55Qix6ZPzA+hwU8S5LzUdrFN5T/Fjryn4PtBIszSanY2cbqL3Z+i8DgwJbyt7gnHqDwLQfES1e5Jw2YbCkHHCBRfmNA41Gt2CnKvKKwAhTd+mL3L8IXvpAvuQMQ+L815eG7bUfQLucAWb8YMw7aYY6U+rd698bCKqDkMpABsNqxX8Q5tgUgNIL9hucIDinPzHMiN2cg7MVNAe4xI4zzDk8uCxlF/Pc/Pe8Deii4ktjLzPinIX0xoIx/E/wDXCy5v50nWbTI7SL60aUC8LDPeM5zU4SBS57Bm8qj/AFwRDwmaSmzWb033SPsB7X3/AJ4Zxr+xWPVaR58T/FHLgxaG0kVaKbJPzxS8V8ZM/LEywZdyqr8R9vfCm8Z+XctDOqQOzV3Ym98MPkPg+aysKZx8wrZY7Mm1ke2OlQiopknJ3RU8ocicQz6tNK7JEp86iwaGL3lTgHC5Mx0mjKqgpnY2Sw7/AM8Xv/3mEsqxwK0OXkBDGqskYjHlv7oo1Ql1kksSHewTicpPRWKissdnIuXyyAw5cRsK9QML/nPwfzWbmIkZBCDsAawb8J5BDxgwusTkAk3RrFXw/kCTr+bNeQd11jzHHLcjdkngTfNv2bhF5oS9rR8t/wBu+D7w48ckgUQZlGOgUNrJrDA5/wCZnVPu+UiaWUii1bD53hP8N4Tmsrrkmyhmnb1+ILjpTuP2IuWcHfnLiOSkl61SRhzuB5Sf54vOF5KBEH3dWkBouJGJoH6k4rOXuRppszDmM08SxXfR2BHyr3wz+fOREMMrQfhkjym+/wAhhMaNchfcY5MyuaYxRyRqSLYk3pOI3IXhFmIy6x5sFUNUD6YrfD7kdY95IJWmsksCfN9cXvJ3Kswzckzl8vAB8J/NjNpKkUVvZL8WvEHO8OEZCdaIDc+uI3hH4uycSdqjECoNzspP+uLX7Q/N0P3ERh1ZpNgx3oe+Mz8r5VYQSmbZW76U9T+2GjFSjlZC45NPcdmCT/hIWl9XbfbA9zF4j9WRcqJCHsaiBSg/M4p+X/HOcRqOgLGxkcCyP645ZLleXOSMYwFJNsV2O+F6V/Yk3Q2m4xlIogZJrkUdozeAzOeJrNIFhRivozjHgeEgy66pGUn11NZ+e2CbLeIGXWIQw5cyv7hdr+uF+q0amyuHI82aBaWgoG4G2IHBosplmJIUFfQ7sSPYYIF5Nz0xp5Rl4z+RPirBLy94S5SM3pMj/wATm/5Y3Zg6pbA3/wCtJZ3H3fLkVtrZdvr7YsMv4fO7mTMuX/yLsB/bDX4dk6vSAq+wFYicTRbobn1wjYb9A/lOBJH/AISKvuT3/fE5BpF97xOy9Fa9cVPGc6sY8x0p88AUkSrtYx9y6gbk2cReG8WidLRgy++O0eYS6BFnsLGMaiRmcyALxFiS7avnWPGe4ex2YgD2xNjIVarcDBFKTiORjl2kS/b5YAOaeSXVtKICh7fLDOiG9ntePfE0LkUdq74FDKTQN8Kyf3aAswtlF0O2FXlM2ZzJmQVQqTpX1NYfJywZTGdwRRwv4fBaJZCVY6SbI9N8EKfshzcAbNZdDIQr3Y99sHHAZtEYWwWUVj3wngYUhTuq9sdpuHILIvv2xgNnM8PlNuCBtgX4NykuouxuUNdnB3kc1S/LA9zZm0hVpiaoE17/ACxgJsvCtVqNX748STxltBYX9RjMHP3jpLmlCxgoAe42xGz+QzKpFPG7s+2oH2xTr7L/AA4tmluO8BYjSjBa+WBXjvIUrRNpkOquw2xM4Pz/AAssQd6cqNV7b4Lkk1i0I0+49cKrRBxaM48G5AzKmmj1HV33v64O8z4QdZVLfhV+YbHDJhL6r71ibmc6ChBNY1+Q34AvgHhzGq0G1BfVsE/EOAK8ajbbtjjHnaWgNvfHSRyBYO2AKUmZ5RdnDFtIUUtYity1JZ1U3scGUy+VTdk+gxWT8bUtoG7dyPbAswMQzTRhyRudgR6YFuJ8ZzbI2iQavbDWeMEV3+uIuU5VQknTXqcYZMQ3HuKvCiyT08pOwx55k8T5VgBby6h5QMG3iv4bNmyixELpOOJ+zqJIgsjklR+2K1FpHRCaWxNci5p7kkcM6mz5Tj5wuKVGfMISi7mm/wB8EvNHh5NkbED9RPzKccuWuBS54AODHEO47XhsbKdlslcveIU8il2AKL3O11+2LfhfNDZk1HJVd19cX6eDsUcdRsfmPfFV4ZeGEkOcaWqQjt7nE318EnNMtVmC+Us7OfQAjHviHIc0pjZtlHYHDbyHB1Z9RVRXrWLXiuUsd9sKmc7YoOIchSstdSx209sdV8OGEaqDe42GGEuVGrftj8kws+3oRg2BEHl3hrqug9h64l8a4OjqQyKxr23xMTOFRiOsjbsf2wLMBM3IcQUhAqk++F/zX4auB21An8vcYeYQFbI39MdcvlwBuNzgDJ0KHlfw2mjUFZ2RfQYNsry2TEwlbq3tv2wQ5zLg7YhiwK7YPZiivznIP3IiaNvIx8ygdsMWFkzWWrYKR3xP4tlxLEY6G4qz6YGuEcrvEVjDfhjv8zg3kdywZ65k8IJVkdyuqMdsMjwq5aikiNoUYbAkbYcuYywI00CD6Y6jJKi0FAxV8mDdgFj5SogWtfTfBZkeHKlV3+WOmXyIJG2+O0OdAY7dtsRbFsFuO8LM8lMTpHp/rgJk5fC5vp7Ba7jDnz0aVqog1hFTK8udtTQBon3wUwIJeM+HmaA/Cm2vsccsjy1OnxbtXf54ZRhOld+w/fHGWNjudhjWYE+WuAyhi8rgj0AwTwzgem59Tj10kbsfqMec5mvQDYdjjAOk8pGw/bH7LzMTuNsccw2qrr9MdZM4EVm70LOMaiu4lyvEx1Fa+YwBc2cr5nfoyeT+E4s+VvFk5mZowoVV73g2hSz27Ye62G2JiDLMEKumlvVt6OPKcFjKgNCjj+LbDuzOSR/KVHzvFDxvw4ib4WKfTDdhk1eQI/6xDK40QDV6bYK1mnVCNKgV8thjhk+eskbEMTWOxA/2xSwcHzGaZgpZFO3r2xz228so/wBFJn/EOLWULanHoBe+LHl7M5qY1tHF7nbbBRyd4LRQSFnCux7sws/zxF8SeDFXTSWEFjVp2/pgOaWEUjFF3kuF5GJSryB5G99/2xRDwsOrXFIQh3P+2OUfIkckiMnwiiSTi85o55+7MkaRmQAVQ9cT72PVaKmSfLREhyzt2r548cq8bOsiOPc+/fFzleVxmPx3jMIq6OBuHic8cp6EasoNaicYGBmfcA5CTRjcfLC745wh8nmAqN+DIaK3sLxZ8u5bOTThpSQF7V2rEbxkzwkliVTeki9PqRgwY6V7KvM59ojIMugB7vIcQuV45tZlJEhPv2GJ3FYWkIWQ9GMVfoW+Xpie0qqgWPZO2w3P647M0cDjk+8L5izb5jSsmlf6Ya3D+ETuAGfb3wC8v8shgCNWq9tu+HVwngjIii9yB3xNgs55TJgAA2xHfFg8mpdhpx0yKBQd98fp47XvQPrgCMrY+EoxCtZxKgy4UlQBXyxW8O4vAGYdUFx6XviBwzxDAkZWjbSLtiDVfthqs1hBmsrdn0xX5CfckjA9w/xly5dkWybIC/PF1mRJIDpHTWiSRt+mN1YUy3ykiPdMCR6A74n5VlBo3+uFP4d8OaKWSR3ssaVb/nhqzSEgGsC62GiLm4VG91vhX+J/KE07RmMmgw1D3GGxJlU2vuPTHAZsM2kbVgDRfUyt4lcMmyUyS9XQoryD1/QYuuXvEDN5l43SElNhrIq/3w+eM8kQzsOogfT/ABC8E/DuFpHGFRFUD2AFYbHko+UBf/o+YnqOArUKqsFHBuXSAL3Y/EcW8ju7C9lGPuelKg0w7epwHFeCTk2c+JSBV9NvXCQ8T/E1mYQJVNsWGDPnLmoGEqoZ2O3lusKXlXwkzEkuuQlVuxY3wrK8cUssL+V+XIVKrp6khHerAP1xYcbkngkt49cde3Yfphn8D5aEKLQDP71vi44jkQ1BgDY3BxlHGScp5szblOHifMK2XYpv51/rjQWWyBVVHqBRxwyPh5BG+tVCt8sW6nzbjbAqhHKyviI1EHFjJD207/LEXiXEsvHZeRVr5i8AHFvF5WB+7qxC7mT8u36YdIKg5DJXgwLb+mKrmTiUSaSzgV+UHf8AbCVyPi7JOCTMUANHT6/ril5y5yy4A0Oda7s0jf2JwaLrhrY2eO+LiqKiQux7XthM8b8SMxPKI5W0ebeNTXl+uFhzF41xdVWVnkcbKiXuf0wRf/QubzSDMyt91UjYV+IR8ztWGUXWSseq8B7z3zpk44tKMI6+JrtjeF/ybxLMSEtlo5Zbsam8q/XesU2a8JsqrxydfqKnmk6rE38hZrDZk56eaCKLJhYAwrqAACh62AMB9UUSbFHzByHxJ8wqNpTWfMwN6fmd8T+bvsqiKB55cy0hAutiLwc8p8IkRpUadZ5mBs6rK/Tc4NeWuLZcZd4s1KPUEP8A743ytOkJKJk3wViywmuQk70qg1Z98aJ8TuJpl8sKi1My0m1neqxlDnE9DNO8QAQNcZU2Kw6fC37ScU7RxZuIMEr8QkED5mxtinJxOVSQJOhYcR8CeJZk9bp7NvXbb274LeHeF2amRUmVoYIV2W9mYfLGh8n4jCTMBcuGlh7AqPID7WNsFPBuKvJIY5IdPp2sEft7Yz5Xqjn61kxfw/iix5gF5QqRn4a3/b3we8Y8TJM88cSNoiQinIq/0ODPnfhvDPvj9XKv+GLLKnlJ+dCsVvNPN/BjGkguJkFCJRpJ+vbDumFLB04ry+6dJomkmeQhb1Uq/P07YZnKngwkLCaZnkkq928oPtjPXLvEYcxMnSz7xora+mT6d6G+HFmvHjh+hkE7dRfIVc/Ee14SSaVIFWMXh/iRTtUY0ixYHqB7+uIeV50im16iyMSRVXil5Jy7MoDumhjqBBF0f1xN45xTLZZ3ooWC6irFdx619cc1MokhIePGZy+Xjb/GaQ7o+4Ab0wueAc6Z/MxozzNUf+Go2uvfffF749eMkfENEOWicsGpqF2fltiJyhydnUQF9ECKLoi2P6Y7K6wzsFK8FhxL7TXE8sNDrHqYbGtwPTHzhn2iOJZgBeiHF7tVA/vi35d5LykzGQkzuNvN/F7AHsMMGDg8aZd+q8WX/hArV9KFHCOUdJZGSYr+NciS511M7KlVUMX9++CfI+ETwAacuCp217X9bxM5QSVXvLQtOf8A8SQEJ9R3wzjyHm8wLzM/TX/8KPYfvYxNyk9jNJLIJ8XbhywiN7eavhjBZr/bEDl/gOd0EZWL7tGe8j/EfnXfDs5d5LggKhIFJI3kIDN+53xc8RzBRgpA0HsR6YUl2S0Kjl3wgUAPmZXndj2J8t/TB5DwNYgAqqg9AAMS+MwEIXUWV+AD3wuY8pI0mrMSOnrW4Fe2JsybeBls67nYt9e2I+SzQ829D1J2AxnfnnNGOQtFM7qxsiztjx/1uZ8vJ+NpVVs2aJ+XfCqRX4vI9OIeImWiIUyWPWtxjoviNAwuMFzXYYzZw2V2iVmicRk0ZKJWvfFlHOYvLl2YkC9RP9MG2tmfGv8AEef/AFDMOTpj0exNYSPjtNmupGHJeP1Vf9sE/h/zmUe81My+ym9/1wycxLl5/Oul1B22BvAFi+rFBy+Y+kDrZV9U7GsUkE4XMNIrP01PlUk4a/MvhsuYoqemR6L2P9MTcr4eRLCUIBYitRGAX+SD2jxy1z4ZauIke43wR5uSwSu2Kjlvl9cqgRN97N4tM6zbkbmsOjklTeCjyvMCWVLdjRPsT6Yi8b56hQBQdbHsq7n67YbXhC0MWV6jRI8sssgYsitSpQA3B97vBDm/DLJT24y0cEhG0uWVV/VowAp37mrPvi64m1gj8iTyZ6j8TVXbpvdexxwj5jksBvKJDsfYYvuefD3OQSFHKGFvgzKrS36K4s9N/YEkH0J3AEHyLpG1sJDFvff9u+Iyi0y6lFrARnPvFYUmXbf5Yl8E4+joWuiDRU98CPK/F5jH1FAsk+X3xV8Py+YTNdSRKR/Qdv2wE2bqqGvLxBSor3wDeKsrsoQRa1Pc+owVtnUAOohb7WRgf4hzlBqC6xq7GjeGWBUjNWX48kEjIV/N2Kn3w4cl4hZbyDaint64Ks7BkDZaIM3e9Hc4opPuEi30iCp20L7fpikqZSXJYAJJ96zPRQBT6t22+WHzy/wowosYawBv88KGeWCHMLKT0we1+UgfT1xf8M8WsuJiDIxU7AkbfvgdfQJcnYZmazx9NvpiPn4zQrse+ANvFhOv0dip/wDUB2wx8qFdBTAj5HvhaJEXJxGgCfLg75C8NWzBaR26WVT/ABJm2uu6xA/E3z3C7XZIGJvhN4V/eblmLJk4j53ogzMN+nEdvlrcbJ2HmOzA5z4yrhYwqxZeMaY4i3TjUD4SUQa3PuXMYuzRu8Whx3lkpTrCFXz9zRCg6eXiZIgKLkHqzfIk0wDep2+QGFJwZz94JNguDd/IjSABdADbc3hjc7wuqmhCEP5obDV+0gND17/TCpg4kI2Z/MxHbVuTfr/bsMDkNDIwM3xGJGAZwDiX/wBTjAvUNPvgah5fimiYsR1XG2+4xx4dyOwi6bXV/EfbEC1EzKZ4F2K0Fv374mSceawgHfvtiBJ4egFdD0Pb/hxYZLg00ZslSt+vfGMTH4PERpKglhuTiNHy8kSaVA3xbcUXSARucds3KCgrv2xgMj8N4GipZ3OI80IBte+OU+deMGxYG+A6TxYhLlSSrC+47HGClZf5nmRY1IZtO+BjO+O2Wi2bUR/FRq/2wBwSpNK3Wm1Anyhew9sR/Erw5GhKk0ofU9jhluh1FLY6eG8eWWMSKCVbtidw3MEiguAfkDj46KRIwbRQJXBuc5RvYEYAjRLMI3Jx7oHcbbYgZfMuzA7EX74t8zGCDdCx6emAApc/x9lU+XVXasLHxP8AEiYRjp+X398NwZYBdK+o7nvhbc1eG7SBgp83z7YKHR78P+IWgZnLah6++D9Ytge94RfKPLGdimWNyojXffbDUh5qjLhTIoI9jgtChTARvYAxTZ3mmCEHWws9gN8LDxM5kY5lUWQrHW5W98ReB8oyPNrLhowNtRu8KxlFDKTxCypqnAPsdsWEnEFZSQwa+1YCOYOScvauSgb223xwfhQjYNG4AO+kna8KpD9F4GTwRa3Zh9Lx14xxaKH8SQgDCR5jzcksq/idIL3o7HAj4p5LMtpC5kMpry3/AL4qqeCTQzvEXxchkQiKXSPWsDnhrxIK+okMDvqbEDkfkzK9Kswyhz2Aqz/PBjzHyhF0VABVRsCuxr9MBtJ0HrgNYudYGbT1Fv64sUlRlIDg388Zf8QuRVgCyRSMb+ZsfzxeeFPGZEZbfV8id8O0qtC0P2ThoSq74hZsA1ZrfEfmDndlUER6yaHl3rC6/wDuPM8pjWH1+M3t/LCqLZhsSQqKIx9my5dGXZbH0wBZvlzMs6EyaRsaGLHifKkrWTORtQC7f3xqMAOa5AlykvWQhgx3FjDL4L4kxCMK/kNb/XHSHw8URLrdmI9ST/rgZzfIQ6o1HUncD/fDN3sAdcO5lhcUrqxxzfPgHdx9Lwus/wAmRCQkN0fSwf8A4wacG5YhVR5uqx9WONgICcR5nEY05eG3P5iMHPh3x2YREMmqQ96Gwxf8tcnlW3VQPUnBLxbikWXjJjALepGOdKzqlJaQrM9LnpJ9IGgYi868tTxx6ppvL/ADeBLmnxezTzhE8gO2o7Vhv8icuwtFczddyN7N0cO4pZFbaF2/NQTJMYx+JYCm/pi58KuY4ZNKyjVL7nfA5z/w1UmpIyq3sPQ4vvC7kd+sZGXQKsE9sK6odBp4n8RdYqXsdtvbAR4ecrzM1tax998FnM2VJPmk1AH4F3JxT8Q49MV0AaE7AL8R+tYhvA8cF3zBzcEqGA6mOzMN6wuuY0KSK0SGRk3YntqwUz52LLx0ilp32rvpv1OI/CTNpKKoVWOpy27H3x0ccaFlOk2CeVYOxlzT+Ynyx3sP0wVcB4c2YNRkiuwA2xd8C5CR2tU1tdkt2H0wa5+JcnG8lqrAbL/tizn4RyRi2FHJ3Lpij0yadXp2sYs+PZpEQsz6aF3eMg5HnTN5hpZ3zDoqk0oGx9qGCPh2YM+Xb7xMxX0B2JGEaL/APDkvnaDMF1VrIO59MFGXyJJKjcYyv4f+HE8shOUl0xBvNvucaNTMtlo11sdvzd7ONonycaWgO538HpFlM0LBNrYE45eGficXl6EsWw8pcjZvTvj9zbzfmMw4iiBo72B/fHDiHh1n5FiC6Igp8xHxHFVTRytNMKIeUcgmYdlIEhO9ehxd52GPpsvX2PriPyvymmWH4g1yMd274IJcnEvmKDf3GF7BoU6cFG/QZ3b+I7AHBbybwjNIR1XLA++Cpp4l2Glb9BtjnmOa4UGktben19sK6YVZbLGt796xwgyKXqOx98JnnLmfNyRlkBQK5AI7kfTHDI84ZgRKkgLWRR7Hf3wjlRVQtWNTNc9RRyhCDv8Am9P3xMHMiAMQRpG9nFBneXCYWJqwtgfPFR4Z5lpVcSxbLYqtj88MLSLDI82TTBjEwC3Q22r646cH4UXZlmZtv2N+2CJskiKFVdNm9vTEhcsLFjthWGz1wXIxKNIAoe++J0cqM1j0Ppjm00a2xIUH3NYEeJ+IuWi+C5ST8KC/3OCmBJsZEkoJ29MQ8/xEL5nIr64TX/1/mppNNDKoexPevT9cAfE+Ybm6Rkd0F6nbZb+WM8lY8D8j7zviOpoorSV/CNv1OAriHiJNNrthl1WxVW2BTKeNCRBctltMsp3Cpua+eAbxAbi0ptMsI77sTW3uRhurY6jFMJuc89D0SRIXlc+Z2Ow/sMBHG/H2HKZcwKOqWFEoL7/MYYPIXhzlTlRJmz1ZFvWNXlU+1dhhRc48+wNI+XyeXSQ7gALdfrhopWP3ekLjhPibmMw6wZdBHratVWR88Oub7PcYC9eWSWZls2SFH6bYGvBzwxz2UmOaeNPkhF1eNDeG3HxOZ3zQUOppBsABg8nLmohUWlbFlmfs7KkSyxaVljBZbFg1uO+ImW5M4tnogHzMcSg1pAo7bY4cW8VJl4quXYhssz6bHwgH540Ly9mcjbQxsC6+Y0brAbmt5JOaZlXxD+ztxKKFnMgeMDcLYJH6YAeVeNZ8L0UEhFaQANwPrjb3innnTLjS2x239cUHI3DWijDtGuoiwwA9fXAfLWGjp45NoR3LvFYeHRCVkkXMn4upe/v3xVc7c6pniixwHU3mberH0w2vFPkyXMQytJoFAkaqFjvtjL/MXiVSxLHGIpYvL1F7msPBdv2BpvIwuUvCmGTqLKDqANIbBGEdzlwNIJmRWIW6NHerw7OQuIcXzbALGKb4pWXSawwD9nrKRkSZtbJ3ZtXc+u2KRn0f2Yks4ouPsuc7ZcZUrHssQBkd6v51gi4x4wSP1vujJ7CSXYA/I4FctBwyIP07jUD0GzfX0xe8NGVzKLGpiePuyjYj5k4hKScrQnW9gVyl48rli8XEWjlLm+omltvmcRObfFfgsyNEIgWYUjaRsT63gJ8fvCrhkXnhnVXJFxKb3+WFVwHkKWQHRE73sp7DHUoRf20ChhcA8G8qskbmXcuDs2wW73322wSeJfIfClZpBMJGoAJGSW1V8jvij4F9n14kEuclaOM90QkmvmcNXwx8PsqXIgg1IRtK3cn64jKSTvtYVqqEPk+B8QloRSPDHtRdiDXphncE+z0GXrZnMvO35vMdNV616YIea+XRDKetImkbLGnmc/oMF3IwzrQmPK5fSr7dXMbUPcLgucnrBlCssr+QeVcv05NCJFGAVWWgN/e2x8pIxpkb72SDpSEFj+rDtgh4F4DOWrNZkyD4uknlX5jb0wyeX+Xocsv4MQB7b7kj64i685C+RLQo+SeSJ5o2WKBcmhJPUbeT9O+Lvgf2eMujl5WfMSXduTV/Tthu5LMG9h8yPrjhnP47r0043ZknyNlTlItFBQoSqAArfEtVFj1B7jHbMOKXb3/fESSbSBpFlr83t9MIIWMOaFarq9gMROK6a9x3/XEJJrI/kDgX5v8AFmKHUmgs9Ht/bGQWSsrz2XkMUQ1MPiJ+FcfsxwRpFk6j27DStdlwjPD3xpWKWYdK2ZixJ7AX74bvBvEJc22mGP4fjY7KD8vfAlDORk/Qs/EXl3oMsKhmIFmQgnc+l4oBl4emVIJdtjdgY0+AH2IGwqyP9cCXGOS4pe6aaJGqqv8A+cK1eh48lYYkIOOMkLRRzDTprpmiB9PniNl4G6CuoLPfmA7/ALYeeS8JsmtkxAlaJa++J/FoclDC8mkIoHcemM1Y8Z+ge5Y8NIH0vKC+pLCt3U1i94VwBMuhRRYYk/8AjhU8vfaPjW/K8iAkBwN6wWL4yZVsvJKr9vyEeaz6Vh68Cvjk8sLuHcxKQQL1qa7Y6Lm2o0La8ZzzvjVmtQMUaqL/ADLucG/IPjSMzI0MlQuq2bNBvpgUGXC0rGm0/wAWqiRiNBnERSxJY/wjc1718v6YFuOc75aLcyevpucUXA+dlkzSLAkkj08gTSQXEaF2Vb2JKg+Xu3YdxhUm2T60rY/+R4GbLNoKAJOG83k8kybE2NjqT17k4b3L+XJQfD89L3/MC8CnhNw3KS2UlkUTRbIw8ilW1AKZIjTR0VZXYsm4phpOGjl+CxKtGTUB69Syf/yBF+XbHsccaR5kpWynzfBkZSjjUpFMreZSD6bi8Zm8XvBV8tHNLlNUiEFjDqLPGBudF2XQD0NuPTV6atkzEZ2Uj/8AOCf5YqM/ACDt2v6/pjSimCMmj+fvJXHQIxUjWTZFb3f+uJnQzbymjS3sWNV+mNDc6eA0bTfesuqiRQWkgoKrsdNSLXYmqZexJJ797jgHKmXkiXqIF+IE1VNpoDsCBv8AKjjn+FeC/wAvszxlfD1XYmaV5CPQGheLPLcqwL2RdXoTucXfMfIOZUk5djIlk1sCAC3kG1lqU377fxY58N5S6yo3VNULYbafe9h6H22PfCPgYy50es/IgjrQNRFdsQOE8J0ppAAJs3XqcKvxmzGay76IWLBtTLpNgKaslje+5Htd1eP32f8AnuOR2++TSgrekfkpaG9C7v3ofyoy4GlYFzJs4cf8PpTI7zK8tHy+3vsBit5d4E8r6VQMS3ljq2272PkBjWHCeFROXdCzom4PdS1A186F386GDvlrw8jgZZBEockFiBZ8wA/lqIO/rgQV7YZclaMw8L+zpNK0smjohY1Kg/mdgTXpQAFn2tfc05fB7wATzmWR+gu8rhq7fkjAs6n3A9QLP8OGXmS+YYIg0rfnY7BVU1+tBT+1bXvJznE2CrFCpVL8hNfieryyGxtVHSCB2BIArFukSXySYZpGjqqsohgjAWDLiyVA+HUibA+wZmI7myTii5omr4ISRX/4X9BZv6sCMDk3N0cS/wCKCdwHI9bo6BRG/a1Uk+g2vAdzH4pN0yUErsd/xllVB8+nfVf5BkC/5RijeBUrKPmfkSeRmaKJwdyfKiJ9SWRaH6/3wnvEXiseSQh3jaZ9mEYtFUGz568z2APJsN/MTiy49zjmpWt5JGI7B1KIL7aVVVFD0BH1vA/kfDx8xKjTrqiVe7bWSdyPX98ckqO2KoV2X5ncP1VkLey4ZvIPF+IzMHfyw32I9MWvPnhXA6IsNRspHb5YNeXeDGOBU1E0N8QbQ1l7EynYDcDvjg4LEAntgc4/x8ZemazHW5G9YFZPG0BwEjZoj+cjCoUYnEIJdViivoMSTAdr2wAZ3xqhDqArBfU1tZxMn59eVlSFddbm8YIW8Sft63hac0csuspkREYEeZSN8FEGYzfmJVa/Kpq8RoZM5uWRQzHy/TGCsCn4kya1EceiWxYbYHBvz1y4Z8sgkIjobUfWsT+M+HbTMkkp0svfRti74hyNH0SWsqq2LOBXop8gs/BHl85fqAfib2D3wcca5ujBoglvYYzBnvERoc24hcqCStA3h++CnL8zgzTebVuCcVnFrZLspEjhnOktkJA7X2HbEyLg+ddlYeUXZQnDGzcgVLQAEfLFXksy9FyQDiYLPuVizPfSvz3xGHEMxbeRb9ADj7PzgsMbs5J2J2FnAPwPnd3ucqViHa9i2CtBVn3nDJZhpQ5UhNO9YRua53EGZYNGzL777Y1hyrznFmV2B77g4BPHjQmhY4FIPxNpw0WlsEr0LiLnHKZlbAdXHcVucEXJvKk0qs0ZYKPym7/bA/yzBlklWQuqMfyV3+WNL8JP/bNIPINJ0kCidsaVeDW0Z6PLrtmCskgTT2DNWB/njjyQDT1dZ3rSbrHTj/LMUhMk7NrLbEnuLwY5LweyskQKr6dycPhZF7MDuWeFxTx9Vs0I2rcPttiHzBwvLvpWPMCRwfQ/6YIc54bIqOSAwUHbCf5JzyZfOhhFYLUBRNG8PGKaszb0G2T5aOXmDzWw7rfbBpmnnlIeOYCPY6G7Vi0595JzMw6hoR6QfoMBPCcxbCJPP6D03+eIvJVegf8AEUTGREZxpJF16YaXhfyZl1XqPIGNUBeLblXkZJARMg1L3+mJsvLEPmVAAB6g9jjOdKgUS+H6ELEHUD2HfFjkeHLu1AHvhXcGzbxztGTYG+GOeJIQBuX9MaxGWTE1Z/THJwFrVuSdh6YiwFm+I7D54mxgUSBqIwDEziPGtJCt2NdsR+MZyMISHUNXextj6zVHrIBb0v0wnOY+FTh2kUdRT8SD1wUrMTs+rZhWUMCyWyMK8x9sUXIPiJ+IYpfI6mhv33wEcQ4pKkpdI5ISBspBq8DmUil1l5Y3ZmYHUAffHQoJI6HlGx+ExPmRIFdgKOk3V4g8neFs6pIJpGFEld+/tiq4tw2bLi0mC/Kxv/PE7JzZoxgyZlRq77iwP3xwKbS0M+LOGL3mTw4zUkj6aIU/Sxgy5D5r+6JpkRVI/MDd4lwJCupmzLNfcKe/7HHjJ5vLsAI4TISatx/cjAfLYy4/bJ3EueVn0skJlYdrFLePuanzDeaRhFGBuimz+wx2hyrElXZMtpFhVqziFlub8tEhrVPLv8Q2+uJ02OkkWPBsszqzRqVX+N+5+YvFO/MAQFEGuQndu9HFfxPmQMnnmKBuyLtXyxH/AOoLHHGYdiHBZyL1X88WjCtiOXomfcJBuQdTH4mFH9MXvCYFjBaV/N+VR6/XHnjnHJJ2TqSJGu1URZ/TAzzJmHEiLCrOAQWZhQ/0xarJdXJjz5FmdlJVdArYnuT6fXC45w8LuJTSM5YSAtt7BcRuX/tAT6+imWL6aW17D09Bh9cK4sWjVmuJvb+2CklsD7cbsyh4hcBzeVKqYNUQq9A7nFlyf4RZrPKWlJy0P5BW9e39Mapnyol0hgDvvYBx6z2ejQadgvYeg/TDNoPzt6A/ww8M4cjEQrM3qzH+uKTjML5qby7woe3bUcEWenkkOkeSI7Fv4h8sW2Q4UigBPLXp6nEnIi27tlLluYjDsMvSgdwN8Sc14hHp6xE+3pi2fiHm7arFUN98SYuE2QRVVuMFIRtAhDzq060iENf5sWef5ezMgXzhML7nbiLLmOjHQkvUNJqh86x65Z5kzr9Ul1JU6V33wtryW6OrQzOG8mRgee2b+I4o+M+GzSzJpISNd7HcnEbw+4pMXcZh7P5VqtsHsUhGy737+mNgTKZRca5JVgKcggix6H9MfOIclJ5SD7fuMFRyoFG/reBvjHPmXgNM2pu6ovmJP6Xh8eQJN6Ln7kdB2s485HJhBekLffC3znjtKx6aQ9H/ADPuQPfTWKPmLNylfNm2lD7gRjSoPsTeAVXE/Iy+Mc75WI08qg+3c/ywDzeJU05YZNAVS9Tua2+QwjufOOiNCHaKNvRtQMhH73hbZb7QyZdWWHW7NYZroN+u+HjCUtIqoQjse/D+Kx5ycx5iaTSv5UJC2MeeePECPIgJCyBR2J8zGvpjKs/iNmXP4YMSsaJQEmz6kjGqeW8vw3LZON5E+8ZlwrM0qlmvbtd19MaXH1/sM5L/ABQm+cvtAZmXdIpWPo1FV/1ww/CHwczWbi62eLpC26RxnST/AOR74pvtB+MGVaGKPLDpSqQWpAo+h2GDzw5+0Ss2TAdlg6QC9SRwoY+tdsWa+txRByYweDciwZaFmy0aRyLY1UC/797xQ8k8fZ1mkzsjhYydIO2pfli34Fz5lSiydTWm9yJuhb2B7HFF4pc+xQ5V5pMq7Q76Wurvse2wxyqLk8m7Ce4/445BRmY16jCUkBBYo9r7euBXknk/P5ZvvEcISOQWHcg0D64W0cC5zM6oo+mC11d2b/rjTyRZqSGLKh1uwNO+y/PFuSuJUjr4o2uzO/Ceds/BkZnCfeHBvUd1A+nywrvB3jYzUuZlzUpQ99CnSL9qw8OP8UkhC5FXQB1qQgVQ9cLfnDwNyMaxtFNL1WOpunZB9fT54nGUaaexeRPwPTJ8s5duHtrjCsVJjcjzj2N979sZY4Jz3/0jNswDZgSjzF7BH0vD7g4zIuXjDk7ABTIe4H98WvBPC+DO3NPGrKo8vlqq9cJDlp09A+NKOdlHwbnCbiyDXGcvAptSO7VveIuV5zlim09RXijIRVN2fT0xUeJ0OacrHkVaLLxjzsmwsbelXgr8NvDFvw5AwLEB2DrdkfX+uA1eSd1hBh4l8Rj+6GXQZ3oDpp6WPUe2M2cicrZXN58nMMkRjUMsCgUx9mP9fnhreIfjpHlmljaOm0ldUZBBbt7UMY2XieYlzLvCGMjEkBLLV+mOrig2OpYo/pnwLOqI1ChI1ogEVsB74B+E8eyk8mYEkqMYSd2YUQL7D1wgOB8r8UzMCp1TlVQecu51tf8AlsYn8ieE2USQK8vVckBiz0Cb/hvcfXEnxxrLFxFk/wAUOZoGFZJHmlLUUCHp122NAYCuUeRc6sxZnTKGUaSl21H2HocaG434fz9eMZd44suoHm0haNfpeA7PctZd52jmnabMBthD8VexYbAYeMqVJE8yYO8r+DuRSTRZml28znUSfcDBPzVylmcrIrxtGEAvS7BR+2L7kzwyzBlOmIZOId5W88zb+hPb+eDDIeC0AlZpnfNMTa9ZtQr5L2/licm3sp9YgDl+ZPvcDRPG0sj2v4QIjHt5jt+2LjknwezaRGOWQ5ePfSkRtm/8mw3+GZSNBoRVUA7BQBX7Ys04martvVn2wFSEfI/AHcA8MYMuAyRq7Ddmk8zfPc4MPvZZbACgbgdrA+WPOYYkd6AHf3xAPFaAv18oI7D/AGxiNt7I+UMb/ibgta+uxGOGe1pTd6xKWAIfkff3PtjtxKXUAoG3a/8AfCmIaZ8n4hp29PXHMZlqJApR6nvePfSYbGn22+X1wEc3eJggdYwvUdiLCnZQdrPzwG6HjFvQf/dFJBJra9+xxEgiQEsTt6VuMcWjDKosaiuorfmo+lY95fglbA0AL0n0xkLVHybzlloaa2PY3hV8b5Idy10vciTuNvRsNWlBoCz6+gxA4mgClWICk732r2GNZjKUXBY5ZHG0ZQ77EdWj2B+eGPyM9v0Y9WXcre4716jDSy/L8BOoqgI+HYb1j9m+EDqB9A1gUHqtj7YWSsqpVg98G4JLGPNP1fXcYl5rKltL6iANyPQkY4ZyBtKr3HqRiR0gqAbkXuB6e+GSJgR4m+Kq5KJWILaz29/lhUcyeNwzkLwtl5FDDylNz+ow2/EnlnKSwOMwQkY3Vj3T54ztw3moZedUgdXQmhLIoAr9e+HS9Hbwxi8suvCvh0MQ0zRupHmBZaVh7H0xVeLfO0DdMZfLjWsgPlGz6TuCNrvB4mekzEh6uYy8cYBHlI3sbV7YVfFeTM1lcykgBzMK6j+Et+U+/fesNBK7Y/JJrCCibxbh0o82XaIjZlC+UfO6x65N5dyeYMs4lBkawh7BRij5057yph6ah9T/AOIrruvy3F/LAp4O8HmlmcwRkRXW/wAN3guGG9CrkzTYZ8wTxoUQPrcOLavKov12w6eFc/5cGIwyJ1kCmx5aYD32/lgJ52zqwRkPl/MauRRYJ/bAfwzlqaYXBAKLAhruvka3GJRVleRKStm7eQ/tFZS4xmQFl/8AxYrYN2PmQFWr3sv/AGw8JuZ8tZ0k1sdWklaYBlINmwQQdh64xtyX4TfhKxiVXAG7OqpfY+aQjGluSuUagiZnRTGvSvqpJ5QbQaha0Ba9z5QMejxyk1k8HkjFPARzcTTuuph8gK/ktjFXnc8D7G/lv+h2P9TiaMkRuvnHskke36ki77Ee36Y9tllPfy3Xqpon0JW6PscVbIFTwxLHam30367Gx86G9HuN/fFZxnIKy2ANQI6qjexe5+qjzA99vXbBnlMkO3xetiv327G9r/1OI8XBAH1A9/Kwrv7H9Ox/T2GB+jC7zXBwlkCgpEit6GwwN/5hrG/eiD74SPJ+QMUzQjzxSuVIN0pa2r6vX0o0fnpnnOEJGw9LqvQhiBX1UkED2wOcp+H0cI83mdmZwx+IEmyN/wCGjQ9icOhGjKnilyKsc8jwaiQjjQTcelEk3N7i9hfYGzuaoU8L/C8zMVYU+YYB+x0KyF38vrWpdvSh374YfjlzKsTZgUqksysx7qh8vmGw0+YkVd39MFX2WeC9aVZ6pVjfYjuSIlRy176h2B9L9hhmsAQX8j8OfL/9qVuJFYg/xeck2T3o0oPqP0w44eMK6g1vRJH6f1/2xB5g5b0umnev8Q/IUAP1JArHXgXDPKSK7ED1ALn+td/pj5+UpR5Gj1lFOCZzgCKt7gFfN7szMSVHzPaz2UnFLzWzSUVUBFVdhsunc0t7aS1anb4/QUBdjzNLGBpO4Uhavu1EsD9b0kd6sbWcA+d5iZmO52OwXsv6AEEgUPrQ2GOiPP4ZF8R3Xh8iBRqLOdyIgKVT3LFmFL3rURqqgKwMc3cwoPKZswv6Rg/oWbWR81XbBLnuJpGCBqllI1FdXkWu3VcA6je1aW38orvikyPLeYmtptEae/TABHsFYEn5sxW/bHYpJohVbFfxRSQT94mcaqKl55D3qmpdVH5EDFln+ZYokA70B5VBJv8An/PfFpzbw/LI6r03mHcmzFHYqtzqDn/Kg/X0xTKyavLF0xt6Ej9z3/liPIjpiwczPOjMuqLKszf5tsV8ecz8jB+n009VvB02bGrQtr+m36Y58Y5hihQmSQKAPzEDt7DHMWoTfM/NefjlKNB1Y2+Ha8W8mWzcsSj7si1vV0cWfDvG7JSyaTKFrsWoL+hOLDnPxpy2TVT/AI7PuuiiP3F1il+KN8bE9zZzhHpeCSB0lHbSCTY+gxB8JvFZoHcyI4Wq1EEED53g55H8aslmMwDKgidjpGoAgn0s1g+8TeQo5o+nGqqZO7hR297w9pYaJyhJETgniPFIvUJIQnyne2OCbK8XeRgwXSlbX3wM8s8pQQxLGKcxCrIvfBCsZI22NfpWJOjUT48sWBt9/XAV4u8t5rNRpHlpQqDaQ9iRgjyWXcAi6sd8S8qnSjJJ29fnjRdOwNWJXgv2WkikSVpdbDcg9rw6sorRqqqyhQN9v6YicP4qrGwffH5EskHsRgym5bMo1o+5niJ7jceh98d8ly80nmugPT0xNy7qFANEdvribmM+FQqhodyfUYARcce4Z5nZnARBTAb/AMsBBlnzaGNE6WXGyyHa/nhzR5JGiclQ17mx8X6YTvHuJ5nM5hMtHE8OXB8zBSoNex2wyQVIuOQvDiSAH/u0Kn0DD9u+Gfmc6UhYFEnNUtkf3wkOK+HUal+jK6OnYEnST898JXjXi5mBJ0iWpG82hjuAcOodsodVLyO1PBPM5qXqaVha7A2IAw6DyXmIsuEaYNtXtgJ8GeMHMpccrIQANLt5v2O+InNRzLZ0wzZoLAFvY0SfbvgNPQvXJQc3ca4fAGE7M0legsD9gaxG5L5vGauPLSERqN2YUP51gn5k4RklgkGlZCRWpqY7+oOOvKPhHk1yJ0zCINuzKar5XeGwkL1dnfkxIV1daZJXPZLFYq+dOZoUDaYY0YA0So/fFNxvknKKB91b7w4+IhvMvz7k4l8H8GVzaq0mYYaTvHe4A9DveFryEGeU/E6Uwyap0buND7V8sV/K3JsgZp9Q0m2tDYHrgh8Ufs55ankicqukDQvq3uaPfAxyNyXmstAQTI0THYG9v39MUk11xsRXZd5/iMxVuhISX2J9sdOEcoy6QZMxoI7hDZP1xR8r8CZcw1Fq/MhPa8MTM8glWLxm7FkE9jiDVYKWD+S5JVJDL1WJr19cW/CszqlBUMWG1VtgC5ehzLSOWZ3pj5SCAFHtiXxXxJzCPcarGi7EsPi/WsGrYrHBl8g3dhV9xeL7J51UVrGwHYDc4U/BfFQOVDoxbbcdjeGnlTahjQU+n+uMBC84rxrMSAt0mCX5R7jH7g/M2ah3TL6id/N6YZGZ40HTSlA3327YCuLxzq1mQdNdzQwyH7egO494lZqOQy5jLKYqoBQCbxZ8D8ZInQaoQpJHlK779vTFq/iplzAxVVnZTRQUTf0xUcn+IEbTHqZcICNgU+E+npivjQnawun+zhlpJ1L55iibupkO5GCDi3LfC4CAJGkBFdy398ceJcj5bLZdZZG8zkbA2TfzxVZDimVa0VV1emtqxCVyRVSSIHHOP5dToy0BbcEs3aseszxaaZenSxLtXTTe/awMe87xaeO+ikDXtQ3P9cT+HeLOZjXSYEVx7psfoRheqQXyeiq5K5dlaUtLG8oFqCSQT/THnmLijQu4+6MoIrXRbYeuHN4bc8/fImbQFdDRA7A4LeI5XyHYE16i/wBsUpIRcjvJjLlfiuXmzYSW6saQRW/0w1/ELlhDltELxpRBYMRdYKc/4AxyydX4Cwu1FEH5Yj5j7NGVaNg0shkY/ESb/bGq9FnODyK7gPhvHEfvGYmtQupFDE7jt7bY9cgjM8RlkDB0ywaldRpBUfP/AHwxuH/Zrtl1zM0aV5fcfPDq4NwZYQsaBVQL2A9sHPkMuWKVRBjkvkWDLUFjo1uff5k478xc4ZeOw5ujdAXWIvO3iHDATbapAKEa7kn9MKfPcdMpBchVbtGFOq/nibkjnpy2XvEPHvUx6ABCfETWBdPGOV5wWiMsYHwr2B98e+XfBeQliFEalro9yv8Avh08K5TVSqqiilF7bnCZZV9YqjnydzpFMllSpX8hHb6YuBKGfXpK2KGPsHJpD6vKq+tDe8ROYJnBMahWJHcmqw6/JzPOiy4Tl1s7U1nfHjOZ1olchdVn/wCcVnAcy8bIj6Sx9B3r3xa8fzyLRZgAO9n+3rg2CmZtmymanzcrIhoGtY9P1w3+TvCZo49387bkn0OLHPeIqJawQFv85Gle3ck1he8U50zjyJHJMsUbntCLYfVjdYSldnSnKWEHUfCOgepPKh0nuK7e1YpOJeOlTKkMJKn/ANR/Kp+l74W+e48IM3RZBAvxSTtqLE+wJwBeJvjbkVmJ1HMkfCseyqcUUW9FPjS/saG5mgzk28k6QxNuFU7n5e+BPmDmf7vRJijVV/xG+I/O29cZ14h468SzSaMtDojUfEF1MB9SdsRuTfBvOZ5kkzZkMRbSQxKn6gHavph/irMmG6wkXY8c/wAZo8oGzWYlteo3wi/b6fTB/lfA3icyxrmc0sMJ8xWLZhfu1d/2x+434K8P4XU0crLKeyFrI29D/vgA5q5845KoKazAD5Sigk+2o37YbGoAqTVsb8H2SuFlHMrzMwv8WSRqv0NX74VXhH4X5WLNZhJ4WnQE9J2UhNNje/74Nfs9eI02blfJ5shRo1amJBJHp3/phr8z+GIlglaKSVSoKp56U+4wrnKGGxoRj/kCUs/Do3UxRxsgIHTRdTWPXEzN+LWTafo/dn1gXHGUAY17D2wquUOa85lR0Ysg02kluooDMT8yTXzwScP4hmM7IMy0H3OeHyky7Fh9e2JteWN1V0NTO+HmS4hDcuVEch2IcBSPmCMZp4f9nOZs+0Sor5OJ7YM50kewrufriw8S+Yc8is0mbCxmwAgJZvofTEnwB8b8tl4XjnGYlkZiRpViT9cUh2UbTJyS0hyc0cNyuXhVY4mSJfyKCVv3B/vim5u4oM7wmSKGF5X+HQdtJ9DZ9sMrM+I2SaOIyOI4pF7SDSb9jt3xVcdzuRjiDQ5uOK/TUCD+g3OJK9kqrZifJ8rcS4cyyHLMtGwSusbe+xwV8ufaV/ELTjzkiigA0/0ONTcxcw5p8qFjWKRWUgyyWPKR6A74APDfknhYsy5cSyKbdh5vNfoPbFZckZr7IvHkaBrmfnRpdOY+5SzRgfHWkkfvfriih5t4g+l8nknjQWPONV/uDhzTeI0smajijgaOFiUXYaLF1ddhhi8AzWajVwyoSLodlr3BxzxST0PLmMvZDifG4po3nyvViBvRQ7dz6YJOY/tXaKhiy7RahpcEUQT7d8NrinjtlA4hIklm31RRAtTfNuwH64UPPPFWkDdZYsnGb0+QPO3t2sA1i1JvKol3sWHOfj3xCMKlpHHdqq0S29+bbBDwrxk45nAi5dBGCAmsKFFH1sj+eLDkzlPKLR6OoMDWYnDN5vYKdv0wU8aytyRf9wMugrz1oQ120r3P7Yp2isRRk2wQzvgE0ShuITO5fzssQJAJO9sKwWcP4PBEiLw+JgzbdQx73627emC/ifOzLohRHzZNBXZCqEntuaFHBBxbkbPZmFVlljyiLuIoB5j9W/0xNykw4WwPh5ajhmWXO5hdIpvu8dl3b51ufpj9w8GedzkciIyxBOYzAICj0ZQbv9hhwcheF2Xy5DhNchFF5Dra/wBf7Yuc1Io1AMAb+Edx7D6YQRzXhAFwnwVnlJbO5lpK3RIvw0Ht2on9cFeQ5WigXyRrr/jAtjv6k74sYsy7MACVA76vl7Y95XUSWbYb7j/nrg9iTk2SMxxHyjy3/F+uOeelSI62FAISXO+kDEDNZ9QSu9FbLf3wBc6eN+UMLQWZbVkah29O+FsCVnNPtB8NOsB2DAnzBbDEe2L/AIT4u5LM6ESUB9JJDbH6YzVyNymS7FAggF6dbANv6Yv+fOXctlss0sgs35Olu1n0J9MZ5dIeqVsaXNXjWqHpwo07AUxGyA/M/wCmEx4g+MOcEenWsasw2X4xv2vBdy3MWyJlihZXI/ORe9bgdzhbcPXpTiWaJJCptVlsKG73X+uNG+1MzSStGp+Tc2wycLznWdCk/qP7Yt8tPas8b+T1U/0GA7gXNH3mOORWUso/wUPlBHoR3IxfZXNuy0yiM3ZA7G/asB2LgpOderIj9GTp/hkfPV7b4TUXFBDFbV1kILFjbE/K8O/iPCYJWKMTrAvynce3bC5454XBwx1KCDemTY6fcH1+WJTjZ0cfIoqii4XztMJEzJtQ3lDHcV8x/phn8M4vmJSjdQPGwtzprSPYVhd8W4ZGqxI8mvKp5iF+IN3okemCbhXFS8fVikkijSkULVH0813hdBk0xgQcWSQE+YIvlB3BYjviNm5Igq69R38oO/8ALAxxbizZRlMx1I4Bjbb4j6ED298EEMhbpyl1OoeVV3HzxSOjnaySMg6kN5So/LY7+xGFDzrzJmos4HZyYhVR1QI+v++GY3OKRSKsjqS5OiwdiPT2+gx+5kSPMgawpJJCkkDb39/phzLeSizfisiIpaJze9LvR9PXFFlPG+gSYmtj7jYfv3wFc7cpZjLlRAzzgm2WrCD2v5YFpuCS31JNSVuBdKff6437DjwNziHiflJ7jkGlG+IONj6YW3ilyNDGifdoRLfmJ12EH0vYY4cd5xyix2QOoKBHcHHfJ83NJHGsi6Ms5okLTEe2ob1hl2WR1PqLXi3E2h6LNB0lJsHcq2/a8MfL/aAZRUSBiVIChbINd/XtgxyGWy+cheFowVjbTApvVXvvg25V8MsplY7hiCuwGrWNRvsRv2vBbRR8t7QquQOaMk8bLmFSSeQsXZlA3Pp8q+mKvNc2HJTrFlinSlPw7UrN89zg4578HMtI3kBimNNrX4LPoR2xR8j+CEayrNmZdehvIq/Dt6n6Y2PY6nCtZArmrn3Nya4pICaaho/ka7n5HFh4FcqZsZh5HWSKIj4SSAT3Gxw7ebOCQupdTocEBZPXb0+eK7K5/MBArSI0gNhXUrqUet/0xuySpIR8lqhj8t54x7MAxJ2sFgf/AGigf1vGi+SOY2Melo9BoAAAafke1D6EgjtWM0eHmYmmlRZlSMgjRQZiV/i07V8je2NMtL01UbsOzAUW37H1uva+2Oz+PdHl8+wg4fxezpYFW99NV9R2r0sH9MWv/SAO4B9yO9H+o9a9O4xW8vcJerpq9ATen3q7JHyvb5b4sySu2rY9rvv7X/r2x0NHLZHGTVTY2Ibv9R7diGGxr1HocSTAL1AWCQbHy9R/mHqPUYif9QG4B3rdSR/L3/Swcd8lmyQRWxN+wv19PKfr64FBKfjuUUyIpohvMARsd/8Anz/bAXz1xbozxKw8jkU1VoZSL3+aEn22bHbm7mG83l4dwbZiRtVD+u+49Qb9MR/G3hCyjLqSRcq0RXcXfre63Vb3thgGXftocDVpI3UqEnjdd/fvr99VEADbesMb7NOVlyfD45JewTpk1V6DSybejoAa7gnAD9rPliXMvlY4zapaBQCFJUrqJJoXpUmrut6N7MDM5GeLK5DLhWYR6hMTuQsdhTJXzI+oP1w3gBorkmHrw9RgQpOs33NAkD6aiP2wMZ7mPQ7xrpWyxX2AFKHf5bMT6aQcHHLjBMrpXby1/L/fC25Y4Wz5mRnFqHUKg7MEshf/ABDUze5G+wo8fLxqX7Onj5K2dZ+Ujp1uaB+E7Bjqtmb5O/c+iKa7jC/zqqXWNaurVAxCgAGmcnc1ufRfqTeGzz1H2BZSd7rzAHuVRB5nPudh7nuMLx8siliQ+qQi6oOVGwXfZRQ9Lr3x5nJx9dHXGd7OX35lBES2o7tW7MPUnbt+yCsDvMPP3T2LKzHsPjO3oA21fPYH5gVgnnl1ij5I1Hw35NuwO4L77n3NbYW3NGWJVtC6dzqlYUzH2G5PyVL7fF/DjR5GjOKYCc2+LOZZviMaDb8PQrN77hQT+mwGPvBM48lN1pD2JVmP9P74XfMiyCWgdTXuT5j9CV2Uf5d6wRcChcdI6SCXFspJH6jYgH9sXjNy2aqGLPEzKCdgDS+5ws/GvkeHMRqXzIhZb7nY/phqcVzhBQCtdmx6VjP/AIweEE883UibVZOpGat/lhU87OjjryKzlzhmXjkaKZw6k0kqbjc+uGPxXwzySwLMczpIPk1WVb/KB6YWOe4Tmsiw6mXrfYkAg/TfBD/94UfLtBmIA5u4yNih98dDi278F5SdfUlcW5Py7lWhkVWoE6rXf3F/yxa81cN4uiI3XZkAGnSR8PpvW+2IHDuCQ5pVWTNDSBsmgK9jerrti+4nzXlvu6QrJIjRjTRJIatrwHjWQRlKTqSKPlX7QL5RdOZTqajuwI1f2wYZ7xNz2ZUNl8tJ0CPK22ojCO4tDErLIyrLvuGPfe+2H1y34wL0I9KNGB5T091WvYYLSq6J8nG7wfOB8+5iKvvMc0a+7Jaj6kdv1wfcJ8R8tIARKhRR5t6/kcUnDPF952ZUUGNRX4ooufkDih4n9nKHMymZnMYfzGKPYfPthajeTmyhkcL5hhlJMLqQNiV9PljvIxBJ2I+uIHCOT4svGIoVCKBf1+p98TMspX0BJ9fbEHQ2T3DmFJAo6hv8lxYJl2sgEebuTiLxiTygnYH+Ebk/PEPLNoNkltvhu8FMDQSvxLT5RR23wv8AxI8Y0ywRFrrvstAfucEUOeOl7UC/1NYFuO+HMMzRTXUiDsw74ZMWgL5QTiOZlMbmNVbzMdPcexNYFOffAKBZ2br1IxtY4vNbDDmz3L8rINEmgH4inxV7DHHJeHOiyhCuN9T7kn1NnBjNrQ9IzLwrlrPfe9CPJGVoaha7fMdsNXmDwKz0xVvvIZ67tsf1rDBKzRkFViaRr1Ob2H+uCaTLmRPNJoJrdfQ/LFO7YXKtGVedeW+KZMaHIkU9iD/asMvlXmz7zkkyUMDGTQOq57B633wRcf8ABdDKrzZmaVV30E7b9uwwacv8FSCOo10a27juR9cGck1Qqm/Jn7lblU5V3dpmWUMUaIb/APzg1Oby7o7R5gwTKPPe3/6uGTmuSvMSKGxbUws373heZTlGI5l2LB3dfMCtKK9sSu3bN2VHbwS5qLdVHl64G4bTt9L9cM/PkSIQRtRoD/m2Kw8OaJQI40AI/KAMWuY4l0wKUuSOwHb3xm84EFVwvw0lhmbMoS6k+eMklh88NfhcyvHQAs+53GOvJuX3LgMC5+BsKbxskZM4iZeTSXFuA3wn+2A7bGQ1JsnFEm+kFu+w3wK8X5bhdGVlUg2cB8y55I6K9Vh8BPrgkhyckqRpIpRiN67g/wCmGSFZXcpcEKyM2kdMAKoPsMFma5jjZWWzfah74HMiZVkMXdVH/CTixg6UTkOw1VYGMCyVkeFKnm6jM3qD2GK7O86QM3Tu/Rv6Ymcr5Zm1Md1JNY7cT4Tlta+S5PQKPX54IBAc38qrHmZWjDRqQCrCxZ9awRcoeOhjCxPB1mG2uhZ39cNzjPAVnhFqAymq+XywkeY+B5SPMALO8TbWrL67djh1LwxqQ1fFPja51+knUVYdyCCvb1AODTwj5YgziMJYQDENHUrdv1wW8R8MGnzbyPUUVBVVe7geprB7kuCRQqFjpU/NpHc+5OEugNrwKfiP2boRbRTSRsewvYHAVzBy3noJfu2k5hXA0yVst+5xpD76jlgK8u5Ptjic4gUyE7Adz7DG7JiW0CvhfyWMnEyai7SHU59AaG2C+TMC61HAJkOcJZBI0UYWOyBI5oH51/TAVznmc6vnEwF70u2w9RhG6yPGPZj6bOFR229PliHHmzeoKWINfI4BfCPieYlTXI5kQehHrhhOrCvZzYr0+WMneTNVg9Pmq9fqP7YjfedbAbj0IB9MWbRqEba2J3/1xw4fkmoFQADd33+t4LFKheS4EktYw7NuWO9Ykf8AQUEhbpqTt+UX+mL2GJQw38xH6H5DHPiPHREC0hRQTQJI2wobZHUqKPZj3B9MS4Zz3+GtjgN5m8UYAT01eeQAf4akr+rdhgGfxAzMshjeVMpGwO96n+nsMCx1xtqxs8f5gjCEmVUr1LD0wD5vxPygXygyyHYMdgT/AOR2rC+4ZlMmWIkeTNaH87MdKfXvRGBTxy5/4aSgEigREaY4T/XT2PzrDU2VhBDL4pzZmgBIWgjvy6U88tfp64Ds7zisLFhbtuTNmW8qfMKf9MKTlXxTlnzIiyqdGN/ilca3UepF7YOuI/ZgyjEvPnp5tZvSDXf9a/lhuiT+zK/18Fhx/wC1pAsJiJXNSepiWkr6/LCjm8bpp0IR4MpGG2Lbyfpiz8SuHcEyETJAJJMyVK0W+EkbMw+RwM+Gf2W5cxlGzmYmTLQUWVnrcfuP2x0whCrE+SiP4h+FGd6UWY1Pmo5d9anUt/vtg55X8Bctk8omfzYfqndMswUhj6bdzd48eF/jD0YpcjlNU0ZsiWU+VD66QbobbYKspwfMZ6BUKTTZnLvrjZmqAqDenbvYG23tgSk19Rk7+zIfI3P08U0kr5VVhcALEoAoDtsNzeHFwjnyLMrcy/doE33FG/l7j9MAPI3OCNK/3mLoSIdJiCFySPXt2+eGXm+HcOnCNM6aPZnCKp/8b/ljkacnkaU4+Aa5uyXB3njkmn1ivKvcf+7vgxySxSqYsmhEOnTrqkv6msVI8O+EHNI6tHIB8McRDWfmAaP7YjeI3OfEHJyvDcoYh+aRgFT+nfG63gl3YjPF7lZ4Z4xDJCZU3EcZLPI17g6Te5wwuCc7cYky348EGVjXYampmr5E+vfFNyf4D8WyjtKqZafMSHVrckuhO9C73/bFPzHyY8yzf9XzbZR1NxqsgYN/7QR/z0xek8GcnLIfcoeLWf6jskEXRVdIZbIcj1FdzjlzxzgdKZmSRGaxqyjAh2A9FXuThmeFa5bL8NQwyq0CLu7AWT877YTfN/J0maljz+WTW0Em4O6yWeygCq+eEwnTFSbCDlnxQy+baWV8kenDH+HGY7Nj13G2LPwA8TMlmpJQ8UEEyudKlQGI7Db+uLDP8A4o6K0SQZdpFp1A7ahvZob/ACxXeH3hfluGFjmAJMy7X1xGTWo9h3wrkqZSKJv2juSYMxlZFJRHj8ymwoH1rGPPBPM5VM6j5p7ijawtFgWHY73sO+Gz9o/x6jZpMpBGDFY1sQUdjdkH1rALyPzNJIujK8KSRyCvUKM1bdy2mh798dHEmoZLOjZHEM+eIRr9zeExuNMjDvGPYD3rCs5+4cMsv3bLyLD/APjTyEAuf8oG5J+WAbknw24hGjB8190RjqeDLjz/AEsdvX6YuOWkyv3hUMMkrWA0s5aRwR67g18sQ6RTuznbzg58k895uEdPLRmRdVtms15VT0OlTRIv2wU82ZLMSRNNnM4zxm9EeX8isa7Grcj9cE/O3AcoKUzdP8pVjqYg7+VAfX02xx4JDOqFMjkrANdfN+t7EohBNfthk/QlNgDwjMTtHEMvAIE1DXNQXy+pZn3JrDO4hzdkYljSSM5mQkaXEZcMf8rAV/PH7ivgfJIofN5iSYllHQh/DiUHYilO4+ZwzeD8jwwxrGgUJGLWwCV/U4FLybtFfkXme4RxCcrGscOTy53U6Q8m49tgD/PEvhPgHlVdWlLZqdSCDMbA+ar2H6YPYuNIGCt5gVJQ9jqH/P0x0ikcMsjpVbE37+uNaQHNkfP5S0KBV8tVVeUD/TEjK5wFQp0mQ7AdwF9zjtHmY9WhR3UtffufU/2xEz/B5CfJ5VC9x3P1wjYhzOZ8wQbBN9QPxH/TEzKPRYkCibb0Ye2/rgCyfFRFIY5pRHJdKK7g9rPzOCniPMCxbFXksC29APWsL2Gosehqc0Cdv5e+BHmnnkQLpADtd6SwGkDveIPid4nJBlg9vG3ZNJAc2PW8B/hJwUSl8zNC5DC0aU6rPvX9MC/QarYXnOZrNI2yQROBRO5K+tYhv9nrJBF2LPVsQ1avn+uDLijkJa0Fqvp8gMc5JhpS7BFUfUj541Gb9GVZ3WHNyKU0LE5/BNkkDt29/wC+J/NXOM+aG8LCBDXlQhR7ajW/1xpfLcAhEjSdKNpH3OpQWYAbd8TOIZdSnT0KYyPOukCr7Cvlgh7Cg5e8F5BlkdJysrCwpNxgegr3H1wIc0eFGe0s2qOct3F7/oDhm8Ry88OhDIGhG6oinqge23t/THlOd4DEdL3JsCpUh/pp79vX1xkZkbwj5bjycY1ppzDg6mcir9lrBzms+zr8BWzRB/kfocAfH+MxyFQELECl1Erpb3rv++PeW5cz0xWmkRfmjV8qdb2He+1Yp0k8ku0QqhdFZ0NIWXdgAP01etYqc60BKo8isifxMLPyv1wR8M8IpCCJJGaxV6gHX30t8DfKwhx5TwHyqgHXKrDf8QVv7+bY/VD9MN8L2xflQHTcdhCtHCqWdwrJYYexBGAfjEE7DpoqpbeZEtRfsVaqJ9D2ONDZbhcSrVJKBsDa/wD/AFe//uxyynEYC+lSgcbFSV1fqP6Hf64HStg+R+AA4N4KtKiDMM4KUF1em3pdrXod8X3FfCVUCqJTFpHldDRA9njOxX3K0fnhpf8AVZAtKR/7/hP/ALhYH6jATzrzXOq+bLxyqQd1njpf3o7/AOUCvfbFYpEXJsz9zv4bzBgTIuYjB3aJwJFPoShN/wD5TfteKri2TZQAHMhQg1Y6q+tj4WJH8x88Gx411ZArJLH8pGWRa+UgUFh7A2Ppg74B4TQTACQrIoFDXQkj3/8ATew6AjbTen9sVivAtsyrzfzvOATFO1iuoratQ/8AKiGA+q17nHzlzO/eQpltV9mLGNh8ntgpP+ba63xtnL/ZuyVhgCW7aibbT7ajuQfa6xwk+z9l1soUW+/lAB+ZAsX6E7X6g4p1XoHd+zLfF/A5FXqadaEKxPl1oe/5fKQfQnyna63xacL8JWzESCN9SKSY9wF9bQgbij79jtRBvGgYvDmSE1E8bgf+kTp29Qm1fVd1O2LXgnAwpb8PpsdyVrSTQ7lbo/5t/W8ZpAUmZv4t4UzhSyahMg1kKSG01VgepBHpYNjti05I4rIkZ6rM3bU0n5fS79Af5HvWNMxZAH41or615hexv5EbGvKw+mKzi/LMIbzIhST1oVZBtTtVt3W/i3B3rE5caZZcj8i0ZImUVIuki2OoH6XiPmcksatp3JAKrVj6jAf4k+BEsU3WyVSRE6pMtZAC/wD6PfsPVe6eljbHXlnnMGkmV4CNmVwRVbDzHtX19j64558TWi0eRPZVcX4qwlRnNuGHloiNQe1j3+uLvmHJy5soI9KrYUMK1Ej0G998EoyiSFmTSwerNA7jsR73/LFnyb4YStIuuzErFwq7EMfc/wBNsc9PyW7eg18H/DWSNTJIxeQiu3wgdu4/fc4P445Ub8SmHoAaYX6ldrH0IPywQcE4XpVUVW2HqTX7nFvFwYawSxqqOxYDtRu6v67Y9bhjg8rkk28hPyxngIh8JIqwpbb/APNuD7gn6Y8Z3OEk7Ai/UkH+4P8APEfjRDLSgaqAuhv9Pa/2wEcU5dz/AHSUKP4CpYEfW7BHY4tIWKCDieZTfVQA33BP89hihynOMBf8OdNfZo9QB9hsd79t9+2Ez47dasrl5Mw8TZufoEoxRqKSSMBX5tEbgG9iQfSsKL7RfgtwnhvB5M/FS50SJFFUrrM7u2zFtRdwAGdheyqxBsY8Xm/nx4+ePAk3Jq//ANZ2Li+ndvBp/OT9TiUQYVpQlXH8jfYj07kqa9Dg75g4IHq68jBwfmp1X8j7EVeMc+BHPGeiWGfMFs1lekksiOC2YyyMuppIpK6kvTFs0T6iy3pcEBW2rxThLoEkUiSFwDqXfyMAVb2IJI83zv1x1/xv5UP5KfR5i6f4ZHl43Cr8iQ8ScqGkiNKCs0rutajqCARrudiwU3XcE+pGGvkYYyOowFOigihsRtX1Asb9xhceJXBA0yMDp87MKBOndST7Bm0lFJNEnSBubquNc8skCazVMxdQfQWAwB3A2qj2OOtuiVWNfhPMSjUl7C69h9f0H9MCP/1zHHI51Kotvqfp/djtjNXNPjFJDEZmYpHpZmPb099rvYAeu3vjMHPPMXEM7kszxB8z0YIZI4o8qk5jmlMxAD9NKeREU27sQgplUWrXBzt0WUKVn9JJvF7JavV3NjZWbb2BoCvkNvljxLzPHJ8KSb72vkr9AFuvYk4/l34Y+Hb5rpaS6tJQ1qzBgxJApgwI39bxpj7OfL/F5DmMu05lOVmeJml89hTtbWGsqRZ1NvjzZcsZylCLtraOuMKSl4ZqHMwoBsCx/wA5tv1JY/8APrgV5qjLLuQor4VNt+rdlHvW+O8/JGeUdvr5jR+l1/fAVx+LMK1Mt+/civ02/fHA5N+DopewTm4VGG9LuwNj/bvjpHxAq1AfUD2xF4pxHe7Un5EH+Y/scVkfETrBr5WMX4tCy2eecucYopYl+8BZnZQsZ7FWNE36Vvif4ic2dBoo4QJZZDt6ge7WMLj7SHJsT5dZ4kcyR0NSflF22qvb+WKDwi5hQwo8ju8kdgs3wqPa/wC+Otxi49kCN9uoYcXyqTsTL+JJXwWSFI9B6D54iJ4OwGpmG16WSv6X6YpeK+O+iTp5WJXcmvIupix+YGD7lvIZ/MLqzLjKoNwCoLH+lYTpNK7LWkL/AJm8CCWZ8tKBIN1jO2319DiZ4O+EUvUeTOBQptens1/5sMLjfLriuhOry+7rsa7ixi45b5UmADO4VwLdB5lI+Xrvg9pVQXMoM94OcOkJXRpPyNWcfsnyFFlw0UKE7gg99z3F/LBnxfhodNI8pc0HWgVHvfyxF5fDwqVoyBTSu5skn1/T0wLdVZNzZ4HLEW1qjA1a15tVV3+WBDxWvJZZpoDIjrsBZZRfuD6YOci9nRY1btfqD638/rjtxrgQnjeOXS6MCtHfV8/mcFCKXsyrwjm/iOYF/e9LH8mwFYteD+M+djcQt+Iw+W5+d4Lh9nVUzAZQdFbAE6VPvidxjwYjjlSR5CoPd13r5Hc7YeU4nXGmGHJ3Ns8vleFl+Z7YJ5OHtfaqIP1HtgX5J4rpkkVZOoijvdg/LF7n+IeYSkvXqq7/AK4jDJHlVMmZ6De/QdwDWIvEMsDpolRW/vifDkAGLA0rKCbN7/r2+eIrZtQW1UaF9779sUZEl5CVVoLV+2IfG82JGCyEKBuRdH6Y5RA/4mw7BR9f7498TQ9yocGga3IOMAl5xUVARRX2/piRw7KUhOkM7b/JfYYiz5YaQD5T6KN6+ZxwysrLuG1enyH6YIGj5m+IEuEKattyD2OLDMShlAOyCh8/3x4hYBS1HUdrOwvHiNyRTAVfYep98YxapmQBVar2rA/zAkUbGVlCADzN6AfXFhZXU3/tCDveALxK4Lms1lJY4Doc7FG7Eeov0OClmjETLeNuVKtI9hASqNfxD3rFVL4/xaiYoZZiBsVBr9SaxT+Hv2aAEVsy5JAsx35Qf3/tht5TlSBU0RoAQKJA3r1JxRqKeMi22CXIHiRrSfNS6k6atpi7gbGt/fAzwjg2VzCfeeuEmYlmEh3Bvar/APjFrzRxGAA5HLDqSuAZCOyAnzb/ANsC/EuAyxMQ+XWXLqALCbjbc2B6YGBkNrIeIcMOVt5Y3kQXuRZ+mEpzd9pbMiVNOXIS7rvqBPpti3jh4WkZegXfYITbWfYY48KnmMrBMtcenSsjD4RXfcfywY0h+jDVOZMxpWbo2jBWJFWAe4xO5i5iiDCQJqoA13Jv0/TAdwoPk21zTySRMN49NoL/AHoemLHiXN7KhbLZR3JOxK2N/bA/Qso0HPLHFI51alaJh+U7H9sSoI1o7ja7PqB73gM5a5UzCuMxmJfxGG8S7KoPoR8sGcWbR1PSAerDUdvnhXgWjtyxnVUEfGDZU4BvETkaPM2/T8wIojvsfXBLmMgbVgwQr+QfD+uJHHOOOIwI087EDV2Ue5wYsw/I+JXIU7uBsPSsR58+RaqhJHxe1HA5lc3nIzTQoTfx6u/y98TuHxcSJcskQDbrZ/Lidm60XuX4eVBcdm7gf0xHz8IdGDqoRRY32/XFbk8hxB7XXEiE0WUEmvliJwzwrILiWSSQE9i1KT9B6YNAx5F/zJzR+CsOWUSStJqK/lWj79sHHKXhc0ul80xZmUUg2VfkKwe8J5NhRaCKtDahv++J7TLEuoglQP2Iwevs3b0ceG8JjhTpRLSqK37Y5ZUEkrIdW9poHYfM4GuM+IOXQLJJJsdwijUSfah64DV8bppneLLxdFSLWWUbn6L/AK4FhUGxsy5xUuyAL3JI2/fAnzN4tQREJCHzD9yE+Efr2wkOKcZcyOrrLmJ6sK3lj39lGCLIcZKZRzNJBlZKARbGpfTcDB3odcaLDP8AiHn815USPLICAZSbcA+gFd/74o/E3gcsaQsryZpmemdjSKN7JXYbYVXEPGWHLDTl0lnkZtJlktYnkv8ALdWLwSL4XcW4iqnN5joQsbEGXoGvmQT3w3Tyy7h10X3G/GjLZaFoZsylmv8ABAL/AEsYSWc+0ZEmrowdRr8ssp9PcL/th08B8AoMuJXfKRjLqD5pmBlcgUSCdhfocL/lT7POVzM3WTyRFz+DrD6Vvbt/rhouC2jEz7OnDG4lNK2ca8tpsQxtotr9lokfU4pPtZ+FuSyvSfLhonY7xEHcfxWSd8M/nHw8yHB3GcSfoyCMqkN3rcjbYd98Z78UeZ89n1jeRJpAoLBumQu/8NDcAYpB3K1oKXkan2ceAQpGJZZ45A2wiQecH2ODfxq59XLxIsKLLKTtCCeoPY0N8ZR8KPEAZLMo7qSgPmBsEfOvljV/KnPPCZZZM0k0YmKg6mNMu10Fb2xPkg1O2rQW8GXOe+R8/OTm5MsYkJqqOqvfTV4NuD8k8RzuQTLxSMuTjcluodNnewdiSoJ7fTGmOX+amYpPGvWyzBg0zG6I/wAvt39MF/LHHVmRljVIwWouQNx7afnh3yuqo5jD+SyJhP3bLvBEO00zNu4vfcjb9MPXJ+KmUyWX6cMqST7XpcsCwHpj74g+CvBp84kRm6cjWzkEKWIuwSRQqva8WvHfs9ZIwLDk3jQKfPICjybd2Zu4wZJSywqVA7ygDP1cxm8w/WZWZctCoU6QPVgL397xTeFvh2OKB9UHSysTsbLv1ZGvcavb3/2xfce8P8zlsu5ynEIXKIfKEVpHP8Gof6YPvs58SzX3BWzMoR2ZwqaNLKbNah7n++FapWBZOnBOWMhw5TLHD0dIpvidq9KsncnFtB45oE19OVbOzOtbfxGjsMDHE8rmBIHlMk1SGolG5X3I32GLnhfIc8qSoQOm7EhGFyAE3pJOwHyxyOTZRRS2GGS41l5ASczu62NHpfffGf8Axj5t4RlA6S5eaedlbpyubBJ7Gy3YfTDf4lxjh+RaKPMssRKghGXYBexJ/rjH/wBpjxeGezXTj0SwRMOk0cZBI9R7nHVwwbdsZJIofDfl/OZtZPxXhyqm9AJAYnsFXsR2wQ8V5u4tw9AozCxwqfw0Gm2HuRX98MHkjLZydRGmXjy8QQAyTbEAD4goO5+tY7cW5IyEKmSfrZ+dQCoa+ipvsFHp7d8Uc1edAFKPtBcbzjhY5ZXO1LCgA296H98N/IZ3jksSDNZqLJx7HzgNPXbV8J/rg98GebFm1wx5FIFWPVra4lo96/MT9MVXP+dyTOOtMnSB0dLLW8pO2xY2av0A+WJy5E9IpCD8gzxDwqycX4jS/fMy5XSZTWotsKVf9MMCb/qGViSBI4VDLbuqhFQGu7EWa9aGOfAuXJWnLZPJrloVUXmMyup+2xVLsYYPLnhRrYzZqZ824NhW8sQuvhUbfveEu9sWdLyBXJ3O7p5NCZyckgdJT0wfUSSNQ/r9MWmZ5J4nIS1wZVS28cKBnYfNyKv6YeXD+X4TpVQq0NTBaFe3bHBnIjYL5iGoD1waS0QfJWkBvJ3hRBESShllYWXc63v6t2F9gNsEUiOpUEbdmUdx7Yq+O+IC5fTQLuxoxp3Fd79j+uKHmvxRe/wYXJADOWGnSP718sJ2oV29hTPM4JZV7A1q9KxH4ZxlZVtgTZ01RBY+p39BgZyfihJpV+kzggnQt2AO70RuP9sSuRea1zju4GmGP8xpSW9QfXSN798DtYeoV5rIoenqHqR8x7AY8S5ITx9ItY1HZSQ4r3PpiPm+Z8r1GHVBpSwRTZNfw1e2AbiHjB01/By7O2rYsrKDfzHc16Y1gK/nbJJlCgWaYu7AAL5qW9+/t7YNOH8HzSFSsmuEgFi5p1vve1GvbCp5e8RGkzTy5iNmMamlVdo277A77++DnhfiG+ZjkIjWNUI1PI9KV+Y77Y2AZKrnvnDLRXGymcuCxK7uCOxLA7AViMviv1sv+Fl3YqNNkigRXfez89sXk/AMvlKzQXqFkorF5lIb1F+m+AnmSIQ6JY4ZInYs5TutH1NHb5dsBpDxP3NXh8WyXUmTXmGOpFDMdCH2X5D5YNuUONxRQRxq2qoxancj/cYHOGoxQTxzFltRKJL8it3Civ8AXBbxjgsB7UppfMmx0exPzO9YUe0Tjx1KF7BRYB9j7+t4i5TiizKGVbMbWyudO3oa9f6YWnOedyuWY6M0A38Lm9/TTe9D1wL8yeLxkVAhiDKNPVZq1bVtR3w6hJiOUUHeY50meRpNQjEbUSCKKDuAD8sWcHPbTKDH1CrN6RmnHruLo+mFNynw15T+LoYbMCjMSfS9NHf5it/rhxctcJQHZpAAK3AUH172WP7D98UXFRKXIvBWNnM2uoiEA/xGmr03vdfpWO/K3hdBL58xGA16r1utfOlFn6agK9sGmQgRiPMxXf8A9WXax2NEN+g/fHfP8HiW+lFI5PqHkP7CRq/vV+4x0xglo55TbCLlfgkEIAQal7C2dyv6SFv64NYOJx9qYE9vIAP6V9e2M7TcZdXtIpVYDfRY27b3at9CMHHLHNLMKbUCfcUa9qqv5V88VTWiTQX8ZyqSk7NfYkKKI99jf6rRHbFBxDkqQDy5mVfYE61r2OtWv9d/nti/4ZkVPdf2YhT8yASAf2xezcuo6+qEj31A/XuD9djjNhQgeO8tyEllk1EfmUoN/Y6DZF9gyn6YqYeHSk3qIYf5VZdvUGlIPzAU9++GFzt4OBySrsjfTUPkQavb9dvTAny3wCWIlWeM1+Ztx+o2ZfoRXz7Yi2Ogv5d4kdA1M4oUTWsD6g2a+l4CvEfkKGdWdWhR++vpaD9bjdTfsSNsHXBERD+JqYk7GOyB+gF/yN7Yv81DH/BrDfxJTf8A62km/wB8T7UN1EDyFytKjjqSBwD5GvY/U6d/133xoLgnDDQYqG27qb+uxAXHLhPC4VJaul67oK/UgE19TeL6OFHXVHLRHrEw2+RDBgP/AHDGjJmcUSY4DfZV+moGv/aKOP2c4o0akhwNu9XX1BXFZPltt5bI9ZUH/wDsh0gfsfpga4nKNw8bunqyssgA/iBQaiPkwVh6Xi6kTaOz+Kik6ZkDi9nQHYjvqUjy7eqM1fwjbF1l8zA46kY+o21Ae/fSw7b2D7+uBLhPAsu1qJA6kmlZrIPsCw1ge4a6+WLf/wClY4wKLqPTc6lP+VgLr5b18wBiiyAmcU5gGjsdh3XvXsVO5H0O29dhhYZnnkhiF0yRts0er39UY162Cr6SDVEHuT8yZlFUEOGDbeYBVZj2DMopXP5XAWzQIOFkvBw0hI1d9zY1o1/Sj2omijdzWEYUGuXlZjqUmvzL2dT6Ej+IdiL3XcE7gkMXJqT1rVSa9q7+xr+R2+mBbMZ1VFh6mUDeq1D2ZfX6A/NfbBV4c85iVvOAjg7kG0INb+pF++x9xsTgoDDLlXwUiTbb5UtV+nb9sMbhvI6r6DbE/gWaWh6fTcHBNl2U4p8UWI5sE89Dp7Cvn37fL/4xV8UzjKmwLX32H9O4Hvg241lYwCb3/r/LtgBbgRlJYWFB2IPt9fT5/wA8dFUiezrwbJyKt9/8mpjX6MD/ACr+WJOX59IBDjSVv0vYepA8w+oBBwWZOBQlXfp8r/QVgf47yxE1Nppl+fb9xf7EfXCSTGsRf2meR34nlEbKSKmdysqZvLqSQJGiOrSrVuHXUh27OysN7wi+J8cyPGsm2SzDiGZHTq5SZlSeKVDe1EEWCyh1JVkY7+YjGvH5AVpLDMrXYNg3/od+938zeAnxb8G+GyU2eysGa9A0qL1bO4pjV+o9D++/h/8AIf8AGR/luMlJwnHUltHZxfyOicWrXoQ3iz4iR5HIzxwssmcnjMGXjjIYwqw6ZmkUWVjiQmr+JtKiy22n/sn83NNy/lYpt5Mvl4su1nzFUjVVLXuGK18XfAZn+ReEw5CSLK5eLKBhqUJGlkjcEgijtZ998Rvs+w9DKyIpILOHYEKK22Y1YsjzHc7+gGD/AMV/xsf4HG4KXZt229sH8jm+anVUMXmzJL0tTA3YIXaiQbWh7XXaq712wgOecuryAWFBX82xJINk1dX3BA2v/MQNG8VgM8VN20iwPzf1+ft3vGY/FMtArAiyWYKTYYjvQANenyNLtj1myCQkftoRacrFlY/jd42IXswUmT9vKP8Am+F34XZlMzlZcu1Uw6csR2cN63XmWjuD8gcN/kzNx8Qz+X6oDqi6EYbhXR2YfM2pogi9/S8bt4H9nXh0+hpsnl5CF2Z40arH0uva+3744f5X8WX8iFQdNO0/ydEOVcbzkwz4L8px5MosSHNZgAnL5VCGkdhY6kp7QwIzAvK9KBQGpmRG299mnwYORyhbMMsucnkknzEqilMsrs7BFO4jQtojBshFUEk2cM7g3I2Ryo0xQxwqK8kcaIm2wsALqPsST/PHXi3MqhTRHbt/vif8L/jl/F7TlLtOW2wc/wDK+WoxVJAbzdnwl7Pdb1pUV9Sdv07YzV4q8yoyt6H6lxXzJoH9BWHXzZxpTeoKo9yCfpsB2+pwj+bIgdRDgtvsYwhP0O1/Lc4rywvQOOQiTxHzegHtRBr9hiFzHxZljLISGG47f09QcW/EOHU53N3uD3/v/bFJxnmCKEfi/AdsccI5Otsv+EcUSeAuKDSRMJEvYGtzXpjN/KXDDO65NHZC0j9RgLGkE7Cv5YOeN8OXpNLlnLWCKuma/ddu2Ln7OEcOWd3llS5FBo7FGF7G/n3rHRCoplbbDnl7guX4dEF1KSosSSRUdXzasXHK/iE2a85UNDr0WpBBbsWIrYfrir4lxVs/M6yOq5aNx5BQ61etn8v074tOM805LKx0JYIlokR2B+u3fCN9tbF61stuJwpTOF7NpTSB/IXjnDzDpICkszgKocadA9Sf9MKuH7SuVSMLpkNnzFY2CgE/Hq7YZnDM1G8YmRllXupB1fPf2rE5RksjJxLebOAKxv4aFjsdt69sCmS4k6kmyse/mffc9q/4MS8hziZzIIwjFSo2PlJ9dvl74vMzmwtM1vtppACt4wpB4WmgU1Fm3sHcg/P0+mLSHMi10kjSNyRYv+GvfFJmwPjOx7ANsT8wMSTm+nGCTsxJ3ux9KwQUX+anLKQSCd9hYwMcWTylTG3fvdrv/P8AliTHxnbzXuPy/EfbvjxPnD/GwaxSdzp/zf3rGoywcOFcsJloyI1rUbfeyb9rxOynGyCV00wHwkenuTuMecxAxI7yKf0Ib0/QY9cWzLLQWv8ADYMe5JPoD8sZIzdkfMKb0k6ifMAo2s7188do8zEAB5QWNPSm7+Z+WInD10x7nSTSj3v+149ghQRV029fzJvBFLOdipJUhlost+hGIcXGaUFgQWF7b7j5emOmXzKFLG41Ua/h9v1+WPsuejslV37UP6H2wTEmOdmqwdOi79bOI7gDbeyNX6/P/TH2UirBI2tgD2rFYmYrUT2IuzuzfP8AT2wQFy+WbStsKv29cfeFykHYGge5/thEr45z9Q6kBgLMq6R+IK2vFhl+cVKkjNPqJsVsEHsRX6HGaoKHdnJ7YVuQdW/v/piNxHLSkbAAsbsGsJHP+K+aFlJYJVUiqFM/yO/9MGnKPjlDmIZCw6csO7ofWtvIPXGp7MHvFZumgBJ9iQL3/viHzXzK2XgV1UFpPKfRgh9QPfA5L42Zd4gkKTdaVgFaQDSDtdD1xbcN5Et1lmLyuN9z5QPYL22wptEHk7kkUZumQ22iS/MVPewMFbyBg8QoqALB+Y3s4ssvnAFY/DtpVf8A4wORKG1GxqJto1NGvcnBACXFfCXL7GIATqdQJ3W/Yjf+mO7c1gxNE0UiSnyNpXyk9tSn2/ngs4bn0NhdAOnb1J+WI3EuKgDpgqkhXu3v8sNeDZFbzl4b5mLLlllafV/6JAJUH0vveDHwf5YlhymqZyqgFird19hi+4HOw7Gy21t2Nd6+WOnHYg0fTBstWr5/T3xuwzdlTnePxOAdYkP5lBpgD8seZUWIHpK1AFiq/mOO+Q5GhQmQqAxoaq3FfLF3kMspYuDYUV8tsYQWeX8dssitrhmVlsMCP53eK3mX7RmT6elFYg18iP54Y/MfLpmRvw4pAFIC9i1j39MZdzf2W+ItISI0RC1gGQGhfbHRCMXsnJtaP6dQcCQAMSWJ33P9scs/xYgFQavbfasRF44dAdisa32YgH+eBnmLxVgGvoJ96mXYquyD5sx2GOWxlBsYHC5dtl9O/ofnii5k5hhii1SyKpBO1230CjfCF5h8WM5KP/2jLZHQfOiP1HC/y3/TBLwflGChnEmM8xTyyTn8O/cKTpG/98a/RRcXsI874ygAJl4pp5WGwZGRV+ZZgNsC+dfMZ0HLzZxInFs0UB8wX2LX+hwvj4ywq7HO55S4Yr0cqLLCtgNO/fAbyxzvJmszJFwnJmB2J15uctqVT6kEd/UC8N1kyiiojN5i5eaFY48sFAF6pJzvfYlQTbNftgR/+q5eFxyzukmZLEU8o6can2jVvMaOCjg3JkOUeOfOZqXOZpdwCSY439dMY7/sThbc08/HPNmWly0+Yjg1OOqGSJQNl0JW7X8jthoQVlO14APmb7R2dzXUYFYSaCiNfNt7N3+uHD4FeBcSxrnuIuXZqkAlJ0KO/m1dz64zjyD4jplJuqII5Rf+G/w/IDY7dvTGluR/FDMccl+7ywLDkloukIJJrspfahtuB3xfkTisLAaQtvtN+IWUzM6x5ZNKoRplQkRtQryJQB3/ADb4c3hR4b8TeGCRJhDGFp+p/iEfKzX09scfHeLJ5BYcvl+HpmZphoj1ndaojuC3f2298JfinAeZ8xKYymYgQgEIr6IUQdvMPYYn/eI0p4pDD+0H4K8VlPkzjzRM1dJ5OnXzFUGGLHwohPBMv0jG+czUza9MKFljJAAQv2H/AMnFbwHOZvORxQyzMhyrefMhGaN9PoH7N7H54fvD2yOXyMssbq0mn43fSGeu9ntZ9sS7uurJ9FsXHOHI+WYrnuKQurEeSEXIE9RYF0f0xE4r9rTIRoIMvGXkA0qOnQFja7HYbXgN5f8AtYqJWXMu3TArSFE6uR/CWrSD6UMDnP3i5w+RovuWWEWYaQB55kBQKb37Xvt9AMMoO8lEvYlPFDguYD9eUCp2LBkFLft+mHH9jnwey88jZjMCKXQLjg1BnNXZKe31x7zf2d+IcQV3GchkjiJIQWFHuVA2HtW+LLwn8J+M5BmaBI16op3BBkCKd9G213tjqfIulXkm4ps1tnszFlYNWlIIjY6WkX+gA9fasIfnf7TmUykqR5VEkMjATGivTLetkdx+lYLOcOT52jjzgllzOZiSo8sCGVXrvIoNNv3vtv8APGfOds9xjLRtmMzk8toaSjrgUtqPqB3r545+OKk8k3E1DzJ4D5KWGK4xIpbrSSM1u2rc+cb0PbCL8Sfs0DKpLLk87JBG9s0TOQpTuADeo+w74SHB/HvPIjx9eRUc/ADso/hW7Kj+mCbk/wC0KFZjm1bMjTpjEjagg+Qqr7b/AM8W6Ti7Q/TBUcj8g5zqQvCzj8QAFid2vvpNWPmcNvxZ8OuK9Vs1G7RKioD+JWp63ZR8O+B/ww8Xs5JMWjyvWAl1RM/kjjB7AnTRHvV9sMjj3GJs46Ln83Gkb2Whyu4JU7Av8uxqsTnKSeRl1oVPAftTZ/IAxtDFPKdzNI7M+/YbA7D22GCHMfaM43noOjDlzDIzAvOlpQParqvrviVzf4bypmA/DstG8KpszxmRiQN9RN1Xz9cX3DuO8TaLRPLlcmhGzAL1nGwIVBvdemGck1aQFFWAnLXg9Pm5geI5tppEW1iUmRv/ABYjtfY4bmd5BiykaiDJLG7Gi50hh8wzenvtiy4Pmky6xNw7KTZvMNs+YlVo41vbU5Yb72dgf0xNy3hJnM6JH4jmWSUODFFAaSNOx+pI9/ftjnm5SW6KpxWzln+I5HL5OSKeTXmXUXoOp9+ypQ798C3KeUzxjCZLJmNW06p81RsH1pt+2HTwzlHJogKIjtHv1HAZyO12fXBqhkK7/BQJCiiNrr9cKqIvkS0hNp4JZmco+czTMVsNHl16ahTtWpdyPTvg05V8EclBXTy6tpN62Go2dwTfc4NeHcUBC0NAPcN3AvucdMxnOkZizoIX0lfylaHmtia3PbDkXySZ04rkKJcAFqA0/lI/ptjgJmLIDsCCCKoXXe/YemBHifO+Y8hyuXbNRnuwcKBZ7DV3+vbAFledc4cxI0mWzRVXCvpkVki37IoA1/PuRiYoyOZuM/d4mYEtmJbjiA3LDfsBfb3NYDeVPHGNERZCzT2yMqqWYVfcV3wNcT45mBnhPaxRSjpq8xrpqdydNEI4/nigzvKDRZkTxTR5hnDEFZEVgfUlT2v0wAjwfLZcxhgB57IElIxfuTvR397xbZriqxwLIw0UNxWrUB6Daz/SsJjjGYMkQCyeSyshnTW8Jrdg67e1V/fHbiuZEGSC/eyzsp0MXu1A7Im5Htvv2+mF7B6jCzPP6GBXijaR2JRY1XUzE7Af5V97qsAPMPLZyqB9IZpGufKraoARvTD8w/niy8KOAZqPLRzRhQ0refWO0d/Hfe63qu+GBzVyO09/jlI9ItVUG3Pqzd6PsMam1kbskUXKOfypC9CBkuPUzmMgL7rqYf09MFuWdaACEA1v6L+tdzjjwHhzaFjJ1BFpmA0AVdAfI4psvnToYsxCBjVg7n+Hbdvr64ZCN2cOO8m5eWTURTPQZkOiyPp3oe/bEiTkVOl041o0VDCiSPXUa3/XEiHNRnYbaQGrSQxJ32v+f6Y8nizo5CAhmGohhYB9h/U4JhY80ZyWBZMoqSNCyqkLA2wZu5vvpH8txhkZEdOCJHOvpoEkc3q3Xtvff0+mPEvF9Vah578xH5VO1f8Ax74F35jaQNEhBOs7UXagfLaruf1OGir0CUqRYczCL8MtGfL6RkUfYuFG9bCjgTz/AC1xLNP+DE8adtbKVBUdtqq/YYbvJ3hgxp5QGbY+YFP5Xt/PDcylqoAofIAtt8hpx0xh+DnfIZs4b9nZjRzEisa3Vo1ez7AGz+37Yice8Eo9JomKNRQ0xlNfvQ2of+K/vjRXGMsh3Gsv6DzCj71sP3GBDmrNLoppG10aXQAbHcbEAkD0IN/rh6aeRHISHLPhplAwLHXZ8nmIBYejEHc+ytpP9mbw7IxkgEkBRsmk9MfNSpAv3se94U3Gcs0UhlRtUcholR5VI3uVCKrfd1AdCLYEWwY3K2fMlF19BTKCLvcGxqQgj8wajXc4oqEbGFkeXoaB1dh/F5f/AMtkHErPxUPKVI/htWB/Q0L9/XH3l/h1mtOkdtzq3+Xt6HvgoPLVVspHuF/e73H6HDr8CsVWb5ODnuwI3pSFFXeyg1+2LfIcuPsNIevVgQ30Ngg/PteGXHyemzDv76f64l5bhjXX9v8An+2ISTsoqBvh3LWoC1oj1B0sP2sf1GCODgZA7M30K3/bFvDkq9hjoWNUMTysjYF7zDwZxdK6+t6bH/uUbH63eAXO8Gma/KpNbFas/LSQNj7E123w83jb1Nj/AJ39MUL8ERidq9itij9QdsFrsC6FJwrNvESHXShHopWmv5dr9jfyO+LRs6HB0ymvZjq/Qg+30/TBvx3lJmQmrH0BP1wrM7GA+mQFd9mrf9WGxH/l/LHPLja2VUr0EXC8mR2Yb+hF/tuK/TFrmeFRObZaYdpUDa/pqSm270bHyxSZKYgAghgPzLvX1o4vk4ujDc1X5qKi/fUpFfrinGLJgpnuXJhZimWYexqOUfXTSt9GQX7+uArMNOSQUYkGjsA6/VdSt9NJYYZvH+L+WyOovvq/pIBYPz/ngSy3NYc6VLFuwEgQuR7B7Gv9fPi5I48F4G7i2Oo+mpNL/wDuPxX9d/Y4NuXeFAL5/iFkW5cfqDuPn++IvCs6lWyuhAI3U1t89xX0x3l4yoFggrfxJv8ApRH9D+mLRxsRlVzdw6F0J0qu1EUKP/l6H3+Yws14GBJ5O43pTTCu2k99vQ2a7HBpx7jaqDYFHb1B3/hulPvoah3phhbS8Xi6lq9MLutiP/aTqB/cexIvAkMj3xrJhyAdRI/Nppq9mUVv81Isb0KOLTk3kR1l1h2r39a/8h3H/l2vtiHleIK5vUCy+ooFh6WpNXv2/Ud8W+W41IDSsEYbFb0Bh+ti/nVg/vhEMO/gkNfmLdux/wBz+vbB/wABnc7GwP8ANX+uFZypnSEBalHqSQP576v0wc8P5hYkKgobW1b/APtX0Hzb9sWiSkXnEwCwVQZHPe+wA9Sar6Vgg4bwzy0RXz2/5++OfDIa9KJqz3J/588XUeV9sdKItlXLlRVE7f8APTFZn+HsRQfaqorf+mLrPxn3/wCfWsUiOSSL/Xf+pH9sBmTK3LcPMd+t+qgD+nv/AMGAHjfBJJGYvq0fl1hSR+mxO9afUEYcWUyBqtv5k/vtiBxLk12+H+37e2A4ehlIS+Y8PWnoMbWqPz9TtYJ2Hb0Prtj9zLywmViDLaVbE7KWJ2IJ9dvQdhsPbDi4LyXNG27qVL6t92C18I99/U+hxfc18nQZiIxSKGQ0d7sEGwVI3DAiwRvg9MBU6Zk+L7QeXQUxe9LH4Wrtt2WgW9Re4qjjNXj54wrmlWGJrcyatVEeUBqWzuDvRBsXv9Lr7V/ApOEZimaR8vLmA0UjEvSPQaIuarQfMAxsA+U+XA39nL7I8vFnnz+cmmhynVqCMak6wTys3oTGTYHbUATZ1CuRKUnVHfKPHGCmmMzwF8DT00zCeRrDHTbB7qt6AoCrr1HzONo8ucxdJFUsD5Rd/Ib1v/LAZl3y+WjEcY0qo0rVVQFdvkB3rAZnOJSU7WCbJRdQo/UkD+hx0L6nC/sxvcf5uSiS38/7bnC7z/OJN0SPY1f6VV/zwtOYuYMxGoLqwU93CiZL+ZU6lFe64HYObCTYmi+QLtH+wdFr+mIS5CsYUH3GM6zAmy3r8VH9iWH7jCw5m17mx/4NpU/sxCn9BZ9xjlxSTMyMSlN8onjZv1CPq/8A1cDXFcvmV2dZQv8AmV6/mKxyTlZeKKTiKtdft7foCTX/ALWrAdznkFaM9RSVG+3e/wCv7YPIo/8Anril5xlUI3cfMAEix7YhGObKuQi//tpmzCXjUqQNQ0vtp9FPbz1vXfAnJwqYrG7PpLSGNi5IUFT31UP1wy+T3zaTJoliaJdZIclWLspAtN+xqvTBbw/hzZiNI85EF6diQKo0Pd06kbA/XfHV2rYab0LnKcn5hSgbMOsbmurGwmjUMaGrtpwZ8S8Hs/HHHJCIM9W41RqG0b/xGmv13GKrhPFYYc02UgiBy5HmU04aYfDTsaA9x7/TFlzXJLlYBL/3ETFiqgZnyrfqsQDWo/b1wrlTGUWym5j58nzATJyZQ5V5DpZhHsU9KXTVA+oOIPNRzWSywy6lelvbReV7PoQd9x3rFpwzieaRlzJzLZwICoXp7Cx2J7gj5C8VnOXMH3oAyZmCIjsgVtV+zHC9m3+B1ClnYUcJ4ZFlMtE9lZ3UEAMQ76x+atgBe/tiLxLxYzMCAIplBNerAM3oKsmvfARJnYohqnzK5i10xpC56g+Ru9I/5eJGRnM1PEssaqLAN6Qy++kWT7nCuGbeh1JVXkdnLuUzc8KtORAVYMgDBjXemB7X7Yv5+ZpCzKjIVSrDIygfQnZv0wo+XZc/IQxpwzC3EvlVfXUm29frhq8RiLBVJpVA096J/vviMsMGyZPlLBYsCa2A+foN/T3x7OU1AFmZWHbsNQHYf74gJlQQy6u2kgD39b9ax5zmYeyQCTQ7ih8goO+AIWX/AF21uQdO9lpvNXY7e5xXzBinl1O2sAn1Rb3P7euIvD4y9Fl0fxlh6n0Hev0xJk4pJGpRArWNJrZjfzPcgYJiZ1+4Ujfse5sf3J9cTRkS2zPV/EPXYe+B2S1VWKsAovve3pqA3O+J2RnV31BmChdTd9yfkdwMExZcP2BAfSNwDV7/AExOFWQChIrcDcn3I7YhZfMEDyhSb3F2bPvfpWP0fDBXYISxJb0r3+p9BjAJ6wgncroFgqDuSe5P9sD3EOcYo2ZWjltRtpiZ7Fb7gEH+2LVfKvlBkZrA8tVv8TH0x4OWZTSMCSPMNzRvc3/bGsBlfNcz9TNSv0ujZpI3BB2/NRqrxZcL5QmmZ2gMeofGryKnf0F98S/EDiMmczYEeTl6cJKtKI2DSNvtZAGn53vii5oykkcbOIZYtNaiUIAHar+Y9TjrazaEvGS84Pwn7hmIzxKBDDJfTeNw4S/VlXc/qMSny8KSSnJxB0kYMJZW3r1UJ6Lf9MU+TWKSJnAEjaO0hL1tv3Jq8X3C8vkRAs/TzcKr5XaNTJHr+XrXqT6YWbtY2MsHbL8yGGeGWQKUjNsi9he1gepHfDg5Y8WpMysssKL0FGlBquVm9bX8o9sZfzvFMtNqKykgG/OdIYex9MOjwf5jy0rDLxZUwjSS86aljOn1sgBi3fucTcWo/kZSVhLxH7RMEcsavGya6VtQ+FjQ2HqL9cMdcqgsrRElMSO5+V/TAFx3wrgnlSTdmj+FHW1P+a++C3hvDdGjc6Uv12J/hAxN14Afa3IjVdgQLHw/6nEBuFICplpm3Osj1rti2zPMK0CACd7VR5r/AOeuOOW0bajS99J3JPcj5YUxE4cu4OxVgQuntjtpy6lST5vhUEmwfrj3lczE6+S1AugB299sRUASN9J1ObI1ruD+uCY98VmABGpt/WrG+PCcDKaW1HSwA6Y/MT6nAdx/mzORtGqwrOjbEqD5W+ZHpi+j8aTll/7iGI+lo/mG3sw9MYJV8zeISZZ1Rg93TDtV9q98e8lz7mJLK5W0B7mSm3PeiK7YHOc+NZLiVGOQxZlPMiyVUhG+kn51Xvg14Ry28mXidg8akDWiGvMPp6YfRqLTlzmnKZmdUj62Z6bEvM5PTTb2JAP6DEjxa8RchEFLZhUUmnSDSXcdvTcYX/hfy+MzA3EuJ5hcvk1B0QZYlDIFHZgtk36DufX2wmeM+KbZjMg8O4dGOiT0j0mlbpgkq8t0oJG+52wY8OTpbQzObPFOCPSeH5JpTpp58xGdnbcUPzfqMJjnXxC4lmm6Mssh9Ogi9NQfbSoU/ucNQcr8y5iJZ4qHXa68qMNHbSDsq7bDcnAJwfxfzaZthnyNQ/DdmQB49J7jSN/rveOqNJYF/Ab+EvhHBBFFmZopZcwCW6VeVP4SR/rhy5Ln7NUphyyIWYdRVGnSv8TnT/TESH7UXDY8uWSTXLaoECUdOwLGx7XveLHhf2hckJHZG6oZQdKqbJ9QzEBR8sccu8nbBTOsvGACzMUaUkBdKEhfXue+Gpw/jfWjXpxpWkLIGULZ7bj1rCG5v+0KacQ5f4Crs7gUqd+y3R/h/wBMMLlfl7O5tepXTyzRhVhJALswvXrFEV7d8I00LVbAXxc+y5wTJwvmZ8wySMdQiWQDUxPwoo9PpgC8HPGSDhy5hcrHJKZmAGqzoFbC1sb+/vh18vfZmiXp/fMwJZNZGllRz3sJqbUwHubxD8Y/F7I5TMjJqEjQRjqGNBYkHwBiB8O24xbt2wVh62fpolgQcVzMLtmREVTL6jM4ZjanQTSA7bj0wJct+KOezLpIFcSyy6HjAqOKP2cHsaGOPKf2q4tTtmJlikqhJHESrRqfKpjAa2IrufXETxf8R+JcXy6x8MyUseWJBkzRCwvMV9FtlKre9gb1gfG9MDk4Yo0bz5nnTLiHLxxpJIAiuwHT1nvQAO/6d6wqOdOWXy2ST/qAWbLxJIZAhWM9QjyHuNZs9h2wCeBPh9zCsdnS8aNaJPLZUi70kXux2Go3gE8bUz8s3/8AE5Bk4EOpIQ3VLGxZWNSS3zJ7X2wI8X22UhoBvCfwvbO5saUZ4EcPKBuRFq7b9yRttv3x/QvhXIPDsugMcMKbA0yrqX5m73xReFXPWQOVjiV4o26C/wCEbYIBQaSh5SfYnY7YT/N3inlU4hDEmZeGFLeWSVdURN9gaJLH03oe3ph5ylJ0JL7aQecU8YZYzJDlMuiJenr6fI9+1LvX8sC2b5uzuXpGn0NmBURcKdRbuFNDT32vFR4gfa66rPl+FwHM+UAP0iBrv8qEDUCPXb64XvEeXuL8UeE8QSLJ5dZN2aopBQ82kEsSdvpeJ/E7tukIm4rQ7+RPFbKpeVluLMREPJOrK2tzuSxFfWq+WKzxc+05l1doYIPv7EAiStSq9dqH9BhecN+zLl4n1xyNm9QZlLv04h8iQNTn9f646txfPZaZIEjjS12TLQ6mCns7yEkUPWzthvonjIE3dioyfgxns7NrMceW6r3ch6SrfstFvoKw5+E/ZoyuTVpHZMzPH8Ikald/4Yoxu5sjuMOrgnM2QKhMw6ZmWMamSCNpXsLq+NRW579gDWBblrg+czKTTZTLwZKMszRyZgM0+k9nA/J2Ox/bfDvklL8DNN7OPhty5K562ch+7QRAmNHKojXtbAfyBwr85zdwvLTymNDmMyZrhERLLfqANXYH0HsMaM4D9n0OS+dzMmdaVVuOQ6YVNfEiChQPa7wXcu+G+VgI0QwJW0UgQWfTTv3I7msTr2KpRX5ET4a8mZ3OiSV55cjltRuFVIlYULOphSqbIoevrhkck+AWSyUz5kdSQlQITO3U0ne2Gq92vDH4lwo6bt3o03YWAbrT2oYXniR4pQ5eSLUJJToYxwxC229X9APQE+uF7VoVzbwhgZTjSAOKJDFa0Vv/AJVHyxzvUQzD8JCTp2LMR2Dew/XC15W8ciyf/wBPzCiwNQaNtIvb812fUDFlN4wZaOZoJw8LzHyRsC2sHbbRYF+tnAuydPyEedHl1KoDFrCgWgUn89Hev9MSMvxqTUInLM1BjpWkCn+ZHoLxDysIe0hKiMUNCMCVPc6qPf64E+Y+RAJw3XdDMNNCQa6X8qLte3peFYyVhNNzDCkyxSONza0PY/nPoMcec/D+TNOrCaoQQ/SKWhrt9R7jCO8See8urJDpzMMkQrU8RbWg7MdNkgne/wDXFby3HxjMSIUMwyxo9Qv01CepVW8132sHAt+QUO7xC4LxCHz5eROgqEMqDSy3tSqwKk+o3H64AeW+P5uI5bLjLvsTKdROqYsbYsbpSLs/piw5r8N8+WVYpJMwWNgGXcFBfrStuPb2wV8f5n+7JHKwnmmWIKxloIrD40oCtV+xI2GDsUovFaLMshigysgA87s7R6LYebRue1/KheALi3N3DoZMvBmciozHTVnZZiqEb6TYYA/5r39cM3hHiuuaPSEUjEqxaNCu3bcuSB9R3wN8y5JWzRDRwZl446TLlVTRtYBcsCdJ7j1Jv0xgkp/CvKDLh2zDRjMygRiCUnLx+4LMfORW9+uBnOZTIZGdDDIc5KCEUZj/AA4yfz2Njfb1AGKHLx/d5YRmkRYi5lEEcoZERjuAqlgCG2PqRfpeHFzJyZkpJlnZTHHFHrk+AIykXGWrckdzgMKLPgfiaMwwhtFYAGQI4MYW6NE1Xb2xaZWa2Z0k1oDQCsCoI7lvesK3kfl7hczZqkeQk+VQpAVO5Ze2zHfc/pil545N6J0ZWPMsrG22HT3A7BT3o+pwuQ4HpPlnFsHLWbKkGq7bEbmzv3xOzk2lRROoEFmNaST6juQB9O+AzhHD84Ui/EaCCJbZXVDNKw72q3pQjtZu/TbE88fijjfUUoAjqaq+I3RvsB8hv9cUVsR4LuRGuQ0QdI0k+o7k+9f1xXca4skcep3DtvpVdlUf5vUCvf5YC+P+I8uZ/Cyv4jFTbqC2nar1HTGPlqJ+hwEZjwtkYqs0iu/xFHzGpTfo3SUL3rygfKjRx1Q4G9kZcqWEG3DeMJOxLSKIuxKsQD8i9L696b+mD3lbikEVDLRIwPd0IJv51/Q7n54+cp+FyqoaZ0ZvyosZ0KK2FsGZj79h222wwMhypGPp3rst+57Db2o47o8Sjo45cjez5y7zNI704Va32NkD9L/nWDYcQKiwNf60f5/7Yq+VuDAEmzub22A+lV/rg5y+RUj3/bDvRMBc3zMZLVQ6ML8kiEfqCpII+Yse4wPycns51MdW96WAu/k6bfSxfzw5RwRD6X/z+X9cfV4Oo7be4PY/7/MYRpDJiNz/AIaodx3J+FrAu/zEDsdwT6XdjFxwDwxWEgBQE9Er4Sd7BHz7gEA3qqycN9+D/LESThAsUSK9tq/Q7V8qxPqPYOZXlwjcEMD6nuP/AI+eL3K8LagAwFehAIP9MW0a/r+2Oiw+2GSSA2cIsp6Gv0x+fI+vb54lLAfXHwqBjNJgTOMmU9jv+2IZhOLFkGPEljCtDJlHnk2/0xC5TL6yL1RkG9gKb0J3+o7e2L2Z/l+uOMcpDA9v07jEVGmV7WiDzFNpQ0aHob/leM1+KHM5ibVq0NvYa9LfOxdH2btvuMaf5gyasD6WP+f8rGafFbkgSavMDV/X2+v19/bG53gHGBHKHiEZXpd62Z1K2N6Fizf1A37/ACDTd9S+WRWb0smNv0Ydj8iAMIjkJulMYtUoWwPw4VJNn1kcbAD3Wq9e2NG8NipdlYntfl/awANvpiUEPITvNzZtNTRq/em0Mmon5qSVNj6X7DviFwXj0xPnCsKGqgUkHz0MdOr/ACkgd6b0wWc9tNuaYNvRK6th6EjevkQa9BgT4ecyR+VWOy6qIf5Cq/YUfligozuCzSfGpLAAFkbZkDdjpPcfr9CcGKZwsnmFbWfn+1jC85L49JsuYTS4JVWC6VA72rex/Q+6+oYpI097Hua3/Wz/AM9MdUSbBHmfNKVKSDY7Anaz3G/a/wBj7XjJniNwsCRuk5SQEAxu2xN7FWry36dgfQrjT3iHM/TkGkldPoAwr3CnvXt5hjAnO/HSJ2CtYBYeqVZ2BU1XyHw7bVhaGGzynxeSPaSyu3xAkj60AGF/r23OGLwHmsMb1lgCAkcgAU/+JIsjtsWFfywlPDzLyGzK0hGmiVBNgiwfS/puD/LBHlecYUmAAEZs2xjoWPceYA+5HvuBhUsms2FwQppQtJX+bft3qt9vajVVhocsSZdFDAl2Iss2x3+XZQfSheMucC4uZioMystDdCTpHsWICX6BaZjtsBhk8HyZXSoZzp7Bmuz3ugBf1I0jFUibNM8M4kh39Nvp9MX+Xzd9hhNcs8RAKgtqk9Tewvsqi7/WrOGvks5sPTFosk0Tszw1W74rZeCp6AV8/wDn+uLGGe/+f0x7Cgbnv8/7YehSDll09sfszxFV+Jj9AP8AhOPSTjc9/n/zv/TFdneIVZG3pfqf+fzxtGJYzybEK362Nv1xRcc5soGtgN/+f8+eKTmNpCCQ1gehPdu+/wAh7DbCq44+ZfyDYWSx9Tf9sK5pDdRW/aw49Hm4ulOFMYZW07HcMrevfsBt6nDZ5d55VslD0qEaqF00AAAPStx9Pa/bC55h8J0Y9STzHVvq33uwP0O+2Pua4F93RxGSGIG38Q7r8ttu3t7YHdD9fBac0Zwk/CHvfvVfKx+m9eu+BeTMRKF1RzIN9wxIF9zs9FL3sDbawMCU/HZhsx7E0f8ALVfy/wCdsfI+PyqL7gmmHYb7A7bqT21CiDR3BIxxykXjEJOIcXy9nU8iEgDUCfXsWBK7H0KuQfY4EOJcKQt5JQSe1kf0fpMB81En6495jiFgWAUJoXYAb1VtO8T+odPw2HmKEagvzL8uA7KGHqU0qxHzaL4JB664dDVuYyDeOaTsqlRSy8ryhhYskX5bLV76CBJ/+piRHxGQbCQkDaiSf0vYr+hGLOLJvGPKDo7+WpIv/IIb0/Otx7DbH6TiOr40DAfmW2/qdan6OoH8OIj2coc0rd79NjUg/c1IP/a5P1wMc+wKsbNQqqskmOj/ABNWqMbd3XT7sO+C+PhSkExtfrpaga+pAuvpXz9wvnni3SXUwYV3ZfiA96O9D9PT0Jw8VkQRBycrzkxwmMCrkJsKgF6xRpl9iLB/fHfmfOvHqkOamaN4vIVCBC3Y7UPKD8tWOvM/iYVtY1VplWg2ig6H0OmlOodvMDexv1E+FzyT6OpEiwAt8DFSr/mBRja7n4e3zxZLFsv+gPy2UlDq8odYy4KuoBt+6VvtqNYa0ni2YEJzoJzOr8NCoao9PlAOy0fU97xacK41DGgTYgfCpGo37gb74quLcwh10zFETUW0uAXYV6j8o+QOM5KTyjK15J/L/iVPKhkiSKOKi+liCzFfi2qlv374E+S+CRZjNO8wPTsyCMggHUb+XlH88fstmo1BjiBeI2dIFEA/lBPcfLBPwHmEFQQCAvl8409uw9zWFbpOgqVknnTwoglJeGBIwo30s4LH8vlBoV88CPA8pnMqQuh01Gl1khN9juLr53goznN8ki6QSoJIGgEFq7eY+ntj5NCVTq5nMPpryqTtfoKA3IxNSdUxvNoncq8lT5fW7TBXcFumlMBf5t/l717YvsvnI41+J2Yi3ZnLkf8AtulHfYdsB+b5f+9RiW3V6FMthio3s+lfpgE4q07yGDzTBe4DiOxW1mv7740YdtsEpUMqHn9Gd1hWSUiizdlU+gJuq9MXGX5nzsn/AKcYPsW8wHsANQ7b98LTgrskeiPLOh/NQSUkVsWFhj8tsVjcUnllWCGbZqZiqdFgw7hhQNjD/GvAvb2OxuaMytK8F7eYxtqKgHvvQB/1xbcA5gRm0jXHIATpk2NE9wP9/fA7HymVCGTMSua3DMFT5AlBe3pih5gzSkrpAecuoUazJ3r+HYbbkHYfviFWU0hzZfLKm7uXLfCvp/LY/viQkFsW7KfiWgBQ9Cfn9cUsfEAyr1K8gUGtqPso9RffHjLZstKQ9kabQHZQL/nQ2wpi2yC+aj3J8qxiwK+fckj9sWWcywIAYkHUG0jso7C/fEXI6qYnSB5hSbPp97vav3OPE0rHRVkkeSjVgb0zG+w9T64wDvw/LsXa9Xt6bn0/4fXHeK9DLqJs6ey6hXqT9cRckGHmcqNRGym/0J7E+t+uJWY4UhJUEKx7sNu/v3OAY85fiLBKKu7KBQWgCTtubAr5/XA1zrBmgENJ/mjc2sm+4+dfpicnEuk0oZ2AAAVq339fbFhy/mEcBpHJ2tSasitiB3+o9cNdGFbyZypwuScwsr5bMfmjWRlSQk/kF9t/SsNDmPlz7vlXTLBVVEYgOpcMe5G+5Pf98DPF+RstmGa1bqsPLMVKFa9VI7MPQjASkmegvLyyCWOTUiyMbeIN2Y7i9ru9xiiafkUI/DHmvhuaylvFFDpYCVJFVQHH5h73f/Kw2ciIWUdMKyKPL06o+2w9PrjMvBvDqXIzLlZXR8tmPgzAj1BnI2U96fYUbo4s3yrZXMiFJZI01DroDptT6m7qx6g9sCb+2NGSwaQy/EBd3Z7UNyK9KxWxO7B3atIvYb6PmfnXpiJw2JFVdDAJW2xYj6t6k++LicDTQOm1tqAph/ridhKmFgTQBQ6PjIFtfbb29cVvGODOsNKfMpsa9uofXcdtu2KHm3xny+Xbygu48rKAx0ge+231GDbhnHI8zHFJrVkrU2ncgkbA/Ttgho5cNzmoIBsPz0Ko12s4spGXV8tqJ339a98V+aZnu7AsKleu/fbHLJ5Fo/N8e4q99B7Hb54wCk8R+bJMuKh0NKfgjYbtvvRHt3wIeGnKOdnkl+9UiHzaHVXBJ9trAH1wXZnwxOazKzPMyKgGkJQN9/iPp74K+F59llPw6UWie7UL7/M4ISuzvhxkCgDrEhBrqL5CGHaj88Veay7xpUGei2NBJSDY/hsf1xD8Q2DzmTMqRk4wrRaBs0ns/er7emO/K/OPDJFv7o6mwd4WcEnYEFQRtjJmoKfCfxOyWRgTh2YiRemWUNKV85IvWT29xfvgq5r8aOCR5cxJm8rl2lZeo0CK7sgI1rSCwWFjUe13hGQ/Z9HGc3LO8s0KKyp0ukY6Ub0pfcmzvV9++2Ff4zeHnDMjmPu2VaWSSMHrs7WA3ooHow9fTtivHTWXk6nCMpUjcnJXPMPEEMuSNxw3EishWiBWqjX/AA4Av/tpwvMZiSfMRB8wLEqnceTbYdrOMe+E3ijm8tKcvlZUgaeRF6kr6VXelLdxvsO19hh/cu8rdTNZj77mc1PICmtsjE65dtgemjr5pDXej/F7YnyRcXhk3Hq8FFz5y7k4pAuX4ZDmY5TpISQmaMm6chQ2hQa712OBbjfgAMrEJ81mlWMHX0kFgWbVGP5mX6b188aq5Zjkggn+5cK00BXXdYnk33LbOxNb225xkjx+4xI2ci6uSzDQq51wlpOlPId2RGTV5Qfbcg4eDbwPFji8JeappMuWyXSnVvJmZJYwBGVB0jphbcAVdHDazvjhksvlRNmXMpDLGzQxuiLIB8ITunb1/fC28KvtJ8PmhjyIyMuRnQjRFDCXj1DsCVANV31gE74meNfIcuafL5GNv/2iTrzsIwqrGgGpCe+ssVqz/IYElmvBJ7yCPiV9s8yfh8Ny9/m6rxlnHuQoBO3uawmeD+A/FeJTjMOjdKZw75lyFXSx3Kqx1dtlGmu2NVco+GXBeCFppsyqSyKVCzS35QPhVO3fvXfthe8ocV4zxfMzNlczDFlctKRDqiZYcwlkrSitQGwLWQPbYjFFLr/UbsvAyOKfZs4TDlYW+5h2jZFLsCZJLI87Hsb+fe8XnOfHUyUKPFlpMwq1+BG4FDcilG3l7V3N/XE/h3M/ThbL8VePLSBvWYFMwo31xE0QnYaSLB99iQvi3iKh6sGUgzGYedjHC6xsMvGG2MrTbjSjGiRZ9ALGOd23kXILc7fbwaCDpxZFsvO4J/EdSqX2YaLJI9jX6YxtxLj+az+YZ26mZzEjb0C5NnsALCr+wxozKfZjhizCJmp5OIzkg9DLLs2xsSzMxCqD8x/OsFHBc5Jkc00cfDoY10H8HKkai5+ESzAFjQO5FVvjrXJGCxsa0tCg5J+z3xW/MDk0l8js8gXy9/MitqI9l2wYZDwWjgkGpZOKKADoIMUIJNdt2Yfywz+HeIbssxzByOTVQQQ+rMTM3b4Aym0HrvfsMFfhhzhJLrfKK0zKrJ1Jh04U2BGiMAkg1RvsT3GJS5JNlO0qKHjgbIxZeuHjRJIby+U1KwseVuqq6v3IGOHihkZJIkSaTK8NytWFkk+85kH/AMjR13VLvv64uuM8n8ZzUyyz5pcsnlUwwkqo3BFN7tdX2FeuGBwHwSyaNrbLiWQGzLM5kbXXca7FX7euJ0btGKyJ/KcdAhykXDcnNmJg3SafNJJHAO4aRgBpNkht6Hz9MGOZ8E85JBpzWck1l9o8oixJX8Gui59iS1V6dsN5830m8y9ONiqb7AyMaVVUUbJ/t747SqwKliyOG3Aogoe1+gOw7b436JPl9AjyryvFlioEKowjAUAgALVESEAdzZ9f64upZJTEUWPSwJUFHDKR3Y/p6A4957JRFqBBfTrIJNlbrzH5H+e1YouBcLzKTytNMixbiKFFNhRXmf229ANxhbItthXJm9EJB3OkAG73rcWPW/yjbA/zBl1k6TSyNGkI6oRABRA3Yt6fMfPHXMcFfos+rVpLNpHlsf0JYfLYHGYvEvnfjCgvJAMnkTagyMrFi5IAJu7YjZaPzvtjbDFDn4R9o2HMMY0Xa2AdmqwPWgCdz6HfAtzVk6nbNKq5k6ViZS/RjRRexsFrs2T2wH+CeTlfIV/09kZjWsyNl+oQbZ5NQDkfTYgfPDF5J4esdjORoLYlYsqrTdtwZ2QvuR6MQPricotuiiajoS3O32jcmsy5eSaVI4yodMrGGCyKwOjqHzOvvpFnDR4V4a5fOyNn5ZHKNFpjktowFB9EBDo225Nb2a3GAD7SHhNPLxDLZrI8NFZYrLM5MajMi1ZFEQN+UAjUQCCRsaOGJxDlySaNc1f3E6RqysrMdT1ZvSSF7bAKdQIxWfHFRTjsVcjbyXfC+UYMrEGywVZ5iNDGRgCo3aWUlrYINya37A73iDzBy/w95YWz2ZK5opaKupA6g7uhJNazspBsjGZudPE1ocx9466zppCGAMweIbhljDE6kv4uxxpDwRMfEYFzMmWbqyKYYJ5VUqkQGzRAHygerDdj8gMJ1klb0UTRE5s5kjzGYgi4YNcp09aSQmQJEu2klj39bWzXa8WXHc/xEzDLRCNdDBnmVT0oFIsK2o6jI3ot0MXXPXJGSy4ObmEsaxIkIiyasHlYdmZo9xZFbnb1O2BaL7QojaNIeGzwqzB5erZ8lV1GIsswB1HV7fSxV7N3SWC643xHiSy6o46MBuLquCZlYaWbSgJFXtdAYDs94y5iF41lywVLYNHIzkuTu3ceputqrBfx/wAa4Z4nkEUiZmFwIvLIvXQsKClQLQjupsWMVPPY4jn4ohBlFiD2zzT6Ay+UeZFY6gPmdqPzwvT0BT9oF481kZGD5Xqw5uZj0YlbSEk72TsNNjsxqsX3KPhlC/VbPZgjMyOdSFl1agBpqjZZhvW9DFLw/wAD8pHHAJZpMznXkC68owJX+NALIGn1ehW+4OLnmzieTgm+4iB45GCkysC8xq9JUg62ZgN6o16bHDaJ0iTxHwh4SzxMcx8TaTpOhQQD8X5kX5mrb64qeZeW5MlKrQwvxGHpsJDKdcfmqtAUmqU3qawK29cC2b8OEaORxmTGG1bNDJWsdldhZCmvWhZAu+5jwqQJkoIXzKqpTTKSGVD28jbatxsnmAI/fGszRf8ALfg7BKxYTCGKSNXaLLuS6NpshnB3QX2qr223wfcscoRZaIxwmQ3b3KSxcnua7AD5DCBzGdjyhEkEpWOMliy2gIBBOoHYqPhotuPXbA7zF9rqaQ6MsXmd/LccVhLPfqNaKPQVfvQF4vDilLwSlOMfI+ee+f1gjsjVJW4K/wC9bdwMJSXh8s46+YaHKZcbp94Z2Z79IoVBDE/+7f02NfuWMgWPWz0jzTk+SFSGf67UFA99K/8AkosiXneRWzLGSYkKKIiDFwo7KJJFsFj/AA2EXsAe+O/i4FHZyz5rwijh5sCApDLMVBoDZeofUdKNjpX/APyHVR309sN7wi4qy0wVFcg/iSKHYWaIRVPfv5yUBrsRgNyHhvsPJoFhVTYO3qaX4VHbzOCfcDB5yrwwRVGgQnuQFd2X3sxi2Nn0H7DHT+jn2OOLmj0MhY9uygfIUBRP0v8Algi5djMlF2avRQBW3zIv+Q+uKDlLlOXYmK09dWiJQPkra2JF/mYfQYcHL/BEoVoG1baP7f64WzHXgnCdPdmr5/674KsvwsfUfQf1GPmQyQH5R+3+2LzL5Ye1fQYFgK2LhAHwsR8juP57j9DiUMufXE9Ih2IvHMw+3/PrjULZEC1iLmIgd/XFqT9McpI8KwkC8fg9Y9zw+2OUW+APR6aQfpiPmo/b+fb++O8kNH3xFzMf6e2ME5Mtd/8AXHoTD3xHlfbEYT/qMKEmNH88eB7e2PjSAj1xG6597/r+2MA8cajajRU7evlN/Xsf5Yzx4sNNTaQli+xO/tvX9zjQPFs+NJBI+mEtz9l9QI+Eb+Y9gP8AX2GJ8tUPAQnJXC3MoebUEs/FL6gj4UAB3P5zWwoXeH3wbOAAU1Cu2kdvTff+e+EmhVZdEe7HYG2s/MgUCBfwjt6kYOeHqIxuNb+tBKFfQUP1LHHMnRVqw24xkNQ22PpY7/PA+eEkCit/+Nfz1UbHuO3yxI4cZWpmkZR30AgsR7kjyqP3ODDKZNDR1X6E3sfcGt7+nY+mLRyxXgpuAZcKKcEWKtjqBHt3P88eOO8QEfw1+hI/SsXvG+FIy+3sRe36/wDxWE7zkum/xWAG25sfzv29CMdDwIsgr4j+KUsSvSqVA/Nqph/D5Qd/rRv9MYy5h5mWacuFVNyWVdZU7732/pvv2w1PG3xQKqVjC+zPYYG/QbhgfkQR23wjuS+ZQJDq02x3BUAb9iLFA+39MGMfIGx68lcajEY6ZBUGyCWLR36VTHSfqR7e2G3w7gcOZVQoDG733bVV7emke5/fCT5YbKAEsfMTWopoonteii3t29jths8n8e8yrFoRa+OytfWyWc12Fet+m+oI2eXPC10IN6x2XTSKu/mK1vfYX9e5w1OXeVzVFCtHcCzddgTVuT3INKNtj2xQcncxRrEDI/YgEIrAk+l6vU+iqC5+prFpJ4pxljEnmkvTVkBPT8QpZFeserVuA1EhSwthlw/KopuxqJ07G7b1DMN2I9Y46A/My4ZXBpwQADZA3A/oa2H0wpIiqU8rMaHwilNe3oY09kQX7knbDI5b4yAoOkJ7J6i+19qJ713HrisScgxiJBxwzT337D0vv/t7Yl5fMChiPmst6nDsmQ585+p9vQC/+AD1OKXj4Nd/MTQrspOwr3IHc+/bti8jQA363f8Az+2KniZsbdz/AC9AP+e+JsZApxOQqoAN0QqiidTV/wAJPoLPqMCvEeP6Tpb6FgKon+mGFDw0AoT2Gpv38v774oucOEJT7bmvre2EY4veI8zxMAB6Gh9R/wDG5wuOM8bDKyjcAkVd7b9voTQwRHggdyVBpbDBfQ9zt/mQsV/8T7HFBxzklolD/FGxrUOxvcX7X2o9jVYhJssLrNcW9Dvp9fXt/P8Arjll5b+hBB+g7j612+YGLnOcuaiWQaxt27j+JWHdXA81Gr3q8cYeFgMK3Xa67qTt5h32NgmqN98cjsumj9k+DMpJoMpGlx6Ee/1/Mp9D+oNnFkNNKTa1aN2Zd9hY9L9NqYGqx64jG8QUn4CNiO/t/LY+xH1xNVtVLsw7gDa/dT6jVXl/hkUejNhkB2eM3lbBa9LjcsAacepkUb6x6uKb1Ibc4oeIqO5FMfzIaJ+YYeVgfY7+moHFgOKaSGB1rXY/nTsQf8ydvcUPQjFXxSUKSB5ozTKPUA7gqfQ13/UG6wrQEQvvRHs9b2Bpb+Xr++BPnXm9QhB0HY/hzikYH/OASv1ofM+5FnE223vsex29D7MP97I3whvFbnkIGSRQ5GxBtZB77/T0IPocHjVsLALjXDIpLdNeWkQbqKl0jsRSG5I7/PEzr6lE3xVcB5pk1aC8MykUTGwRttrZW0nUPpfpeOXLMcQ8yB7PmF1at7hhQ/UAHvi2zuSycgPVSNZGupCApLemoit7/P29xjpbWmMvaZ2XhsYLOiyh9JJ0t3I9L7b/AFxScO60si9RCqKDYI3v0Ftv+2IvDOKfd26b/hoN1vswJ2ZW/MCOxBo4uOEeJMbswoggmtiwI/iJANfTEmmrpDdl5CPJ5BUbYEn+LV2PtiDx6dj2cKKNqASx+hvbHxOZVIsWU91U6f39fnj1HMp31Xt7AH6D++IJNO2UwVvLub0OsgJJ9Azmh/7Ttt9P9cT+Lc4OZF1xq8fo3cIfViADt9MVsnLp19RG0OQdSsNSmvX5fUY9ZfKTnsYyCaLC6r1odv0xaldiZ0MDh3OFp+GyFDsCvbb64F4+LNBm+s8fUjYAak7Jv3AGxI9cXPBcuANNWVq6ABH6UO/tvgiy4jplbYVQ2sm/T2X+uOfskytWfeJ8vrJrnU1IUIR0Ok6qNLQ+ID54peT88XIWeBRI13LoGo0K23BFe+LXh/BWSjl5ARuSj2VJJul3tT37DfE7lTINqaXMUJSewoiNdwAD337k/phe2Bic3KUQGllbS9XUjsL9ypJAxPi4ZHCB0owbB1HtpNUu9Xqb1PteLUxalO5qwFHqw/TteK8ZBPhUk97Fmge9739L33/XE0wtHjg2WY0SVersG1osPhF9yT+b/XF4Mu19vNWkAH9gD8vU/LFeeHuB8dA0N61em38W3ptiRnMuVFhfMAwVr7E70pJrsO/vtW+CAkZiDTYY+XTRYsFtu9X6fTFhw/PFlIFdMLvfa9+x9vnj1Dl2LoGsIxF6lDEeXsAezE9zW37YlyQBQ4Y6lsLvpXYmq29bNdrxjUfJssAq+cChYvcAjcCzsPrhe87+IcmXLsgQmgzPp1KQPyg+/f8AbBJ4i+FEeaiUdV8u48qlWIT6MmoBvr/TGT+O8Blhmkyv3lWVSLOosh9ao3RHqPTF4RUgxqzRfIXiHleJXDOuh2tlZWI6ldwPmMWXGeTAsqhY8zNDElLJEw/DIPavic17fthR8ncDy7+aKQ5XMRbiYDVD7DUDWxOx7HDs8MPESZklOYdHCOF6mXRih+ZYA1fqBZu/fAnFeAzVAZxLib9e5GzcMKOpSVYWoEVYkv0HvVd8NqHKxPEXilD6/MHNEkjY3t6+w7b4pufOMB4ZT13VWBMCtGVViu5AOm2B9O2I/hDy1EIle1aRzqejZX5BQaHz+eIJkyHzhyFmbSTKPGhUAtl3sxM9/H3IU+lge3thP848WzrTq+by0kDlQjyxoZYigJ85K3dd7NGsalzudggH40qIGahrND5rfbYb9/0xdZzLgRlQVI0NoZjY3Gwb/LiyfhoAouQfE3LNGIVKSBQRq19Mv6bK3r+u2IfF+AzLBJoldWEpYR9TqVH3Cgb16VvthXtDmY8wz/dsspVqKiVNL33ZVOwDdx2xM4pzDPCzf9tNGZl/LLG4H/iEY1W2xHasI4u8D4PXK+eXqSiVbkbbzdyf8wxN5M4vNlpmVHQZdn1vG4ojffSfb9McuW89kmikjl1q96vvUgKkOa8rFbFX7nfFDxCdgwBKuPnuNJ7EHvvhdB8GmcjmkKrIGUbnSt7WR6n1vHeDPH1pQ10x3B/b+WEjxXlqYZeJ9whBvzLsG2G1+nphjeGPDNEaQibr6SWbUy2Q3ZVBJPl7YNiuNCs8d/FaePMLlsuwAj0OzoSDrs+Q1W22/e7xIP2iGtBLw9VLAdR0mYdRQNyvlAu96vfteDXxt8CInbrxypDmiNlkcKk+9Ab9jvsR+uATMc5rlcv90z+W1tpIikUq3f8AhYb0PQ+u2K4pJIsoxaGdw3xQ4VLlZC0tRqg6sMo84J7bHdvYFb9MQOKeIKsmWXhc8OlwQ6yFRoVd6N0dR7VWFvxuThEvDMyIV6Wa6YZur/isy7/hg7nf+HY4pvCLwdy+agRjIXkvWVU6WSiDvvX8rwyjGrFUTRvEPtncJ+7RzFZXn7tllGlg212bCjT3sNvhQZHgx4tNmHyfDGyqZijPmM1LK6tvdxruqMR3K7et4XvjB4Y5bLZxsrk5ZM0yhVLHQT1mJtFK0rACvoTV4bvgzxiPhLNPxLNyQ5rp6YcmzmRDGV8rNGgYAnYCyK7YZpRWNlnHqrRpHlTh0WWWGNsnlYtgiPoU2VG1WNR1d9+2L/mDmnK5QlpWCAkbKVG53NC/1PyxlzxS+15l9OWmiEWZnJNokjAwV6yR0KJ29bBusFHhBybBmcssiMuazn3hp3jno11DqYLe4RVICBjt64g1OrZzVY7uM+JsjQpJlss8yuGbqFljQgepLspr51hDz+KWRz033bM5tsqYw7M0ehEZwSAvXBY2tAgIBqw5PtAeC+Zz2S6MbnL+VWMKuAh0/kc77E18PtWMS+LXhHkeGqkc2YkkzBGpoYxHpQ1vrtQQoNAep3+WG44287LQUaNm8ic88OzBgyuQCyzqgUmvxNEZovJItkWd9RNteEh4zc6vwzMyO8hzk8sjaFEulsmigB49jvqPmDFb3resLX7OHiTxHJmdeG5RJZsw0anMvEzaI99MYbVGgUkk2WoGzvg1P2W58xLNneJ5lGklcs8GUdeo0mw0ySkGOJKGk6bbtTYs4xTyBRzkpZ/tG8FmzEQk4Xmc8+xDO3Ul6h3KxRdQ2FPtV12OHrxnnbNCDLtFLFwmPXq/HhBk0E3oEYJBq682k6iD8iBeHnhhLHmn+5ZJMqoYF5oWM0giGz6Z5jTE77KBvgk8TuHZWaSJ85mUyUMRCpEjdXNzuCQTKV6kak99Cqxv1B2EpyWOpoQzk5xclZCV/vGazLcQlBBkfNnpwxrZP4ccQAr1oijQs74vU5hzua6sOQy6DIswRcxIfu0WmgS0W2shex7XuR3xXcK49nxHp4dw0pl9Opp84QhzGryhgt6/8x1L7dsF/LvgIXTq8SmkkNhkyUMrjLopA2pt5G2o2QDqbb1wlN7HdLYH8i86ZbILmoMvFNxDOKpE0sEY6aqNtnJoVRsjckihtt65J5D4hn9LTH/p+XkSTppCD94bt55XZfzeg7/TGheC5GKJGSKFMtGd2CgJY07k1sDtve9V8sey9U1aa80fmsdu5P8Am9Btjfoj8iWkBnJfghkMmrFYtc+nzPP5mkPcmO/ID70B337YI40qgkRjbsSAugjc0ewHb0G14ljNq27ltQBsdlBIOxI2ojvv3rtiHwfMF+tE2rpLGgTejbbsupDubr02BF4Z2S7NkWZ7JbWqh1C6TZvfytGSCPKbBIGJ8eYJI6lIFWwLJLbWGY+ibE+5xG4hxOJMq2YzLCOKFfOzjSqKvxX7KCBt8R9sZ55r8f8ANZ1mPCEXQWMUuamjcBgKAWCIlWBAti7gjtStdjViwLLoe3BvESLMl+kwlkBbokr5DLGCGZCe9HYtt8vXHPhvNhYupDrOiqzahpiBJrduzN3YAXY+mFX4KyZcLMZmkOcyk5RnkIUStpMgEa7KF0tuAuokUbOM+86+M3Es1m2Msz5HLqzdPLwoVkeIMRqlsNuR32UUaA7HCxi3tjSXhGguYPHXIp1VUzZuQowkbLRHQ2knZJSVS0PdUYnvffBXyDz82aj+8MD0ZFURuoIkbYWpTdiVN662J7Yz1xfL/dJ4M7bTSRMGjgKs7gOtaVSMabYNqtQdxVHbGrxx9kyX3jNsuVRokYwbakVtzbKL1na1UWDYwN6A4tHmbjqwRvNK7dIIFjjNApISbZ1Ju220rew7jGWvHnLZvNZiDMtOohiUSLFEde4JtiANBYdt/hHa98M7L8HkzodooVkMLI2qQOkUgkvykOVJZFoGqUX23x9y8XUzL5fOKULp048vD8Pa+s7AaVEY2VLokmyTtiPeSeCygqyJvNcSZMu88erMSaWC9WVmMdrb6lOpdwfIB7bViz8LeMZj7mkC5kRxsCW0ELKWe2bVpXW4UbbkYcuS+z9BFHJCWaZ5C2idtKmJAoryx0ute42JJPahi08LfDTLZCF2V2zPqjzIlqE+PTpVSLNnzn5YtVom5ehXcveC/Fc9l53++SZRQ2nKkf8AqIvrKWXVoJrQAb7m8fuIeCHMskEeVbMwuofqfeAWVjsQFI0eYqfYb+rDfDzn8ZbkjWCJpVYitNFbFAMXUuEX3DqvY4reJ+J3HE1OMhFJ5wE6c1sFbuSp3IHrQWxVA4opKqQmdia414U5HLyCPMQScRza6EfpZYRwggWQzsenf5n7miO14a3DuScyejHDPJDlwtyRIkWiId1RHVEZNNUe/wCuOHLGTaSMzZ1Xglmn0wxxB667KSG0qGZbIs6/LpAJ3OAnxR5K4jAMu6cTeXNK4MkLmNIFjINnp+QsFvcyO2ojYC8Tq96LuaqiVxiLiWXeUQ5mOaHSVpyZKY7Va/C9fPTe9YpuQucWkV8vOkr8QQMY1WRaCoVOqRAVBXeyTepaX6LbgZEGZy6vnEDytJcMDKsZJt0aQrrjGs3ZY6vajhr8m8m53NRyMyLFlplZ0kLKkoZG0qZCh1ujDfQAt37CyrVAx4LTinP8sUipmmilhkjJkXLKFLlR8F2rq2rdiK8u3rjpnZcu7hI+os2YADfiTNHBG9fhRb+chRXm7E1tjtmfCaVcyB5DlmVS2npq4O9RjqBvW2ZyWu6ODjlLw5iE4KRGMRgKrNLrsk2zaVIAJPstn5d8GMHJ0TlNLIs/DzhL5biEqwJJJEqFN1CuSTZJY3pJYHsQSNPzpgv4R5jMTLM4ERLBi4AaS17VI1sBVAhVogYfnCOExx7WCSfhVGZrP76fqa+oxPz0Ex7FYR/EKaT6V5gP3/THoR/jpbOKXO/AjOYfDtEOtlY6rGnUIuof/BQXkrvQj27364UvOHJuY2WNRlYr2Mn4zsb7rHsW+VuCO2n0xp3iHCI01W0kjtuaW3cj3pS1e2ptIwpvFDjKZaJi2jLyOKAYHMZhl+QVtCH/ANzKL7emH6RWifeTMxcweGcbSXM8s7Dt13WCMH0YwLcYA9Cw1dq3OK9eT41pcvc0pJJ/9OFD72wYkD8toi36dsW/DeU3zsrSyZnoQIdyRqkf/LGiDpJXud9RA9GOH74Y+FjPp+7wCKBQQ00rhppPQDtoUHcsUXue93jpiiUhH8ueFOcB1FwWPc7pFV2VVSNcg/iYINW3mAvGjOS/DljGis7qAASNow3fstEL9aZqrzXeGLw/wdUAf4ZPfcs9fMAMq7egJNbem2GZy14Zqo3PrZP+wpf0A9t8UoFipl8Oi3m301SaQdb+wG4u9rJIHqfXF9yF4JzX1JZCl/BDHWlVvbVSjUx7tdiyR88O3h/LgG9X7XVfsMW0eQA98CqF7A7keSVACk37j3+vp/LE2HkPLA6hGob3HlP/AOrQOCAZT5gY4tJ7kH98RZkzxlcrWwJrFgmT+eIsZ+mO0bfMj+eAhrOxi9x/z+uOSZcg2pseoP8AY/649Lq9/wCWPSyHDCkXOIccHJ9e3/PTEye8c8u3cdj/AGxmGiI8uKuXMkG1G/t7/L6+2JvGcsfTvii+9Ed++EbodIuMxmww27mqB737f7Yh8RzFAWa3A+VnFJnOJMCHG5G+n3r++LMyLKEeiAaYA7UfnhFKw0eHY3Xb5+hHrjjmDpO57+v+o/viRxV1Hfv2H9sU/Gs2pQGj7eU9q39e+2FYxb8Mmssu3uP1xw4i9d/L88UP31QpYMQwA39wO21f6YvCdWhwb1Df22+WCnaA0cc9kzW5/b/gwlfFPiITyjUWIJ76Rf1O3r6Yd2en3/T2wD828thgSauvayf6jCTQ8WZw4LwttTMxUFyL0sSWHz0m3rtXkT1IPfB5luGihVVfdgNz7gdq/f6d8UvHMxpevLQ2FKzOT6ALsg+V7YIuBxlgDWn/ADP3Avahsov5D9cc6Y7J7csI9dRidwAASEBr1Hd//dY/y4KuC8FRK70B6ki/n3v+gwKZXOSMxEZG22ogGv6WfpXuTi7bUopvMfltfzIuj+mLQa2IyXzJzFGiFqYADcgWB74yj4x+ICnVpaRl7giiR9B0yQDf8WH9zYwYUwLHY6BYG3azYv6dvljLPjTmtTFQQPddIPb0DlhX/wCb2w7bbMsGbOc+IPIzDdlO9MGBH0v+tD6DHrlTgA+L8q1q1UzD9KNfI2L7Vj1x2Lp6iTe/pq7+t3vdD3r5HHDlHOxlgi24dt0BojfvdA3612PyGOlaJtjL4lwJUVWDdwGGvVW/rQuh7b9tqFnB34f8Gkn0JG3zOldANEEkvuQB3dmvSKAs6QZOVkgdUjIsgBdI2KqN9TsbO1WTemvmRh38OjMeWWOJRENj1WA32sOVO7adykQut73shRi65d5LeVaRukirpMjllZix3Kg+ZFPcEVK+2o90Wr5v4RPk10cPRdbbO9apHa/yCmCFiSdXmfcAaAKwBcM8USJUQSkRDuukF3o00kh7F27DSKRaRR3J0dwXjBdKXuRRNgMtjsK7MbpiNx8OxDY1gADkrmaZVVJWU5rV51La+mRfl8vxyrvqIGiL+JmUlXByvxs6QdRLVu7d7J/Ih7D2J8x7nvhb8Z8Oz5mVCCaDm6Ohfyg7sbPoKB2u6wNQcxlJDFqUMR8FkttQokXV+rEgAe2xxrMay5Z5gWrssxNX3J/2wZZfMbWe/p/pjPfI3HSWCqynQKavRv4VJI8o9yLY2e1YbnBuJm9zbe3oP+fXFIy9knEKs1FX60MVOdCi/wB/54+HiLM1DsO5xE4hETtffygf3/bDOSFo8iQGM0O4/uf74DecJbXb4iNvqB/8YOEhAWh8h/L+uFzzVljrA+eof0P9D++JSKoqIuChdMosBtJau49VP1Q+nYix646fceorRggawTESAynTsUIPcqbBVu6V6qMdZOI9NSrC1sn9DZI/0xxzfEkVdQto2Oq17qRtqH+Ze9eq2KvCBFRnck8bM6J0p0oSRWzRSKD+ViC19/K/mG2l2x+4vw2KeMZiNSpo9XQfMp21NpBplU7kjSwGlvXZicwwCRuorXqWmKkXXdZF9DvV+hF7AjALPl5InYpSuTq7eRiNten2btInre3piLwx0VHCeMLLA0UpUvGRT16NeliNvfS4+nfvgVz/AAqWFgUtx3o3ZUfEB/mT19xTe4FrxBUdi8Y6cosT5c7V6loifijJ3FG19sd8+5aPynfZlI7q47H6H4W/Q7VibRRMoZ5FfS8daX+Ja80c3odvyyL5DW10aGmsQcwwZKP5f6H5/I+/v8sfmgNkja96Ha/UV6b/AOu2JGbXVv21Df6n4v57/tibKAznMuRfej3r/nceh9PphE+MGT6h0uNa0dE6UXX3BH5q/MjbjurCxb04/PJGrUA+23pfyv0Pz7YzbzfnWMjO9orEakOk0RsHVl21D59wSDtuHhg1Ajk+CvHGLK1vWk/F9Ca/mAR6jFRNwxntm0qK2A3IHrv74KM5mgVpqJPmR/Rr7GjuAdwQexHywD5vhk7MHotWw9tvlisW28mkqLrK5osoQpqiGy2bdf8AMgPp7oTR+RxPy/K/kJVtOq7KUL+vqD7jFJlEZULFSG9Sp3I/8TfbHnhvHrsLblh5h7jvR/1vDNPwJjyWeT8g/EmtADSgeg9DiZw6LUQ4YmMjbaiR879cccpwwsD5dIIINhbB+V9x88Q8hxKWAlZELKotZFW9gPUf1/4cI03rZROtl3x3nIZfQiqGLeZi21L7AjvY9+2BXjmYlzLDQNKKLJB2F9iSor6YiyccE0mt6Zb+Ht5fYb7H9cd5IVqXpuVW102pXV6lSwsWPT0Iw8YqP7ElJy1oJOQubniDpKHkUG1ZN3vYUTe49RgkHisoJuKWl+IEKa+ZN19cBfColjiOtla/Mqqwux7n139B8/0IfDfk8Zw63kbpxMOpHpIWzuFvswrvVkDEpxjmTKRctBvyBz4M1rWON0II3r3vcMNttyR3wdDgcYFRlhQABJJLsfVge/m7C8cOGLXlQCJNJC6V2KqKLV9e367HFjwzJEoFHx6b1MNtyKtQexN+nzOOKVN4OlLGT5wXJsjXTgsRrJI0etldXv616bYmp8REmpVLkKlDZdqc16Mfeq/fEnKZUCyQJZtxoFlb2JosQEA/mbr0xP4fxHz1IdBCkld/MqgWBQIIs0Due/bChorsxP5hpIDv5QxIJs9jsCaNVtQAxPlWwqldeli3mF62H8HYn33oYk/cjIGOmm81EULXvVrv5htbYrpZDSsgO6ganbVJ6+UC9KxqV29Wod/Ugo9cIyTNqlNIzbd7OgAE77gMdwdP09KxaZWFV9A3YkWCVs32F7irs498KiIGrVYI2DLV6j6Ghtd3tYHt3xAzcQeUmRo4YChRXOlC5JogMxOwAq6trNH2ACNzHwxpVYhwGZCEYkuRewVUXsfZu+Eby99nfiAzjBo18ylkzDMxiHY6Tt1C+/Yr7+bGkM1wwKsRRQ9H8NFIRDXwsGBqqBosTudhvtMyebpTrk85Dal89IWaqShqZqBO+/c0BikZuJn7FXyz9lxHQtmJmmAYbRHRCCDbWNmYXtZ/lhocu5CKGEpHUEa2EUJo1vvupNlgfeiSd8euMZmJIwNRpV2BJUWBY1xmrF1WokXffCT5r8Yc7IyNCyBYdpHdFILVvVb0AKBQfrsMbMsCtmhzxdI0HmV5I0JZbBNgexuvkas/rhNc3cwwxzDNjLRlHUEmPMmORnPo8akKTthd+FHCW4lnMweosKqCZekzCSQvdFQ10tr5iRvYAweNAuQhjkTLNPI5ZZZHiYOroSABqshdrBA0kUdW+BNOODLJX8W8Y9eVkMsQ/wAWkVwraV2ayGskqRuexwPZfJcYz7K8YaOJ7AkkbRFo7eRRZIrt5aO2/rgL5644+YOoruxs+nY9iPpsfljbPB+KrmMnDIpjPkj3U+VDQBsGj5TsAR6VgxdKwsWfLX2ecuigZljNLuSQ7xDT8gpANem/piR/+7/k+m3R1R1LqMmvXKVqmU6zWiqI39MNTI5Tfbz16kbfMjt29K2wIc+rFLGY3GsDsqFtRZthqCV5dyKOw29sBsAiuaOGw5WSSKGZczrBXQqgtqFfGTa3fYgg4sm8NJZFEuZkETlfgcUCq+2kd/lsMVnNMUsM6p0NKqVkUhQihT6a1JDMK3Bw8Oa+Q8rm4IteYmERCkpG8ZWQ9yDaFvqEI2vClk0lkQ2Y43wZZFV3Z+mQrBWJD/oHsfLTRPpi75x4zw2N4hHDmMs0hChjDKLBGxjF2WrfbetyPXDsn5Uy0fSVIkkEbKyjpRqsZWqo+VtQ7+pvfF/FmQ+/qtm3B/D+Yobn5Xh6QrmITgnEcmxIOdDylWjUZuMkKw+H/FrT77bmvXCt4x4BcUQvOwizOk3qgzAJK99gyoAAK2BvGz4+EI4cMoYE9mVQdFfwkG73371jOXjz4AZskz5Q6oTWvKRfhlV7l1GrQ5FXprV3oE0MU43ToCeSi8F+fh1kWWLMOCSqKqQyIt7EsSA5r2v+2Kbx85vkymZU5SFsqdZErVSydqJSyFNd+23v3xQch8QzGVdnjEkQWtayQlO3p51Hvfp3B9Rh8cqeJ2XzW2YMcTUBaxgs1H8zElf5Yft1lq0WlxtrDAHw08F8nJloc5mMxmIOq9RoV0Fn9DHItsVJ7MNzhneKnC8pHFDKy5V85GUiy8OcTrSZlrAVGNg6iSCGYNVYX/H/AB8OYihg4flpM2cs6tpjy5ZBFGNQICA6T3G/td9sGHFeXuK5zRmHjh4XGI1eF5o1mz62bcxp3jJHo1EDvVViVTcu0sIMnZ38ZOVzHw2R+IJkVzZjXowQrGrRE7+VwQzMOx2Gw774zX4Y5/PJI/3MTvMw0f8Abq7NTEb+X4fQBrH1xofK+EXDQ5dml4hO28Zz0rIrud3AiS+oD2Ctt29LOHHwPw04geHkqRlW36UMcccLOt/CzxlSoFACzdbnc7OppKhVNR1kSHDOMcX6dZvickIVD1svGhzGahSwNTV5VkFWLJ0163g/8OuCcFzOqcFM5mmRFaTPyRtLGFu5Vifyi1HagScdOF8EOWWVZswuVZ2C5hMsrZ3MMjUAfzdME2L3s374quWPC6d53lyvBIgwJ6WZz8p1kFmUSCIBwrX+IE2ZNhthbF+0vwg34vw7NPMq5MB8lo1yT5lgIBp2/CiAQEKBtVqD6+oXvjFz7A7RL98fMIEVUyeRVQXPYmSVNlUH13oUbsYtuZYclw5kXi+fm4jMQZBk4gVi1USFaGM1obdQJDpNA13JveXPs2JnkjzIaTI5ObRJHw6KNYpFWtPTnmFsNY8zKpULem9sL18sumo5ZF4NmOJGFY5pTBl9DCPJZBDmJ5EXuskqhhG1AkkkWfbvi7k5ViSPrw5Hy0srtJCI2iKizqZr1MuxIHdrPocFnitz9HkIly8SCByRDAlGNJJSKQQpGplmGo/iMoEaDd5BpbEnn7xGzUeRYmJGYQ1MynVH1CKKhStkL3HyGEkicpurQMZD7QMnTSOOB83mWP5K0pEDsWZQe9iwQFB7kYczFWVQ56b6QVQmydrPrW97n6HGdvsi8Xi6s56L/eWQ0URun0QSbLNUY1P6Hc6QB2ONF8YjMjFWpI1TzBe7BhRp6BA3OykG/UbYdqjkWSJneEfhEMSxG+lqOtq33PlOoeWtwO/piJl3jcmjoZAVEL1fUCiuxK6Fvatr3x543xyMqixmtR6UXdlC0R2B+JRbeY9qs74H+W+WJHWOXMFg0bs3SiuJNOo6NdUX8iqzW3mYk9qwqY1HvP8AHvxJIZJoIcvGqHXrJnktbkLISFRQPKSSxo/lrefyNx6EUIUeSMWEmijHSPuwui1LsSNQJB3vFhLxHL6ZXXplYQfvD6duwLbna1Tv7bbYz1zF9rEZjMDLcLCyOQV68isIohVjRpFyaiw2oA+53wcsaMG9Bp4n+IcGmWMTIzS64VyjjzSTPoAZlYWaFnTVVvfYYBfBbw5eChl2dUYlZX7abJUuoI2cHykj5D3wGZPwo4oyu+fzgWUTQSRZlEWV0jWQs5VRGgSyxFW1GrUgVgi8beK5ebJwQZbiCRqsnUnRnKTyptoiDIdYbWdZXYMT39MGvFlVBp0jmrcGyOanljmM+bh1XEJXml6mltWm71yEkgiiUF79sL3iebzsivn58srDUrkytRWPSAESNhZANWTd/FVYvuTPDSOIPmlhluOwiEBhLO50xxpdu4lJpmNgX33OIGc41xVM0crmIVmyutYp3y6np5dp+mChmIUBow9EN6dr2BFXo6Vxxjt5H/4ccPy2Ty7SZUSZ6aUqwdnRyLAHSDCxFEuqxW1n1JwW8I4BNmHikzEdKmphBIwfS5Ujc9ioB22tTvd9pHgr4b5TI5QxwDc+Z3ey0pY6VbU3claq6oKNru52ckZZQytsysmi9hpsg6tyXa6A2uvXA0cT2duH8yJRdfhFjokHsDpVgR3Lae1b4mnoyrHJ8QsPqFEu/wCWP1pVu2B7mhWKvKcBV00gFVdw0hP18ykgHSdV/Qe14G/EDmoZaNYYVOp9ammRYxdHqlWIJAFUsYJO22+MTBLnDx3jZhl8rFPNMGkXTAhbSR8ZZtkUn0tqUevfErl/wwmYo+claMySFhloHbTeotTOpuyB56FXtdDBF4T8stHlo00/iaj5yxXVudT6SC2i/wCLcncitsFc3EB3ZdLLrsEg6LPxuwIUDTuAaJB7emAG/R04fw2OFSsapCpUACJANZOwDuotjfqfMSThdeOnjU2QyQMFyZqVljRdDOV3ILaKJ/DG2knzEj3wcw5XSzIHQqRrI1UyAnZxY3A3Ye1j3wpfG/mFYpstl4I1zOakkOhC2oKpsCQiw+oHe+4GojYDDJ0arF7yv9pHiPTSCQDVRZ5+zhCSvwGgjBbAaiSew9cC3PHBusVzEYYwNqE/VdmMiLRUjUQ8gOylRYLNW9Yj80coz5DN6ZI/v8qv1FoFYnEh0ojMdz0zuE2BrsbFtzJ5KXizRu2X+5fdQ65fWobrPal3MQ0VFEBce4BJ7bYz3Y9UJTl7w4mlKThEdY2Jgy6KIakVj0k9XQSNeolTsNyAd9TeFmdz5gYZ3SrdQ9MRgVHGK8uujraybKjtt6DHDlPwYSNxMQ82ZBJVj5UXU90kaELEfSxqYju3rh48tcGJUKwG3oFZSPr5qJPrRxeEHPZDk5EtA9y9y+hbUwbSd+1X7GjX7m/phi8H4ei7qFUe/l1fy/3xa8N4Iv8AD+//AM/74soMqgNWB89v6747FBROJtsh5aPe92H7fzND9hiFxjigAoaQf4QGc/uKA+dXi8mdfcv7Bf7t/uMCHH8o4NlkjU9r8zN+g8oH1L/TAcq0BRADxB5hk0FRO0Artl4wpJ9fO2ogdrNr6+YHGUOeEt9PVEAY1JPK7zzsCaBYjsWvyoSSfegcaI57y4o6GcsR3oVX1KmgO/lUenvgQ8K/AZsxP1swPIpuMUSzk93LEGyb8u1quwI1GjDLHeEXfhJ4ewyIiw651SvxOmeiO1lWdkRmJHmIdwDdjGneVuRYyBqRnAFfiMGj/wDbGoER+ZCn6nfFnyryWiIqjZVoaLsbfxVsf/EeX3vBzBAB9MdawczdlVleWY17Io+igf0GLYR0O1fLHXUT2/fH7pm+94YU8I/6Y9qMdhHXfHPMX7YWjHmUr64/Ruvt/LHFcr6n+WOxQegxJ0E5u49BX6Y5vma9f2G+OhAG/c49Gc12H6YAT8nFD6g46w5kYjQ5lr2B+voMTguCjHF88Dio4o1jY7jsR3H64tpIwbHoPW/+friqz3BUo6SQT66j/L0wsrGVEWLjYKkkjY6fodtvqcVnHI9S6gNx/wA2x1jyAS7AIoavqOxI9z6n5DEolSNgPp9f+dsSVtZKaAWXNklb2F779vcH698TOJ8X8oUfxDt3r6/0xVcdWyVZdPfttfsQ3v6+mKmF9MgXUWBH5u9j5/1GI6HoZ3RVwjHvp/nXrgMyMw6kkV/Sz/T+m2IMnHJBJGAaQXY9SSe37euJfGk/EVxse4b6kbH64duwI88O4eomaPtrB0A9gfUC/wBNsG/L8YEaqR8LaSD6bncj9sDkuYBIPrsb9R81Pevf+H9cdMxzIQr9iQAb7MwUi7rvXvhoUmBhJngqWa1EnYf/AD2HrgF5ozhaxXoaH+lYk8S5gLyOi1sA/mO+581AdxpBAN1eIuazoe9Ndtvevf8A58sGTtYAhQZyBtbWoq9u7H60KHyAsnHt8258otRtu9KP0Tb9zqwQ8WzNLt8RuyBuPkP64ouCcMJY2LI3JJ2HyHqSPWzX1xydclrCDgHDlHrbHf8Ayi/zFRuT7XV99sEjqoHlFn1f1N99+w+SigPbbFJlYEXY7juQT3Y9mkPrXovwj1vYYqOYvEGNNi+qjpCIPMW/hRRZsn9e3bHRGkhGrLvmGcBDpKqdrbTZ+gA2/U3vjK/i/wAD1W7EBQQfNRJPuys5vv2UAj3w6jx+eWzo6SAWb+JQewPprrcqD5fU4RniZxCyaUnv8QYlq2uye31/0GFcvQyRlLxKzxIKKpG/ewbF9/l7drrEvwk4SmvWzgMKpBQYn/KKtSewI9Lr1x652V1ktl07+1hvrhm+BfKomcvqSHUopwBrFHcCwwA7aiuk/P26k8EmshlwHjiCWtLKBZmZ9L2R2XUTVgedtyL0jbScWXM3iGCQkAaZyNFaV0KpHmNi96oVdlS5td7L5vAaBkYKxpmHmAIN17DuCR3uz6+uLfkzwjjjRU6taQQCIljYN+bzaSSfayxv8xrCmPHhX4cx7S6B1TuWCaRuK0A/lA3oqTt6gnZ/8t8OIQKI1joUNrBA+R3v9T9cLPhpSO06rOo+Fn0ggAdhpAvf374vsjziopS1Gu5a/wBtgP27YJqGHJET8e3y3qvXb+ff5YFuZ/DiCbzfAbsBdgSO2qt2HY0wI+WKfiHiQg26qetgkXv2A39fb9gcVGd5yUi1ZhsTaN3/AMtGx3xg0GHK/K/R+JxIb7UoPy7G9+9k/wBzg3yvMQG1hSdgBv8A07/83xmyTnmZXZnR9A7EJJJIdvypEAoHpu59b7Yn8qeLCGRWMbx0aAeMKzH1Nm9IGxLG6JG49VsLRrLL8VZU2Jc92Owr5AD+Q3OOYzpIBF9mv6+31wG8vcwGVd/KgABYG+ozGgE7Ejbdu7HtteLZ+PaWh0/AbBH8Ioiq/i1dz7X+tKJk+fiLKpo16/8AuF9/0/tii4rn7MTkbaqP/i3Yn6H+/wA8dm47HIA4I2JBAPsdJP6Vvj82aUqY9iR2+nof3woUfuM8PUqT3Hcf1wET5sRGlXXG9t07+IfnVPQSDd09wHXY0QSZLmAISj7L/Qeh/TFVzBwIMjFSQCb8vdGBsMvzsX8wfmcAxS5Hl/RvCxaFtwPVG9wPQHaxtvf6wuOZdyNJHmotG3sfb/xJ2v0PpibwPmDSwJIAupVANBv4wB+Ru/8AlP64L+KLGaNgE7qdu/fb/wAvYbMO2E6DWIDjYEtak0yqdiNi3uFb0Pr32awfiOIsNja732Pv7g+x9aP03w3OZOW1JsABj3BHkf6H0b5imHzwv+Lcv+w27MD3HsTXt6MP1xJxoZSsHc8UB71f5exB9h8x6D1H8qnPZyhVg77H+1/lPyOJ/EIwPLJv/C3uPQH3I9CN/btWBniRKA2bX0bYivmfX6n9cIykT5nprVuwNdn+Bv1/Kf1/pjI/iLzCjTSKytHRIcfGt+wIoixR3X9e2G14heI75Y0yh43+Fgd/0/K9eosMB3BxnLmzj/VbqLqv2q9I9vSx6gG9PYbYrxw8gbLDl+OOUdINTWWjLGiCB2AJ7N2IHrR9MTeD8QI+M6SDspslj77dvbFRwgNKqnSNj8ROncbiq37/AM8V3D+JO2YNDSQTerez/qe+GlG7HTDdZywthQ7UL3H6jHLL8IRaKKASfNX/AAY7ZN7q9/WhX7gDFkuUsdwD8zv9K99scrlRerP2Uyx7dh7/APPT1xU86mQqkca6y929kAV7kGq77Hb64KMrwgncGq77Wf2+X8sSouFt22qqsr3Pc7A+3vhIzp2FxtCbzPKk8ewj1bA6kBYb+l1i1yk0q/gyIVDUCrnQKO96uw9wfrh0ZGIKum1Lb7LYNjsNNHy2Nzj3nIAaLx35GTSE199qUEaiT+w/TFHzN7Qi4q0BPAuT0CCOYx9IPYDrqZEYX5ZlPqdyvqfrhgZ/iEOVy34IVRRKRivOxqnIvzX3PsMCHKfLmYinMah3Sw7RFfMqnsDYKqR3O4FDFl4gcoBWEzpI7NIAyKNaoNttSdtan0Wwf588pW6bOuMEi0TmiRVWdRK9xjVE7IAx7HQgGoEblaFNtfvi+5f5hGaLhUeERrQEujSwIFsNN7qTqNkena8AHFeRVD9UZmNVZRoVmDaWK/BuAFA7EiyDVjviFy1w4RGRcyUBZdRjldo1pvTYeYv6GyPhOBSC0PvLy/4fZrYsXjoqRsBemxuFOkM2x749cb5q8j2FXSQaJXtanRqHlBI/KTubFVvhb8t82ZHJoUjlEiyDeEOCkZohiocgEbgHVvYsb4vPEfhJPD9SWkMbLMdKhUKNXxaWokk6ixsja++FFeAy4Fn4swW0LrIKhkBbRpPwgaSqHTW/e+wGJeY4IVsoKpvMqmhDpU6dJFBAw8xvfuawsfADjkjyMoX8FE1EIAQFG584Nhq3s7/zx84zzk+ZzE6QSqqKxFdXSJYwKIOklWO/rvXdj6AUbhzyhogjxOrFmZIh1A0ZNDS4JJZTbEBKPmO13infNNNK+iPWIAelHIjBWvYOpmUBaPsrUo7jfC95R8QcxBGuXgUSa5KjJSpQ7CzpZSNYoDcnYA4Ns/xTQupp5vvbjSqSRSbkbFUjo0hY/EGY+t4U1FjludX8yTROgFRa0/w7P5gABuDS+Uad6sXuScMyiMCzjW5N6aIMQFgVsWBJFlh23wK8o8AmK9bNqEk6j9GMVoKeh+IjU4GqyLFDsTi54ZzxHmJZYkhzEQiI1TshWFrA8kcvlLE9rraz8sOkBim+0lmbCRmUqb/ETWN0v8/l1Gj2IPsPTAfH4cyaY1Dao5UYiMg6o1CFm0qzAkgbg15u1YMfFpUh4pl55i4ChXJ6ZmWt1URArpLAnzCzXcC6xd8+8RljmWWJxH1PLqMZJjjm2sqQSH22oEjt8sVUqSQtWKn7LnNywcQeI0y5lekHtF0lLZfjo+YGtPe9OxrGrOPcP6kbprdJjYRhqIVqOkVVEEel798Zi4B4SpHn4m4jUMbOGgma41zEoYOnnSlTzFWpwhbtWxxrTiGZlZgqFAWQkPZ0+hFGt2Hbv2F4bmabTQEjOnCPDNpEto5hICVzNrYVjZ1RrqDSr2oqCK9AQRiVyPkMiDIh4hJAEW3y4RoJJmF/DHLRYg1sFJuht3xozhnD2UO8gAIWtvMbAu22799vTbfbABnPDjJZpzJKJC1ahrmdQtnUNFCgT2IvbbElXkGfAMcFzyFLyXEM91f/AMGWOOUDfZZA6oFB77Pfp7YbPJ3CsxoBzJTqXqZo10qQfhLC29e47YHOF8t5SJ5JVCxoo89uKAXYsVXeywFEE3++COLjJKt0yWsjbYHcXd77VVD3wMBp+SVzMiBSW0CIWSz0FAu978oDHYXip5U4TlkBkgjjYNupiIYAG/Ou5VRvRqv7YUvOfgFNnJS8mdzKqfM0LkNEoG+laK2ALPmBN+ownOKTDLz/AHaKZNWsqmYS4AWJJUOyOK7AG7Gr64p1T0CzZcHB3kFgAMe6sparPc/+XyqxjtLy80YGxZvVqCq1EgKBtQ+d+m/fGTU5/wCKhjFNnHQadJClBen1EqA2RtTB/NtZF4N+AeIvE5QFhzasEG6zRQu5RKBvszkn23I7nCvDoZKx5PxmTS791XyquwJO3maQtXz0g7Ab4XPMvj2kcojUxzyHaopRaae9awFBv2Y+vywIc5eKedmiaCaCVRp0tLl1pWA3sIRsGH5QzNpvFF9nHkLLPLJmJmRzCWWCAm5g603UeNSDpANKCDuGJ7YyV5NoZ3D/AB2y80ci5iMpHpKKZkd4yx8p6jKlDbuCRqGBnmTwK4TMqdNkic/iLJl5Ei1bgE6NRoA7DUCTY+WH1Lko5BodEKt8SgAoxPmBPlFWL2o7374VnNn2cMqQWgQLIpBW91amBI1Eg6aFD2IG2DFtM1nbxD41xUZWL/psYhd2Ly5pY4suAgGnTHG2xXtbOAQLx05g4qkUEC5/PyNnZV0tDkY455p9ABZUHnC0dhsu179qYeQ5NkSJv+t5/W0wBOSyqlIVA2C2A8reazYdFYbV3vhyPxeWJkOV4SmVhDt03iRdcsRPkcufMNW7MG7ep3GFc0sMvSA/w08Ms4unM5fKJFIxcx5vicrfeAu9EwINKWd1qthTVgqyXhPm5XabiGfm8l9SaOU5OCONu6qi2tMKOsksPNTDUQbXnjxcihzKvxGQZPLIrkJ1AzTNQuKOKPXI38WwF7DCG50j4lzNNHFEjZXg8bsI5WDBcwyNQkZS1yS0SI4wulBZLaqAaC7ZeEan4wGvAftCcC4c7wZFmmj6jS56e2dJGqgY3kbVMxYAWh0qNwTiTy99rtc9mxDl1zkkATSMrk0UyyFrtnnLXCg+TI2ru2IXh59knhGTkWWQZvicymlypjjEJe66jIFUkL+USSaO5okKRo6HPzolQZSHKhlrQvTV03IjYpFudXcqNx74d9FoVyX7Md8zfZc4lnNWYyeRThpikLKmZzUsuczRDf4ksjmZFKVYtzq96w1PCfxXnzmWnVJWiOXZYJjIqrIZV2LFxqFau2nuB6DDo47zonDeGmbPShCgbvZd5Gukj1C5Wo7J7/IYwX9nLxlWPOSwMWbL5t5Hc6C0gndrV3SFa8y7OB5Q1UcNJOURlc8sPufPHrKifMKcswBAgj4wJA0ySFiTRmLOYYXJPTjkrc2oDknSEvJrTZARNmHkYwoBmCkdyuw3dljAVS42Cg9jtir8McovEY8wue4cIIY5ScsZVVxLGRXUERJaNiwOxA8tVe4Atx7wpP8A1DJy5eWXILC7ho1hkfLyvKoSMJDr+7oVQFg7qwDaPKCotGk0kyU5ehq+GnAp8pk+lJGrPFaR9JyzdMXV6ggL2TQ7fPviVmuXus0TSCQFAxjIkaIKb0kMsLAy+UeYPcd7jtjpkMp0FCPJJK3TWMySlXaah5ZnESoocuSBpRQQaAULt2yPFpFApCWZiANGkKBv0/OTQagzEbCze/aViUTsxwSFHj8gEiKT3I06/KQteWjsCe+na98eWyDaXQEKCToPbSWHlvvek32vau22Pc/EmDENuzvtagrH5fLHtuRtYO1E2QLxDzM5QnbVcqyKtEt0z6tV72TpJoihQNjGMQODcqqqSBHdQ9vMRTBpR5WsyXpU1TbAH64zf4scicKLdaPM9DOIy9S6hhmvU6sNNBQo3Dx6iaAI33Jvtbcz9HKMIihd81HHI5Zh938upZRTrrYlVuOyBqLMvfCQyPibkkKWv3icmupIhkmMmwRY7UousgaI0AHtucMkzu4eN12DTljnzOqVuM5zLrbRuRKgYFQyOjuBrN7FtOkEdyd8C/2i/EJUiiiiCJnMy+pstGkcyxRsF/xXKGbrbtoCdjqNeXBBwTxY4ik5y+ayrU661jYo0qBKkVj0yyqrMR+YMtbjtZ9y7zZFkZVmOTEskgUy56aSGJ6komLLJKxYlCQtsIwQbttwDF9ZZRTkVrGzr9jjLtLkUzGYz7zLFIVjy7VHFA0epArkoHmYD4dR0LtQsXi2+1bwmQZAw5XJTynOSUTCjOItNM08oXzEtQChho3BJ2AwkZORoc/xD7315clO0gdIcqIwkJQ6VcPKNLzkKHfQulmYgEi7NOO+K/EMpA0Wf4gjRNKUQiFo87MmxqbMRv0o42jDaikSsNhrUkYo6btf9HDGE01ZD8LBxJYUhzLztDIXWRgAzMrDvHNHbJENNMdRYb1tuK7i/MBhzEaZPPSyGLUWysrdaMKu5XquFYHevxGJArfBv4YcfzkMbwRZWaKIRmamgcLAFUaVSViqPY3EaEszEit8LDmljI088QR5QdKug05j7xIpGmgC4Ct3VoytkjVQOIWehBRvNBRw37Q+ZnzSZMtFBJpLAT64kkksHphYS4YkWVNgNuR2wxOVvCFs1mv+o5uWH8FjDBHlZDJDEQWUyO0qL5z6osYCULLELSp4T9nPh8H3XOZ/Mzyzy6CuWdV0/ehTNG2hHdghFAal30lj5gMNvw+8N8/EDUTZeJpJZeqjQM49EBjJYHWD57RQtX64Z0tHHydW31GxytFUQWNnYKChZ1UOyKxGttgO/wDCDYN7k4+RcOaRUPTDFZWLElgNQBGrSACwUiwDsNqHqBPhXME+to5Z0LfHD+GIy8ey07lyjG7DFVABXtvixiTKxh7dwwZ5ZGWR2k0swLHUoo70tVVCh2OAmcxf5TJuZFA8zeQSte8agkhQvq7D4QQdIsse1gvirxpMvLDJHl0mzjv91y8gC2hkVmLtIKIChSX2IABFi8E+Qz62ADII2/EJOxJPmFk6XVdzZJJNAVVYAOO8tO+ZeSGaVPw2jFR3o1EaqnK0C1b6dR37gVTqLegdktie8CePZ6dJPvkcrvKHMOdXQRl5EDROXDUWXuI1Ve//AJA4PTyLmYc1F03fMRAgHz6CGtAGZh06Gm7UEr6FbJODrkfw0EWyPsF06NAKiuwtrHzJG5+eGTwXk5TXw7d9KAb/AFob/MHHQuK3ZKXN6OvAsjKa1MFU12Jv07gtg74Xkq7MT7Ght9Nv6k4rcny4t73Y7nf+v++CfheRAOw/5/PHTGNHK3ZMiDVWx+uw/lj0cs23b9jQ/nicmWFbj+uJMQ9sFgRTtlTZ3/YD+9/0xD4hw672AsdySSQPcnt9NgMFIy19/wB8RH4YGNn/AAx3O3nb2+aD1H5m+QNxSbY9ii4rycjEudl20juXP8VEH6KDt+buRgq5K5VNiyyJdV5QzfIke/rpJ29yTRi3AC7AkUg7LXc+/wAgO4v139hgm4bw5V9P1/56Y6YKsEpMk5LKgAACgMTRDj1El47HL7bkY6CJHjy5x9eUjHyaf538v98eET9vf3/1xjHoP/vj9LjoqjHmSvX9sLYTmibf645ySkehP0x0eQe9Y8JmB2Xc+pP/ADbCNWMjxHq9qH88dHf/AJ6Y6Kfc2f8An/N8ckazgAs6mU12/lj00Zrf9h/fHqRiMQm4rXz/AOd8MA6f9MWrPc7k32+QHbFXnkO5U0fS/lt+2PTcbXsTX1xU8Wltk8219x7+36/r/PCSrwOiNHb3tV7GiD/wj1+WK+CSRGK3YPY9j/z2OKbjErLMu5XVYJUgD5Xfr3H7YhcXycjAhZPMN0J2B+T12v17Y5O2S1BLxThSBfg1G9wCLv3s3v8ArgP45lwCrgEaSLB7j0s0MSsjxaZBTg2KB2JH1BF/p646cSzwlRgpJ2og02/0+IYZ01ZlgHc5OTIDf5Cf1vY4K8/NUYa7pQb+eAaFyCNR81FQKrf177+mLTP8YIiVfU+/z9P1wqCw4TSyo69q2PoCR2Yfwt6H9D6YqON8FBKyRmr2I7qR2YEenbYjtWKbhHHGChNrHl3+Y1KO/Y+ZT7HT7DE/lskSSxmzG3mWz5hdGu/obHb2PqcUVPApVQ8JZcwGJ1CtIB2NAG6PY2CNSnfax3x04dw7p5mYKDpkGst6D00izt3sAe59sXfGsra7jYEUw2INiiPY36e+3Y4h8J4iGJW/MO59aAr+Zu/bDdaBYH8WPncAbDa7717nuAP54qEztDb4d7Y7Db+EewPq25wQcehALX8Pt6H/AF+n++KCThjSEWPIK0J/Efc7bKvffufpjnKFfHmZJLohRsSfYfxM1fqFGLDhHK6p56o1fUbdiDvYBB0j2HxMavBBw7hypQJBIGtmryj50b9b038ziHxPmVQDIQWVQemnaydgT7kn9vTfs6XsFlVzBCVXSxoeak9aO+/bfa3YmgfoMJTnpNz011ED4yaUevfcmvYLXzw0+OcQZx5q1v5nAHwqPhjs+nq5PqcKznTiKHyBgx9SN9/kB7egv54WQUZY554ZLLmNAIJFdu38+x9Tdf2xO5V4tnOvFASDp+E7KVI9gKHehvYNj54tPEDNqoIhV0ku9Z2LG+99qq9rwc+C/hh5BmnLM5Hxbr8rqqr5gn53tjojoQbnBeNnLxrtL1aC1p2LEXeqwgBO2zV322vFDPxTieYc6IkUBgQTIz0l7ggDvW9A1/mwLzc+ySyNllqU3TDVpNE0QdRALb/lsH2sjD55O5OOVjBAa67O1la9KJPl9hZrejgmYg+cOXOMxXIipKAb8hazV7AEUANu1E70MJDm/iHGXYsY5St7dMNIQdtqZdY7itgL/TGu+bftAxJYFl1JUrQI+fmXY/KjdbVga5Z8ZXnb8OBqF+caT9QbptgQwsGxt6WHWAMy9wLmXPwnV90kdm3DPFvQ3OkFTch9zVUR74ZXBvFueIB2yklsbKtIQqKPzso1N5bGxYHf4R6bL5Hi1r+IgU2p8wB1A+oIN/Q19brBO3J+XewY+wN1pIJu99u97i72/lnIAjeQvGGOeON45NfVsbx0q6SF+H4+5UeZh5jvsMMrifLSyxsz6XZVABKaNBYHSWHqAaa9xsNq7hvOPgRlzLccZilFktAwi8pPU+EWCxfUDY3BYdiQefC+dp4fwpY9akFuovlbSSfIykkEoLDBT7UoqjFyHQXZXiq5FVLsWF6WnO6pIoYo0gHwq4bSCBoQnetROGJlONB3mD1ezKRtYddj9BuLHtha5DmmGWLeiug7N5g4BrzbbkA0bAYC7G5xCTi7xKrR/iRx+TTdloCfhBJH4sRFKTsy0PzXgKYeoXcQV0Xqx97LSoOzH4ZAPa61KfevfFpl88GMbajTL5JB8xsD8j7H1AxW8PzRWMOn4iXderIw279mB8p9qHsTj1yjLE4aIHVEza4XO2gt+Rv4fMCCCBpJ+exTFLGLmGKWQxOQky+WRTsb/LIvvG/fVflNBq3xNmEkAOka0Joq29Ght70a29R237YXXPPLhlHV+HMZRyjkbMU/I/zra96N77Ni34ZzpKECyDWpABBofLyt6e66vhNrdaaPY1HjPcRVyZcuQJV3fLyGiQO+lh8Q77jzD8y1i95U45l8whQ+Vr0tE/5W9tvT1VlPzFbjFRmeCwyOC1pKNllA0k+yzL6N7ONjffAvztyMyAvR23JHegb9PT5jtd7VhOzCFXE8xJliRZeMndH89A9tz8S+zA/I0cVef4/CRqHlvaj239Aw1EH2Bo/XCy45zPmEUBmMsV7WbdAR3DdyR+YGw4vsd8RsrxcEGyCD3G9V/ceo9v0wvfwHqE3MS60Ojz1Z0fmIv0+Y9CNr9jhcZvjSgEqbG+pG2Pzv2b3O4Pr873iPE40rzab7G6IPpTdifbfce+FZ4kc0R2QzAN21gGm+TDem+ewOE2MgC8QZgxbomwfjhfaq91+X5JEJr6bYT+e5TeibIBOxsbf+VCv1Hcel2MX+fz1ud732G+30vf6VtWOSTulnbRRNk2Qe9VffvXocP2a0UUUyByx04I2DBtW9kHyb9qwI53iY12pJJN2a9+xrFrn+JrLSC1GonU27V6fDtXyrFhw3lDLsVAc36t23G/wnf9e388G0ssarwgmyHDdQXugoWABuD3Njfv8APBKOH7Ba9SewBsbg3ufqCcUEE66wi2WQA+Y3t2FAd777nvgliylsWkXuBfctY2C7EV6DYbj9b4ZbLo/ZTJliR5lJNWSACN/hH0H5qI3wUwQJp+IhQPMTuBtq8xq6oEkgevfHPhfAFYgJa6wNTlWFkDa29K973rt648c5DVl5VRtICVrEbsWffy+QUtixbgjTW9HCLY5Q8Y8TctEv4bNMRQHSU21gbMfhA7iwbHttt+4X4valBTLzA1qOvRo0KQlqxJ1XddidVb98BHh/4cmUmaN21w+aSFHCMvlbSBZ3DkUaAsWFN1i/5U5qkKoY8rJINUiRTKSV32aPSfMQPUWPMt+9XcY1SKKPlhXwPxKhl1QeaCQvZEpZQZD8Z16hflHYlaPYdsHPIufM+roaXEMzwuvdNaqptLJFMp23b1sbYRnBuHZrNzMrLErwASCOVVd5nOor5Ua3Hb1NCu/pbZnkbiU5ZUcCUKJHhikEAqwm6AqGI06SCbB2PrhJcaChpZ3w/wAuZ2VYtMrhtSMQQ4dvOBpsAXdFQp7+2LrM8vRLGPIOkE82s6gBZOpi4YhF+Fbog/KsLXkTiPEMqgy75WPVG7AvLKbqRiCW6ZdtKEWG7DyrpsjDIyPPeUlkbLSgo5CRiORQ8cp3pgsQYMzNY0sQzaie5IxBqg0yh4h9wnhCwqsIBoZg5bXEKYDRrP4d7ozOSNzV3jjzPzRmRFIoz0MipsIxHGGYEAMFZS9JVgDSRdbit6nJ8fmy+Xmy0MbEPKzJaskaK20imNgBSlAxUkpRB1XeF7KJJ2DSTxIixhpFgRpG6SWxCLCDvQJcggJdkGjh4xbG6pjo8McvnFCvJPpScl1ijihNaiAQ7FAELptXfuTW+DnhzQIyr93BKpUbdJCzaRv5qUttdXpGodySDhPeHHiWrRzlWmZ+qJCjJJJF0RfS1lYyF8tkk9iKo2MFvNnifmlRFRcu2tkczRyRjTHXUaKRHkDEhlFk2Cmwo7FXdkqQzI+DQLIJVgWN0ZgHFF4/wyNgBoBokvXa/ckY8NKxZGkkQR60IBrzxFW2GkWLkAkYmiFFVuaQ/A+cOIZlnkEmWRNSoRPLH0g9l9KIGMg2IOsAgih8sMTl/PTzBis8EtpQWMFYk0byRjz9UW3lLAbg9qGM3QOoecRDDQWYaTQCV3BBAAYC7bbcsKA3+E4n8NzoMugsjMmkyKvZVYAqW9yKoEXVX6gYGOWvE5GPRzCrl51qOlIkQkbDS4ApydjZA32JBxfZjNqHc3IQq1pRD5pAy7ABbUVV7lQPazjJisqPFDk/71G6LM6rZACVWxJAbYudIFgggdr2vGf+ZuLZ5Yui8chkUq8fSRmmjhQ7zSMpOolr0Bje1m9salyvD312U2PrYbffUPKb8xJ2FbjtW+Os+a3VFBrTRvYlgQSuwBJWwSBdjbajgp0LQCeEWdjzGVBmMmYJIDfeIBG5atlKsul1P8Wo2K39i3I8IIDUzwj/AA4inT/DWhQVXXsQL3FAVRxS87+I6Q2iMHn1V0mBBpqFKCANTd0s0KPfewSHxellzqQhmikRGMmXFTK6KAbuNzpatJNsAFNVvWC3ekag2yGUzMnUVZ6YAjWUXzgD+GgAxsHa7GK/lriOZj2mhMgLdISQKG0Vs2pQQVsn4tIF3e2GXwTh4SEF2VpG3OhCoYNVKoNt5QQAx3NYQOU53OXz04YTZXKSlluQhrlBIaQAE6QSb23+G/bCpBQ3uKczQq+guiN5V87EEEbAtQ39h6WR+nY5ZIVeTXpJK3e/xEbmwxo7E1sO+EzHyRFmsxHN9/gmiDBq0kSlUb4LL6fMLBB374eM8MaeZFUSEFKtfOo3AbcivSq9hZxjHnNOxVkYsFOqmUqps9iGavMPU0dsK5PATh5AnRHaWMkp94YyK73ZEkY8prcgFa9dtqZZyyyIOsSrajp6YKBa77keYqDRsURdL2xV8L5bkkMh8obX5OmCAUHwu2qqLVR3qvTDqTWhGrAXlLwylSJkmHD1VJGMZigdSwcltWpgwjZSbZRGyn1wI8e8P4Q8kbO0U1ApI7RNlpFLaSEYCKQEVupjGkHawLw/M4jL5nBaNRbHphiD2GlFUs4P5io8wA7Y/S5JZEH4XUHmcdWPYkbUEfzBu4HsMZtvYVjRlzgvinmuHTPqVXSgpJOoEdgEcHQCPQ127+mLjnbPbQcYyqxQyliJlSNjGUYrrEz6KZwO5UJXzw5fEPwpSaMyJCkU1rWlVdTGDboUACs/rYo9t/QqXkbjwWXOZSIfhujPomVjEjgVKj/D0wzem/qPc4ZM2x78r8wdRY5BZjlQyahopu266d9N+4sXQx2n49H8cpUISAjsQov0XvpskE1QJH64XvgZmnOQRTAI+k0pjEBTRKhZijoCx0KLIqQ7VsBtbCOglTszeiaNYXbcjSGWhR3231EHCyVMxA4d4p5aaFs3K8mdLMER8rBLKkWg2BIEDqvl3COFHbvYOCzxrzTZjhAzCz5vJgx9VWj15eSMItjqRqA+ki2dTpbY7jvip8PvAJ4Uki4bmHyrOUaacKJlPlGpSktqX0gC0Aoeu2Eb9sHxSzkR/wCn9eVlUaZZ3fJuc2pABDLl0DQgMa0EIT5tiDgccLeDrw8RIv2WPCCLiDTT5uFszEurTnJpHl67DytG0TSFtgAbJO7ae4xq/kvhsuXj0IESBGPTy7RLEsEZbUemUGqkX82knzH2xgfw2+07nMhlvu0EeW6YYEOUIctqLEuQ41tv38pA98ad8E/G3/qGrRw+SWZUC5jN5vMaMrZUKwQjX3PaNEB0UWqxdOWErvwCSezSnhhzgZopJWgECq7iPQxdnjT/ANRrAKhyTpUhmre99skvz2nFuPmf8SDL5QBLXqxO5RzTvRj2Bs6SNWkV2JGNU8k84XFbRiOTcSCMs8Xk7srabZSOxq9u3bH86Oe/FmI8wST5WaU5WTMRiYdKzqUdJ0jT86ggFHI1AkmiAATxrsnRBV5N48b8KsjxGRWzanMrAKSOaSQxfDtKsOoxdR+2ojUQSvbY1fOnLPDky8uVhOXyEuZjKg5dYoZx5dJ+Aq1gC9XYe474A839oXLZeXoyyXnHIUruBGrAFWnKqAmgaWYkWQQBV4RXHeS8jnJ5s198Odn1p15J3EahtPlWKOKisS0BRc0m9sScLG/JVQ/6Ovhf4yy8Hz8kUuZbPZFRoDGfU0ZB1F0i1SBpPysOpQBDA2KOnuWudpOJHL8QQdPIhnAjkBSZnQsodtIZGR2IVSTtubBqsjcs/ZvnzPFIFjyhfIiVfvMqTl8uQADIqztpYEmgI1G4I3AJI3HwXglAp0Uy+VhKLlYgFCKkTdyFtKfYgE7EEldrNOSqROfVYRP5k2IYEoqSIzVszotbajXkYsdxYYCgKO/ObikjKFQN1DqEjbaUHcOVJpgraIyqkEtZogHEWPgi5rKmKZ2fU2p3VirLGsnkU7C6UaaCmt9jjtnndlrLlVYPGQxO7U6rIjfnXWoIGw3W8c2hEQOacxKwR4gzSK8bNGx6Ctv5zKdLiiG2Fb0BRGPgzcqoTKyrTavwy2mNQ26lyyatQoA6QEAJx7zvEQoZVlaR0Ya2KkIA1rQCA6iwBSrLBqLGsQueuZMmsAfNMvRLIgCMWBAVToYpu2wOoXprvdHCDUeuKcmcOzMSnNQJNl0LSRCVbQE2S4S7bYEa2uwbogjCp8J8zww5jMyZXh0YkjYyQSKEohh0h5mH/b6hdCNSfMKHcYdOQ47ls3E7QOkqtHpmfqUiIR8GlbbUV2CkDfudsA3D5spFImSyTHL/AHhWqXLLHMY5TRXWz6g5pDu5pPh9RilsaLawZM8J+BcSjnkOXy8zyagJFliYhXYkBjPN09XTFgljd6tuwxc+OHJE+UGUmz2cK5ppTUMSIYYYl3LqWa2YMyqXMdMzKKNE40HwflGRs1H95zjSxpI0EEGWMiGZ0YszTAMxAolm0+TYgvVrhieIfCMsqGaWCJjD0yrtGsmiPqqG6YK3VAUtedgPbDqWbOp/yMmT/CrNz5mWOPLZF5BIdLZ3O9VkVVALuDpC+vkVCttS7Akhn8y+CEOTnjkzEkudWwx6+lBl1XVYjIJoWwOmm1BSCbxoXKcWXSoWMLszAOQui11bKu+1gkVdke2A/m/hwfqyTlpIQPMjLoBUo2oRhBq7aTrYmmJAFmwrfohLlcgi43x+HM5VkilUvoUx9AlzWoKZSFIKWQVNgaQLG+E5y99n9opMymVkWFHVvvMywvJmDMWLosbzMVCRnzam1aS9lb7E/GEGTyUTQsYGaU1HEmpHdxsssnxlQxsS69zt27+eX/EDMSBY440RUkueVCzGU3cihfQPsXYk+3012SVrRJ5W5AjiVHzRLxZfX0HzBaaZ5piC0hYFrY+ZY4x6MewIGLLMSzr1pIy0VilSSJFWQ0K1xLJq2HqQrelYIOIcwuaSMRxxgE0C2sOexWjoVQCf4ifYd8CjZeZ3UtK1/wASoSTfcAKtC/UlTiseOyEp0SOFFVBZkRpilM5jKUp3pVKtQPfTe259axL4jNqB6ZiiLFRq0qGaq7l+3b6i+w7Y5ZTw8LHUxZjd+aNbPsbZQR9KH9MXieHV7hUHuzLqJ7flpRvve+OqPGkc0uRsj5Lg0rXbllNKTGV3rvsD/Q3i84fy6t15gOxDWb+ZvVQPy3x+TkYgeWQINjSRD+R3G/rf8sFfDODkjzOzja70/wBgMVUSbZ9h5cj9v/ykqf3BBr9TgmyHB1AABK/8/XEXJZcL2P71t/z2xZxz/U/8/bDiEnL8KT3P74lLlQO231A/r3xGV/8Am14/PMf+emMEnpCx2u8S8tk8QspCe5ND0HyxLLEUAdz/ACGAzE54gx0jsPiIv/8AKD7n1Pp2G5275iHsFGw2A7f7Vjxk0oV2+n88WuWT1Pb0xqFbOUEB7t+wxOjH/PbHMHe/X0x7ivthkBolxN644O1/82x0Eh9P39P098eBHWK2JR8EOPYHv+2OYQnHZY69f9BjBo9JGf8An98epIB9T/zvj7G31/vj4YzjIU4S5UfTHFIh2/5+uJMpxwU4Y1np4Cdht/ID9Me1YIKvf1PvjiZ+5vbsAPU/89sfoYPU/wCw+mBQaP0mcv2/fEZJlJI7e574+Tw2dgf7/wC2OYyAF3+2DkOCLxTKowIAu/U/8/bAfLwsqCEf4m2BOwPxEj9t/wBawQ51KBG5u/l39vl+v9sUwj8lH4xe4u67iv3xFrI6OfGo1dakUA3YI3v5/wB/ce/bAgcoQxAbtTLv8a/Me47EjfFiOYdS222k6HX+jD5G6+WKXmXLsq9SNtXTtqNagL3H+Zf6YjNLY6ss8hzNepWA22NEEqfetiR7/wAsU3H8w43BRaFg0PN+p7A+/p++KyeRMwutaSYUCQKv2vfdT+tHtipzmTlUEFFYHc6Gu/ohI396GJNjpHHMcWDEMPTc73uNiP3/AHxwynFNbL6gE/yvtgPnzGmQr21dhVV9f+f6468G42OoVHaNaPzZt/5Dv8zhUx2g1z2aKgOb+E3pNNpsb/UbFT6EYJP+t2I5Qd1oOb9D8LEd9J2BO+k188CE82uCrpqkAPtW6/2xScvc03GDW62Cv1u1P+Vt/odPtiqdCUaElKyJqHZhuDuL9Qfn6e/Y+l4DZ3WFnceqkX7H1B9z7+tj54GPD7njSzRXrXuFJ81UCPX+H1F77HsMXHiTKnREn5WK+4PcDf8Av+uK3asnVMps0NbKzHYnUV9/YfT1r1xZZnO+mwFdvf6+uke35jgNzPOwVmFFmAHlFeuwFnsPWhvWOL80aV6kleb4E7WPUm9yP6/TEigYHiQKk0abufVvYAf0A7D9cVefcC3evLWm9wnqNK/mc+m22KDJ82Ar1GOmwdIrevU1vQ9vUj2GKLivMit23N+UG92Ow+vez8tsY1HTmbiGoaR7a5K3IB7KSPU3v/thecYyFLZpb7Cv5HDW4dymyxxlzbyzKHNepU6V+Qv09sCHiBwwCQqNjuP2O4xNqssKM+cYyS9deo2pSfLGi6mJ+tgBfck1X64O+Nc+OyiHLfFQDMVVVShuNV132pVa/U4EueeF9PU6Al6rvpHy+tHffb54ouB80vCoHlMratSxsJFRdrZigZyx9i4BOwsd+iDtCs0H4R+FEUZM8tGUnVvve27G1ahvt/QbYhfaK8UGMRy8AfWWrynfbsVO1b7WCfbbARmfEBpEMaK6AjSxYN5uxNLdkn0U0AMeuTuX4YTqlDSSsQFVrcj5BEKKK9Lb29TigtHzwP8AA6adutmmKj1RwdRoA36mr9e4Py7v6LhiQV93y+tvcHSpF9tR1DvuARt9MHXh7wfXENQAH+ZT3+QBIHz3+uDaLhqIPy39aP6Wfb9MGrEsztzHxXOoxKQlTRosaKlvyUBpkF9qO29EbYocn46TRskc8MvU1gSFQ1bmhtXou59q0nvvoLj3NuTvS8iqR5SGIDC/n6A++6/PCs5o5/4XEx/FUGwWZdJsVW97EkkDbe/5KxkRp/tAZWNxLvIHDEE0dI1abJ9RZIruAD7jFcPtCZKRmBQx2zK+oalL3QBAoqXv0BPa/XFHxji2WmpYMs0kms7IgoB3FlAPLp+M0dWk/UYYXJXgxBpQyRkEvr0IAfN5bLEg35hdADtQsYWl6GAuDKgSs0bDpv5jG/lWz6rqABPse57G7xx41npIQ+3lFOQDY0L8RX10le6nddIFmwcacl8O+ooDVGleiq7GtrOoEA/QXvgM508F42W42k1b9wXFFa3Gm6I2r+WJuHoKkAPh9zygYxs34cg1I13Wo3f1Unv6j9MReFStFmM3GfhJaQAdgWGoMvppJG1ele2BqTwgzGVVgaVA7NFfU8oajpujWliQN6rTe944jjzlunsZghVSpBDpRBTV2uNjqX1I1L6LibtDBPy3z67+Zz+LGem1mxNDuFR/QlQTGSbJVlN2oOCrlzmCMSPG4/C2aOTbZW3AkXeq3XXutr5gNiYXJXh2CgJADkCwSKB/f33wxMh4VRRgMSWcAgn0825Fe38sIm2M0gY49EjKVR/OACPNpdCfh39EaqB80b9rBFYqPD7xKZ3bK5gFZlsIWrUQvoVrfb09R2LAih/xW4YA8ckWqhYOg7i9ibBqmFK6HyuCDV6SErNznmI5V1jX02uGTcOFuwuq7YDsUa9PoaNYp39G6WNvxH4QInK1SyXoA+EPd0vspuwPS6wkp+cQjMl6XX07dt7Hz72vrhveJXPEeYyDyoQJIo0zCgnerKkE7fAwdG9hoJqwcZB8WeeoswkWZi/Dd/w50P5JQLVtvRwCb2uj2OpcHp2Zk6C3mfx3haJ4nS2GxK/EAfXtTAdx6juDhD53meUndy0d0CxIKi9u/b/lHFIIJZJNRbSQaY7bED4vmNv64m5HiySHpvTDcF1BN1v5VXuf+fLF1FRFTssm5oeNgArPZBorsD7q2/f2GJfE+NxyKynVFIQTva2R2AqwfbHGPhcq6TBDIU9Q9hSPkCbFevb6Yv8AJPNRMmXCEEAOBYAbvY3aj7/7YhJrZaKfkB+AZsq3lDO7Ctu4P7H0xYcEzMySFOm1ud/IC4BO5XV73h2cA5IQCk0An/1FW/N67fIfKvbEnM8gMskUgCuBYlVtSmQGghBBpSl3TAAnbbEZcyfgtGBQcscmQsQ6GRmFdQsTqAPm86nYdv27YPctwUjQAGKW3UZSvmsVsSLr6bjasW2T4fHZCNVhV3u9hdGxQqjVGzuL7Xey5nSpUvpc761XWNR2C6SCpsC2Cm/Ue2OJyL0DvDMpIWAKu1arQA23YLVMLpfzUfU1uMEmWyBpmCAH85Dh2G3qgrcXoa96N1scWuayLhWkARgQD0k1W6kABtV35SxJ/wDyn5yFh0xhq0Ek6ogNYFAgDZbNBbcMQ1DCmFF4o8KnGmTKxyxFB5cxl2G6E6iCijWyg7nWGr3BwvuT/EDMRaIOkmZjLhFXUcu7O5NXIFAJDk7t27HtjTkAWkUNdoaZAxI1A9kYOFs0d7KkLdAjCW5Y8OBNmiDrzIik6rzLCEXSCDV2ULu1C9INhivti0ZUqZkyi5m4PnVmGaGTaOaiGkgm6yNVrRjKhkpQAdK7kCyLGKp+dZpZIpMwmeyjRKqwvBEx1WSTqQqpJY1qom+53II0LzX4nQJIYo4mzWZIo9PzI8lEnVJto0AK+gKSO9U2A7JZ/jeZYoyiAB7JEaI/q1qz2C2nsQdzpUgYZT9obsyk5IyvF83FI5kiyyl+mzSRssqxjdiKooGaidR3am7UcV8PgLF5mfikMYQlpWDjXq2OrUZ9m38pGv3rbF3H4J5mbNqZJ5ZMpJpkzAJeFpFZBpI0bGia1H0VhRsYKeD/AGb4IY5AWjmbqEB5oRYGqkStasPLYeRNOoG9sZyXgHdgzznwvKL93eDNNmlOlBB5OoU0nyK4Ctvvq1De18xArFryly5k4JuqOGZ2KTQ4DFGeM67tNAZ0USC1Ynau49MWMHhLJBKrmCDMKpS+iHidCpKkIGYozKGUjU5be7xc5SaGd2g/7iAuprVrWq+KRrLKTYuyaY3pHrifZo12WHJnD5IUKDhwjjDGRVgmi6shs7dFQqv1SVOnXY81DfA7JxHh+YmkaXLNDKPMBLElvdDUQFZgyqaNiwq3Z2xKznD87FpeF5c0A3TbLTMAxNlUlDx1RQmqcgEV2vY35clgnVpJI+lPCOjLAyq/oLGpSTpcBa7gA1W+FcrFqgWkz2Sli1Kco+Xa0SHXG8pPYeQgMpNGl0k72DiJkfDbLm6ibL2RVPqQ1R+Mbqr3emgKH7ccz4S5CWbVDAiSFGMcisa2s+YFtNre3sxWlxH4px3PZVQNSZ2R5B92gZQJHU7khoyAXXbZlbY2LLacbYt0MTIeGeVhShCrFgCzMweQ9ySS3ZQNxWw8uLfLZIppKsC0idM1uxO51+UAkhVIPb070MA/HuM58xxtlBlxIU1SIz1OPKGK6JFjBkUimo1sRtgV4Z4h5xWV8zAriM63KOVdpDGw1R+fSSqtsnwsdrBFY2gpWOqThghHUL6UG7F91G4oFrYir+Ktvfviu4lzJCASzBgpDa0Jcbk04YKy0Nl7qDsdu+ALmTxyyGmlkkl2sxyTS5TpkNTM/ks2TvH5gBZ3rHyTxNiRiczP1ElDJ0suZJEjRhenUrL1U+LTqSMm2NfCMBmSI3jf4FGeaCaR3SA6VeNSQ1nsGa7ojbsSp9ReDLwu8JstkkPQRBK5VWlUa2IIq7PmGi6KmwWJ274+cG48mYt0mL5VkVQgILpZK6PxDuaruGcMKvfBdwNeiAsRfQ5IGpalRhtuSNOgmxv2NYfs9AoTvPfLuYbOI4zjRkNpSNEb8Kh8NBqtiLvSdrse3jNZ+WaObL8QghZYdALxTBp6B1dcxhSV2I81gg7acMTljk/7vLLJmJUkd2OjUpQKNIsE2Tr33K9xQ98AOc4eJM/IIzaSx/iMosCQmumzkMKIosuxoXWJ2Ghc5vguRSzHlM2cupAkzqyGkb/KCKIHudg17YM+N5TLQZVc9DmczMlAIjP5pJNQqMhhqQE/EQvpYJoYOeO3loH2YRxxORlkQOzULIAIGou3YegO2+2EdzF9rJGkSJckskYCgrmPI6ygCgqr8Og/CxOr+uKxi5GirdEviv2m52RUyuVJzHmM4c9QAjc6QlM/p5vKfSsVfKX2meLB26uWGZC/HHHG8UgH/kA5BA2or8tsAcEirxNJR1MiryCRpJTaqas6XA0lGP8AECBe93jQ/MOT6bSzLmDl55AXeZUBR46vWisqq+oAbqNu4NVi0qWKOjorEx4seO+azEsQimzGTRApMSuY3WS/zFDqcAbAPQHqvbHHl7mPiOVmGcfMTTqPiEs7sjhhuhB1Kp22IXYjb1x48TuNZKVFmGaXN5gHzkxiBzXqyCrAo2aN9wd6xc8F4ufutvFCuXYHU07tGCo+IxyFHDMO66BdX7YN6VD9Y0Mflr7R8mfEkWXy6jOaNUYklHSajTOX0WjUbAK0TpF72OJ5HaEM+YzRE0ijrFmEUdSH0a6ZYiTpKA+5Hsn+SPDchy4zbQpN5Q+XYhWjYEhDMNAJDC2XZx3re8EHOPgayxu7tNKqIdDh2zCHawb329fTTuSMBqOiPx+Rz+D3IQykc0S5h54Xk1RVHrEd91LqSfOfNqIAIN6dzbJTKxoNLP0wADevSH9B302vuRW+MefZ88QpMg0g6JZc00Ss7SMix6Sy66rt5rYirCgG9qOvFLkuKXMJ96zE+bjIUxJBHMqK5YVq7KTQPck7bsMLJfbOibhQXz/aG4txjMTZHgsQyuVEZEkkqiORFu2kln833Yvsqxoryndh66DLwt5J4TwZwHiOez9FM1mL1IHvV+Esg0+Y1bbu1Asx7YtuG85ZviOZcZWd4Yh53ZoyhI32I03Id7JNFbG3bFJylmVhzMuRzUPWeaRQWW2kUG2DIWOykVdHUp7nEpcr1HBZ6oanLvh/wvPuc2chkzMN1QaWYElt5htGGO5HlY1tfpiyg+zll4kmGWZ8oJfMyQvUVtWptBsIxIHwgX7WcQeYG/6Tw+bNwZKTM5pNEaxi3cs76VLMoJMKEgvoBIWze2Mg8f8AC/j2czPX4tM+Qgc22rNKVVCb6GXy8M0gDVZXqA1+bUbXFoxclcmRTvyO3xY+1zkOFwfcsg4zWdU6ANJMSlmKvqYUOopBIiS7OkbDGaeXvCScg8Yz80GUDZgZjRKuiWUs/UdhAunQG7xrRLb2FqzpLk7OZbLRRRcMyTSgnyzvFHHJmKsFjJMYTI6qCzGIV227DCi8SOHycQz0GTzEIybRP94eSeaIypAum0Eccs2suCp0sAUDKW7UXUvCVLywwauizk4w3TzeYzaZPTnmT7omY0LLNGVaNAto79EoFYXpcsewHdgcu+JcH3YR8NSBZYEDNltKLAkjMsY6rgKUUE/HIwtvhsXVPy/y1EOJ5mfNhyxiV8r+BOy5fLIgpRIiaOrL5tKBdZ81A2ThgclfZhyzQZnq9R4M9mo839zI0UoopHMwBmK7CR4yUAY0QdwUpPY3JJLAZ+GOf43I0hz8eThjKDTHlXkkmVyRcjOwVACoJ8pY3VV8JJYeHtpZRI0wUhlDU9Ku9kkCyRsq9t73rHblyFFDujEoGCVVBioC0nut0tlt9PYUcB/HOeIMrmtLTGNUVnljZB+MD8IjZQfMCaAPorAXe05PyQSLngsEy9R3AjjpTGBvIsek3GHB0BpD8TbBbUAEhsLTjPMeZjnj+4ZRpoyB1CdwpUafKzv8SA76vjJvuDg04bxOSaFRGpidhMyRPKysIC+mORwgOgBWGlGBY6h2OErlPCjO5SYyJnemXsHTrMdkWvVV1IN+VRYu/UYk2USGtzdmcwY1VsoRHEq+WOZdRmY6iBb0QoJJ1A7sT6DCt8BeWJc1mZ8xmVEWWXMySQ5YqSvVbUhIUqV7qO2xcWB5d4Xit4yiHLwSCT75KqqksYDZdWcFhK8mkGQAjcAEE6b7YEfDvj/EpUzLwZb7jGVOcM0j5maMoq7dAS+a5KOmgyjvajSpdQtWOk9jn5kyWfjz/TyseWjWZGjLHpbwAfiMyaldtFkihuQRe+LuPwozKQqqZ1uiJispEKI+ldysbqwNr33JUfM7YBPALmmV4Q+dypSWMFzKYi2ZmQku+zkyBiCqny6Cp8o3NdeePFTN5hRDFDJA0TdbqOTEreZnXqPp/CCg9tO5CgEgbo1QXbdBd4b8W/8A4pmI0mcZeCIl4GuUCRmVWkeVvMHJW+mWPoaokYNeeuUop1RCNKyTRB3GoOuliUVR8TkMoFAhVJZjuMVfh5zNEqwQyZiKbNOokdoFOiQ77MUtSR6s5U+W6qhiRzrzl0FQWoklmjgjCqJJBrdjKwTZjIEs7+vYE4aLJS2QfEbxLy+UmHVc6mUmCJQGLlQFFNuAAGuid279hhe+JPi7NmgseRCJJJEQjzEw7pWtdZOgsNgANV2zadlOIXPvCnf8WDTPOjDSuYtzFprfpvGBHINJKC6J2DA2xE+O8A4jxIQHNRKixu5UaQI2LAgsxMt7jZVsqLJoHt0RhZNySCvgfOvEcnGIuIJHONtJEgjNAhVV2I0FQyg6u5vdTucF+Q5p3YgdRZN10tGAgO7BbK7WdyNiB27YjcueD+ZKxgsKF2zsXKsdjoUvupWlAIIrfvvg45e8DI0cuxjZ7B2Vx9AUDFP1GLrj8kJchF4RxiyGKzGx8KR6h+4JH7bn2wb8LzEVixKpA/NsR9VU/wAjifleRAXsnYAfDqX9K7f3wQZXgAHYj+/9MXUaOZysh5bIRncNRNet39Rdj9MWMWXIHoa/hu/6YtsrwJN/LfuW7H6euP0mRVTscOKRoMtY2JHysH9De/6Y7QZY9iRXyFY+oG9vpjpHCSRZO/8AL9MAajumVX+H9MT4ZaHYDbt6fyx4gUAe5Pr/AGx06Hqaoen/AD++CA+wQ3vd/wB8dmfegP8An98cgwrbYY4QElgTtXp6/wDz6e2MAuXzFAfv/t9MRo81Z/YGv3/2xXcXzG4F0SP2Ht/z545ZXiQLUNvTCXkIbcMIO/8ALF0st9htgXyuaAof09B8/mcWsXESfhG3ucNYtFi+crb1/riRl1Pc7D2xyykAG57/AM8SxP64KDR2x5MmOBnJOO0L4ZCtUei+PTRDuceGkx0L4cVs8pePrY9Kf/gY5St/8YokKcpUv/U/2xFaM9v3/wB8S5JP3xzv/n+mAY/QwAn5D9h/z98SzIPTsPXH6JNq/l7Y45rMeg7YYxxefvX74rJZrNeg3Y7dva/me/yx7zBY/LEHNzADft/f+rE4FmIPEM6Cx9aFn2A/5/TA9zBxCvMvsDXax2N+19x+nviXzBOFU+l1qJ9d7P7CxQxW8RzoIYAflNGvZe3/AD2xJlEAvMMhE5UEr1BqB7U3r9LoH636YsspwssjUSr7q6jaz21p6G97Xt/LFbzvbxq47r22/X+d4oeG8wOoBILIR3vsPX6EfmH0I9ccrw8llorcurqTpIvfYilYdj5Sa+RuiDiu4txpg4DDb2s2v0bewPY/r2x141zGRJ8Ood3B7lKrqIy+o+Fwb9CRROBbjGeUvoX2VlLVRUgEAn39FPyo+mIvA6PfG5fz2SEv5kegBO5r5H1wF8G4sal3NnYH3L7Anb9f0wfcOg2YFR8JBA2NevfY4EsvwleynbXq/wBP5fUWTjINjXy6fg0e9ED6kaf7YBuARMkjo31B9d/97wV8Q4gY8sj0Sda39ARf7g7YrubD/hyp3B3r8yNv+/t8xXrhxSh5p5fZAsyMFohdV0BZpb9iSdIO1sVHqMEf/wBYu8McUgBIpZGvcE1obv6EWwwQ8HCyx7AFXWmFA7HudJ2I917+owuOKcMMbPGRsT5GG4YA2KJ9e1g7jDoUncbyREgI2srd+tCj+2BbNNJLPp7KA2o3uQB8K/wqNu3e+4ww81FriDD4goYfMgUfpuP54C8tMpnV1rSy7j8wIux/Pv8AIYLQURjGQFUHSe17E139fU/0wQ8ocIRTraTqEk6Tsaruf+H9ALxz41wbQykDYH+vav6Y/ZackItAAmmA9ge23YG998EwXjjHUKKt6VbWD7t/EW/kP1x0515X1FpANnAZT8mNt+oNg4u+W+AFyu/lAskCgPkPme3yGLvjuZRNMYoooZmJ7knvX6kAfrjdb2Tsz1zLyIkkZjA+JgCxAJ+dA7Eitr2vCj508LZo/wAPLqq6dtW13vbkgUK7nyk/PtjUOdhAnhFaSzgV72PX+n1xb8H5VjbqM5oamVR6k2RfzJI/vgwRmzK3L3ABl4ZHeTqTBaZ3UhVqvKooV70PMRuT6Yl+EHCRPmDJmgXUHyKsipEoBsayWDFjt5Rq7+h7aiy32fIGTTV2b30mydyWsbn5nvtibyZ9nLKQuW6Eff4mVWdjd2TW2/p37fLFlFi9i55YnaRaiGlACKBFX7A/6DCZ8c8rxKVmiRXhiA1NLGRZvsqbMWJHcV+nrjWXBuVo0FKun6Xi/wApy+vc98PQln88OW/sq5xkZpZZGVip31GWu+lQQdOr1NAjagCKDL5I+xdlA4mnRpG+FVbVSe2lQasAdzvdk71jan/Qk29cdY+Ej0GD1N2Yq+DeEsUaoEUjT8O90KrcG/Qet/LBDw7kkJbM7M29XpCKvoAoA/c7/P0wcSMBt/TEfNZGx5qPyvb9ff8AphXBG7ArJn4BspBI2obkfpveIGSzIe9G9Eg2CKI+VA/TBbmOHjTtQPoFAG36YrMvwfR5r3J3obn2Hb09PYYlJNBTKLivL6MpEhJsVR2H7d6wpeaOQssrhgkev00jzCvnd9vlh48x8YA8qhmc+ikXX6kbe3vhf8WyRYkt5T7keb672f2xmk0OgSgijr5/0xPh4nY03qB2IJ9PWt/Y+uBPjGfYMy6lavWxZ/8A5TgZzHH2WyW77AV69+3yxySaiXSs6c8zxilQaRpIAFUQp3H1He/b6YQ3PU6qkjj8oLH5Ed7+vrg5zvFmdqJ9bU3XbuP2/cbYRH2keahGAind1INdmFbq3swBtSR5l1eo2nBdpYKaQuuGeLZ12N4z1Y3H8UMyVKtfJ0Vx9XI9MLXr9OSSP4x632db8jivXa7HY6vnivimCFTdb7evz/XtWJuUyEszChpKm0PrW5oD23uvT9cejhEVbLybl5pVQVpQCyqKR/8ArNuQb/2xf8B5XRAugNGdxdE367A3v8/n9cd+Q9RC9Qkb6bI3O9Vtew9ffDUyPAYtJZiWQlUXy6SrerFqoKQDXrtsN8cPJyNYOqMFsEkZ7WizBthUexruL7L8ydjv7YseHcGDya5QUTY/ESpJ+EUDVDfbt6n0GGDluVlYghqUEIAhJANFTYo2VJsn2rveLUcsyrGyqS0i6vNKCCikVYVAAy15qFEal7dscbkXivYKcycfTKoHYqIy+la0vqNd/LVgew+Gu/pj9xPnrKIqyxyDMzyhQsYclR7En4VVT70w/oquK8nDUYsu02d/zBSqK48xCliAKoWTscUHA+Qs+0+pMtUsfmZS6DWO4DKWCt29wN++4ukYxayy6gxvcA8YiryR5vQHLKY3hTWKazpZmbZvQNfmvuaGHPk0mKoOn012kJGlVamJC6l7LotiPMNVix2wpuY+C9HMZLO5rL9ONUQZhQEkMGYBqMtpdSwUm1K6gtDewoL44nkNWmTpggFPOCz7SOApK6uwUAuYw58wAB1NiU16BNEKCpBoplJXyjS2q2sto1eZFJIoVosij6Y88IyWgrSAIEcyFfORZ1WdAJBsaNgtNYAIxJGYGoJ07JDAyR26RBVA8zsAAWYgVpZlNEYVPOviqSDl8pFK+YZnVm2H3cKNFAilo1dtRWQaibOkIlZM+eK/igmWy+mJHE0iukJOkBlLFC5QkSqyjTp1rbGqx+8O+Tp1yiiUjLwsxc6I9UkpUglJGsIAG0roNtVjasTPB/wuzMM/WzCJPmJYeqssrtKIWD6SqG7LGlT1FHykANhi8CLyamVopWLsz6HeIq4fY9FiEtidGsFaoN/FhnWkZYK3JctdBaj6SoxjMmuIpIzre6sjkso0hSojawvbvifkuMPLJMGCR6P8MsGGsOaoRyC1NjSrA0B8zi+4jnyQWA1SRsqqprSrWFfzA3Wlx66iRsAMcc5w6KRSspDBC+rceRiikbtYaiwVaPlrVZrARjgeKNrjdXXSWjC7KqWx0HaqCqV0A3bMQBWrfjzPxZoWbSpLEusVpWt1BY6na0UlV2u7Tbuaxxzql8qyxuTbqU0CK9altDKfLHoDKNiSVos3zu4co8kVMEsx6Z9La4yS1todviYMd/L5V2G5GDQli2zHiG0oj1WZ3VunFRii1qwZpTLIPxH0bBF8htdIOxHjK8Rzs3xxrkoSVkmfqB2HdRDEqr5VksUZK0iyBdYNOO8r5aQnLNpoktSqyaVDAoWbugBXyrHVLRsAMcUGX8ImaRmizOYMNhWjkCMrgCmIdh1dCKCynb3VrxqGtEvMcyxgMwdFEVIalSlva2IIs12vUT377YDvDnP6585Mrl0E6kMNTq2tNjSbKTuST8IVD7jDP4HBESk5XXCECoDGmmFTpIKgk9RmO2siSl/NerFpDwZUVVijRI2dnljjXp0GJ1vWpNRL1rq7U7AnYhIzZU8v6BKwj0jXQBJGt7FREFt1BALqqggnvXYS4uVVtrW3slfi6iAsacEbtXfUa7BcT8nliakdgdTKIwBq0sqHSQfVmLEW23ZaBBGPmYybFk06iSCS4ZQEN3RU3IzsOyKoQFTdAjFBAf5z8OY81GI5gWfdlda/DKNTNag+4LDbzUK2sC2c4jNEi5d4Fny6DyzxyFJNCWo1h9i4SlGogONO/fDFyMSLIp7gvK91pGuQgt5TZItWAFaW+ZN4F+cOGu8UsEc4UspDSSBSqq1dRox5Kc/CBd6QTpPrjA7wfPZCeFMxCQnVbpRmSNUHViFkSyEOiyGx5Sae1qyDUriXKc4VymVgcONMjCaRG0E31SjIFLaqoAsDRAUAgYzJ/wDUWcykrZa5IokLN0wCiMoI8wWj8ZUGxYv5g0wOJc68SdY5UnkRY416mTQorSREi5I9KNrR1sOD51LEgbiy4ZDY3c/yLOZAy6kgQeXpMiMzXUhKdMIVQUe4239TghzfJkrrGqZpynUNyOilyvcaGUgO21AFSBR70DhUcL+1ll1/x8vLEqppTs+pmGkKQCoUotDVRG4LYk8D8ec7K8UUPCy7yK8sPVm6KyItEyhmjCUFYE6WOm6AN7D4mbsNbi3KWXc626k+lfOZQWpQw7bKusXbtt5dsdeGZ+OCNAiQrGWX7urXTWQFKdMFmkWxZ7dt+5wl+bef+KQzhWeLTJe0baogGtTFHIVBbpmy2xFeasXHhf42F3mjlTqLBGxhZQLWVbqBZPhV2FaV+MrV4mNVodvEYqDSMdT2AbAADAGgb9FH5RZ7e+MceLX3HO5wNktbZosBm10GJLUbujv3Y/CQB2AJ37vbg32meHP5plljkBBdGXUF7LptSBsN6IDXsbGKXxxmy2ajTMZbMRLmIAxjVtNPG6WYNgpSUsqkMbAIKmtVisXQ0MSyC/KvAZJOnA8AZAbQz5lZdRW6AU0FHpYO3teCPxF5C41NEEHTmg0hVhaaPqRaK0pC/lZQV2on0G3sJ8B5I4oDI0kELQdMSrKMzGISB6KVt9d3syBbGz0QSFcCzGd4lN+FI8SL5VJdi7rRJUnUoIHcWK7Ve2MruzpbUtDD8MPDIcMzYlOTZ4pYGizGrMZeRonLqytplZVrTayhWLDykD1wW80c7ZiSJ4xwsZqLS7oh0NEQR5W8kbq1rsQCGUg+bcYBeWOQuHZdymcC56d2HkcyK8UmqtSnyr83ZnvtRF4cPFedJ1zWX4fkoEjyseVWVnRQy0wpEhvSEClfPZJ1XWwNX73k45cbTwL37Pb5d8nJkmnWfMqjzHLSx60hLEBRE4IdlRrBEvnRtvLa4AuU+ITxz5iHO5lcs6EdPShBm1XaOFaNE8mgr1l12Td0bleN3jxnSkuXmhjiYtG65mEPDKhifYhrINgFHGrdSaHY45/Z9yfC8wriZg+dJZi2bbUjlQArK3xavcMdew9KreG2Uimtgz4i5XKrtrUuTYdZhKT67hVAQH2DbG8Ffg7zZxMx/dn+8LlWACZnoO7J5gemGavw3U/HpbT/ADFD4keHpyM6ypDFJCxDliiyRo16gaRyauwNh+4wyOS/tcRlVTNRmMUAJYg7o5JpfLYZQB6EHsd98L4wVnlGkuXOUhk45XkeXNzqG1SzOi0oCqFgAHTTf0s7dzsMB3htw10kzfGc20kMcalo2lCxrIhXazuBGLCCTbUTdnthrZqAzGXqANkNCBI119SQkOW1KO4awqKosmyx7Ywb9oHxA4xnHmjmglymRybbZTQsYgjJqE5gr/iuygFQCyLvoHlLGfHx9n+CK+xI8UPtq8UzUjiNo8nl9SMsUDEtUZBo5kdNnVyLakjBFKQaJO3eVsu2e4fBmczFqMkAkOWNeZiKG0gN+X4gxo3v74/n/wCGvgXHNGubzmYGVyYceXS5nmG7VGCNKq4FBjqJFnSB5hojmHjea4bD96fPyZl5J1CZRx92ghyp3SFY2RtcxRFIIC9z5e99HI4vCFlC2lEBPF3nLNrxbh+Y4ll/u2XgkJyyRuhEYHxPqj3XfQWUKlhSAGFnGw+CcIyOaV8wiwf9xCHd1RTLMrAaGmcVIw76VYna/mDknOeJbZzJZ3M8Sy8DZfJvEuXyzIJisrHYu+og6uoKUlLa7BUYeHgryLwvN8JgmEJiOajd5fu8s8X4vaQKYZE0KhDFYwAsfoovCyyiXxPj2VPE+ReKPxTLGL7vl+FRTBppMtNqmnCRsNExeMHSzHQyIaVNZ1AkDDl4vxXpKTqCKgDTDt8V6QABqohfQWewIL448h8lR5KAQwwxwwqdSxRuzBTIx80ha2Zyx6jb7gHftjm8IaQAaSTIjtKyai6D/wBQD4VbqqFRpDUcewBxKUrwjfsqMi7DLxs5Esi+fVqOiMEP01ZbOmNSRs7BjuL2xVeIvICy5YXIom0ookkRBqrzNR3KKCQAgtrHc74IuOSDSGjCamdFkZSrRsjEqFd7rWianVRuHr0YAi3FnybzZV5FDJGJOg8hkB6i9PSRAxAfUzV1XB72BszCTyOmAHiNlnyy9M5iWTP5kJG5VFVgisNCRlPMiFzZos8zb7aQMGXLXJn3eBFd3nkiOvVO5IDGnIQMdKaSFUbu477HbCy8QuEyZnOr90XS0j9Z5lkdljC6fM7vtGPKdMa7n0Bw3c7ym/WiaSQz5eKJ0KjSy9XQih2UIIxpUyMxYnQVU0D3VIdsWnjbxbLGWPLzqr5e9ealjygcqX1iPpsbRUQkI8lOXGqx3pw8E8L43jWT79NOtpI0R6By2YjRfw4nhSNV6Vi/Iy6id7BINPzX4YZR4UZaPTVBGBJ5DEt9MMEOmRRuxGxaiAarAzlMzJkR0ly+YzEcqyF3RGkMrhfIyRprWGMXXTDA7C9VnU1tbM3awX3NEufX7xMjQKkeoBmcKgjKhzHQC6iNIPnYC9I7b4JOC5bNSoOt04UaFGlWNy80mqNtVkgRrZqj+IwoqO1gFg8Imly6yZiSd5JXinaASmGGM66KOg+NlGlXIu2BChe+Gtnp2E0a0CiJLK+ohmuxHFENrDElqN0oG25vDUTsAsj4ZZZJ0+7CXLlXCTtETVMol0TM6+UFR5yg2Z17Xv04mxVzKs8UWXMY0qADJ1iWJld9QKUTfc2BvQJwVcCy50sdesSKTLGFBd5GovLJbuwXRpjRF2UL332rv/piNqDaSCu6EL732Ipid/yix3xSMLJSnWxIZ/i2Xmn13mJX1aIxBqYEqavWiM5+Rc6AOx7nDY5I4AAwJjI22DBndSaJ83UZVPqQBfv2wccE5chWqVhXw1agfLSCF/lWCnKZNbsD9BQP77nHfGFHJKdkPh3CxsakP1kJ/lW2CDJ5LfsB+hJ/fEnI5P8Ay19Tvixy6r/F274sokbOEeW+X8q/tifDAB6fyxKhy5+QHz74mQ5T9f0oYbqDsQzEPU4iuw/53xZZoAd8QVezsP74DVDJldpJPc9/0H/PrjvFkb7k/M+4vsK7f3xJzOarYiiT6e3zOP3VAG303/fEx7OKKLv27ewFY553O+g3vsPTfsfn/wDGKqTO2dNn3P8Acn9qAx2jfU19l9PpsB+/pgbMWkmboA+vof3GOOUzgsfIWfkN/wCZxR53jQLNRpUu/mQBQHy7k+u1Yi5fjACk/Kz233r+u2A2aj7zJxyiSTud/c16AfM4+8A4qFBJoG6APoWO++/7/LABxXjGp++19/1/5/wDBBwvPCr79jV7AkUCfkBv/pjmvJShkZPiJY0BS+vuzbX86Hv/AErBTks1Qof/ABhWcK5kZjS9gSCarcbf8G5wxuB/CCdh7nuf33xTsJQUQSnHdW+eIkRPp+5x1UH5Y3ZhJyN/z/fEpG9ziHCR/wA3xJjdfa8dESTOl49kY4vN8v23OPD5/wBKP7VihOiV1B744u3tiMM6D6G8eypb5D3w9gZ+aQ+n8v7nHqMV67/0+h/rWOnTAH98RZQPev6nDAO8uYHYfsP74r5Zq9cdJpVGw7n98UfFs+q+u43r+n/PXCt0MiTn+IhRV+b1r+n+uBvM8T9Rud/5eg996usU/E+NNR77nSPck9z9P9/bFZm+K06ovpSlvRRdtXux/sMTchqPXNvEt1S/8x+i1f72bxF4vxEopIN0NWketKfKB62LxQc/8QYPY9NIHtQ3P6mv54rOZOJEKh9ip/8Ayt5h+ov/AJeJOVWUSLqbOrJDa7jY/ptsP0oj/wBwwC5DjRjmeFt0cB0I/KTfa+47gj1Fj0xO4Vm6SVP4WOmvZdwP/wApwO82y0scnqCy39Df/wDMP5nEm7yOdea8iCmpTRWnRvVfRkb3U3/+Xf3wD8d8zRvoq0VaG2kpYIHow2sDYgHY7YNIs9qWu6sjgj9D/Mb/AFAwPGCo1vcDuPWjXmH0J7+l798JJJjJ0TDxV9AIF6av+ID3v+vcYruEursf46sjt6/8v27+uLbKcQQKb3A2sDcfXt+2BjjUfSlSZSNDdyL29P5+36YTQdhzmMxaFS3lYdmPZh2IJ/Zh6jf0x75akV0MTfMC/iXft72D2+X1xBzGWE0R0mjRIH89v17jATw/iro+q/MpAN/tV+oNbXZG3phrBQXcC4pLlZdB3QnvW19wR7BuxHobPyxa83cQRh1FIqwJIjRK3/6kZ/MPXSN6OobXgR5h50QSaZNlatLeisfyn2DbaT2uxtgK5u5hUmSJTplVQaH5la2RlYdir2g9d0G/bFU/AtDX4RxfTFIp3IBr9dx29z/PCG5k4kQ6upIKsQa2JD7MD7b6f1BwU8hc49VKY2a0n0N/5vmRTX88BnNqlZKO6nc1337sP6ke94DYUOTI8fLZaNjfwliTdjTY3P8A5VXyx04LndROkWQR9LPuPYDfEHLEHh4XswXQd7339fYmv1wLcE41pV/QsV39QBs3+n0vBumA0NwrnxVQKGBPwlrABc7kKBv+nqB7Y4cR40pHUb4btdW16bAY/wCWxYH9dsZuHHWOYQA38ehSdgWBt2ANeqjtt+mJfOHP7EhVGrSQiqWITdb1t7AtqIrfSBuB3r2sTrQxsrxZpcwcw3YG4x6AD4B/5O51H29tsM+CUnRp7/l3233Zv0Fm8Ivg2bOmtVgUSwGkWexA9BRpBu5Js9xhocr8X1KoXbSWQ/KgrAfU1R+d+2BE0kOXhfMiq2m+xAO/dq7fOh/pgpzcgBGMow89skzsdwrgb9j5fLXrZdjfyVflhkt4rjWU1WQ+ljt5RZAX21ELdemrvi/bBOh1xZ6uwP6YvclqIH+h/wBcITl/xPWU1dHfSL3Nbk/JR7+vf1FsrlrxDXT5iK/i9P51/wAr3xuwKGIaGOb50+n9cRMpxRH7G/njugBOM5C0z0Ax7bfM3ifJkhXmO39fqceIwB649GP1Pb54ZM1EaYAbgWT6D/n8ziu4hw8k2zaVo7C7O25O/wDIfvi0zGbA2GKnP5o74zoZFfJwpFs1d9gwHar29R/XC+5nzzKWFnb2ogg+4PY/5gNJ+RweNxIfGxAFbfPcAfvhOc/8VDmwPhJFj1FWfqCL2/b0xGToeIuueMud2IJG/mG5X6qNyB8tX0wo+LcbOkkkEjsVNj17fL69jht8wZtGQqTXei3vW1nawQaN9xvd4x/41eI33cMIyGPU0Ov5o238r+ouvI5sMCAfNtjknHu6R0RdbLLn/wAVFiRqNy7aVHejfm+XqPaxhC80cz/eLZybZffsBv6+3p7bjAjmObS8pLEm9t72F2B/viw4POjuqSFYwhO7MASGOwA/rv8A1xWPH0Qb7M78pcqK8wYsZAt+Shv7C7o/P19cMDg/BSZBSSKAx1BlZdG17MFqvT3P64F85IVYMgIUilZdrYbGqNb/ANPrgn5ZkzU1dPW1nbzkeb812T2UdqNDHNyTk8nVCCWBm8B5SVVDdOwNlF0QTRoht6UmzYXVe3bFHyzzrm2zQijhVolYF5HBSlWwbYF0VwLVUI3NXW5xHg4RxRGLzTpFl9Vi5E0FlshSNJJBIok712Hsx/D3jKyfBo1FbZYyrgEgKdVJ5UN2Cbex8scrdfkqohjwARBtUbJsX1lwwYEWSynSoNEhXG+rSN8X2a4cJI5tMjwhgVJEap07W+qGk2dhQJHl77796/h80YIjZlI0hSFK2R2NUFJI2NAgn1xQeK1iCKIFxG+YCFNJLEANq33D6a1bsK8ovtiaYKF1yDwARoY4EPESC2p5Vkigh1abCwhmaQm7LLWkXQoVg3zPgxJK8DQzLlXAIm0KfMGApQFZdJBQoBI1aQCVFEYZvL0ccQICqqoKCxgMwYjSCVo6WbUCQzdtxZ2ANzPz+iTCFIxMPgnUOitKy1+HGE8xe2Gtiwse2+A35KKT0j7xrwDhljVGmnlb/wDuHk1lWenFx2EUqB7UfKL9QPTeEWY4fAGinmzNMrTQlNUMixuQpA1HT0/KCUfubFaSAwOH+KMSOkLRS5ckKrdRCI2YICBHIrMCSoEdr3O5G+DHlVH0rcjOxLq2hRoAUsQBekXVEmtQ33JwUwSkwG4T4mpNlppFjETwhw0MjsctqqolDDSva9JuxYXT2OIHhv4UaQ2aYmOaQFnCHYo3wAoW1NZKgoBq9bJJwOeMOXSJzD1Ky2bkVjEGJ+F7Lebz+UkMtVfYk74dOT4vDRS/8JANrJ+S61b8qnUDu2r18uF8jPCwRci4/wAJQyN0S5kChVkjBIZarZwdBdSdQ16qJZsVEfL0STLJq6L+YLbgCnHUkYP8JIIPkStN2brFVy5wyaWDO5r76hRbJRkE0uWIFqFKOtl42VVjQNqKrdkGwvgXh3Nm0zMfWhmH3hBNJnFfLTZZdJb/AApYnMayatyaSS9iBh0iXYNvE/mj7llhOqLI+kLGiOpCEW2stJKASvxEKLJGkfGLQWayGakgjzeczT9HNzxBYokMCMztSPLKpJVY4/MyaRHosljVhn85EZWBYM8JkeIaslxCNXzGVcSAKEeKMJCOxUxlCCCrBrTeLl+YeD5jLp94zCq0K2cjnDrycs7G9MdJ1tDOp6ZR/LqCtFQ0YvDGKJyYW8g8j5RM60aSMGy2QZp41kd185I1K4fQWdQXZUUMdS96Gq4znN6IsYMpSOQWjTaVAdBaU0dABR5vNvJQbu2F5zT4uwBctmOHyZaJTBPFm0YxJJHGSgiVU/DbUhGkPRYBhVi6EuXs4meRUzEwhhhe0lmikjlmWmEkCTMyxSGhQZmYxqyFQdOnAcQRY8j4lZKHV1cxCZmUKYozrZCbp2C2xvcl20lR5bIGCPLcdAVZJnESsoty69JgxACBr8jsSALJsWgvfGeOdeX8nwiTL9PL5gZXMkSO0lzJlnSt2mJIkDxkMY2arB0htRp18L4dlpF6MJEwkkizLSSOLZVk1QdNVvQqU3waSBp1EknAkqCso98Py2qBCmgowcQJLHR0tUccatrsKoOo2CNL1S74m5HOzBWRwSyyNoC300j3CqSygNGACWPlAYqpsqDiRPxmHTpF6W6qSCmVlbtKVJI6ZUHUyjylRY32x8gd1KKPhYBesfIyfCGASqYsTq8p+ZOxGFGKTmTiMMSSTTGVIVVC6rGDR1KQwkXvMtLpVCB7gHcrLO/aHcoXhyTtAHfqyTSMIqUNVFAygm9Q1uSG2Ng3gy8TuXI5GijKdWNJPx4WmkQOhvzAhw2pANZkJ0gpoOxJCk+0dwhoFigydfdOmQiIzGPVYteoWIa9muze/tWMl4KQSbHvyln1zeXjnUSZaNlYxopjLqtkBwSGBU76QoAAIO+2LrL8NiJ2CsVXzWASSoKh7Io3uCVU0fXYDGZvBzx8GRykcGc6nlJWLShcmEnUACANJVrUm7CgH6OLkPxfyeaH4UkayHYLIy6yg2UlNQUtd+l2d/mzjQrTQF8b8C8xmMzNJmJDo3EUjeaQKNRA0tpAVT7kkmyBvgX8NufNPWyeYjGZggLKJbWPNRL7Ra/jhJ8wjJUqC2hmsLh088c/rHpjhH3vNEVFBFIjaWbbXIqkoka0QWPmYkBdytJfmTgpy+WaXNRIM1PmHklkEjUrMQAoUFgoUFgyMCANJuzjN4FW8h3xvw2mmy8ciQQ5zKEGSON9OrSfhYKI76oIOz1RGkkUMDPDOXIQoEkDZMQkKIxFIMyjN36UuoGGF1FSCIBTsKO5xI8M+cFyrSZeYu8SmNnjR21ZeV/Ms8MiMp3U21PpkWrQ7g3PjJ45GCONcnIk+Z6g6ryRBdUeksgddKoGA0r5QCfMQBeAreEzSajlgVxXiGVEbCLiWYjeOURJls5HDmEMbjzdMGMuFjBMnUaRnADLpGxH5eaQ0a5X75kmgvzyRZJkOXMYBM0cOXcRs01lVlfQVYW2rsXTyzxqPPZRJZcrl5YpyhEMnTDdRSVkj0SKNbqF8oV2J9asYKeb+CQ9KNYcqjg/hvGI0iKx2FkRWKaPLsaZhsKvtgu1syaMvcOzsEcjLkInz05IHUzUceZdmphqj0xLGgCmmXokm/8AEJ3MTiPJ2daZD9xA8/4kUKEJqkPmLlWZIiB/lCiwdqxp/krlvIwB1h6RdWufpvqlQrYGqnLCidOkdvawDjpxPgCy6HCrpjfS5ckG7YkEhwpYWKaUuSCNhhG72HsDvG+SUiyLwIzQrNE8StqAAZtlTU+qiGNDSbfzEAb4xzw+DifDWLGOSFQQbK6kZSSAdaWADRK9mr02xsOfmOHKmRF6WZkLM8OXyqWyR1pYSDXMoK3q1AKN777YjcJ62bKSyyGGJKD5KOIRySsCVUOXALBSNQCoL3+eHjKsUNGTiZh5t8e2nRY2ghkzCkMc6ynrsgJqEKANEYvSfMxb2Uk4JvATxxMWbcziW3jOy7uKO3kkINd60kevuxw/JuWeGoj5WSOJ0eVpAVQLNG7EnySFjIzIxFFdwKFHsKjxt8LRnMvAsJ0DLWxlmYh2QAhwXVNbkMRsStsAPS8P2iUXJ4KrP+LEJZJ+mI3W1aKbKrIuYUi/MzKvT2Nq6Esp3IIxEzXEvvGYfOwyQQSFUEMIymXniBRN0eQBMyZnLHTKjDSKGh63B+UfBLM5iXRFmrgIuSRopOtGNIICwt5XLH8wcUtkknbHTmD7O+ch6f3WU53SWaY6RCkJBUxlWZ2B2J1qWsFdl3oZP8hfQj84/aMzat0MzkYJQwCiGta2dgUAj1amIJ0FQynb54XmR5SnnzJrh01sQ/Q6M0bouoWylhekH1Ir6Ye3hR4WZ6HNtncykMSxoQQ4WWU6gPPEQwEfbd3N6TpA32fvDOLO2lx5iyWWDgnQfRVOq9t7sfPfDd0tCyl1whn8D4grZaGW49OhXD7AElbaiQFUAbWw/XH89OYuZX4vxmeXXpy6tojWNmaKWKJysZHlolgerupKhjXoTsb7OvG4HyiRxI69E6D5WbyOfyFlABk/KOyqPYYxH4y8gcRyHEsxepjLmZMxEyBpl0ZiaUxJIVVVEzIKkjj3A7EArg8atYBxeV5Glx+FRmUWRkkysKhnzU8xjy0FbsVCKvWlNEiBrJC7AAgmx5+5lyoMYbJ5nizywxSZabQ8uW1SKQqxpFpTVpOpqQyCgNVEWWcs8X4RxDJpl5eHqktGabK/d2Ux5ko8ZaOgL0AEhtQIHcWaINPk+LZXh33Phc+ZzJglbqZkRLCIYgCYstlRIB1iZKJKWVfUg0igFSjryZT6O2gUHgRnU4Q0SwyyZziOajEcLKw6McNOJZgraYSQjW8gUqukbkgY2hyZy7Dlo1yeWjXLw5eFJJGRtSpK7WUpyzOXp3eVtyCDuXOFZzd9oX7twyFpIngzzgQRxZxSjTzNpiad2Q6TCrvqeQHyoCNN0uGN4WcvNlMmqzyvnZZJTLJmB8DSPo0LCAWYwImnSm7dMDY3WM7r/Yk5ubLLjWbBDOWAEqoGckqN73UMKpdJQBjuDQFEXSty5N93zDTODHNOixoYOmsEKsY1eQGy0jN+ISUZDagR7McHLThcu0rEqArNGmnZAp+NwfNqu9JOgbjYb4BczziVSaR1kncyBI4kGrqOqu6srsqx0u4V9ShCBdttiIgRcPhMCurRlnm+FRoTXS0JUUfAWBLyPJ2YgbHY1GQRowoCLmHAJG6Rai1q51NpCRRgDyqrFiTsS29JDxeeQQ6w2WmzTBmWPTOemnbqSjyKqXpd1JRH2CsWxdtxTzM+sKNBUygM7zyLSykoKlKL5xHpQBiXYUipZMGHETDopvg8quIxdAXfmHZG3Bsl27Ab4qcrkR+WkjKlVhHlUAE0fQEm6JJNA0AaJx6ycReNCXZY1bWURNB1gEqi6iz3GFAIUGyWFrVYF+bfFjIwIXeVNAQqSrFpCx7KE0k0AaIOlSw77GyAuuOcSQRdU9MMw1IxLRqsaUW1OwoRoQaIos4F7YCMvwDMDrvBJNFFm2jYF9ASGNgzzyRiTS0c0rALGXG7efQBWF+fGabi2kZbLw5d8vm4qzObYS6Io/xnaOJRpaXTSkbImoHqBtg5XZ3bORsDFGAs4miJEkhcuKjMgKAxRxltQ12ZAVNgEtKNATOqZVlhhjBJYIvRaUnqOVtQsnk8zyG5GK0CK3xZzcU0NXkvSoX8o3Z7qzYFkGmPcAVZGKWKLR5wugKgK2dc7oZBoXqlipU3tGmomwSVBx443lQiF8wy0VSzIyKS6kldQBrSu5oKxNkEk3aozPeYzMajU5Kbk6WK929VK6hpJOoaSO/w4JcjmTIA2o18huf1fufn/vhdZPPh2DCIbVTOaQ3uWAYGQiuw0Ael4KcvxiTygugsWQoPbej8TV/7mF/rj0OOODjmww4ZMdlIr03Nt+unb+eCGDVdBvT0FDAtwPNFjsrPvsfn9PQfM4PslkdvMK+Vih+uOpRsgzhDlr7kk/LfF7wjhQHp7b48x5wAUAP07ftiXBn/AJ/XFFGhWTFGO3V2xEGY9h+uOc+a2r+mCxSFnns0MdYWAFD9T/z+WIKuNz6Y/Z7NbbbA9yO+I7yOjw0mpjW1H/hxy4vnaFD0HqPXvf8Az3xxyOY7gWNPp6Udt/ocC/H+K0SL7k/z/wBKrCMokduE5m7J3Jvf9KH7m/0x1OdAoD0DE+1/X5G/2xTZDiNax6Cge92e9fpQxXzcT2J7DcEX8/8AUk4ksIeiNxrjZURqDuz6mP8Al3ofqR+wxKPFajY+tgfQkE1+nf64WHFuYPOfkY1H01CwPbYG/TF3xvjXlUDYm3PodJ7fTy4TsEpuL8WAdAd99lHdj6A/K9j8/pgty3EmCigC5270NzRJ9aF+neq9cJPL8e15ksWpVrvXoK2H6k/tfth18DAJXy+wXc3ff0Hz7dhviNDDG5Myhoaauu52AvvXc2e59cNrheTAUEnUf5f64CuWsuFUenyoVg2yU+3tjfgUu4ZBiSIfYX+uIWWza+uLKGf2/qMXimBnLo+vb6VjrDIfcEYkO7V2xBOVPfzKfcHbHQRZZooI/wBMRJ+JAe+Ixy79xZ+nr9Rt/LHpT7/scNYDhJxVfmPrjrHxj5jETMZAfNff2OIkkFfMfpgqQKLOXiPtiAc/ivznGVAr1xT5rjyqpb1PvtQ+Xt9cZyCollxnjmi99/3/AE/53OA/iXFGAN0CR69xfc/WqHys+2Otba32NWB7X2Fe57/5R88B/MnEyQ7dyW0qB2B22+ZsgsffbE5MdIkvxK63pQpa/l2/agf3+eBfj/NQUB/QFdvWyQf6HHri8rKum9zQPzoD+V/3wIZrMao5F7fDv3323+YPY4i5FEgx52zJbpsvZguw3oErZ/bb98VXGs+DBZ+Z7dviu/12/bHLKcV1RKfzBSO+wNaSu3scU+dlAimVvQqR7ebYj98ByDRN4A2pp+9UGH6bH9wcDPMXEToVe4Bax9Tp/teCTgcxVge1xMG/b/UXeBvjWX1awdtjZ9jd/wAj3+Rwj0Ylwr5LB3AV1/em/mAT8icQeJzeT2O5Uj591PuD2I9RWJ3C2/DUH4hY+oN2MVXMc9CuzCgR7g9iP+bH+RCgU4PzeqyOrHy3QJ7URYv29r+RwRxyQyIyFqN7MKOkn+IE7qTtYo2PlhTZtwsr/wCbYg9r9h7Xv9Dvisz3HzC3UVip0myd1I/hkHvt3ogj98Ti7KtDf5a4wYy0bHzIfowHoSp7+4K2CPXHTm2NSdYNah7bagO36jcfqMIuTx5j1RiUAMLUOPVTpYe5Apvmho9sF2a578pPdaG1/lNn9CCDR/rijVE6P3iRmvwlcb7aW9ivsf329QQMIvnPxBKZyCQG1dBHJ7jsAfS/NpY3YOmiNzTI5t5hAyspUhilOO/mUMBJ5QQVYLuy9xQIsEYzRzXOJnV08rXWk+9jdCNmB71sR+uKcayCTNNcr8wCPMbbJNTqv8PuPoDajvQGPninzugWwRqRjsN9ixWgfqBXthXcb5w0ZgCMa+hFoWt9UjA6/aqLaf0OAYjMuSXUkMpUknsdRa/lRqr9qweqBk0rwfxM1RZmNfNrTqxKdiWUCQ/L0Zdt9hgbyvPGp2YHbpFl3+a7H3KkE/Pv64WfDUkyxTUCb2QmvWtQo1YP9CfQ478K4fmktukdIPcAsFRrJVgtmgL/AE39sI5RRVcbZcZDn2Uzit11ESSACtKb0Pcj1FbkjvjnwrxLvW0h82rymmK0AbWQL5yv5SUFr2phYxa8M5YjBR0a4561oPjhZz23bdLIFkAVsdxWOfOnhXLlvMAjxOPjNqAZG2Xv8I9XAK3W3YYX5o+BvhfkJuXvEfMNbTrpKhSoSulqbbUu9NW1NZAN77aQ3/D7xCdRlV000szzve1RKNySNrYgkEndQPfCZ5Q5MheGISJbsZHhWnYH3k1BQqqaqywDAau4oM3iOXMLBWUs0tJrUVFBHaggG/KrLQ7Uqj17HfNHIr4WyEvHpFzEbMQUfOwWboBOp1JCT7qAqEmlrHbinHJOrPoYMsgZ2YWVH4cRVQRuD8bM1d9u6kYEeMcQD8R6NVEXAC/+mwIssxI+LURuWFrdVeGZw3k4aVIIUhCNOyrOpLabUkbt5iXBNUGPxHCrnC+EC+RefnYs6MHWSLRlwxNowUGSNiK85IbyEWweNhYIOC7J85TrIyB3kdWDoSGbdgTqCi3dS5IbpAuqrGQpAYBbcn8sJk5MxFIV6DvFNCxcH8ZGZem4UlwwhFFlUagqlb1UNm/ZX8MIZphm2NCIaY4ClAMd+qxYAkkHyAVQNnfc2XIpSpE5cfVWyV4R8N44IS0+mJFHlipHZxv5xNZtH2oaFYb3hyZDiOaULrioVex3Py37frgw4nxUxk7D2rFJLNJN9P6YabIok8G5jLuVMbpp7FwNLfNSCb9t6OL3NcQxw4bw8BQp7j1OI/EmI2vCKTQ0kiBJxEGyTQHp88QJM6G9bBsWPobrEfjLIqEkgf8AKwHxcfOop2X39rBH7n/XFExKLrOcO1gAG0v0PzP8gTtgD5tnEdAfxG/pVgj52P8Al4s+O5tUbUrlaFMAe9XQr67nALzVx9W2G9A+u/lYX/JsCUsBihbeJ3G9MMr18CyN8mSiRt8txXttttj+c3M/FOrM0hYk1ptqbXBeye9xkBabzaQu5KXjV32h/FVEieFD+NuwA3sLuVPyYWD8vptlTJ8HikU7EnUSKbv60R6iu/0wON0uzLONukQ+C5BDRLoK3CN3YfXsN9u4/ni0X7tI9TEuSQFSKth6LqIob0Dv29cU3HeFQa1WMkEkKyd6+YPvfp/rixHIskFPuFurdT5O1MxW6G4+nthpNbspFPVH1MvPDIdC9NSx0pq6i19Td7jfsf5Yc3KHDM4UX8dYA2+lI17+Y0xHuPQb7j2wts3xRUhUM6yPr1KYHBFb2TtsfXevoN8OLkfk4UkqyzSsy2qs6krVNdKo0mt9z5tt8cXM7WTqhgJh4exzLpzErTuN7ULGumvQbsGIO3cmj9cG3L/KkMIMaVGGpm307gKC5Yqbbsu7beb5YrsjGKK6dLafNqDFtXoQp02e4vcgnbteCPJ8SbTvp2ApNirNVkhWNAabNm6f1xxjtllwwgmgbpho1KCSjAboyqDpVQd9yRfyAj8y8LjmUx0TpZSrhiPMp8jHc+VNx3UtY9952RzbSuW3CJ5QisAWY3pG+5CqSQaAAPtZMI8W6RBWNntipjPmFKW3j0J2ugXe13XtWAAp8hm3UB3gkRx5PvOWGtiDIpZZI9zTb7+YKK0sl4hw8MmQzzZmGCGAzJI0iprzQ30I6hAw3pCWIB8znzd8HcvFm/ICV/PRt6kYKAWBKE6QNtItSRdqMS+EZSWR2JkZ0GzM3kQEA0qBqZniBBsNp8tmyQTqDdHvmHJ9VXSlOpGuQ+jyVTBWIXUAaBIA9ReF54I5h0GZyskhcwSgL1FKgI/m0jRX+IwHdiKY1tdNJOHpGkhZrQed78h0qNWpiX86r8SilJDUDsMJPw38Skjy+YnkdUeeaUZS4w80rDULk0sS1M+hS4ACraltrKiZOyN448SJly+XiYGUkN5xGpWaV/wj1OmClMAW72gTffdx8DEsaIs8sUjoUEjASoUf82lRqW2AuydxqOwIBTXLnC0lzA+95eeWaUo3UELW7RmlYdo41JCGyQpRAaBsYdv3UkMoEYY6FDM2sLqJLyPpITqMQUC7b+pUkYWRR6orOK+Fn3jMrIHOWhgqSoQBK01rL1dgQqIVXSTrJOs7agSGeI3hrCEzRzE8jzy6FEzHQpXQWAm6YFxp5Vp1AFEgWaF5z2vELCZHNq7Rr+JETCHfUQXLB2/wt/hWvTSWBwruLeI+elYZNoo5XmKxNJCkizmRCW9GeJigJVmZRpX071SJzNhPD4Y8Ty+UfKxqM4uZkqGCKjlogI0JbzspjhsAlzqSq0jVtit8F8x/05eIZPPwxrLlnTMZvNRRNLk41cWI5nUEOWBULpVQpLe1taSeCOY4aV4hPxTpLB1GU7momXeF0JXUrmgAFLEnygdgC8W8VuN8VheN3y/3OctGIRAWmeMk6WeyXTWFJZiNSqWHreOyCVOyTvwfM9nsrMuZXLZUHJtmNa5z7usTmSJRaKJCSyeY6XjCeSlokEizTxVZIUy0mWfMiRhHHGrTl/OCsaFNVGiLVhRQXqOxOGb4W5GDMpozEC/eMtG0RgdGBRRQVwGQBkYBemaNV32x3+zVxWF8zxGRUUNG+lDp/wAGHQSyL5dVuwLMV9dj2xBu3+B6pGc+bInAOUcZjJOaQwMRmPiukkRbVw5O2hiPcWDeueETMuXjjEUlJBF5TCDMNChNDV5fLp3+AkE1YvCNzHiB94SPiDwCKN87pg6lM6CAWIplYCRNQCsjuGNtY206jbI+O6o33uaV4+HSF4Fs9Z4JFIrrBdThG1X1CmkARHbVsub6j7yM/JRGiNmJVVN23lJ+AaVA2P8AiXbHYD5VXEeGxMtWH6QSolJvfUFPm+JSustRBIAtrWsdeGSq6jQ6zRTBXjKNUbIwvY6mJKghQ2w3B7g4j8aziosYZF06wsLNqKq67AOB51JFrZYBgaC77K2aj1FxZQO2ylVVjWum2AsCmRtRNrZ2ZdzeAXmvwqyOXimkihmYjSwiyryFpJH20LE5aOgzHcIQo71pFnHCRAxD6NLqki0DaaGG+iTZSuq6HmN2O9k98jxZUUsEax2RNW51nUWDhQFY+dPMoC6j9F2HRnaTwVWfLa5MtNHMoBKOo6heTUVOqJSmhABr+FgD77YBeLcGjLqjZaBDHceiGIjeheouatfmdrr1xrfK83fiGIqeoYjIYKZjFE21tYC0QWoa7dt1B04Ff/tVlIzIsMkkbvHrMqyAsTqJ1Rs8ZBWqWQe5Ukk7hshUhF8A4Jmo5VjyB05gAkoNEakAUdWpNJUdjfrXtjxmuVs/m5Mw+e/7YQsrSu4MUTq3lPTIDRNQGot2or8q0zk+D5fLHq9NYtKKWmbSGVKGpWcAhSx31WtkNYGAPnLi5zuZSCG83AXjkmZgpysCAhwqBER2ZgtM7M4HlUBSTZToDyL/AJN5FjTKfectG8rM8uXmRDrWONSAr6KLDUBbXffYLRx35U5By3EdWUmjYBQ0kM6MBJGwIBGqi2xPY+Vq0kY0Dx7h5RZkyiRxZjpakZQIkfTYjLALXko77gkjuLOKDwo5KbK6pcyOrmTrLOpsRraeUOBp1knWdIFjVv5TYVqXZBbTVNGR04NmMm75fOGPMRROdKyAuNSkU4AoxsVA0yKQQfVsNPkrmmZsss2cnkbIwSK0P3eR1ziFiVRc1LEydSBQVZST1JChEl9z5+15ydIuYjzKAmFkCvoUBBKC3e9iX2327DYYDfDp1k4ZxAO7RyR6Y9SABZYnFojqd2kWUEWCToKgDYnF7bVnMrTo1hluTYaLxRw6pSrlXhUqdQIJZgoazQPckNZIO5xIK2rJpoLHoKGy9sSK07Jpa/isroGxWjhWeA3iz1MrlYnOZnlRjHLIkRKQ1YTVJVbqUGskmt2AAJw2OFv5naSyi+ZLulIIQhTZMmuxZQhQCRpOIuNFU7VmeORuBx5fPTwoxj1FlmCoqdNPyhLDlUDNsQSRRr3w0vFPnSbJCCLJRiRpyafzSmRl2P8A5OQb1kgUDVVgC4r4WcQXO5qdOm6Mw6TyEMz2fLDpUakMYFDWpFepsjE3l3iOehModEyKJFqWVlklWVmPwKqsQtkEnTpYk0ATsEoq2mFOYeSGF5M4Q1xsbUW0TkeYhiQVLdgArA9hj9ywZJcs3XC5eNipQay8xXYq8iEERBxuw1Mb3NdsUR8KcxmXjbMZh8zG3nnjCFQgI1KuoVpoimDanUbAeuJPLPh66yyCWWSbLhikTSgkED8yAUXYbop2UAb9sagErh8UGXzmhOqA0SjysjKzsW2urLUDpYFV9PQYOwwAUlHJIFQk2w/y0raPMDudRKiqN4HP/pZGnVwqppXQradwoBNaiSS2/YVp9D720eZldiHaMxtYvTqWySI1LtIFDgXY99iN7wyEPnEYtepUOuS/NbaY417aTuH27j4mYrtQxZwZIhVQAFVogoSvm+Wont7NVjbescvuRMUqRsgGikeJOmRtV/E6Eq3m1L61YxyysVLDHITMQVYtIfMXUeVyRQ1XuAN/TffBMBvhVz3mYc7Ll0gkjj6jGRZcu6lB216Cqs/tQZrJUC6OGX9ormfocNzJBlSZ/wALLyaZVdpHG/xKdLKrFbCro3C2cK77Q0CpxKKZHJkYISRKytHoOxoALGoDAsnft2vD/wAscpnYlZmjzbRFG10j9OQGw66gQsgJ+I21CzhYOsFbpqRjzw08auIZYacpwl5cxJ55TM7o7SUbKQmMMBpt1Jc+UMaN2fzfaezOczMOQkymYyay5mBtUbS/elCyF/w1aKO4nnIaQ+ZRGHJUhWOAzN8657hXFpEYKzdfeWRQ8s+VkcaGDnWCCoO4XUSGTsABqjmPmnh8Meb4tlmE+cjyTRqjTMa6YEgVI2FD8QAmlBslQAC2Oqop5Qf5G+yHkeHjys2l7U/lUmtROwoKi+hrvsLxWjjI1fhoQwiZ42awkSDUhMUfbVpoSAEHeNdVPil5P5nEuWiKZmPNSqkQaaEoS8hUA0oDKq7mTb17DY12zeZYzRhqYBZl6t+SSQhAooMStspbzEKWDjTYxzs50Q+Nc5vFAiLGJp5FnaGMdOBdaIT+INEjLFWkklXcySUE1NQFuX4pGljhfQ2lS8r6VhLOGeRDHCFOlYZCy6ZXUyBVJDFyTdcH4cq1HIxnaMlmnnCrr6rPIAFiOpVUuAiDQhOkEkkUdry/EnlAuR6ZwVAN6dJYaVITSndtz8K2avBWRtFC3D1jW4wjSanQyAUUjMgdxQS2WwSUIAMhuqFD63BJHZzMbUvqhWMGGRKUMwZ0mBY0W8zBaU6SCW2GW5yyzZoRQJmJVKlnzUMd5SERo+zzMQHJZQpSJna2QMFBvC05r+0BPFHmiuXlXqK+iaVlQqHoKpRdk0jdQpLbgm9IsGGB4s8/Rw9KCF0fNZxky8OuRF6TbqWBKtQXVtptnYeawLCc4jEcrlHyACgyHXLm2jU9UueoI0jomIINW5csFtiAWw0OUuCQ5bh7z5dkmkSPrSZl0tZ5dAHlYi4VVLK9JiRYJJZmJS/MPAs3m4c1xFkhERilckPLJIzBljCpHGrAHT5ELFWvVsSScGO6Js/fY44BGiZuR83E5jzC64lzBPUWl0s6EKNMrdh8LGO2NKVOkON/eXin6fTmd/IgaQdCNtbIimXfX04yZH0gBn2AUEUkvALIrwThmYmzTLHmph14oJCiv0I9Kqkii5bJDEIRtqXVVNVb4UfalzGc4mfvQeHKjLtEmViikeOTMGUESmSgwFDRGBSMzaR7m8k5tsCdYNHNywqnqAb6GLSuS7INKK5jWUyLopdiEUXsS29wuNuZIwunajReT8XclgSQoK15Sw20igNNbh3iB4gyJOI4UDPIoBeVyAFAC9ONF6mlFttTsFsj82lQP3CM0VW5ZUBA3VAW0C9gNZs2fUqN67d8Px8V5ZLknRY8rcpLCA0s+sWdKBupZ/yitcxs2LDKgAobE4POGzxbKqsB62m59TqPpXrtq967Yo8tA76SpKigCxVS73uFF/w+otVHqPc2yGVWNQCSzH1Juh3Nk+UAetDv2x6EYnI3bLnhnEgOwKir2+Jj71VgVvZ39hi1TNA99h8zdfU33wLJxWEX5hQ2JLbE/Xud/fa8Vuc5wUg6aPsGOlO9Fie5VTtsNztWK3QNh8ONCvZa+I+o9wNtvn2x6i4yDVH+W5vt+/v7YVWX5lLnU3wAAk2a27UvrZoD8ouheDLhufFm/KQLAPpq7X/m2P8Ay8BOwBome2rHrOZz09h/83/pge4ZxRQGI7AVf9TiFn+LHzbHYWT7/If0/fAlI1F5NnBfc+pC+hojc4iHiYK1e42P1ut/leKTiWfo7GttvUd7A99wd+/8sRssKBPYNTg3tRYsR8+/7YRjpFtkOI0CxOzWL+n98BXNfHANzfsADXuSSd+247X88Wk2aAKqNqUufamI2/rXyGFTz9xYksB/+IDXuKNj2on9sSloognTjx0v/Kj3Nb/tge4xzQoLG9q/TtufpteBabmsBSf8zH5MdzQ/ygUT6nYfmGF7xLmgvaahb21k9lvSBVULBY+22IOxwk4VxUSFTeznWfTYbBfpXc+xx14zzbqV5b2AH7ajX70ABvtWAvK8dAvSNqCR9ttvO3/ig2s9yQPXFD4i88dPKqqmpHYsaG4AtVAHpW59zX7BRMEnh86Fw0ps6i2i+xBvznagPUd7FbXjSPJHMkkm6Kscan4yBZPsGNDt3oHuMYx8P80wW3bR2BsW5PcKBv2BBPq0jAdkNs7ivj3FlVVdy4F0xJCKKBLUd2s9htZrvZBcWY29wLivsb99x/vhhcLkBXfGBfBL7Q02YzMauqhXIAjVhqQEjvdaiAbYBib9Nt978Fy50DCJZMy+ykKj5jFxCikbDFXk1IxZIT7Y6SbdHqXUPQV9f7Y8pmW9r/Q47GfHocRHzw6ItnVZD6iv64jdZBvVn3bf9r2x8nzl9jX1GIczD1az7f7DDBPOanDd8VL5Yt2Olfer/b0xLaezW1e2IPEuJk+Ve302woxTZvg63dn9e5/5/L2wHcy50a1UDUb7VYsfDfuPWvWvrgrzOYokk7Dt/Ex+Xpv2A9BZwMZzMqp1EhSfX2Fb18wL3+pwrQ6IXMfEmA3vVuKHYAbnf5nuf0HbArnpQojG9IbYk3bPRP1N/rZ+WCDiU6kknYBbPsoq6J/iqyfb19BgT5oz+4EY/wAwNdiexr3A39+2EboZHjmjNbH0sD9LHb5VV/rgG4JmtRmQf/o3BHevkfoL/XBXxnhTvENiNV2fWjQr60P5488m8p09ns1Kfl6LfyFDEXbY3gqOTIGDupFqZdYv0Vu9e1EA/riTzHkFYSVuGUFf1ph/P/TDFm5OClTVXqU16HsR/Pb9MB7yhT0nAFWQf8vqPnROqv4SSO1F+uMi2VnDoPIh/wD0ZRj869fn/t88UmaNPuPiWm+ZAr+Y3/TBNkcp5CR2DWf6H9xviin4svUKPW/Y/K/KwPp3/TC0MgefPBQO49D8hex/Qn9sUfP3FaCNtd9N/Yg9vl6WvsdvXErmhaZgp81FgPRgNmAHuvqB6fvhY8/czDQC2ysNLD207Bv/AG7MPWrwv4GRD4nmwSy7B+63tZG4A+o7D2PywvecONgI196Ir/m3rj3zPzCekW/9WH6BigP89PcHfbb2wvucOLmYCSM2GUl1qje4JUeo/iHde/Y4MIZsdyF3xviLWBYPSY/sbFftsR8/lho8tc5l4FYE+QurC9zGQSP1VtJHut+5wpuO8Np2O9E2O/rgx8I+HajL3NKPL6eu93Ww/vjrm11IxTskcQ5+ZSx/K6i1urvb967Ee5B2OK6BTs76URKYGgrMB8Ow9T6gYreLcKHUdi34MbhRW+rf8p3Jr1PsMWMXG2zDdKOKSVAVqOJAzkHYXtS37E+59MDxg1HP/wCqwrHQL1NbFq3J32vvfc4ZXJvDZ5mUoyGAG3ZogGJ0ksqeaiaI83ZT6H0tsvyDBDHHGVTLySgmaWV0aSKPylkWzpLvsgdKEY1myVonnK/OvDlAUSKEjtSteXZdK6Sq7uTZDFqJ7izjh5eTH1R1QjTyyryvBHlbaPWVDEAiiRdHQTqG2wsUPiPvV7yzy8xR9fUUWRphZq2YqTK3ksKxAondSdiN8HkvCkdDJFmAWXYaWUAE2EJZhQVCaLEDXffesfZ8pGyAEqkjdKNwGY3bDQYFKkNq81Fiapqqxjz+3hnYhWeI3L8UckeYBUoXCyhJVDsY2vZV9DWlj2sr6USdxcXh4gkS+ZISfKe7TSLSsiKllQmzXuSy0ALJxfRcoF2dGhjZe0hkCsrhFrsC7yMoFsdlOoHuBYbw3lZsuIytxks9wSoUZCHsSykKPwiQujSQWRlG5vAsOwvzJy8ckcCPHHIlroZxGb0FtKgag4G1WWJJYUCdWLHNcLldaoU53UkqAG09Y2FsAKKC9xe4BGOsnFcqI+u16pQA6ohYoIho0EUDTahYIDG9mY1XHKapnZ1R4EsNH8LO0bamBaNhIYQQNIB+EbvVAA9haE1zXyZ0M+kYOz6HGs9NokJJ0TS3RCmrcqCV0jv3dXA2laCJdPppYmtJUs+h+rQpZPzuuxPawCcduZfDyHOBQwDBJFHUjQgrGFC1ddSQO9rKQoQvTXe2LGj+KG6axxlVjdR8MUZtxuHjUB/jEhJ0hF0gS7MnkDqhYc7eG4zDxyRyCIM1KCmsXCStgghhVPq1tpXTqAtiTpv7HXFBBDLGHMluCrmVpFYhVBCFuw1fF6XQGwGEzleBs/mLMnUnSXQ0ar5hWkMK2adBrfzab3NEWCLh3MzJM0cYZZIWtUJVbDGkBtygXeyDR3rzaCcV4+TrKxJw7Ro2tJIXYMw/TFnHnAO1DC05G8RwygS0koRSyEj19RW1YKoeMK+4O3pXv8sekpJnmONMvM/xyhdb+tYFs/zKHsDv2+eOmb4iF7n9LwOcWzOnfYWL27/T9cMDZx4vl9QCkkeu3/PT/npgF41L07O4AYE2dyfT57n+WD7/AK9CEQll1EUFve/p/fCV8S+bfO24I1Uv7UD+m5ws2kGKyQOLceYgkn13v1HoPp3xnTxW8cRC8kSNcoG9dl17fv6174/eOfjwsMDrEwaZ20DfZTtZNfwp6e5A9cY75gzsp1SWWZn1OT33N3/+b/nbCwh2yyjfUtuc+dTmJxJR1MATY/MQA1H6g7euOEubaOO/gJPYKOx+f19P9MC+XMkjBVDF9Vrp3Nn+3v6DucFPDeHkkrmNcYsKSylRfyI2+e+39cdEkkLFtlfy3C+oyKurc9+9iiav19T/AL4efBcnFmYyeoCCoV1FAg1YVr33PxE3tWOHK3KuWeNI4WckE0yxsw7nzM4XSCTsdRoUPbBJyh4KvC89sCrkMhN3pF60ZV3vtR+Ht29fO5Z9n+ju411wxa8Y8PcsDD0CHdpdLLrBr3bTudINg+hX540hwmJkQL0yqqLLhApFL6BewLbmjZ22qjiJwDlaCIgUpkC/iaQnUAbZW2G2oGrtrNki7wY8F4OGFszjzaWVqJIFG9jWgfXcbXviEpOWGUwtFfwt2soaBOkqDRfckEMCLWqNNvsK32xfty/KYyezAtYUhR5QKshdUhIHwUFINbnHrh3APjK3YMjNrFPH8YWgKUh9ypGpD3DegkZzh5PTbplZNTUGshAg83wkincUu9GzqPlOEAcOG5KRwDqOks1aVZGjFKFWRxpVWBF7igw3sGhYDhoYMdnKr5/MAUPwrrCmk1D4jQ822g2cVkPGtRLqkr6WJa9FNVaBStrayAFsk0xamGxu3mlRVclCGUvJHIoABtj0kkqz3DhXLqe4IAUYVjHngegN1DdMvkGzB22Ci9QBu/KNIO9baRVgvEigGpgSNbRo5Cg0B6mzsvmChDfn0jc4+tweGNAGlVR8Wt2CnT8S05Up3UCtItlY6jqwl+fvFwSxTZbJ6Znsh5aYFVAZXaF1tetoO5pB5ttW2Chd6O/jt4oEKuTVanmYGUhW2hsELqKhGFeYqu2mxQLYqfD/AMPMtHn4jOmmKcAZOMlisjRLq1FdetHvUU7UxNgUthvEMtNDkixafM/d3LnSp6UKsC/netgCApIc7pZVReL3K9FsnHn3lljmUOUYOztlyGXSej0zEryMP8QuGIb2JUs//RaKpV5NW53IlQxBIA6YIZQxVmYFdi5DMoalFhSB5txuO5/JSNDOsMqQhkBjkk88cbxldYlQFKDUPIrsUDaqwC8v+LWbmy4ljSJ21uI13EuYADapbsJGI7GgOTqYUNINGVwrxFyOXkj8sgaSSgoheWQnfqZiVQL7j8WQBgEDGgKwI1eCUovyKXMcyZnKZiJ87l4cxHMwtst1EZIopgDPHIdImaAEsIZAAw0rrFg4LvEjjPCXy9wS5uGdjrjzLwyRxmRdm1sgjVSxYu7q5dfzXTYdnNyZHMIHmMOZFhlWF7fpnSU6aIdZsD4VbzevY4zZ4rc0StIcoqrl8o7i8kXUkqzfG2gt0w5/EepFKDuNzdm06wQonco80GWSM56ZM08FS5aQNFmJIiy6beIFSF7/AIjKXBvf1E7xG8Ks1ms1DKj/AHKEoCXizDo7yiyxKrbJS0o2pQTTnUcLnkzw6bNTtHlNAzeWZZMxLKwgS21KIg6aywZV0rqR1Vrv3DJ5+GaigcLl4XLJ0Ivx3izakrTRyQqrLJMhpQYHWOVwrhKYYd40xsAry5zBxHJPNGmYjzMUgnImLLmczC6UFEJZgW1ABWicsnqoX4TbcC4PxSES5k5STM2UUZeQnLtnxmXEYZNI1LJGzv1urHWgajSgOCH7M/IOYy8JGdy8MOXjPVaRjozhe+pTqQdBU7agysAoGkA4n8U+0TnJD/2nTgiRHV3lRppRIK6c6jWAlEAup1B2sEURheyT+1GpvQA8q+C3EXyee60bZCDLsJUhmLzgyoKZLBVnUJS/ekLh6K70aOeUvEPhcuXkQw5KOTSRJFlmjzEU0VBX8g0O1jdkeNm1A2zAasCXNv2kuK5Z4VtHR0VRHHAsjyFWOovpbUsh1DSopmIqiR5rZOTxLIJJEizEij8ZopFyTRIUFZdJwqs0yWxlXQFKkWfXAln7ezJeDxzpzLk8sv3bI5WXqIXMZy4zMDRFiGcRiG5CS1HQp0bmhscFnhrNxRW6mcjijy3Rbpq0rvmlfUml5Ce5Kne5CR5DWoYoeMeMcaSxZeCH7tHGEiP3iTbvVNJFI50PZLSbk+U0MMTmDnCKGEvLREaU2gs1PQ001At5SemCy2FJOEtMfR3k5tg/FhiBV9fUERgm0zIVXqaSyEkG9R0bxPXzxYrlumA7PJFGEGqOV9OhGoMBI70w+d77V3UYh5PPyywh4o2RXCuoNIxFi0DOXUeVQxJHnVjewwm/Gbx0kicZZIWaYBWJ0dUNIhPTYR+bWG3Nil8uy+woMVeEaDcNp1g6Y6K6iw0mLupEjdipG+o0QxAvUDhb8T8Z8j94mBmVVGXAIMiJAzgVpCG9U69vIQrpt5tCFcxcT56zmd1ZXMF1m6gWNgSkal6do54VcXSqOm6pqRrLEgk4/cv8sQLKFzMzvNINEcKRE9OW7AlZgZPMO3lFMRudrdxHfFJaHf4UcCzfEelmps0k0al0GXjQCNXRbZczEwYGgRJR1OtoQfUuuVo8skaQxWrtbKuiKwbL+UKAyki2vSAPa8YM4H4kTZLNnoKxBYtKi7mYKV1x1X5tNXpDAXRGN7ZjLLPGktbtEhXUdmQgNa0xUeoJYMu1nvgSi1kgpWRZc9G4LFgF1mIJBIWIttVFk0e3wjsLAs7GWTIAVjGvSvwtQZylIHK18Isi7BLaSceczkVjQsAdqK6RZYkgiO+xs+UdOu9jYjFnlVaUt2HkGl2JtAVXZQDq3Pxaq221A1SIYFecuEJm8tJE7KF+HqFFZQ0bDVQBUMd61ah5i1b4UXPnLMuXC9ItmGbREzTZR8wjRowVI1ykKeUqGLai2pxsW3Bw5VkjS0Lh5FtQpYAlixYsd6CkElfi0qCbsY+yZwjzhr2EZWwemQdRIord725ZgyKKvBCJThXAMlwuZsycxMOsUgEXUWCEPMtESQWHCoaNsWEKarYkHDgfi2qNOrLDIWcjXCuiIg0BQLsSFX4pQdOrcAdsCfO3g3ks1IJ80s5opa9YrHRHYRo402fyrXoxGwoh5Q5Vy+WgjSFekihlVHLnctRDHcOhA1EksWFMWNVhm7QKL7QyhgFUkg0GAPl23XYliwrzUtb/ADxyz8vbWRYor5QEDhRuwI3K2dAry2CWvcec/lvMJNDN50AGrSFLEKXW2WkCbgMCzAbHbHnhLMwJQEaSwBIDFiB2GtmU1RLWwo6bFg4UBB4pxdtSBTLpogqqkoz2dTu/mrTtaghGH5iABjvxppUQaVDSMenHpYDXqs6vZbPyAAonEvMuoZC4LqwGqNKtnYnS8hJCqFv3Ck++kDHeWO/MWZAQDpsaVI2FEIDqagS3mB3A2xjAzmmjidZJ9XXRNjEJDQaxTBTTLt2ZD5qNdsQMtLmJHtG6MbAnV90JJBJKNrZ0UMx2cFCSt1t5gScJyrA69Rcsf8SQVVDuqqA257mhYv2xS5DPLO5MbdRI3AkI+CWWzegrZJTbWFI0/D3JoDFvk81EjnzDUoCtoJKMaAJ0MaRjXYEmhdnerJtJAOkMuxUnyk/MbXsN7vcfXAB4geI0GXSYNJraKlWIaVOtha6StbqB5izEgbVthecF8QOIcQ0Q5ZEy2lFmOsm3iDgO0JZT2ujvW2mxYwyCoNh14iZx5+H5ZgYpIRAsj5hInYOwI0t+cJDuQT8UhX5bmn2YOKI3Wy6kkFNfT0COMHYXd62v4rPbYULGBPwX5mSfh8SZaItCqdBIpnINRsEDzUJto5CSaq2IIG14rvBrhQmzszyCypkQospigZ1J7IoHUQkAC0ZNtTA0MJJVIpX1aCz7RH2epeJZmOXLZpMucrGUPUQuFPVF0Y9IurLAk6Qq9tRpQcK8IOO5TOH7qkeaAjkCys0ceXmSlISRGdZI3ZxYWyWC3qokY1zxhtUeln0yTuisyjpoiakuBKZTpkp1VvicljsAoxV5/iEbshVHZ2dRGdPmfQvU1kCQUp23PlXyatwoxbu/RLs3GjLj/Zb42ZjLLPDlZ8xEVb/pxMMUKJGOoJ2VFBLLQQRFmaUfGB5hobw58JUyGRhyqydRYJur5NSnMF6cyZlpOposlndI9C6VUE1aMS8Uz0soEzL0yDakt2FWmnZhrL2j6gKjs0tgnquTbQCT5qlkZiy0rAjqKhvVTNqom2qtJO5DS5HJURUKyfYcsFC+RUk12TYsancoaYEi1OokAC6UVqBH6GVn6qyDXFqj3L2TCQG841Hs1xhLqQtuK2Eb7o11r0wxox1My9USbuVZh8KiNmsjfZVBU2MTuBZRTqbTJRKsBISdiEUGmY6Rt5aINgsR7RHsRU3jI8HF5llVniJWDpDdUj2UdNIvKu19Qny0SLFYYnOXhjw3NShVkAnBe4YpUVdKDzkqdQuhWsbs9AUSMc+Bcu5LKuIgzyZrOCRzmHA8xSMkraaUSFV1dOJaDEMTqYuxheIPhOwdJoJwk6Rv04MtlcsM1KxjWQxapJVSNZJY1dmpdJ8zP6lqsQ/cO5fzEGXzoYpm+HjKv+CWcTpMFtYIyn4YiRdXUtgVbSVO5ASnA/FuWDKmECJYkkWdHjXqSCj1CdPUpikgBBtr7e+CTiHM3NUeTSM5Nl1MIy8HRlzAqM0NKTvHppV6k7AhnLlqu8V/idyfnMxJD94yr9QRokrwaXSSQjs3RJQUHKk7Kuiw1XSuLWSiphZzpwldB4kuVk6jRMyvO8KzS9cIkKPE7FIoAS5kaoX0kgKwIGM9eHXh1JE4dperMzAkI9ojMSdMa6rerJugg2oe+oeb4IMxkhl8xKojWSO4kbXIpiNUEWNydwPKCyhW2YncA3EuNZfLosUKPExvToj6bsvYlncl11bfCNR3s327OK2qJOlkv+H8EjH+J5pWrXT6G2rSGc3LJQ3CqUXvW1kF/BvusNIih5Ab3NAEb23xCvTuWJ/fCdy/HnOo0kagbtZZ3rYkyPvZFiwT6knesfeDS5qY6cslLRuUr+HGPUqW065G7Fidh8K9ye1Ujjkm2OXivino3dgrm9Khdu/1IH1Y0K+uKXhPNEmaZmZpCFYAIlopAJvzEefcbkeUUdI7E8/D/wAGwr6pLzMh8xkYljfoEXZEA72WPfYDbDhTllFpT5B66TuD7gi69h39fbDrJPCFvmeDysRqfSorSiEBVC32Fhif8zE73sMeZuXQgJ1HcAHSvm2Bagt1QBu/4yp+WDTieWjA6ccZPbzEsTue5IOo33r5enbH3JcJqxQUAEjsD2Iu9zdkmtyf2weoQW4fxEqI2azGiayBdtIx8iC71CPSFFn4mv0wU8Dndk1tSySNrKi9lA2Fn8wBA9tVsO+I2Qy3+HYIC7C+6ithXqCPU79/lizyWZXWUPxadYU738h86IP0r2xqAeZ+OsMurLRZ2DLdjy3Sk799Ise5N4uP+qh4yfUivc2BZv0/f/TALzFlmWNmG2kGlJHwIRVE9mCMf8t3ibyJxVWU9q0Kw99Sn2v+G7r1FbYUNErmDjH4Mbq10Sp+RHZv0H9PXE/g/MK6MvXaQ9vRbU7V6AMCB8hfpgEkzgK5iE7d2j337n9quv2xx5e42TBE22pHZDZG63X77k+nb6WLCG3Ec+Fk3qywX9LJr/nywiObuYt5gSfPZWu+xWx8trG2D7nLjGlywvfSQfQEAi/luRt8xhBcf4rqmbehenUd99IAArc+vb9xibKI/cf5jKRrZ3LgfOtQ1fS9hfsMCnFuKnqpov4RYG50qdiPlZNe+19sRuZOOxmXyLrKbDWaTysQaVdzdk7t6du2A3jHN7GTZiFHwIvkUkCgWqrBIHxdgDgKJm6DTjnMbAhCyoqKAxZgL3sCrsgEgnbc4D+McaWSYANqoUSLVQoG5LHzGt70hdrpsAnF+Net6q3PoWYG9/cFiP0Hzxw4TkZHRiNmbayd9PxP/wDmND6WMU6rYrleEHM/iGQ34ZoAaIwBWkHdm/8ANgPM/cXWBEmWQ6wNTdlXc6mJsMfdU2ar3YKN7NnHLnh+KjSls7kteoE6d+1EEXsRt3Paj2494cSQyNJD1NCDWzMpAsfEFaiHWvNQXYHa8TXIrpFVxvbGj9kzwZzUuby0gVVMbrIznXq1A2VN+Wz5tvS/mK/rvkMj5BsLrGV/sOeGpgyiyuD1JlSRvVbIOkqKFUpANAb3jXWWGw9sLFNuycn6OMWWv5H2x10kdz/z2xKDgD+9f1x4nP7Gv54qRbsiyX9cR8yRidMlHA5xbPBTfpggOU/EKNYgT8aAPYg/PFXn+IC7vbAzzfmZApYdgO472e3v/bE3OtFVELJuYQoLNpC+m9Wfck9v0xA4dx8SAspBX37D5AX2G1m9639RhCcQ4jIad1eQBtNKbT/3HVqA91Wm/wAy9xe8L4/mJ/w4wsUYFBIg7NfqzmlRe1BFfba2JF4nHksZxoNua+bQhoGz6C+59T+38qHc4DOG8Lnmfqygn/8ADjHYX6kdqAFWb31H2GGFyb4WRoNTgljuWfSX+nqFUegFk9yTg4jjiQUB/e/23w3VvLBaQpeIcvysNNA7Dc3pHdmNbXbH19Bv3Ix34XySb1tuO5ZtifoPRfnt2Awxs3xJfQEmu1V/WsD+ez5ZfMpX3U1v7fCTt+2D1QLKz/pqhI12J8xA9wdz+oH7Yjcc4ekasAa1Cwdv5fqL/TFNxjPn4t/JZH8QPsPqL+oxN45xFJUUMa1ItMNiG3Ir5f2PbDI1Flw3i5kjF99iw9bC0d/8w7H3A+eF1zBmgJPML0mz8xZGofOvT5OMdeDcbMb6WNFDV3syOdif/E6q+TYEfFDipjZn3oN3G9KfPqodxZN7dm+WBJ4CkEuXg0a9J1R/C3+U+h/8Ttfyv2wsOLZoF5E7EHy/5WPp9G7fscEsXMhTqEHZogpHpqC2rbehAWj274U3FeO/jFmNWArWe4HwsPmt/wBNsSk8FERPEvjjJHFKBZjmTXXcKx0t+4oEe/tYOEj4xc16S6bWpvSdg6NsT8tq3Hbv74NfEfnxF8jGxIDHIPnXxg/xKNLj+IA/MYQPiYXlmUm+n00DOfhJogn3G5sfKj88PBezZ8EHiPNxlKab9Ua+x0iiG97XSbGx9seuBrIEPlIKnUrLtq1AAqVN+m9gb4kctcnxqW6m67FJFINV38pqxXcEfMY7cT4ksY+JQT/D8bIR5SEryA+pJu/0oyktIpGFZZM4fw1ZkkDlQT8IVfMpFmhtdfuO/bFTypy+yZgxP8MqOFpq1VuNvegdiKvbFjyZPThSW85ugDYB8x71VC7332wQeL3IUhjTMIAFUKjaWa7bdPpQNGjYYi+4xz9ql1bwzpULVlJy94aNmZugzNHHEvUlIAPSjBGqQ9kumHc0N/4cE+S4wpEsOVmjymVypjEmckW5ZfOyjphO/UNuGILggdrAxI5v4sUycWWicSZjOsHmWP8AE1IVCxxagRXUYbxkaiVYkaXUYKPCL7OkEUb5ziAYdJGl0So8cMLRk97I+8PY2VVKEmgGKk4aUqVy/wBISMc4BLgXhvw5oWzeafNNl2H4cuYlCyZljZBgjjDSsNQpddE6rI0riPyfwfLu8hmimy8DODlhXXn7gBWIUXq3NnYVpF9yZZ7jr5/NmbLcPkzEUP8AhIZGiiJk36rwyMKLLtpjIpU3q9OJUvIueEZnMMeWJV5XMjKZmXyrUMKKwSOyANelyATpIKkzlP2LJZwNDl3w7TpxGEoGmCvmHkZ3kMe20aeVGYkEkNpWLZtLGgf2d8PJFdZYk1M761kSmkhVART9WUoZGttWyEBa3BIxO5GzyzaJpyYWi+KCB1kgsBkWSV10PUmnRHAzAKwsiQ6aMs5xkt0gKaPzCYuSNJ89GMp5JNLjSd2suBf5h58lk6VrBV8b57WBwjNKymumJFZZJWlQmo9IZKEtMarTYFlRZ4828I6oBmaEySEIxdeuxj6YYqGHTjMiVdkEA0oBve+mdJmc9SQPCslxhdDUzLRYIrP1Cw8opRoBO/mx25fyevMDqtpdcu8TxLKixlkMbOyxt+QRhGLFgyM2lrCkDVY6dA9y/wAOjWFSFIRVjJJXS5dnMZLpWqXqLsPKoBB/gXFvk55YyA5jVF1qE1F3CiXTINTSaNIjqOONVYubNIReJOVyyuSyhgvUdptm6YZkVGIZ5DGFOwZ3INSEqDpvE2Jo+pOQZGDpHIgbaMpCsgQh7IBI3cKIyEDMPjGMkCybJkz0swqJrLfC+wlUvTFKU63Sv8PcEAnY0CK7M8KRI9LR6Y3bUSCHVCTSh0OpSjFVUn8h8zBt2xylD0JUJksqsSvJ1Ekk3kcmuoWZGX4IwqSKQofc46DmN2ZZCpESHSpZNM0oRHIZWNDLiJwdoiaTSNJJODhCuz9m+GOdXUuRValDyA6a0h0cW2uNXKFWUBnS1GkCsD3PMcsMSsI4jqjUyNP1BHDJId5J1VncRkKNIUaVYDcCUnBTwXKsqgOrOzBVSpJCgWJgFIIcvoXW5ZiFMgZRpNHELxG5yhiaPIn8SdwpWN9MYJZQkAaQqUALARsiqwNXqtgcamwXTOPLvHw0Csuh5GWIMIiQkcklsZBYEjLoVWKRnSlfwlWYym8VMzHFGFMEhA2jJ0NpBrujSDWzeWitXZ1epzB4XcUly2czEOZI/HZ9UltqhbS1LFYXprocxkWCdFKR3w9OaeFo0URMUupZU6YVLQONCxpLvIVi0VFK0itRogqQDh05R0BpSOfiF4/5mLb7jLISWB0PGb06d1BcMVttzW4BIujSyT7WmbkV3XIT1GQrlhpVKsEnzfLb8ouy2HJkIi0nZVcqvWBYFo3NHzAqF0eYqjbal1EKSuBbirIRJBIrhOoyaURnMyrHHq1MAhkUE7RpZGm7IDVePN7EfEvAlG+1pm9etcrWpmRTRbQAr0xYXqLEHZAaVKs6rwE85eJfEcwd9aO+8cemjpC3bVdSO2+nsiqBV3eiOEZSJGLiNo1JVmjdArCjpCFSWkeRmVHAB2vTS6wcVPMXLkTTzzNqMZBKKDbh4hqYABgRSBXVgwC24Ja9OK/N6QnxGWuU/AqacAy6wSWKyGyoN0eoT232L2ew+WLSbwReOVUkdVDOoDSGhTA7t/D28pOzbb0bxpTieUnETzRaGaEF+jKmhZzGQGW1UuGjIC2uoSE3RHacvCBmEjIjolFfMoS3UjMsf4PT+MM6MQtjT5bGkHcI+aTG+NIUPJ/glHBbPFpmHlSWyYnDlgrpIVKaStFrtu2+LzJZeJ+s2g1DMsRaiQ8ipbBQASG3+ICqB7bDB1k+EHKQ9HqCaMS+TqomuHZI5C2km2JJqMAb+cVvVry/yIYozAdUgll+8gxkr05Jtw0UxUUyJrDBzT2fRwMSlJvIySB3g/KzawWYFFURiFdIBZifMy1ruiGB8o07kXgjzXDzqLaggKtGAdwGsdva7Fsb23KityTPkB30AyR6RpEZAUhSemHkVQIiadnJO1pWwo84eAF9LDtIi9BeoNBYsHdhposdW4AALKK3JwgUVWT4IkYBYSKEJEmgLq0CiGLbWinsVrSpLXa1iTLMnUIXZLqQtqS6AIfcASRnTQosO5NdsSc7nUj0wsyW4vptVuSdITSdJHls7N5rs0CRiHmObcmFiSKeM6XKBQNRHkbWqoKChTpCgkFbbdqOBYaZJy3DWlYOpVlCnyBwygjXspBZQ2+obggg7C8d8pw2tgxRVpCCthLYm3DsrFGGwvayBsReB/iXillU6yNJEFZSfwyWdpASrqdCJffynUxZdm23FDxLxnWRFbKwtKi/CCrAKRYDNqDmgKtWLatyNxhbGph/w9wxKUrLFTMJPw9lY0kQNBS23nJcKACD64Xviv4z5fKIegsWYfUVdy9rA6DTToFUhlBZQVOh9IJaiLH+HeFGYzGYjlld41kUf+p+IFYFenFECEWOTQVtiSpBZqusNDk/kDKZbqCKPqzhRIJZdMshAIVQ66AsaKtAlFssBZvU2MjNJClynhdxbM6Rn/u+cj2kWNs3oTStFD1MuC6nZRQFBl9mY4LOLcr57Jxjp5TJzhVVinVmZ7suWjaTSCwI8rkgkiqO1ePH7jYggEUsKfdmYdU62XMLKxJDRxxaVb2YhylUCBucBPgH40Lw2KaLMx5g5SR45MvOImknGryiwxchQFUqqoF1l/KNYGHrsDJN5kzuYdVAafKLIQJctONcYMiF30SgMgJa20AaqOmx2FTy1lMvkoCRMW6y/iopBinVRujxWCGZRR2J817bVbeLXiycxxDL5douIR5AyKJ3ngcGS6kpFRAI0YqvVYkMoLtSqoxP8IuSIc3nuIwTHKNG2nN5NYJWDZNo5XhASQDUIyoSRhrKaiAw85w3wyW2OuVVoE+M85T0I8tw9oIdKIZBAUdeow00WXUpJYKgpr9R2wyvCzwhzE7/AHjiTzpNDIRBHFMESaIqArq6gvISzGOWK1UaSa3BMvxeizjuY8rNk2hZbmlkcQ5mNgzM5WRQEKWAUFBkCkG9Yx95f5i4kjAZlcipbLEZONJQZpZWHldiwQIH1F2YbKKILBTgVStA7N4CHhHglw0O00UKQyusrSTRsVzCM27GN1e08x+INYNggisU/C/AXIQRuiLN1CSzTNKz5iQurkv1CGW18oZApBaidwSV9nudIsumYjlGWzeazMgLIwM8sDaSsqOwSpArG0EbKbJ3I01z5S5pzT9PLjMSwraoI5lYO1k3pB1TOAxLLb/CPKSFIA7uheoweOcOy3Dsu+U4fFI2azLtoaJ3mnMjKA7GRh2oMVFpGBey4F+QfBLMZPoZ7M5pstKKmnimVHsHzSRxyB9OtkO/xMprTemjb8P/AOpQ5sRcPiiVMr5JHzLqwzDzKDplYDVqoKyItKrKdVb448E5kjzeUaHO8Qy65lcx1GHYQjUVeMBjToGQlCurSCoF723Z1+SLWcFHk+c+L5vMZmDJvBn8hbu/3+Ng0ccl0GmjMYc7lY9aglAAxBt8A0vMP/TpR98yUdszsyGQrrhKmQFdEkoWRD/hFy2od28tYPOE84w5LiEaZGMSx9J1mdZXjGZfd1ezrQKoAJqIqQaBGnzDWf8AETMZrPLmp8hFGy6xbRUFPeNlm2LspPfpUNRUAa8Oqllgp2UvEucIs5OsByssP3otJkp9JEqsQJGEcpLEMNJCWW8tCrK02uCcegyUciydaaNtSkySfeG6zRp5+noRYiCoDBaJNrqJUDFXwbxDlhy6tJl4JSssMkLNKImfuVkjjaNqkpqDakYsRYAs4sS0edzkE+WOZy4D6swEy7K6TpZiaTqgRvGyhxIVLqToPYk4Ru8RK/sE25b4ZJCBPO7vTNLKxeNgGNAxR1IrWTZDG6HYUMfuS+acoqGBFfN5ZGimClW6ydMF5JjGN5o2pViqtLEqY9LbaUPIuU80zwxl9W7GJPhBJ7FPiHdCBVk7tioRIrZ1RBpBZWZUU9MDQUJjosoY3Rar3CbYXRtnHIc9h8quathCiu/TeEwzjQXDFlZuw+EBVCyKLHlo4zVm/GVs1Kj0mWS3ghzci7wobBDFgslsKVem1AsfMBRxqTinD4nbqMHcABS5Y6ShO90QtsW89oCUFDc4UPGvs18KkcSSCX8MKoRJ26L26jSIybZfhHTUp3o3Wzxp7NbWgc8P40y0U34WXmOp/wDvJg8jFiCoMOXYVGKHluU7qC97LiFN4PcTjYSrHlnGVuVc0/mzcyhtQR41BG2oqBQJISnUjGhOGct5XLWiQJESGXohV7hgWKnYn32agQBucWUedAB1v5EUrbjv/lOjewNJAXUB5u5oAHQ+b0hJ5XwAR8/kuJjTA7+fMZOQuFV3icMcvJsQ1vrKua+lkYb+bikIAWQJoZdzA1soUDQAXC7AmyAb7lSO8nJAOYnptBPlDh0YG900OBVlQbcAla33OP2Y48ovVQPWRIdYNl2Olo1CgkiuoFfTQWixpNRLbkcxxOaBSRbVlQ6lpTegL/CaFl9kZdqWtNijFh4kVZV1MC47mpGZTROwI8osKQFKA/m2GJ8gYq4CBWW6JfUPiGl2LLqBCjUQFYAgj+EY5ZaUht1XU7hQvlIChbQ3WobUdI2J1HSN6WjA2/K2VhlkkWINNK4MjW0hYHTZBHwIBQqlU72TeLHNREAUq/4tkMCX6J+FY9OoKwJ8l6l8rC1u8fG40bHScWsjQyxqqkvMtAjUx7ICCTTBu12Me2lZ13MjMjaqjdgSwIpCRptTRJWgABWoVvmMReM8UGhhqP4gKobErJfkB0bDUCLUMdjt2vFlDHEijWz0ArCV3DabVQNOwC7gFkGy3tttjhnsiGRmLOqa1kkDSqrssYoo3l8ocgBwrDWh8pG5wK8Q8Q+HqzMZY5VYmOQFzJGJD5hoFaWA2s6ttwT2pLNsIZ8/tbM7gxjSpBk1E1TJp1EG9zZ8o+m3YZwNGigyEMSzsU1NHdk2L0IXI2BJqjt3sRyfiRCWmmRWnRUqKOFXIcLs92gRe1hQxsehusB7eK+enilEMMcCq2kF9KNFZLbFyAzAA2yrRIIFGhjILQ68tl1DkvoKlQ2h20yALYTu7MSBYY7VYuqbAnzpz3lkkaNzI76NQVBr0CgBt8IoHuCQfWrws/D3lGCXNuudzazvBF1XiUuNSkecyTOUBCjSemtNqsX3xy4/zXlMsOmMvl51LkCRZ36pRjqWpPMAR8JB09vqcEyR64/45uJQEiSWKhp6waNidw2npvS0K2A7DarOK/lbxUzZkdrDqocGBVAKA+VQiqSR623xeps2cduaeM5jpjMiJOG5VkWMPLEsuZaV9hIiogKo5UIOx+MmwRbE8I4eHxRRKsimUqS7S/hPLJotmZGIkpWIVFo9tNkmy6jgy/QqPCHmSGTNzRPCJkLqwVwXSI9nYlvTtqY01BgDubkcf8T0yWZIy88k4SUrDl3jgEERkK60jMdSlV3UJqO9GiRiJxLw2eLMdLJSTTtATPm86gWOKKVnYyOQW/DgjTcI2pyFJBbcEc5y8WclkmvhoTM51irTcRYM8SlrLiCOVQQ7EjzjygBgdZuqwh2dIq/qrY0vAXKt/wBP6cWlmjzD5czF3VlXM6VZkOmy5LgKqpsqqwfcVM8OeFQ5TiUcTrFK8dLpyhaQF2j0EyqdbiVSpLRgnvZ7YheG4y8ed4xHDJIw+KHLfiLEiKi9TpxhutNICVjjYgUrdtsFHiFw2XL9PO5GFYlAV5Wj6aFWdig6isCxO5DKuo33LG8T5U7GdWaQz+RkkiIZAFLlqklOolZAVZgvZQg16VJIPpuRihjzgVfKU1IdOYeQA6iFdmGxRSkI2ZBeiwtXqJqvD7m2WfIhp2UyWY/PIFDamEaAdNNmHxOq3d0SfSLlMy65hoemqZbp0SdKsJZCGkEQbchgWLOFN+d9ZIAxjlqsFhw/ITFllMkgUyIOkYqRICJFFhKoj4zmHPnel0gBTjpzBaagiqItNRAn8WRwS3UFBenAFUmWRjqcX2ABPdMtJ0hFFIysLjedrkdunJQPmGl2q2Erq2wNRkm8dVye/wCKPMiFHeRmoIw02labs6iQQgJcC2pVUUA+wzBBFrIkmlplKRNSalN/hAHTGim9cshY6kJZdQAGl59WLJTZnMt90QyyRdad9LRxo5ji7g7zbGNQGJViys4cWU8b5jWJArjXMQOkhVyK8ilQsaO2ksylguoKgruKON+N8GzuazP3hslneIrHmx91y2bhOTyqpIGDtDAramETUiTZgBNNMTbaBWEL2JJ0XmYefifEzmg65TI5N1kjaOMPKEVSxZybEXVAp+ordOFtPdsEPhHlcxmc59/DZhlE03xLQkgK/hlXIjV1JKxhYxS093gw4F4GZ3MMxznRycAAvJZHyCSNOmVWSZQruB5gyVpIJUUqlix+auEqUJZ5FUXEHjlaNY+oiq2iOKwzneNL10zUi2LwJO8BSMo/aF574zkc0fvefJgzAeToZRWSGHTQTLrIAvUZww1ElS25C70GR4Kc/wCXhyqvmJiZGH3hIA0imNGDaZXEgGxUAjetJU0xO03OeJErSrwvP5doY53eGHNQukrCLQTH94My6I5GUIJZWYsrk0AGwovE3m1YpyMhmoxKmsoxZWkKqgVxIyowYi1IA1L5STpB04pL7JYB+BpcrclzI3VJZ3lXWRIjqiqXYK8xLA6mB1IO9V69qjmPgKmQmzJRA0x2VLD09S9nsNQHp6YncE8RJ82jCJ7Swsk7rrMrgbtGCF6p1fEb0INhq8wwXcscgPEBrZy7b6yupq9NKaQi1damU12ANDF+KNE5uih4F4allTqIzf8A6Lsigns6g2/zF1e1bYdXKvI5RF6jBFA8sYQR0L2CqDY23JJ7+mxOO/AlEYGxFVqeVtTdrv3Fn08vyGIuc54DONItB7Cy7egA7n9/mcdiicbbYU9RVogBV7AX3+tbn6Dtvviug4kHZqDObobbX6+52HYfriFlOW5pTbNpB72bbf8ALsKWga0j1/cGfDeHRQABfiP8RJN9v96xRIQpE5PkartVvf3IHp8r9cfs5wAB1A036H0A+Q/v/ribxrnRYwTZod2JUX/4j2FEmsLLlnnhsxmm0KWKrYlN9NTqUBCexYi28oauxI3wcaDkaGf5f37XQ2PqKvc/XAXxzhvTdX3HwlSO+1WL7/UfPf1w0MrmwdTdwQCPWjsGX5kf3wKc5RagyfBXmQ+lEWD77HysO1HGawZMouZ8qrwNtqBB27UrDSw3v9u/Yj0wmOWc+2WlANlAdia1aTtvWzd/iA39QMOHKbrR2saWHop9CPkasH+fpha848MIAfYFSVJcExsR+V9PmjbvpkAPsw7VzsoiNzhmbMeYU7q2lz2BIFkNX5ZEr5BrPocVvCZtLTKPgkAkjF7BtibHcErR1DY0fbFdms2CGjOoCVdQBIsEfwte+10exH6jA3w7iLfgrYLLJpDjy6lN7foGNj5V2OAEveYuYWpLbvWoE97K2p23rGe+Y+dW1FrNlzY9FALGgP8A2/pZw1OcuOrJHJp8unqC/UHezXzIB27f1ytzzn3MigbVuwJrdgtn6b/zOGigvCJcvOJ7sST3J9d+4/8AH5fXFFms8zuoB3JJ9u/YfQD+uIPDsumr8QswINFSFAPp32IHqNtvpi5ynGFj7RjqD1JsfqQf1274LxoEU5E9eWSi63rSdwRvsBdiga+RNA478B5o06dMTSgWXJ8o9dNbEWO9mrugOxx9izhlIYkq2wK25iYXZtSfLfsPL9MNng3BgsWXQiEBiQBqtZDq1MQ9K1geRfj89g4458lbPS4+BbKXkLxKV5AJwkKgatySHIBsWwoH1r8x29cPHwv5wy2YljEdlA4jZm+IBjYtGN0y0F0iiCRZ7YR2Z8LGfMJHGgYyPpCq3lXUa3J8297irWm9BeGZl8jFw/Pw5TLkaj0mzTO2l3YkBYo71roUgPp0hjenveI/VtUWnx4Z/U7k3LBUQKKGlew9Pev64Osshrb9sAfh0bjQ77qp+m36Efttg86+3zGO6KPEkyYqfLEKGIbg9jtXscSo8yD2NfXHKeEj2P8ALFqJpnHitgCt8AnMzEgn0r+X+x74MM9miBR7fzGB7j2WoE35a3rer9/l74nLJRCW5h46yAD0vv8AviPzJxhmhKlwGk2VfQDtXlIP62N9sfPFGQKgZQSLojbsdrv3HfbvhPZTmaSWYxxD4ToYkAlSP4dj+p9De22PPbadHSlaGZ4Y+FEiSdR8wxvuijysD2VwSdWn8prUPcYcGU5diQ2F0+9KRf7bfXA5yA7hVEm59T8/+f8Axhmw5UEetV6Y6owVEZNlaJxX+/8ArWPX3kUf6f8Axjzm4wDRsn+EKLr3GB/PxuW8jFFAttqJ9/Q1W9+/9K6EPnF82wshVI23LEHf6jAhneZQXZTqiqgX+EWR8ILAAketA0axcFetaSE6R2JOkMO4IrsQf9d8CfOXKcbtpEjG6IDnULHYE/EPreAMgazHHJL+NZFNqp7EML03v69vSjXvjnzPx0Ll4mFqWkVWU0dB02CfUIzKR8jqG+KbiXKj06AFG2II8wDDcFlBDUw9VsH0wNRc1EtJBMVLbj4twVbUuzKpI22bv673QSqGs7cxc0gSg9gyKrb7WWBRgfUXQ+QxXc98yWg3shaH+YVrFf5lB2+QrAT4g8UKqpF6VZgxG9CxRPyB7+3fCq8UvE7pKh1bFww9dwpBr09tj3/XC03gI1M9z6qIrEjyKqN7NGa6Z7dxZFetAYVPivztCyshJ3jDxujblT7ehKMAKPf9awuucvExWRk20sNG25ABtTt7WGX12+eF3mOIM6aGshUOk+o8u9N7PQJU3dA2CDikeP2Dt6LrjHFpiF83XjoIbu/KTpsXqVq3U2fWrDEYuc7yg8iKyHzKldMmzQsAbXZFV2AIv2JIVyRxONL16ySexthQ9BR+Rsn17YcHK08RXrhVj2+JqRgT2O5ohgKHf8xAG+I8zcdHTxJMXWY4DNGfPpHYGMOGIvYEiyBQ7fP0wVcIyyyFEQp1CQkZZVLgluwkOnT7Hv2oYg8Q4ivUk1I8KNWho/Otn85Pl1kjtRv5b4bPhT4eaWdmTVIrIY5JUaFQjrtRcFlJLamOn5Br2xzcvJSzs7ePj8+Ai5I8M10FtZDkBZC66CXWxr3QhVUmwbIfvq3vFD4o8UmlhnjiKjK5eOMuzLoWaS/PJCxolVqxV6nDNey4NvE/xGXKwdNSVkkRQRqoqBatJpkF6WGlowGA9koWQOORl4XJmZpSRPI6guHfqRoxXpEMyrGOoWkuiSAaoFRjlg26bOhRJXhF9wy/D/8AqD5ZFzWWEgUs4LTSlgsQiAYBHcNWooSAXA8pBwBca8Qc7n5o6X73M7qIslBvl8tp3/FjYdPUWu3lYABXJKjbEDj3LuiDJoGOY+8q0yRwLKSZVDBkWMD8WRAFD6AdPpQK2ccuZfO5LIRrPLl+DZSWySIXfP5pqqRij6hG7LoUsakQEaUX4R6KSq9s4pf2a0iNzdyhLF0zms+rT2C+SyrGJIEYVqaTU6lLpQnTjvSdLe95y3lM3mcsYIp2zSIyrJJNInTiLXoQzMFdtCiwiah3bYIcAnKHNfCmm+7LkcxxIlyys0eVjkZKJkkkZTG0i35h1yqoNzRxccv8HGZzU8XDHjyrRktN+JJ0kRSqMQIg/VId9/OQEL/DYGEnD2C/C0aV8NuQoMnEYo9ZDOrSlwxaaZowFkt0IjjSlJj0BC7AglmszOTnnuFZHMzMZ2k2pHQu5RSGUM4UpbdJVRH3Kmt7CLJuVkpFNxxGJ5PxHZgmperQjRQrLrCamKkBdOk0bGLNLFYZNBMh0sZH2IUsxALPpQq2lYncB3b/AMiOFu9lUq0VsaOk0wSRxI4UhWCi1NltKlKEkikppB1hUJ0N6TosorU6rGwjDRRxmywWXTapq7ySsj9SUBgrB0IPmI+5bMr1I5JdAMb6X6ugOJGQFXYs5cyBjIFjsLT0DtS+pcuqrD5y1i9VoISEAYuxUpXSddCqKJJdS7WdU26GOeYzyAzFljRE1GUqrCM6SpjkpeprtDpjRWOk62KUi4Gc14/5PVHGkUsg1hpOqTCkJkYJq/F/EYCtMTNGF0hiWqiCPJ8UdUheTaFvK7KgV1FtJuoJ0jUBqZX8lqBqVTVJ4m8jw5tG6aJHLKRNHPHECSy65CjECiRGCHVWNl1a9hikGryJJOsATzrluJRvJNlhMuXIZgkDLmVQq9l+5BF+fyRlFYlLI3xx5qnzmSy2XfW84zSCWd5ltY2VS0apCpVonNtqJ1MxGojtVDyFm58nmoIYm0a5kikiDhlIb41YMWOvQC66a0FaJ9MaCyfiFlszmGy0brM0MUj5hEdm9VZCCC2lgzKNHwfCGPmKmtfglYr/AP7vRrkJJlAkmQRIMsWJnh/9NpNQAMkQIEgURsGkKqxDb4N/CDh+VzAJbMpxGWALLJJLBX3VaJAiaRGZNTsRWoLa61VdAGFpzv8AZymPEcxm5Gy8WVdvKx19SCSQstCJIo0CLKoZ2d6Nt2F0RZTnk5CNclk8sMxAQsb5+SgkubkYq4YxKyPc2lAL8q7AaVY4LUUgK28nH/7U6eJvm52SLKyznpCQAl1YGkljVlPTKIWLMo0IbIGrVgy4xyws6FfvLZazqemTpJSgLCQSVVZF0SWxKDYMJGVWIx4m80DIQ/eM7Ks8vUAyuTZzGjZmMOCzrRHRjhpCXNML8rMVwqeSOIZbMKczmpiPveZVYI4lJCGNh94Ei2F+7yM2hGRGZGWwRu2A02rGWBseEmQeSTN5iN5osrYhUyrqklRVQPMHkLF0JpYSA2m2IFEDDFy2XqWLQvUIjKSSSMXpNRLpHHRYuhGlmICpQVgKZcBnBfFbhvV+7I+iOJdjoEWXaIMwCRvqBKq4oMaDKiLuRWLvhnF0kiZ8u8Y1yM0DACIj8NKOh/xJQ8lHWi9OjIVUqBibVDXZwbk0RiQdTqNMXMcrktIVY6njYLpEVMAASdMgIYjUlYG+YeXHk0kaDGWrQykawY3UpQthCAVc5cq5bZtQKqQy48u46Y0iyEZ9IlYDyszAEnURIwUFaewUY7SEDz94jVWYlfKVAQsyyBmbZ2mutIBQEUfzDT5dRFmAzg/JzIAjSMsUUEIgbZV66FurK8Q8/UZArxBmIK+UJa3izbLLbNbiSSBkCbhgQxZdNotMqkyNaOatqsNfTP8AH+nDJcfVmMv4MP4jlgQAFZQkgjDRt5GqhpXszNj3m4nJV2gl/DA/CfS8pb4yVlLOhUljHdhCSSUWgcNYKI+RzcLAKpUrECtwszKX1aANa+YsGUGTQgt5C2pRubZMkmoAopiVQNWzCQ3paFIdyoNHWbYvIumtzXrMqsdUlUGcxDu3UAMqsAxoJuoIGjYn8qY9cvu7LB5SoCjV5tKNKpYNTAURIKZZKBCgUVZiuCYHOcOJQ5aATy6zHHIo6YayGZm1A6QA5VSpWiqK2hdJIAZd8M8Qc1xGSXoQ/d8tqA60ovtZBshV1xsSSUNqSGJAG9Z4iZzNzzBUdzl4JNHXLI8SldJZdg0gKrbWylmdVAtTWGOnGJZ0nZIjBFECiIGrqxi7zEoTYAaBShGDJ8QJOEseqAeLwvgyp68uYllCaGVZ1Y6pdyNDsKKR2NKAk0ytqAG/rPcHyWYljlSKSaSZi8jwJKAglO5RWFak8zOFempmJWjj7wTgk3EGj/FToRMvkazIenROodOirKuk6thHprtaFuR4GZJpfxpYlI/AZAgSEFowoVmMnT31BSFVT5w1ACleRroXHCvDqWBmkysZfSwR0nVN0BpwDqKNaVJJpvdgpUGjhhcl+KkB6aLEeHgta64mhidmDdXosqoslAAjqEEEFqJsEmz+TFQkPJsNTKJDI8jIY7LqtgklCS5AUqD5bK385v5dimy0kTq8iM2saKgZq8xKnQqkl2LICRqjvV6DDKIrlZ+i4LUsToSBqZpo1ZWYPMPyMUJkZWW1VbGtgQ1nzWBzn4ixEBzHplPlXqMJGbS5CEiQKLVriGlmJZQFNqjgPMWZy0kOWmWGPL9QRwvrYNJEXTRUnaQA+UFty9EsF82GbxR2MhTzF01sGrcM9+VGohXEbMfLS9t7Y41moS/DeDtA8+Zzs8bz9edITNJHmIlVNgqwgKFV1OtNIuOlGnfUa/mJp+Jl8nkoy0SIqSyENDHIw1KWWlYrKb1FFtjtsAbJt4feDWUAR5ArPl5WZJNPSknZ40Ymd2LdSRBZRCQotT3Api8c5z+7BXCNJEx6kskaoDBQZzslMSaVCQQyk+o7Mn5GcksITfGvC7OZbIwpLxv7rEiumYZow7Nqr8OGR2RyQhMZaQuykk9gVwA8nRRQNKeHRPFl9NTcRzchPVRdJdcuQQ0g1D4IgEOneiAMMbjHi8ucZoZuHq2XvVF95Oks3S1EqjCnYqT5UJLOaYb1gf5f5Tzj5vVmZcvLFErnLcJgj6hZCsmiNmdYeit22pnkBIU+XSBi7bapsmmk7ou83wrJvk9UsWazDzyrlfuqt05ZZydOtWR9AiktmLsygRBnLNuRy5f+zfP94SXMCPLwRxA6o85NNLlxHGYxDqni2jI1NJICo0jyr2OADO8K4wkisyzh3lEp+6sZRl10BIsuqIpVCULqLMhA2JF3g+4ZztxOVDeTzfTWEs95f8WTemtXZWf2AII03X5cTrqqKK5ZsXnOnOAyk2rKQ5dYlMM6ZuKPU+ZhmdlZlYRlZF6h6LVRcMt15STzi2d4jI0MuYZIMzlFXMx5dSCssGtpA1h20MChVoyDoV2oALZHcpw3iUOXljOVzLK9LDHKqzOkOkG2VdWiMGpNKrd1vqUjDm5A4Ikv3eSYPJmOkEdHRGmCE0XZWI06dUZRQd9gaLMuNKV4SFcKzdnPlzIwNLNm8lNHGmbUjMZfMJqeLMO3meNdKOrN1KIlYJsGUjsQ/h/J0GRGabM5GfNZeOItBnEZZY3TzBjJB1B0jroh/OEFk6RWr9xDloZcNnn0QSo9xtYfLZhUjIDNDI40RsaRlW2SUWvzhZD7SkUkNZnLGISTPCqQFp480rDTqoEMCjXcbKTJqoFiCMLlk8DQ8IOHOcmj5jLwxtMGkV8uIuqcvIisCQm699Fhto/iCmwA3IeIWThzc2UnQfdkiKEBXlUlUHU6ioCxVy+7bICg9dNeuYOL5hR90ykX3KFFTTmQoaJS4U9NAbdbs6l8wVjVAEHHvwl5ARJnlzJEkrAi0mZZCuoALMid21MQyF60Ua2FLecDqqyLzl3wtyiTfeWzhXJgk5HK5osH6aoD3mKmUIfg8q6lMZLnYsyvDnxGWRtFMXCga5wY46WwscJlsawrKSFcmQA7e1xP4aSycSlfMRxS5SOMNloTRlgcU2qPWtiyhOpmK+aMALRITvjZzjl8xJDl5WldtTPJGYWiDBKdpVYhVLxptrQ6QpJ1DYYd3J2xU/BqPiZDg623RLMepgOxOliG2YU2xqyaWu+BqDgUrE0elG/T26QBApSY4ixHkYAuz6SbHY6tWLLkblCGKADL/wCFIA51yyTkggGuo7O5GgeYh9QUgViRJxwFV7hERXZpFVdAYjSser8wWrAN6TZBLDAMV/NPL00gJjlWCOl1SxlfOSSAFRq0Akk9VGYaQBVWRMy+SZSErQYR5a8wAUEiQitDPJQZfMDqLD3x3lzBpghfa0EYQqDbBdWltzp1Nu4AoGiTQx3zWZkVmvyoiosZDMzMK86qANbhjQBBJAql3OCYo5szHXWkkQOyLveiRgAG+FzbADfTSkMTYFbSoWFajartugo0Rso8zBgd1oAhgwaqIxxlcyx9TpsKYrGXHmVGAYkqSpDGzG4eyPU2tDpnuI6ItTBoyBdM+hE22JDazGq6e6A6rC9jjGP3XYa2bVLUgjEYCtYcqQzWABoS9bgkhFNnzViYZ63QgVI6tuLJFm2Ao2wYKtkWrKd9sK7mTxny0GoAh3YawYgxBUAhRuWGsimZ1qhqH5Rcb/7j5qSLXloREjxCTW8iHUq+UFtRFiiApO/a/QFeyG6sak3GNYYHYhQ52ptOqyraywIQA6lNMDYoDc/eIZ6GPZ5KClW1G9FAfESDR3PvsPWhWE9ByjnZS7Z3NHR0W1xwkglSDdOYwhG3lokvTWaDYFOLcAyMS9OSSdvhC9XNKkpXcgRKtxFQti2NiqrvjXYygMfmbxJyiyFuqzsgKx9IDSqk0PMAwbe2aiKKoQdsDPEPFPiLkLlcnYLBet0ySP8ANI3wRqfjbUfKT64HIOdshk2yrJAwjZAJGZWMvr51L7PoJUsEpSB2+EYtJ/HDzOmVy+cnDgNFLNqjDg0SQgXzpr2Ie9goH5r1MPQ9czeD3EM8JFedXLafO4cqGABMQZNmVTVgsQRXlAGOPO2Wy+Qihi0qEUaZFIqN5BRLaE82tj5iGYFu17Y48eznMBQSQCOFGUv0omiaSty0ro+oi7pgg7+XRtj5kPDDJ5nJ5TOZ/OTPLKoaXVMkcSyEv+CVUa0CFQupACdJPlusN1tZBRQ5HxYE80GWyiyPmZWCrK5XpIFtn0QM2rQgt3tg1LQN1i58U+F9IoG4lFmMwWVHyeZqBSFk1MKBdk0DciRgWpSGG4xS8Z8RYmLZfK5WTIQbl5Y4Y9ciC7RZXQyBHBBU6hJd2V2B48S5myuQyrxycMzBmm1EZjMxs5aSRQqsJ5R5GClWZIgb7ndrLxirwW60rPHAuAcVz+qJLWMMFLSMEjKlrKgsEaQmrCDWardQ1mXyfzhl8lm3yv3QZl0mCzTSAFUCFtbQxqknRRdg1tdreu9IAPyPlM0hEkvEYeHKwLK8kkckj0wWSoFYJab/AOKUFdu+PT+PqQxSZTJRyZ6SZ362Zlh6Us0RtTHHHlXeVkIINyNqU2RtpxRcUmCUopbGp4meOU2Y0ZfJRvNISx/DjOYBCEhemh1WrRqGBK0tX64EF8OsrBCuZ4rmDlSzCQZRI1kzbMdyZImcvEG7+VK0WNUbEEAHPHG+JZGFYY8keGxzohmkjaXMtmaYdMPNKZPu9sDphjMTm9wQaKhn5r1y652MxLDqCSRtbAHdC5Ote5GxBW9vbF4cGCL5VHERm87+KzyRzwZOFsvkCQ0oUO7yqpYxtmZiD0x5muMMEY3evfC0y0nsb7dqxr/ww4zHlcun/T8oB940PPIzNmACB/hOWcjSCSVjkA0WxAtmu15o4Hw6WZRnMklAAI8TPlfjYekDoJRd7tbKG2AxvmjF1Qrg3lszJyL4my5fPw5y9UiSNI7yKX1q4Kya687WjMdiGY19MbD8Vpo5Mu6tJI7LMuYALFUnZ0eWSXpR6wFiZgsOvSqaV1WRePvjZ9nKDNLmczH1BnTp6YMmmO1FAHUAix0mhWNVZbcgVw+zXzzC+WTLs7dVGEEkpUNrVdbIkCLfVRUNSyupUDzEbjEeVqcbRfa7eUE/2bPELKqksbvEjyurIS4OtSpBbzEMBHert8TMcNbKZcNK3SiA2uZnVh1o1YigWALm68zSBAmoqGxlvm7l+TL5mTNpAyQhkkR3qalWjTGMBgJPiCA6EUqGG2NPckcXlzWUjnljt5Qzxwqx8kdgdWRmUkCVTYFUAy0CTY5IvwTmvJfz8WkZiQmvS4UIDuyiyHokKlMoou4AUDbzC+HEYx2kqm8zAVWtqcWzV/6gFbkLp7jUpxZSzKpWlCkvp0hbDk2Nh8J8t01kCvi8oxxiLhNTBWFg9PuRZ81bt8B0gFdtjuuGInHiMa+Z/MERdyANShSGayRsdrUL77gnbHefibC+mrEkx6tOnVouzoWiNyAFBIA3YmyuK6XiklSC2Zw1L2jVmrzoD2IjB7lmpw36TMtlkWNtFhXavKBuSGLvv8QVAWDFgusgCqAwwDhE8g1A6U17OoYEhSLY2LBCsEUUWoaxRvELJMHGv4mViyhaVbKsu3oWFMLYAqoJWrBwMQZ+RYzPmdEReRI44i4UQIzdOPUxatQ1KSqf+p3ayQoXz742wBpIstUsqhk6jELloSGJL2QWYatqWw521+YnCWVUG9AV43cpZbMZiYvNMwijiR8smbaKBvvDNBGhoEopBLEWAyo7OSAq4EfDjkjMZWFMuuX2MznMzyuqQtCGACa2KzFB09iCAAGGklltseGvH4Hj0QAZrMNIs2ZllVEOZlWYaGRGP+HGAwjGmRYkUCiSTg+l4OIizSaZXKs71/hIpl1ooGxlm7edrKrdItri8JNqvBKcVF35P3J0KwoXLB3kBYfhiOJBfaKMHUE2+JyWY76tNDH2TmAs9qNZqxXmdvbv5EWr7m99gNsQ+LQMxDSBiu56e25ojcE+ne2NKfTvj5w4kgKK3I2AOkfL1L/M/DtsKx6cFg4ZMmjhEs1KzaAd2jjYtQvvI+2o7fCKW7+IVg25f4FDECdgBuzsbO/oT2A+npihzXHEh/Dj+IH8R+/mNWi9rc3v/D23OB7mXmxj5AA1b6B8IJ7lj2AX37d9rxfCIh9N4iJuYxSg0HawCbOyL3Y/PYfoDgO4vz3qevMztSbbhaN7C/Qbnvv6nYYHuC8PkkFFtZJ3kI0xqP4UF6iK3O9sdyRsMHXLvCIoxqHmYXcrDcn1VAew+l/rgp2A/cO8PBmT1M0WES6dEN6Vah8UlbtfcJsP4g1jBXn8jGioqAKvZVXY6a+VD0/TFXBxM735R+Ud2Nbkkb+vp6jvj6c9bixuFNCx+3sCfixjHnP8UZUZ0+JXAK18a0CSN9mA+E/Kj3xfZTOx5iCKQWTWntRPuhH8Qo/QgjArxeU6VHfSSRt6kV6d9qo37egxQZnjb5XSVBMLuTIpOlldiCWX5g3se5Jr4jifYNF/xPIV2HvRI+IfmX6/mH8vUYpXjBJQ/n2v0J9DY2DDb/yoV2xb8R5piKpIpuFzepSTofewRVqNid+24+gzxXO6JAQbQuFdLvTq+FkJ30n29NiPXCNDoRvNevLzMgYdMsHF76G9dH/6Nu+24o+xwtuJ8a6c5jN+WTWu9g/T50T8iAMPnxb5f6kTMKLrbAWLZNwSB6FT3S9j8nGMwcw5rU6ljuoADe6rqAHv2oH5d+2FKIs+O8YHWdQdIfUd9t3Hm39i3b6/XCh47oatQplBVidydLECz8ht+gv3wRcd4lZjPqj9NwfzKxpT73psX7gYpM5kOoSv/rixY7UGC+cnaq31+2xBxtGB6DgwLpGtWxHxA1d9yQPh9SQDt+uG5H4drIFWWJBLVLIrlVFCkvT5mW99w1e+4xL5B5ZEdBnLkk2wU6VIG9epC9tQNWdxtWDjl/i2XaYxSFRYDxOXBYNdkElVRXCAFS3bby324eTmd4O3i4sCZ5M8M80ZZRLpy6QxNPLLKaQIqF10erl6qlsr3YDYH9y5wqTNsgiDPIDRQkCONAC5Zm1UhLKa3AJG1nbGreJcKyyKZ8z0hlrc1NUvTaRlXyHzK7so1ogC6RqBsE4XHi34g5IyiKKVo8uHY5s5OJQ8ylSsJVSBGEZdIYBWCk2Cdxhfk7+Du4k1gsvAPwzEc808itJLlJHH3lJ1GWXVGihYlC658xUzBwyhIwU9RWG4vL2UkZ2ki67ZaSJWcBSyPI4dCGEgZhRBm3IsX2IxQ+GvFBNl4RkIjFklEyIcypk6ci6FYwxBmml9QHDoBPqssQwW+y3D54NCxSdb7w0hmXMBwJU+H8JEUMhUIsZoOipqLM1FsQt2LyybNy8gZj8JCNhpUfPtg7gnBH9MLHwfzobKx9tQUWFsqCNiqsQpYKRV0O3bDK4X5hXrj2oZR8/JZJuSIO/9MfZsyO2I+gLt/THt5xXoTihMpOKZki/f0rC/5j5uCXdjv6fLfBzxqc+m/wDL/wCPrhW8zwyt+WN0JO2oE/Wtu3yxy8ja0Wigc4nmUmjZGGpWH/x+2ExyzwUxZhkp1WyQ3fUD2tvn++GrmMv3oaCPTC/4jDU4ezvYPmPf2+QPy9ccLd7OmI8uR4hYv9r/AK4a3DUFfL5YRPJOa7VdbXXYfU/2w3uHcTICj1J2Hr/L2GO7jeCE9k/NZ4Cx2ujdYGsxmgwbSRe/fY2O2CfL8KDAs+9n9q9MCvFOWkJbQoBv4gTqvfsf+C8FtgwUkeaijtWZlvY2bUnvXavpuMA/MnH+kGcL1FG2pQVYD5+hr+ffB/muADSRb3Xfp7fqzCm9u+APjPCyQSwDdwCCU29t7B+VdsbILFVzR4lrKBoVe1E66a/S7AH0sH29RhNeJXGaeN/RwUJ9QdyLHb9vWsFHinl48sxcdUKd2AQOhs7g6D2+ZX9cZ68TeaFZFeBxQa9LHSDuPKrmlBP8D6SDVE7DGSbHwiRz7zxJHEXDXpAsrWzA1ZvanXzG9iVOERzLzL19ztq7j8oZRSug9LXZlPua/LUzj/E5pXJIKqwVaN1foaHf27HY/XAu2UN0V0GyCTe2+5I9K/TF4rqI3ZY8M5feU6FIDBC115QAN9wD6D+v0wT5DJxLFpeZgV0tGQlJqPYAVqYHsTYrvQ9L/wAOODCXaDSoSleVvifcNsux3XsNxe1H0ccnhTlV6+YeHqtpYstqSWXciNGFK1GiSSEYEe+OPk56dM648WLM7ngnUQFTbM1egUt7bkEEAeoAP6jDp8LuDwS5eXTAonjUpqdCY2OnuGNsW1iqAUKDV9rpeWfDg5qf8OGXKKqjU6glF7bhXC6nP+U1dncd37DwqDJr0zINogDDIVHUBA0yXqQaCRq1gHdd2+HHLz8uKR0cUBE8pcm505kQqir05AZzKpQKPLek0ljUKARSwI3oXhvc5c5R5NWQFTNuy0xKxMw03I93q0j4B5fNtpu8Rm5mmzRMOQDPO5rMZsjRFEmqiiCQkRISdiGGsgsNTHbrFyBBwqMztMJ52BEJ6ddSUaWaOFZA6SIoALTiShdJuRjil9ss74vwgb4rwlYtOZzYXMZ/OkQQZbzARa0Edqqijp1KKs6TpChrc4+/aL4Vlspk4cpGx6oETRpLMX0QwtJrJUHpRM7sfJRZtVgLoIwb+D2Wz+bIz2aQ6TIIsnljAECCUXLmo06sch0kFYydz53JC0QqeZvEh81PNmplEuUyoeDJ5dggRZHloO6lmEwTS0kraidRiQGru0FnPgzaWWGXKXiavA8jH+I2YmkhqCLcNA8jI53dE0QagA12Syy18aUDzeFOd4lmBPm5WVpVdgxh0wKADIsa0SiUSqLqCK5YEuaJwzIvB5gi5riOqSSRrTKghJHjQKSkjOWMa6fM6mtOxLb6cfPELmLNPqgggaRfglMesAI7+RGd5BH5V0xkuykBBSiycXXJWtnC12dsppvC/IQkRSPK8aACTKoqKc3JajXPIrm44z3gjMcZ0UwYOQx8OfYo4GkXLTDpfiukcSoQY5GaCun05EagZJUILqiqaA03E5U8MunlmSRzHJJBqbMRslnz1IiagenGlqrSGi7KaO4OL/jPLunL5gx/h5gwJGokkdo1rsrsoRGzLWzPIzkuJEBDaxU3Jyw2UilYm+A/bDeOFxJlwATqh+7t8Mq0WWQEk6SC9utMbqgOxjwj7QeUzHVZAYzl1eULIIkZr1EwrJuWssE8o1eZ2sAgLmvIZGTKzdPMRiOSw5jko9zehgDvrDGzZFUN9sOjmbhGUT7l95jdEnt0XKgS5mliLqZUOnQsljplVMipbGtJOGnBaSOpqKyxcc4855nN194pUDtIsUdFemG1gHU25UNSk2RrJI3Ixpfwg8Xsq+SjM8sWXllnlESjQG06+nsrBhGOrqZSy6QwVtwwwteCczZTPZOJUyskMcLtAQwmkUxkN+K0yR7lLVZQTqMm7bKLVfNHAo5ZtGRyxk0VGxBJRSTXmdgAD2BYkkG6B2wnVN9WqKVGUTbfK3FkdSY21N5YpZerr0o8rMWptbNIGFRqdCRKTIRSpcvI5k0kjGKOEJLF5ZDoKsAqAEqPLsgWmB8jEFg4whvCPwuXJMs2riDRk6ZFXQuUa45VqVIgZGVW2R1YlHBBb4lLjzvMOVkVVdoZdCI7ak3jkWMGOlktnGoKkZUFlKsAPPRk6vDOOSrRF554Fw6OOR/uryFonVI8ur/eNLhtbMqMugyEi5Vsqura9VIDwi5Qz8sonyAivKSGN45CFiVdIIjY+YyfxSBmUqNLFhWGNz5xYAg5SWaPMSEyZiadXhZ4SylUYOkRcq3+D06VEtdi2rFBzp4xBclJkydMuYZPxoYwl5cNqfUE83WmtY9Pdo+5usXg8HPJDvbxPyiZQpNNHLmHLCb7v+Oi5trWtVKrjdgwZvQWANNjvCPHThyh45DmJSiPK7yRHTJ0tVmOGEVGiEFgAqELsXNC0JwjhPEBnIoXyzZXUXiyysgEMWoOzTLo1KXDqwIpXAXYAqpxpLg/KAXKPK5hGeBUZrNRqB1UWVmcO5U+WeDUjBdmJI/LWFkqMnZ54J4u8MzjIA8bOY1/x4qNEkPHGXQrqIciMFzXrrs1S86+LuVy2aKjLr94hQQ5aTSnlSY9RliII0WoUExpRYuPXHDxV8JsvKUIZct56UoqEPG5IJaNgFWRfi16QRYZmNEHpwXwniimhcSzssWqNopFiZpCrhdTTMhYqxD+WIOBRjB06sC0GmK+PncZli0XCUkZZA7CKc9XSyhY9ACKrx2a1SFhrAatjhrcJ8OGhzkcsUeW1dOOI5l5JXmy0bO6sIoilNI8bNG02paPm2Wo8GGS4RFAEMUcaCSnZlioHWNIBVTZKuAyrq+JlIQVeIfE8q3WbqEHKh3kZSSZGdypW7Uf9qFUOwWjZUkgeXCykvAYxCxnOqh5Ynj0Dz26pQXXt20N5RVvpDeXsQNPlB94GlulGU0Q6aZDGyKXbZSEmlkpVokKoXe3xX5fm+CRp1TXJ0H/ABo3j/H6CK6FobKPJF5dFKACdd1tfDkrnHLJHJFojjEXUaLJpKjShVAJ1DVIOs28qqjFk229hY/VoL4aWEkhtLEsQ2+ha1Mw0321eTzuQAwI2IwJ8X5tiyep8wWvMOKdQ8kbImgrI3qQuwAA20nyefVj5zz4iyZbKiSFZZjOQ0UwikKBCgkV5NFt5tTKFKi1FA0DhZ+I/Ccz0nz2beF0JiKqQ7Okkt9JoxpVFk82uip9S5JXcP8AAUvY72J1hHABC9UtuHHUXUXQEKjadNaaawQjK16h3y/DnL2a6ZSmvyCvLoZDQZW0eVlfUtA3R0rgF5Y5iAy8ck00shcCR5M2h1Fl8qxCICPSspDqTGrg0pa2IJ78O5+y7KkkkmiEzPEqSFekJVAeyFo62C2HYhUYlSL3wFL2Dq3oBfF/w9nGYhzGWQO0ocuY2aMlEUtI0pUBXWRDShzq2ADXWLLhHMg6ETu0cE0bBEjbsyjp3pZQxkZrCNGSQAKsbkMTIcT6iqoKkCMxvvrTUf8AEhdEJsorBgXa7Xdm2JpV8OIVmTOEksgK29KiowI6yRuoa4gdVK4oEbkhSD5tBvFMFuYOYIHgKRMqPJIszBdSGMIulhCVLAuCSAhOpAKAoUazmrjjSyxRxvFmZ+xcdRXhVNJ0Tm4yCyliQ8YBugNTKSyMvwTXA4GX1Sszr5Y1ZANY6iIEfqMh+JVLVqY+wY8uHcOkQRgovXmWSNmYLq0KwaMObEmzKANTnyMmo2uB1YU0QuMu9h9UipuzH0do0VOkoIYhVGokhdRQnzEqMEvLc0qUJHQ+YlX1G1mcHy7imXQKF6grEgtRAxQQZpmSNZBIryI4bWQ4EocHpSSEaGLFWo6tLqhjU7kCfBw9i0cRuWJbLGgFe1UoF7kyAAanDMFiGkjc4ZCMpvE/wxE6UI2bMqhEZamhlo3JG1WAgA8qMiNuDvZx+5H4j1I1idUjljPQkSLeJ0W/hYbdlDaSwZQrdxQxY8zB5IH/AO4OUiijLSTKgZiGV/LpLNdMKWUeZ6pawMeE+TkTJLWXQzyTM/VzDiDVGzBRKgVDKWQUFCgBlN3T2M6sa/qEXEeC5orMyKqzMgMSs+qHqKCUMkoUE0tM4UEMAFBvC78XuF8WkW8uyIGjUDMF4UjVgNiSzNJ6N0yqOzEglRg28Sua0gl6ccUmdmGgorlmjiewAhiRCokqMksACAfMQG3D+F8uzZojOZ7Mapo/JlslBLGI8rM66leYprCyEMQpOygG2Y7K8cOybugB8OeUI8nIuZ4tnWzckUpMcHTzDJHMwEjyRyuiKZAwqNkAjsmxYXFrwzLzy5KTigz/AEmeTNtDE8fVErI5VUhUlmLKFt207EPvS3gj8dvs8rNBCFlaB2lW5JmkePS/cCHU5QKfidCtMo1bHBRy94NZkZARvLHLnSCiZvpMPwgAnTGkg6Uj8r9gXGshqrFpNNX59E0qwKTlbx5OiDI5j7xG5hds1mnfRN1HRiwhZVLUpKaWI/w10qATs/fD7niP7nGIWlESokPVl1swWPu8rMC7lqFSldI9fcKjgv2f51lijzMiynW0odFJi+7CQK0M7miZHZgEZjSKpUXp3f54PCiIEtIw1geVVjAB8rIGF1QOxBQEkAgi5S3grij9NmHuBI5EKuVZmWmCxSWrhCCGGvT5ZPOEANqSQMcuPuqyKNBd00hSukuqj/EollU9TQhujQq6vFjBAIjHpXeNjTAEeV2LOVWvNY8zpv8AkII3OKkQDU5KairVpTzDS9tqr8zAAagtMF1be62Ahcy8rR5nLTwSREQyNrQR+R9Vqx0tZ0EyqWU2AQzXYNlT8T4umSngySRR5EShmUzswhqhFoWaCtM8tiSUu16tFN5rLiyLsJfOQ6qmgAmxZN6lB+MEFSexWthviBzn4bQZtgJ4knRVcwqy0FfQSXDMTpZSEULpAUEb9ry/IGIzxCklWEpFl1USytBl8zraV83oCltLya5nViNAkbSo8q9wMPLw25NzMGTj63T+9hG12x0Rh2Aj1Mn+JUY0OQpLHUbAwseXvAvLw5iGRZZpFy34iRO7FIfxElKQBywRELabSlkZADXmw9OHOxcqG0CyTp3WtVBz6GwtCLynXfcE42FoCsjuztHQkAB1GRmVSmgBOp0zp1DcAC7q6XsSPnH+E9ULEyWBeoS6aZQgdy1A7M27qpW0OmtmI/cYz69Uatdm2CAAqWTyqJpCDGobS1R2KAAKsSpFJw/heiYOzKw6LBDJIyKo8nVBheo5AwIZZj5lalK0gwzCS8nxaMqHRdWhlQEaQsZU0THTCtxojtDShSSQScQDzsrZzpIqM7JKVLoWR9RHkjkBIEgUbqSgVS92QaqeZ+fuHhgdcbsFpY4YQxRnAVQrlem0lgguB7Ae+AXjPNbyo8UMLx5mZ/gkVgYk0g6ogdAiZgqO2ldiWazdYm2kUSbD7m7myLKQv94YxrpKxdIvqKa7VC7As0ivpU91KeaxqY4GudvGGBss00ZSYsqkLG1TQOlshdWKmMRsqE7NZBHZhYVzDyjBl4j99nmzEqBX6qyh6QUTl1j1EkuQF16trJCisTOWfELhTINEuWykjAM8fTOczZ7tsNLIXN0UqyL1NYIxk29IbqTeJ+KHEZssBHFGhnMapLG66zGQNfSX4/ibyk+/qBqEPhnh6cwseXnzU4eO3zESS/eUJA8vRSjobykeZmUb/wAS4o+LeJrZJZJ48pMc1M6fdczmVRInWQLpKRRaejI4+GE+exQ04WHiNleLwh8xNl81kzOxWWRWKRSBr2pGLRknujMNWlaG2GjxuW2UjEcHEs7w7hDmN2uRwZFadDNPHGWBC9GFAgY7t53phRs6aIefFfPZ/NMnDoI5nQPOZHITUhGm3jLRxxsUFdPU6uxqho2z7kuE5uVWlEE8yDYyrHI432vqaTZ8u+5qjdY3H9lrkT7rkUOYCB8yBJGwL6SkqKRDN5NnRbYAsy7rp3G93xxgr2M2ooAsr4PZsST5vPZh/u6RSnMxIZIBHGIy7vC8TvGTAx0iMCmBJJO4x38EuSuXM67wQRyZjMwnqEzmaGSSLqDzJXTXSjMmpdClCV1Ak3iw5n41xPL8UfLxo/EOG5jRlinSbRCJAuuEydLS/TVWZ2e1KkK3mQWa8x5Th+QzMOenSPKSp+HE8X/rR9PQctoijCThVqTsrDTV7YOFv/VHP8kpaCDN+FOSeRpcwkmbkQagcy/UABOikUuqoALAGm20kknbFJ4oeLmX4fl4UdwoLVl8uV1EQbVp8shQKPKS+2koNzpwpeYftDT56Zslw2I3mmCJmXJWXTR6oKkLojEYLWxLoCxC6iLp+Yvs7PFNEJ4JmeNYhNOJhLks0KaijuDNFLQVViGkaqphs2F6+yyg/wDIOYPFCaHJZqcR53NLPq+6rJkBDl8pI0bFpPg1PECRvShtKlSNRwM8h8ozwCOVI8rNniEk6LBJpI1FkzuwzASGMEKX1hWoaRfYc/Fnxrly5TJ8OlzLZltKN+LJO2WAH/7MizIX6hJLFtWlUoVspCoHBs8Mtmos++ayse7iIssf3mc3q66srNPGAdyWOjUx9DT9O2XgKdKkOLxf+0Q5iRHlykeZy83UMQDZnquFLKU0iSGOyQGLSBQLW7N4VOT8JOK8VX75mMyqI+sxJ5m81XoTLJpSFCOzCzSiwaBwb+A/CeC5UvMSmfZUR2XMxwwvkgCAxp5AjqxNWgYk6QAboOrjP2iuCzh9GaghcK6R6klKqSm0iqygPvtoFH0B7Yon0/qv9nNK5bMM8qcbyuUkVM3kos4IpmMhEssbkEBXiOkiKaMMNaB4wQ122liA4eTPFjhUBzEuWSThqTMliGWTNyMo/wDS6clmFQWZvKSrAaQ2yDFbL9lFDTz8SijkzGmSFDAVecSEtrRWkSw/dQorcLfrhQ8d5BeDMTQ+aQwsbGjQ5SgeoEJJogiqLVYxduM1Vi009G3OAySyZYSZLiZzBYGTRYQ6FHYrIC2pD2Q9janTV4qeD+LPW1oNTh9QnEmWjYGQgIwdynmVmAFsQRuQTucJDw5+04MnkYuHfdIMxl+vJJJPmndmVZ2XWY0RR0dCiyyu+ur0gkg6CXwmUaZcvmXljmUdI5fQRJEQS7xEnS+m6XUGLbEGzWOGcJQ1oupLyXXKXh9lMjljLl0RM0OrKyLm5E68mg9NWDO0RRPhVStKexXGcsh9uXMq/nyuXkhc/iQys/dnFtG53j22KMkgB3Gnths8Z8F8l05DOZ5HAaUJOXhMXup07aHA1WuwY3VjAv4Cc88InzQiy/DESTp69c7pIw6em+kZFOvcglfjYBjvvTcdZclYZ5WDVZmM6gpLpglhRxI3m0IU22OpHmZS2kMQqk6ipqmyhkc6/DeMSZXIMgyoj6uYfOkShVAJkdnUI3mbSojivWxKhdIJDJ8QvGt8vNlspLkZjn5MvG65KA6kTrF0BEuuqjVNBYR1GS1gEagnPGPmFUjyyzZWSHigzC5zMNmEA1oB+FBFIkly5eI0i1pFrIW1M7YHHFrDWGNDBoLmnhWYzeQiMTuJSlvlATCs0ct6CY9d7fELB8oC0D3JvDbxEnaIR/hxLlwkWZzjyxrE2lhpjhoIzyDyRlSVRNXd2pTUeDHKmpMtnJcyuZn4jl5KJYqISRbRIqrqK23TQsQbHl09ysEzJg4guUikiZMrmda6mmGVSVi0jo+qw0iA0z0yrItDzasQapiNXaNfcRpQp07gEx2zLRJYV5lY6qsUNwm/c4FOZs7MsGpidSlDoFwrVodAs7Kx1BSLaXak3VcTeavEKFSAdTyFgkSLvqDqzqxN6gCLLtpJEY2UkqDVTFGSNZpUnmieF5C3lXqh6QRRKCulGHkd1JQAFmZsZqyKwT87kaSMamDhzI5JAjMhBLqyEhTqVvKn5e9XtgS8VvFE5aECNJOvKXjVE/EKRnzNL/Ap+ERoTo1abJCtgZ8UvHqHLOyQI2bdRKzCN2bQ8p/EaRt77VSL+EpXt5cBXAvGKRIMxNmFtA3kTKF2VIiGOiSVyr7SklAm5KsW2XSER0x47yQ+CcfhzkzSZqaaSDLRgrBPm1/Eb1dnTRujNqdEuyVXYDfxkOSTmYpY8rlQ8zVomCsI4lW2PXdwU035W3LmioGMncscxFMwqhI5+oGjEcqnSDMAFYBDQkQ+ZL1AEb++NQ8k8+cVgyUWReGaVI0ZQcokjPJHdIksulFjUkm221ruWADEUlxVs6X/AOIc+GXLuXy2azExkyrTxmOJGgnJhQMB1l1FF6UeoapCqmhoVfM+G7kiRFrkYOzDu1jcN20MSFF1oTzFU0k2ReM7cO5YnlaOPoxmdniaaFXTTk8vFKpPUlW41aWTQAAJTpSrJsF0L1QiNIweRlJkK9l8xtIlAUBb0jWw1yaSxG4GLcWzzeZfkjcQnDMWk1PfwxJsDudyPib2Jal/y9scn5m0WzlY9I1BVB8gG1E7WxNAADbsBfap5o5nSEO0jAOLCrpBN+lhfzDuqA7Gie94ETxdmRAxKnUtrqBMdfDsO72WNWQveyRqx6UcHBVhTkuJO51ElWPnC+qL6s+/lJ7nVux27Y6crRiZm0hjGG80jm2cit62AWz8K7f3q+F5AzeWikZOyW3Un93lY/DGO1A6bNWxpcNXhmTjy8d0F07haskt6e5Pt6km8UJsnw5EIoHwr6XuT6A/IfIbdrv0jrnDK97iGMmgPzN6D0pQdz/EdvQ4oZeKO50saJI1DbYm6Re+4Xfua3JN1gg4yEihVFIUVbH2Uf1LHYdzdnDi0SeG8RBl33Gkk1vQ97/r74gcMzLSSSMpOknQtEmrosSB7EBRW1X73ihyvFdKKtlWncXZOoqOyqN6tSSfQDufXBFwRNIXfu7/ACLbGgb9B69rIHtgMai344Pwif8AKKrvd/1GKXimW6kNEXt32vcWe/8A83gg4lIGibTYrY+5II3+XpW2+BrLZ8KKPZxTbfC19+91vZHoe2JMKFNkOZzk5ZIJbbLSiwxFFbNHvtqUjUDYJ+d4uOYOYwvlJEmpajbcBtG+nUt1Y+EEWpOxAAxZ+MPKgaPUwO3dvb1u/btv3wmMhxhlUxN3QNqQ7BxuVZSN7GxVgQQBW9URYaGGOKpKiMjuHuirEUGXyst9m1JY+YogWuM5eLuQ6PmAtdepCRuVsAq3fzD4W/8AzeuDvlzjq6D5tKlipJrVCw1FT/mHo3upIqwMCPPec6i9OUbs5UH/ADiyp2rdvh1eoIJuxgDC74toNsFNsAQL2b1Km9wwB20/I+gxU8Z4YYykgk6fVZQyyKNSqVBNkXaWLPb099rDPZ+RPMiUqim1fEAPkD6CxqG2IGW4cZyXml0qFJF2QnsKu96uhZNgYm2XjEbXIXCYmgEccySTKLVGZQtnSKkVSQqG/jCswYWe1D1zfw6RhDFHw/LtLNrJmiKmKORvK4DBIwCPKwaRihJ8oY7YEvDHkjJmeBmkVpZdDwxudl1Ix/ECXZsE6WYBQASCAa0bkuR48unWWGHXHGXEUZfWXkJJGyUdTUYSFIDldzuRwTqLPRhgUfhpwaZs1HkM+QcvApn+7qRoo+UESJGSop7ZrBRbC1qwR+OEUf8A27Rxu8ME4Q5f7o/3eZ42purmrubUpEYj0awrC/gOAc8g8RzGekkmV4fMXmaR5UMUcYSR0Vyql2SE2i2NRBJ00xGzcrxKNMvG0QCRsI9CXGdSdOMqxBDhHLEdVmksg1ZJrCzaTtHS5dWhEcs8yTvmcuZ1bLuqu+X4Zko+nMyyITEwLPD5LLBl20qmq4/OSc8988SwRwj7vFlpmlpFkzBlkkUArpj0qZEZ9ehlR3LkykMSu5DzRyqsjdVzKssYX8aIgSFszGY2FoVHSBYHQdTKGJoCzhSZbxSeJXgjDl1kkjOZkkE5IJthIS2oLFrAXQkdMxAJAvEnIi/s7N3fZ+z7fdk1BkayGRixKG9085LeQnTvvth78Gm71ucYZ+zXzVmhChzLSOJFaRCCrRoqOI2tqVhqe2QEG1BomiTs7w54iHj1A2D649f+PO0eHzwqTJvF9WsD+mPLREfX5jFzn85Xar9++KfNZ4+rX8q/0x0M50im4pndN/m9x6/pgO4hwdZfMjFa70KZfmV27+/+mDCeZNzpP6d/0+eBvivGGUgsKu6krdavyuN9qHft9MRa9lELni3CWF0aINXfxD37nf5YzV4486tlpoUJ+Msb7DynYHb1vbf0ONP8XzxLHUtX2Iqt/fvR/ljOH2p+U0ky5cA9RLKNSsPmvmKAE+h1r8u9Y5JRTLxdDG8GOcRIE37i6vGlOA5mwNPp6n/nbH89Psr8Vl1fiBl0dgQRZIHa/QD19fS++NxcpcWLDy7D1xTixhi8ntDEy/EzrCsLU9yPhB9LHzxN4nwwAeWt/UbUf9cQcrmCQoGwBG3v9cXWYAbTtuN9vb1x1x0RBWbgzEHU7bHt5f5eXfb3wKcc4HfrYPuu/wDKjhq57KWt9vf0sf64DuKcE7hWIPrZvt6f8BwGqMjNXihyLHKrXErsO2mR4nv1F9rPzFHGNvFTweaUtpvLML1CR4yJR6eZGXzCvzRj6m8f0n4hlFohlLj5Vf8Ab/XCU8X/AAjy2YQlonJXdWVunIPlqBH7NY+QwuslFqj+aUXhnIslKJSaNEpSEf5GDG69BQs+2KviHLJ1Vel/NdnY0fcE03rRv+mHHznyQYZnHTzEan88jxhGrdSXXzWN7+WBJudoYDEIoopnEwJQDXIBuSQQaBLiw2qwAAQReFlKV4KRiqP3A+C53J6HVUCuVF2mktuQGLaQGX4viG2HPkucs7BEplycMurzSGLNxO4VtNs/SaXpJJdszPo7g6aOBhfE3MZkrHHl2OrWWVlVtFlmbUzgAVvqouBtpHfF3F9nEOqjU0ahCs+hQscrEnQq/DJpTcyOUKjdvQ44OSUf89nTGEv8QozHi9GxEWUL5idiADEXIjJBYxar0vEAAoOkUfi7YgDwoz3EZY5s0WiUCukPKViRbIiU7USAfMfWtJ2GL+Lh2U4WWmOgERMmiFiZmHlTq1q6bwsdepw97AHdQMCPC/FbOZyfoQpChlLIo1aUYBdRXqFqVwimyKagasm8cWW/qv8AZ6EOLFsNuM838P4fFmERoyDoU5TKMjTyktq1ZnN2TDS+VgilqDBSdRXA9yp4c5nMOJ5J3y2akdnysc7TSvl8v3MitKuslgKiQLpYPvpLimbyNyvlRJlQuXhaLJhhmZSkRU5rpXHEkiPbaHkMp6qFY9Kgk+gp4veL/Wfo5MrLNJpRpQdJgiTzanlUhPLuzjUqIShN+UYCTeEWtLRV/aC8YLX7ply5maRIJnEhL9NajKw+WN9Uig61RgmhQpNi8CPAE+7v08pAxlC6ops9KoSFlH4rfd2DBpGaQeVdekkVZSloZuV2iYpBpk6mgNmnm6ykI1O8bAuEAa2I0aaNkvVYbGV8D44A0pzHVzyLJJl5y6pES0rJqIU6rUigpDMwtlRVrHYkoKjknLthABkuYmaRvvGfnmliNGQRSSrodijxo2oKFamLuyqDrFAEVhhc38I4jPl4ZEnTIrDomVY4ZZWZLOkseqqMIdWoIYzrI2Zh5sVa8vZWOBXzOYSRI2HlVnaCRXLKBH0Qss5QqzuZdAqqB9P2c8a3zGZGVySQwRCPqzS54sVEGXpVWKMdRbg1Awg20t6WAFnCxdu0I8B/y/zFl+nPmc1mR0kZUESmRBDW66o2k1yO+nrBVOgdYbNhU/aL8bYJIikImjdzG4XVoCAilYqNTOXVVpmbULb0oY78o+GUGYZeq8k66pAAvTjjzBJbTqLOJK6a0SoQAmOOzqBwa+JX2eMtPPJI0sisKpFaKk0IEBcy+Y6KWljLKPKoYFsaNWrLR6xM+8vJAJUkzdZpyfxDKLWmC1eokOa1HzbFgpNKKJlx3i+Q4lJBGv3zKNlw0ReGSJnmQj4p2YBUfZI42XyRKSuk+VcMLgP2WMpDNHJJJmM4AzTLl3jROqgiUwmRA4Jj6mrqgspdunFX+LhG8J4hLkZ57ymkuSZhMrhYDrLRBWUlRobsh2YUCKBxVPNrZV9eQtPE7xDUOuXy7y5WOMQwqVleWOWMIiESxBz5jTdV1JErXailr5yT4mZjKZqKGJ4jl2ZVaOYRiCPVTMyuQxiYnzB9yu9q2Jv2cPCIcSzWZeVomjijZW1FxcktshRkFFoQhLLfl1xeU2MO3JfZ34aMzl2XLOYfxQzZmdn60sqo0RlhZ2DRBBL5VRSGZF6ZotjS6rDB2jG4jnSfZQn4eouwGpyGXVIdQVthY8+lEI0aXBDNspPHriyOkUqu8TKWTSI3Lq0JRj5AAxEYLRidiQXCjSCdmfkeHO0S6EiV6jkjF2upPw2PlF6TEAmkBtMYtgCbwpvEbiMmdzSxpBMWybnXKNAQtaSOIgXVSCVYCgXZtOpRqF8jfg5Vs5T+Hma4lJFm55JsrllVY4FVdWYCPGzCWdmUKszMSShR2I0ihRs45d5Fy0ECQrEilA0LTyhTmWlNhnEhUEk6iLV/Ki0oXSMRovFBWgYpJ8AdyumnhdWESmdVRtIYDQNJYtISTsW02Wd8SMhIHSGWPrSsqAsWSNZ+7vqUhkjBCqCQv8O2s4ZyvTB1/B24LycqalOYllj1AyJJOZAp81SJKaZTJdKrkr22BO/Lmbh84QiN4SiM6yFohbxxGQjXEikExFiGKr+JerybEXoy8uhY2eP00FmbUURkPXplLaSQ3TJtUGhSLoipXicSSTJJLl1UyHMSLqGgJbF0dmJk1mlACNoBX4Qp3X9mr0T4snFK4Dl5WXLeSQwqxZ3sJJDVhQEoChpJo6jTEV+Yy00SOXRZCGkKDQEbLoBI5DL1GR5LHVoELrYnUp2NVw/xbgggKxzh5EUmKOJAY2UrqQanJNot6gr0pTbTdY/cR57zH4LJlWlE8PlZJFaMo7kuJDp1B10nXroKaAZhak2jdWXnEM25EYjMchfT93EjNKqqUU6iq6mJaiyFWsuQtgBhifP/AIp1qGUpbMdSBHQkMgYuKLJSldICtZN1qwAjJcTnaWJ2jyUSkCA5dIyppg6xhyxPSsjS4WMhnF6R8XLmXwlzWYyzxZiZswWZnjKySaolVWZT+EArly1E/GCCEK0Dhb/A1fkBvFvmA5meQZKKcsEcdWLLFARpZGVcwxjMikfGTavVBSQDhMHlXVFHqDZbM6DJGrB4jIVtSTqZfJIRJ6UCKoggYfniDns9k1y/UkjzqF4xSp0yIl01FI7BXXUVW5AFcabI8+KPm7meTiOQLaUjzjuEjVQWVIgQJPxenJLJM8ZJlsBI1DHvjJrwVjaGfytzmY8ghmqHMrH0445isYZ18urQrIRHIpqPdgvnJGFnwTxFzBExzuXXNLHKJMv0ynTXMKF8sZVaVbFI9avM2nUBst+BeGwfK9SabUzSdITiWShE3qwUaiFXS7SdIjRVGg2GhlOGvlZcp95lWUJ54pVkYwL09g6hFViR/FMDR3og7CT9G6oIOLcwyTmILlo5ojHGxLussqTS7yKrudEhyxDAJrjNkLufNjinInWy8McLh2jnZlaWARxsfxGAlhjMivV6jL2YHTYIwbpy7lZWkYZfV1Bb1IArrayrKoEvfzB3NITQAprGPfCgsavHIvXhUyiMgVmD5iCuhWI0gJoU+WUkx2rFg2Mo3sRy9Abwfw4EExzMLLLJSvJF00EbMaUwRyBvwtiCWOoL5SaF0c5XNCpGadgHWR0j6RJiaqlVxHYfY6QpGm11CgQTbDNNL/D54VYN1AIxbNpIYfjHTWo6haSbnYYHn4IAxlWSQBFBDUGLLEVanOkLPHIKOgaGU6mUgtilUTbsvOC8ahQWjPG10qTWistqbAajGgRfw3UL5TRHpiJPzAsxFIJgWjRJgA8rq4ZnaMFTQjBEYk1FS4ZfKACeJlVnQyD8N5FIkNajIwBi10HTpsWEcZJW26aN8RJiZPkAFkCEIAG1RkjYyLSsCHJ20jQqEstkkeoNi0XPNDxRXZMjFhpj1LIh1g0CGvR5iLJ7V6+Yn9kZQ8dxh2AihZda+YSyakZdmGpwFU6dSqNIA2Y47iJF0ajLI2ohJNMbV0xpCg7XYJUM6nXuuzKt8o+Ia5Q8KIsKKhkeVmXSW8w0oqyJISG1uGZdBJC76sCrMV3MHOkGVhBzGllcFUV2SKQvuNBAJ6qKgBdj51u6YtYR3jN4lSFFkhzMKqhjC5XLvIZaKm3Z3FLpo7kKCFYUbw4ubuQI8wsi5kD/ABNa+ZldIGRUVIj00UylBXSJN7EfEBhe5/LcNykckUsoKui6Ypkd380TK7VvrZkEbgxsVjNqQLNah40UPglytnM+5zealnECtqjhLyQCd1Qks0kboWUBjVr+IbXsKw8+VuRUy73CB0mYvIgYgo7101FPpZY11BVYitZKuaoITws8U+JqHnmEc+REDGOCNY4s1lkQmESQRvGBMmqlcNI34YDrRGli3kP7UkeYmijzGWeNTBD15ifIMwLBUprZFyzrel2YMHOkKoNijXoVpjCykkWYyyZJswZpGHmaOciVlEjfhpL5nDqLSWm10GN73go4bk5BqQuvSQeRUZhIgSwysWapNYGrqEh7tSp7lXcq+LS5rNyZeCNmjukkKL0olEZk1mmZxHISTFIaKsVA2vDIz8jBhpcXYLFiaaFKDqSQWG1gdOjqVWqtWFsFHrK5nzs2jXJISmpyaKLYAAPl3bzAAHdjbLsBA4BxVzKyygHUV1eQKikUTQ7kAEIGssCpGLOTj4cqRFIzFSRI4QQ3YCqWDFkogebRvuPcCMWRFDNdrESxA31qCzd6JZlY0FG+oDuMagFnmc2HbZJUBAJBIirSCR3OonygXsexv0xRCFyzaH3OhQSSRq0k66Fgha0ki9tW17gg4rJelafay1LqsyAFe2oaQQOptYNel4GOe8/FCr6plg01rKi5I2lU08akNqEmok2KUkkDAaMi14fk2Zyd1pGAjYhmYkDS6m9St5gLvzIFFkisdYOJedU0sW3U67PlawQvZXCKt6iQH7eY1SXzX2hUSYRZaPrDYSNK3TLmMErJpvazWk0oY0mkCqFOI/aSzzhxBFKTJIkj1Dq6SmILojJARgSrSXWpdUh7VWTvQ3U03mcymtW6OtSjLpjrSNJVtMmwdSSSwDak7iro4HeaPEOLLRu8gUjV5I0ZSWI32VHrT+XUw22bfy4V3DOFRvl1lzE08ckv4ofqUqxn4ldFLOosAs7KRrZewbF3y/4cZJX6vXabR5yE0GJ4zSsrgsWoMw1/nqyCAMC29IKigV5q+0BI5d4U6MJy5RjKQyxyl/joak1GzGtgMK1a/eXyJws5xTmJyc4Y9QijOrcmgxkm+FY9R1UtgkdiAAsvxV8QeC5aNWZoTNliayq20k8RcoIpkjfTaG5FaQME0gkFZDaM414t8QzKyS5YPBw9CMu/Q0BIzJbIrP5TZU9lqP021DUVxt7KJY9D0m8SOG5OZkzAyUOYQkL0D1HjSl8jBVtCwNAqdWxb1OIrfaQgnzBbhuVlzmbGXfTLIEVECkn7vUyq8jC1KksrslhSwusu8D4Lw9p9c08seXUo6JPEsUsmnSTG0kbyRgM2oBwW1AfAps4Y3HfGHLATSnpyyK8QUR6VfUVtWUEUyIAyyNVbJVHFXx1hKwXDw7A/mHxoTMZpvvmUuN16csEcskDQtdsy6gHEnp05AEBoUtbjnhhx6bJZ3rQFVMYbVls5oRs1l7FxhnXpmTp+cMCigjWCVtS9/EiXKcQVlkgZJHiDLNFl1fPzTkFo0pU1ShkDaorDfCw98OPmjlGWfIZAz8OjnkQxxS5aWSP7xp0dAs0qlVXV3ePqs3TWiGOoHohNVhAnJUIzxc8QuINxAGCRIsuoi6ES9JlMfT+OYaSJHRy4DBTQVaurJyn2swEMPEEjzkbIpKxBJBqB9YnOg38RLUVYfCBeLnxb+y7lZ5MuUdckVAjk6UReGTSqae2hY3KgorrSm/NqIU49ctfZFyMCETtre3XriWSJtyHRehZhcRpqjYrTPYY9tpNxaOVKV4M887fasz0iSQZVY8jlm/w0iSpo1HdElFKquSSwRBV0reuNL/Z+nXM5fLv0swtZZYpEkcS5XNlFN5hGHV6U3Ub8vRkNaXQgRthU88eG3AnidFzjPnVPThRArNIzHaNI1WpLHm1FtSgVd3Xbl+XM5dYeHZIf9NSd2OZE0wmzusqEaeNFMkeW8qG11qLcEBCTbOUWqOzo5Ibvih43wZEpH0zNmZqeOJCPLZ2E35UKkV5QsrBjQIVjhMZvl+WXNxzcTkFybrlzcoy6P8DIrEJpUb7Bxq+I9qMea89Dw10i4XFHnc/mnCTPM0mYzTOKGplLBVNmn3WMKhc+UMcL3mzx3bJNMrmPOcTDaJOrlBl4ske7KgS1n7KGW1V921EHSZKDl/UoqgrOnOcH/SZzrz6ZeYiRwuWh6s4RwtRlKjESSfEjNIy2pra8KvxA8f5cyIwHzUQSMLKy5ku2bnTZJzajoKR8cMZK2dr0hsL7mHmd8zK80jBpHYs7AKAT7BVAVQOwVQABQAAAw+OA/Y94jJksvmoBBmFlqXorJ5ghoxlGcKjlwSHUMpjK157sdkYqCySb7kz7CPJq5riEuafMlXygDfdwQJMz1ldCzMx3iSqdQCzMVJZABr1ZzLyZHOzjNgyKD1SrZdZKjfyldTOxRKIU9i6n5HGaOXvF3iXCVy8Oaya5SMSsiZubLg6ENh4lkhIDlR5tKuJHVfMHABBv4F8XzmYfOxTZvWuXZXjIKtJJFINZXV0i/SaiE3DK1rYoHEeV3kyh5syt4peHeZ4fmJ0AqGVpUVlVGVodQIUqNZhry0GKtQBDEXit5O53jgSRHyeXzLOysssoYSwlasIy/lNXpPrvfoNBeOXhbmeqc0hVco4RMskEryaU02TMrA+fWzMxV2B83tuhpPD2eVZpArO0Q1S9OPUgQ+bWzKaDFTemrIs15TjojyKWGF8bWUMXiPjXFxAxxyZVzLHGRE/3nUIlUXYDoCFUKGNHVtYN2cFfh34b5vMN95R44Yo1VPvMwTN5eWINoYa3KGkcbAyoRuBuRhAeGfLcTcQgjzEy5OJXMkss9qqpEplK9wQZlXQhsAlwd9lYh8avFNMzmXGRWWLIxwiJYEDR6lALSSyRgkU5NEyflCFgCzWHxZ+pHs3sYfEfs3u/ERJLmcnLA83Uk0RzLCyFqdUWFpa/i2mJWwxvsX54UcnR5SOgHpJSIQ2cJVYnclfu4cBghWi16TYGone85/Z14bBlZ2kbjGRyw8geE9R0kVtJ0y60ghLCypaOR3hcaiCFpo/2u+ZUzGembK51c1kbjURoxaGGYIdSRWAJYqGpJQWFsyWNIGBKEpOm8CtUO7mj7RsMsue4fm+H8R8kM/TdHD5giIMLQLpAjK0VkV5UruPNtl/h+S4cXR8tm58vKsmrRnIxEwpwAFny5ZAau7A2sV3GNF+CfjjFmcrlcsOok2RigEkzhWeRQNDmIq1sgY/C41aaJs49+On2Y0nm+9ZVooY2MZcTGQF3dhpYFFlB1CtgF7b73a94xfVqjKzQHH+d4B089PmcvB97hg0mWULGsIuSOGJNWpxqeRmZWGt9PotYyr9r3xwizs+XiyrQy5aKFLaOM6+sNSkGRwCVGxCITGLskmxhf8k+A/Fs+2iLLyAojAT5jqxxxRxk+TqMrep0osalQfbc45ZH7OnFTPHlxAWeWUw2JEmWEB9BknMRcQxXqdWdlLhWoEisGMYxd2XVJjI+yx4tTHMx5GV1aOZqTV/6ciq+gRtqpe5CgaVUktucPLi3C+GZWCQ/dRoAlXTIJWYpIHAcSknpgy3u1FviBsg4x1z3yW/B8+YRMss0BikWeJCgViA/lBZiGQnfc3t2sgazzPiVDPkJ5oleeFYlh/EiKmR2VVaRBKrMywlXJJoBj5dtsc/8iK/siry0wm+zBzksyTRHRaOCuhaC1GpdSNtROlU0m9iTQBIDJ4ny9JIXAkbLdTzzzRIvVEKi3ij1a0VjKSgBBpQ5UBjhK/ZazYWTMRpC0epC4l1HU2keY7ldF/CtKSSx2OkYY/OfiA0HVfpu5Jkj6arNmX6wUyJ5UA6MUfw3IdUjkXoXduaLwQmqkRfD7wLy8EytC8iPFFpzPnB6gnKypGfKoWRVssyC4/L6uThL+L/CEnbMZaCJVlXMhJWjC6pXUhwSzDcUxUKABsSxrGoeF5crHbeUuqBzqKurGMaw5DMT2pmB1MwAB2GMt89cv5vh7u2XWZoXYGPMCQf4hUsYmkZmdlXzVI5TUT3vssvwV45ZyUPGfD+HK/dOHwFXzskwZdLILmdDZkkCWihfSzUaMQCxw38t9naaGAZcZ6RWkn1PFEp02QBaiQl3VEDMS7aNl8vpiD4FeDS5eN+ITOMxxCVHkRssNfQjYDVCjMXRppN1MjUukFRQVizahickPKSSLYElmALgeVWXeabSdMklKleRFUFmNGgS5XpAnyryGmUeZomCwyS9LMgu0ryLHHKE6WnUqPJmJK3Q0q+QC94vN/MxEelYwsjNojTbquygHaNK00QQL3CCzp1C77mDPmGOSRrbZOig8o62omNB8IDaiV1AkrZCnyu2FjxTg/EJM1lmg6JY5dkzEkh1KiMw86O1NJqcEKEC32sgHDwZzSzsHuP8rLEOpNIOs5tY1qwW9yL8xF3QoAkk+uK3gYDNpXzHvK5+BfUKl3qJ3tjse+wrHXmzhka5gRaxKdIvTvIxoswZxehf42322Avvb8GzC9xX8NBQsaAVdD8zEn81kUCd6GPSho5JbDjlgJGNbeVLDEd5JSOxJ9QD8KDygnErmrmN2ZUGzEWR/AuxIsdjQ3b5n0GBWLi5I1GginSPUlvmTsK9Fo1uTvWKGXPPJLuWLSmgu4Oizu3qqmizsQaWgO9YsidDP8PYgzmRmPSjUvdk6ixoHfsTQA9loYG+eue+pMgY0rPZXfZQf6gLZ39fTfBZm80kGXKCh6tqPcAVqc/lUDstbChVthB5XjQnzerzdIOg3H5F1Fn/AMt3ZHeqvBsCQ8uCTK+datxDBS/Iufc9tkI+Yvfvg341xAIqt/lAA2Fs1bV/P5/vhUeHXEyYpJj8U7O99iEU6VUH2CmhX1wQ8wSs0kaaiNJDgXuSytQF7eUVZ+tCzgNhoOubM308sCK1alJv2XdrHuRpH61iDnMrqRgNyou/nRv+fqfX9cDvi7x/8Md10AgKe7ae/wBbZh3/AIcX3Ds7UKEiycupJqvMB5ifffY/PEzHDhfFllhkhc/Cvpdmu4I+QPf2HyxmfxHvLuGO6KwU+tI/wttvQ3B232wzG5jMOYgBNCR9DNfcSeUfLt6fTAn4u5UM+lvKSTC/p37Hf0JpgcYNCVz3EyjypsQ/mU3sTYYb/PsD6Hviq5s4tcUbDcgCmAJsCwCV732U+oO2+2B3mPNOmqNtRKg6Nt9vQH9q7gViv4dzDPJGTH5SCjhfLROySqQdtJHTcepINV5sGjBsOTHkZJXZwDv0aBQmt9SkXpNk1Z9N/Qycl9ndCGZQXYhwOo/kQ1at5Y9wppSSDXaj3xE5QkkeSNJJADQLkUNIBsVqNr202o+eGvxbnCGKLyszOatRR0rVatQ01Q0szMdN1eOHk5JReDt40mJfkLNvlM20TZcuzVGAqBZWJJAKlxpCsoJBGm6BJoMMai8OuWtGbXOZjT94nTzAlSMuiLYhVS2htVL+ISdUmvQANQwJ53juWy4BYKJCLbU0kskge+mFlKCXWGJbSPKQFRQe2C/jvhflCIJc7PIpjQPLCxbTMjC9LBjquN6OqNgVW00mzXLPk7ZO2Oit8V+aWzUv3dZNEUsipMIlM7QGRtLkELJqBCksqgAIDq2UjBhy7l+HrDHlzmW0dNVSIajLIqyMxCyGOl6p3VAnbSDp0YUvFeOLBO2XyLSRQTFEMzMdKHQ3njBqRdaNYLan1EKDTVi74NyymbkWSLUT50DnXDHl0RWCS5mei5YldSxqxJtTsFtYN+BqPPNvL0saQuBmIVygZY4lzjTROjSAxpm0lcv1TufI430LprbAbydxWCOV5MxC80cTNIwy5jvMAogRJA7E9KvKYlIbsAWDPWhuH+GwZojLM06qih4ZI16U0ki+SV2UtrSKUClOqQaVWvKQVHzJ4fSZSYyZ5Vkinnka8sGiERa2BKqqaYwF/DGratnLCgbe2BVodPLvixl5RCKeISxII0YDTloh5YY20UisxJrcae1eXfbnhnl9GTh3ssuot9e38sfzMy3iDko44tMQ6xik6alj0lTQoUyyEGWR2IdxqZkUGvLV41/9lTxzGayywmg8PkrbdbOllrYiqrt6bY7f401ZwfyYYtGl4uHg7kkn3xHz2T9ALv37fU48QZvcDHrNZiifeqx6R5rIU+XVRZN/8+eBPnDjSaDXf/nf++JHHpGa99vrhV8dycjO8YJugw9du3bsPn8vpic36GiinzvGX101FTuD618x2r6YGPEmLXl3AqypoHsa9N7H77YL+IrF01XfqV5990f6fP19PXCi8ZJ5Wyc4iP4yKXjAPxMm+n/3CwN+5GOK/DOirED4bcWEM7UoW23G6jvua1UPWq29sbo8L+ZAyqBQ2B7/ANv9cfyqyHiNcnVJIa/OpsC77qN9+9j0O+NnfZ68XY2Qb2aBJJoDfsB3Nep+W2Lq4sVq0b74IwoYK8llQN/U1+uFZyFxbWitex7YbEEo0jfesdUGtnOyJxbOqi1d3+p/58sBHEtUhtarve9fP+WDybhqn64p+MwKq0Nq3vDSdmF7meGBb1k6j2C7j+hr9cAXNOW2alANfnJ3/TYYYWc4jq1djp79/wDT1/b54W3N2XYt/Y7X9CN9v8wxCTxgdGDPtG8KzZlPSSJ0o3ptZF+q6wGHtQPrjNEXKsgkuVCgv0BQn5j+5G+N2faU5IcxdRIQ8iWdiyNXrpZSGv17n6XtjGZ4DPKWUGYb7xzSMaHsjn+jAHvucBS+paKyH/L/AItZaFdIBahS+WzY3oNVA2LJN2DR+VjwHxZz0ro+WQhy4Qvp6pbUra0c7ADQXJAoFasgLeBHl3klkljcKuwPUQ0QLtdgLJJ2o1337XhkZfLgO2ZllbL5ZFVNGXZVYlR2UArTOQEkcDVTMo9WHmzUbwrZ6vH+Sw4x4WDLdCXNGJoyzQzLBKqOAKlIDMb1AGpG0g6iqAyEhsObxF49k8llgQUj1LFCriEmSKI+Z1K287sFZQGi6YOpgGXy4RnGPHPMZqGNMvk9DJHofMn8RQ/VDBw5TSWug7sWaQWKPbFbnvDieZ3lm6nEJq80iKyw2oJOlUUNI2o0A5ClgQK0iprj/wDmzoc7LrmnxZkzxkymSlXKcMiSOPUwYSSkkEvp1GRtbWQtgL8UhIYUQcpcM4EmUlSVTJM9q7MjmVysdgwvEaguTTGoWgrAyarIbEDifhdPHl2mzAjhy0YNNMCjF0jDC1UvpVd0/E0ozk7WDhY8S4z+EYVy9zii86FqKh2A0+WqorRVlRqHl3x0L/xOebb/AEOvxAy/D1yU2X4YohWKW53Ae5FkUguryN1J2BpJOoCQqmrB3X3hFx5clHmnnYzMyhMtlKDEtp8zxAhliK0gkJK0NQXc7z+VPBSbMQqwmZbAD+Zy1Esqa2DBF0NbMGJ0h7o0cF0PhE/DzBnmljzcUbW6q6HXqpbDMQJBGx1AKAzNHW5vC9t2Ko2sbF9wfkiRqlzgZU0L01pUOhnAVU1kspMl0W70fkcXHiPmoysa65GtI4YougyM9mqTa30alUMJCXYC7rYh4l49cOzTSo/XdY8qroXC3MQbkQ3EzRuzrEFLaSsaEDuWMPnVo+IJlszLn0gQshyuUy+rNZmJ3ItG3jkEoGkHRGFjFLq21EVn7FIQ9h9wTnbJZLKrDNPFHLl4wJEidpHOanYK1uqandVB6lHTEGK9gCDHhwy7ZguWjkR4noCRQrsLMQhgO6sROS8rs+iwKsuFyTxjwrjywLZ19AeulBGQJ7Ksx1MysuzUDokZtRYWNJxX8g8px5/PRw5aR8oixNMxSRnm0wlOoYSP/XJcMt+VVBJY1vRQUtDy40ldm9uHTR6tQ3kM+pmKqQgjCRsNKlRLHHKVijVdQD62O5Y4oOd+X4M1BJlpvOq9KSdEl0sAs2qMAx3TO3UYhQDq0BKO+JJy/wB3RhoeV4Q7xux0yPGDqSNVrzawQWYrEW0uatd64cIEcZEa6MxmJbMijUmrMkXIirrWHoRxDQigjqafOxBbEdHLrRP4eYRFCYVWPJqeoiKekHlDLLlnRKQ9FVJ6xZXaV9lsLZ9Zzh/3h46SUaJJswiR/hFjA4gjkILK3Vnk16WPkVNyvmJx74Bmo1DEEzPGRlZYkdJRAC5byovlEwsnUXaRohR1VWJnFeZ2EZcgxFZNLIJBLOwRW1h3V4+mrKA2jWx1GjpKlcGxGcosu2iSacxiONeokyxsrqrIkaqBqZDKXaXQUsOykdMkrhUeCeQc5iaUTJOjd1cMs6kyNpkYMCiyNoJHTQBySNqXBZ4lcwSO0PD4my9zJH94kkYMIq3hKlj/AIjhDptdQbR5Bdgr4XwYRQwxUHeNYVfTGULsqkrNtuir3sBgx1NVjE3sfwS+KZGOaKQhELkOkgMduUcNqQyEE+Yf4ZoMG7gVhfcb+zvkSquGl6RbWVaQaOiS0bqLTzANTErTmjv2BNUdW6kWorauRIHIAAJ8hcFQxDNaggFlPxEqcT+DZcvEwYlV8p0B2UgEtqq7IoEk3a2Fq9IsJBtoBOYvAddNZI9FZlCzLIXcPCm+lZDThDYLKW0l+4oYqZs3oyWUy2ey3TypZfx0BDHpMdBKi6Y3bNR6gN99sNfgWdYBAA2hiU6kp1yAkKYiVaiqkbfFq1WNK6qxx5xVek7Sx3CIy7xXqFgkkKknxMQPMpsEABT2wHH0FSemcOSctlHjVkWMvGsSIFotFEBdkbOass6kCnFWb3s+KTKJAE1U5KgjUAutfMQoAai27gnQpaz6kY45M5zzeczOaj4eEyyNJqi1KhzIUWrdORiNN0ZnQWQKUHyjFFxTinE8lmoxmJsy0RdZkZp3aKaN9QKpbOml9wfzLdELeKJPTKvhZuHM5qPrrsrBw+pyIytoPICGpvMQQAgKjSD7DER9QkAOrzu2kgNKwRyNJ1xrGFNi11NvsLCtsouDfaWyOhqy8ge9VHpsZFelDqBRGhtzQCaQBV3hk8mc+wZvS0CmSIBkcaDWuM7XuKZwwAOphRJ2HmwhJwcdgv465dGy3UKF5lkVfJqsLvrLOrOqqVXYAhgQAa1YFfDXw5zRnTOiRcvTNoEkbsZcu27sI1dTGpR3HUs1pU6TvbjzM66oVUGw7+WNaRWPmUTMgYKux2vzNpJq8VnF+KdVzFGLKSIHOgjSp0M0YkYgOqxkl+nIGVLvdhQ65sKnigS4t4BZWaaSSCsu8sh6kCLGyFR3bQNbAMrDXGHRdR7bsSvua+QMzlFYyrHmIkR5Mvt+GTGNKmZVIIiUHSNifMTuVxoGfN6hcajypK/UVlbR+GNBK7MzSNqN+YRuoNbkjvLxgDyqVYL0xVOx1F7BCnURYPwlrC91srguKFU2C/LE/wCFA0cJjhaGNkjdiVgRodTkhwSghL6g+3Vs0VKg4seK8YQFZpdEECosv3lyqrd0AY2ZDDr2ZjIxdjTaQVOm5myKyLICOoja49IJI8zeakIOqLcNpa3XQKVu2B3N8Wg6q5dZTI1CZoiplBUERu7lVKkAHyoyqTTb6kbFEJZF5czgE7ohRYoQJswCpZ5JJC46selgrAlKctCxkdVAcFNTT+O5GFwhCoHduqkkZdAqakZZtasVdhdyL5Tp1AlarELl54VSOCKf7wyopZ3c/ewszs8Tv0x1CCAAC6/ACS2oXi7PDwdS606IRlESLJqcEsGGosyMNellUrqYqC9g7gFnzg+TUo8sZK+YguTYZU86zhPidgQNMbAFoNqJC4iR8OH4pJkkDuhWMSMEVGIGpHCh01yBHjXzFdOpD5mBtcjN05Y6YOXSQArpVNShbIQFbKbWQgrfUwBBxTGIyBY70LvDL0JgpjU0OoQF1B2LlRHTBCwINBjjGJGneN5SoEcjFdPnExVSheREKFaVnMjOjKrqrjTYx84NKWRiDKkTsQhNdTSGosgQtaSIokVloqpYMm7DEuKBjJLId2YJGisiKAFRgHUgCpZLIlVioLBSAvcyoMpC40qQFDun4bPEweO+oEVaohgQw8zBjR2OCAEeNZLNBVjimEUciTa1kJl1OxHQjgVnEw7lhIr0qAVGrEEfeSOI5lX+7zRGSMRuVnDqUUlwHQBm6p8/lVnpiNmvvgnz/CkRBrYuGPqRMAXqQqdtStpA0qpDnUFLE4pp871XZDEY0YGMyaSjuZAGCowBZZtJPm8pAU1ZIbCtDp+CwzvGo2zTCNbeGJJmdrWNbLKqsjMml5FExtSykCO6sYiZXkmAtNJCgT7wYxMqaR1JA7NbIwdAySWDXchtvhufmuSSkEhXzBPIUJeVtjbTB5aeVwo1U7MGKEUCdOKEeJGVjDI0yatvKqgWfMSzsPIDQpQbrYhfLjXQP0X8BcMY9wqRrqYCgG1F7WSwJFsdLSQGTcEVWK/jOYRjqsmXyrMwBBVJC2nQGA8mokELQJUoW2W15wjx4VlMbpIZAvTURNrkkVjqUkqLFimAG4Kn2K4qpeY87mZBHEZYoZfJHNMWUIwJ1iWYoKDMK3HxBWNFWONfoPX2OT74sTq8hCV5SzlVDOBqLaexYtfmWy1MpHY4GOY/GrKAIkZ60rsFUAUhkZtCBy1AguaruNgN6wuM34DZnNRvJLmdTQI5Kg9ZtS2V6cmrpAkAUCSxVwxWwwxz5V8YOCwZcKFDAIiqjRGXMySuFDMGPUU6dWkaCvmBK0QMFJsPW9Ezj3OnFI0M8oMSk+coyn7uUJXzRq+tQWBQEsVkIo74+8E5F+99XNZk9WKVLj3McuY0AiRk1BwvTCsAKIZ9lA2JGk4Zm5ctn5kiiynDkkSpeKROJmQbzOUKoXQEWBIKc0qkuWwSeG/hDm89BHMvFHiyhROhPDDGJFCKV0R6hGUTUStEb7qWtQSz4/YywW3NPiHkGEcU/QkKsgH4JlmQq4WIRAIwZyRqsALu1qCBiu5g8QMjIZJJcvm8xNAetLAVZYIWXUSSNSqh3IYmx6aRuDQ8C+y7PleICb/qME83n6aGNlkkLA6+ru+mwzfiJqNjtV1bcy+NHE4UAPDJ4YA0iPLDlcvmZnfyF5NBlddmsFmQLJHTWDsCoW6TKLqI/iv2gc0JHhdIo1eN1iKLZMMxJ6bOHYMApI+EAEUAKBwe8tfZOyU2WizH318tJMheNfwyisa1uRp6hUoTuzht+66SuOfIPhHm+KSQyZiJUygMkYYwJlJgXN+XLspHnJ0tItRbWAa307zj4YSS5VMvEECRoI4nlQLOqqopVdQFAY2A1GxYvfZpfX+ppSS0Jrwo8NsjwVnlzeZTN5yVDHCIUIEcDWSADrJaUqNTSeXSoVfzkyvDXmrKRtnGlCRQy6CyQowSU9ozLHGtXqBDGgTZvYAik5s+ztn1hy899QhR1oAkWtApkACSpTShQQWYtqB8wDdsWn2b+WdUsh13EiN14ZlBZjvpbV5o3RK3LEHYj0BxGcpN2Tu9jD4XyPwp5JZFgy08eaRYp9hJ09BJYaCpaO9VF1KVpBK74XUv2MOGXmjBNmPNvHGL0ZRVcWskzAFlcWhLyM6jcb0wsOVvCjMx8SZizZfLEmaJotLHOpFIOpGwFhF0FXYPZdCClEMVbPMMscqsklsmoG45ZYAA+6s2lgAlAxsjHfStgeYYrGUkiLpPB45Y4FBGRNHGZJ1i+7daJQgkES2pRLK7sCHlHlABWyLxSc286x5aJZ82phDSLGJlDPHA/mELypCwdhM1jqBau1I0mzR+OHieeGQKYtMrSkpAXcVGdGl5gEskFOwI0l1IvzDGbOUfC/O8TDS5rNyx5V2YpM0yyCSVi9II3kVUooaLgEbaV7kNFeWVjDFvQ8IvtEz56VMlwwQrmZEkPVlLRwLGqamZdWq9LWqCRfUbeVjhD83cpBkjfOzyz8Sctqy8kyLlcqNZRY3JsNMyKpIjdIwpIJNXhyz8EaLJJlchDbwtG0WalEcLtp85mklXaXqDug7WbFNgHHhE3GMzKIsz8CqZGEBOUScd4xIukW9bAgHVqvGTzSKRkloI/DTJ5bhayPmxHBNmY6ikgkM7wRggBk8rLES38BOxCkkEMa3gPB4cvk85NnGmy0MrM0U0AVcxnQ9sqyHpEhZKofCAdVkaQ2BrNcz8J4fE6o7Z+fpuLmAPSzAOkJGBqVMvRa31FwybV3KF5+8U85nWU5iV5Ag0xpZ0Iu3wr2s0CzG2Y2ScVhwubvwJPl6h9J9oKXLJ0uHomUGr/wDaiivnpF9EllYaNO5LKsem6323a/2a/CzItlRn+IZOWZpJHKPMyvDLTkrIkNhyG3DvKH1HdQQ6nGSeGbuoIL7i0GxYWLUMdlLfCGra79Maz5/5jfLaTk5XGVXLxo+XMn3hIdCrqhjDm2A8pYhQA5ZRsFxfkj0XWJHu55Zx8e+TeGO82azD5jKzClXLxRKA1LUdDTVAFQ7sFat96WnT9nb7SuTzWSggWL7rPAUywSi8T2nxq5AF0t07BwwJ3FMcy+JfiHkuJZFJcxO6cRhlMfRUDRJC0gKmNSQoESk7k38S1RU4VnhX4izcNzZnhAcqrqqSahGbI0u6KaJAHwnYgkbYC4+0M7J9sn9EOYPEGNSERBNDIWM4mQOjA6EcqrVrctdgFgo/kLcR8Lcos/3yOKSBpIyrQ5eXpxHUpQBowtC9K6Qp0s253thR5OXO8Ty8DziPIFr06VMAZjpKsXY7pKNwvqdz6DF5yjzmFnXLrJFLKoHV/EZvLGdKyNGzdMJIT5ulqIQhxsTjhdrB0J0QOROVclHEiZrqjMNNIiZfNy/9rIjMAj5cUsTMgZfK/wCLr1ErVNi98TeNZ/LeaCNIOHxxjqZjpqJJZWVoxFGgKqqqdKmQo16iFNgWCeOv2gV4ZmzEIIM5mI+nNon/AB8siyEsvTazokj0qVIXVpZbo9ss+MHjJmOJZmXMSF4VlKEZZJ5WgjKoqkohKoNRXWaRfMSe++OmHE2r0BztjH4544fd5A4jViyaQHqTWlnVFLqAOlbrQwI2FEVi8znE4swmTzEGW+7IbRkQCNZg6mN0V1C9RLW9LAUdtxeEfyxyomYlhjaWW2IDER9TRfahrBIBoMSAFG52xoCPlTL8O4eJWzTTs2tOmujpIbLaY42ZnDajUzbbjUtWcLOorqnk6IJvLR5j8I8hLMzTZdvu0lgtl9UWajnYCpQgGlowDqaHSRtqAO2FJ41fZ6fIW8bPLlzJIgaRBHKmggDrJtRYHYqoXYjY7YKvszcVefi8cJbMSqY5XULMylTGurXILGpFW0Kg9zHsQpGGp4yeG2dePMrEGnXMWXhaYqyvGLjzERexrNAPGWCONPbTRMXOEkmyXI4sxtyzx+TLzJNGaeM3satezKT7MLHyNH0GN7+B/irl82oZJCgXsiUpRz5WjkAQMFY1pYtpLFiNiBjCviByFJlOmso0SMpLKSCwo9yoJKg2KsC+4sYGuEcYkiYNHI8Tbbo5Qmj2NEWPkbGOzk4lyK/Jwqbi6P6KiHjmY4X93R4uGiNWquvJm5ooQWb8QNUIkIUnzOzayToNgffsM8UmaAxDJSRZeYCZ83O5H3iZxpLwxsgLpW6spKiibJLEV/APtA5eVswczLHlMtmdMccBlUzCJlbWzlQwhLlqUWWUjUW22CvHPxjykGSyOQ4TKZI4bZ3hnkkaIR+VEaU+Y6i5OhXEYVdwoK44UnLDR3dHoqPtoc7cKlzSjJt1Z42aPNTgMEIQBESOiI20m+pIovbTbb04PCni8mYg6mRgE2UjhOT88nRXMPpQscvHJqOiBlYSs2jWxah3xgPiWe19lUR7ENajt2Fjbv6Wd/XvjXn2NucZhk83BI5MKlfuqhNemd31MEVa1As3bzEu5A7GrckEoFmqVIKPAPi2dhz6xS5V3ZxonsBPu6G3Du7nSLPw1ZZSVW8aNmLxQSNrVraUlkJNtJKtIL1OxXUVIGnXQXtZwgvFriuYLx5kajNIkSHL5YPULrqK63HkV9IJAbSFHoQASyuS+MTf9PSnSWW1XqySAQoEJDqvkLSPAtqzqp1zPsxABHnR9EZ5yFHFMw4k0h2OosynQenFYjHVbplVKiNjGiW10SWAVjgZ8ReHpmsqQX6EQaB8tII+oFEQZVGk7zNMDJpjUDygBRbasWc2QzLSuk0qzdXS/SjUpFlYFGnQNQLvrdtDuWQuVBCIq6RB4CjuGMriSRlGyKIowvU0AwKW6gCHUGkJuRig2UqMZvwJ+RUZ7m37gxgVpSvUWFwenCV8rr1CrFAUmtVJ30qavWd2VyX4kvPqjnX7vLoZoyhLeRRpklYtGUXpqCCqlgv1GDKPl2N2dmAcNSokg12yFiXANrfUIBABspqLXjLea58i4hn2ynVGVyMMpyss2gdfPSLqieDL0GaNHcBpSArEWRRIIeHG3+hJzRN4P1s5xBJcnm55Mtl5G+8TTkaF1Fo16QEaeXTqpmWlsyXsAxry1xTMPHmEiSSRE1yPmpY5kiklUsuXihVgTKoXygx0ooyMFLqC5OAcm5XLxLBlY0SLWqPq1EuVI+LqFmbTotiwJNVe2wfxbniGZZF+9KpjLR9GAAzSHqFRqJFLqYUekpI1AagbGHdLRJW9iD5o4WZXXoxNA5A6zMNOpVJLCEGpGW7YFlW1Fkm8eklbV0Y9tIAX3UfmkkPpQBIHcsb2vHXMcQLSTgFOsJwglNEDSFaRaCrQ/KAo32BIBIxdcKzEBbUpChiTK228i3qHtQIY1dL2rHXwytE+RHfJZBXZUQVFGp8x7dvPIx9S5sAdzfyxZZDhtMXO1XRIrVtdbUaHdidvhG9Y/TZzTGtA03mJNXW9foKvvQv3OK/ivF6SrNmzqNEjXQQUvroF12GpaGOlskjxzjzGGikq71AMfTYBq/ViLHYbeuFHkJyqk9y53o9jqGoH56aAFb4MOJSqYO58zvbUCxoec0D31Gh320+wwupOIjUAuwJJ07n4Fvc/xXp/ngow8uTOLKIronQ8cYHcsQvUb17IKBPuTi+5f40ZM0ztuqoGIO/mUjSD39Ow9t8KXLcwmLLxqpBdnk392ZxqIv8AhUKoO3r2wXeFOcpZnBJJcJZ3DkEaj63ZBFew/TGYAq56mJaPUwolVHrdtX7E7/QX88EnD+IHQwO50FQL2Iti36G7Hvt3wneduZ9fEsvlx5tJLMBdatDAXfqACa9LG94YGX4hbhNmIIWx6gd/XcKFOFowrvFbjOnubYMiqbumVv7Bhv6Viu8WONGR2N35U8oO+oCrHrfzHpQwLeKHGgcwVYmupqNd6LWK/p398UHFeLvIr6f4nVWO9DV5b9du1nGeEFEHnXLdY6lB1Aq5QbGiLYqL3BINj03wsfv0sUh0qQGBGmrNVsQdxY7j9cHvF8+xUjqhWjUa27AKRuRsfU7XRv2vAhy0nVni0K/Q1jW72ASLY+YWBfYKPfcDCp7YzSZf+F3L0pleaVmiSNOo0hI1MCT5QN+9EWVIHoN7D18M+WcrLPqbTmGiHU8kvUBBIanLkLa2AIxHRbfeqx08NPD4ieavKrroDyLrUvITdJRJWhoGkHU2wI3OI/E+OZDhjZgqrRyyUWuMxyvvJXTiDD7qqlhXU3c+Yr2x5/JPu8HXCHVE/wARuJrHxTKyD7uS5QxSSanEekhB1GagGXUTG4FmTYfCCG+vAIppopMyzF2EmjS3TSTSfONTMfK1q0VsQWEhN4zF4f8AgLNmm15lJoISQXMn+PND5mJRXG24os3TKpuLNY1Fyvz/AA51ZYy8UGXj0QrlQVknlLxhVLyWxhgvT5U1OSpLsBs3PNLC8nVFsHeZeS400GKJGkdnhVZpmAXXICrFlFAqo21MW07gnWFx25N4TPk81nYJswrI8UKxKEaHKxRlpJJUA1ammdrjsAk7W10uBnnSHKZfKSzZh5RJBNBlZpYpJHaJXmUF4QxSP/AAYFRqDdrYAY+8184QSnLNw143lzDRDKxhj94khh1PNmZnkOqEa4rVZQWle3I0msBQdXRnJXQ7YeNyRQu8kOZywjrSoVXlWzIWqKAyqpaRiIADqCnyx4CODt95jn1ZHMKApdTmArvM1DR0kkZZVqMUjSCJRM7MNV7fPDTxLmzTTwO8MhhghlkkQhTLM0hQRswAIW0YmQUB0yoABswOHc8RZV2zOfzEcPWlaLKxMGVY4Q9I7BA/WFWxkfWFWiCSWCmGXVCvCPvhh9n6RGaZsrJcpCBJzH1I49OwmVriIZjb9OzpoX3vS3h34SxwsrxRCJwtEpstE6iKoCtVnvjL/Jv2jpZpH3bMNFH1ellFCo8bOQCj7Eoq6SSTbFgvdSMPfKeOxQFX0ZZlF1M4bai1MUGlWIGwJZj7HHXH40/ycvIptGrOASkiz37HHDjuZ2ofrXr/ALYGPDbmtZIL1hmoE0e4YAg+hqvcDEXmLmH0F3VsfQD0GPQtUedWTzmeJBSB7n/n1xXy8NCdfMOaJURx7flVbah62x7/AC+WB5M7rnRWP5t/koosf22xA8YufV0qBtqBKgdgt6f6C/1wnZVZRRd0Bef4pZJoX3v3rt9cZg+0f4mS5bMqiNSNHq3BI37bCyVItT2IIBB9MPTM8WBS7F1eMn/aQ4mJ2yki2x6c0TGxsUdSqtsa2YkHbt+3FFpyOrrSEXxciV3ZfLrJJFnTfc01A1Z7GsFnKvO82WAEdlqrbfvvvYqu3r22xCg4CR6j3Iry2fRu9f337YtP/pmSlKhKINDU1lu47LuD7e3c7Vi7mgx4z+lf2TvFhM5kkAb8WKkkBO5buT9CCD+oxpLgvHdRq9x3x/I/wW5pn4XMsiSEo0g6qgEaxpvSq779t+5HehWP6L8l+JMU4SeJrVhRG1gjuCL7jBXImqRGXG1k0Vl5LGKfiWVBP/KxT8I5uUmr3rHbMcZu6OLJ2jncWCmd4UVksAUdm27j0/Y/ysYC+c5dEmlhYHYnawfY9x/MYaWeyraHZRvsFvfzEjc/QYWPiTxDXMRQIAo/P5gjtvgSVIKyBHNKRPGy1YIOxAPf2I7/AF2Ix/OXxl410M1JFqOnVYD6gw2286khwPmAw7Htj+hHFoNJIJr1Hy9wRtv+4OMV/aeny7ytrUdVSPMNg23cH3q/Kw0mr7gYmtllayhEpztmJAy6xEAAFeqOkXSKbsg3V718ji85e5YhdV6ua06C7MGdEQDYk05v4jTkedq+EYD83ko3KKNTN+UXsB6+pGlR5iRhicr8l5NWUlNTm9LMNa2VbYxs+kkmgSQdA32xp9UvReE2y+kyeXTKyPDM2YjivVGjoURS4AbQzjubkRtJ2ry+uGzwTxD4gIqy+UAyyZbrdWX7zpdYxqMMSFF1T6iSgj1AOXOqwt/eTvC3K9VJ4MshzAULHMw/D1MAhdY7eNZFYNZVBpQFtVM2GtFxiQlz1IyyBahB6Yd0dmVWkAlbW/TdnMZUxkBSSVAxxyaf5/Z1KQk/FfjvFGy+RbMLHC6OJgNOro0dUK5hDUepUK7a21E0d2AwF86+KsmcIYlktIyQNotasfxAxZnAN2vbvVChjT+U4jls0HVgsydNWbLSKpZGYLIgkvqN8Q1tqPlVU0e2ATjn2eeFkNLHlmKRKUEf3idFzEobRoj0uQAsopyjEG2RB5ScFSWmVhJeSP4FeKOSjhQT5tjO7APF0pFVA1jRAET8SU6iOs5Y6moKMePFnwsOZd5FSPLx07MUV45ZdIpRJ5keMuXjWK4ixIY/mAwreHZeTLcUWU5WOItLIqwRFPu0S6QpZCxXyxDzkBgw8x8pK4Msh4ymOeUSR/fZneSLKdPQI0TpjqOUUvIHBitAsrsqK46gDHArNxKuFO0C2c5EzmYiKHLZThao8fUYQdBptTIkaMComlXWrOFIVWcOdfmsPjn3LPw3LIY8nlpFTQXfLnpvlgwQEWoL2xCF59W+oKQbvCO4F49tNCFzBE8hzBmecvoYghCKKaHXzKPKp0hC1CycdvFnmDMyxtTrBl3SP/tw5GoBFEXlrcnRqJO5O7aqxpW2kx4xbeSRHyPLxYmdJsvCpvVCtyyZXXKVUuCVA1lncBnUvTMK3Ad/KHJnD+G5eRMs+XdnOmTME9V2IrV1CiC1AMnT0lUUMBv5hgL+y74VpFF99WYO8iRGQMgEcdOx0x2r3NqHTqQLqAcqBqBwz04ZHl5xMsciZnRHGyqSYLlGnTKWdUdzKatgsqxqzV3wJWsLRzzneCdw3i5ESSHWjysM7J948rxmgGQxANGrpC6gJuAqtIQScUPAOFhgJ3E515gSITIx6wiSREkACgQwaZFZECRltRprko3vMmcMSO2ooqaTMxiHU0hdIaNRQNbsQSwkUDyGjgH5o8eNW2Uhld3uN9ULR6UWvKoGnUwYFm1aNqDXpAMiAyoHhijkcPDHA52IYKPOh0mZ2IZwiEaVZl1DWgGmO8VPGs9l44mzipAqkKSVKlpmEra9LANTLIFpgtsASSdG+aecOMZzOOuWLw9ch2BOiKCJYgS2rSpOmL4VCo3megBuVj8X5UkymRdZ5meaZ1UQRu0Uccq/CApAdi6MGZiiqn5VJG7VgZRyaC5F5Yill++TZapnYSrqcMGABfq6eqyoRqUAONQrWApsBm5zNIQp07+ZiSwrUnwqAKGhLoEblbrYbZiyPPPE8ssCsYSqWOk4JNgKAxdQHWW1UFwKIoEmyA5fB7n5czCepoikQsrQqwLEBFq2YagpceUeb8+o1sZpoefG0rCZ3ldLJHUVgJHpkSSVWYh40LFQukFQzWPUCt8ecjlVI1DTfUOnUyhmshXVb0DTIm3m7VqAobX/ABZAYWdnouuu1YlAN6K6CCaCqNgC1Ngb4TxhWUx6AQCU6nlUREIXJNgMryMxDAHVRB72uGskSoUW1UDufwttKqI5F8o9zfZrCEsF9BfnxHy8UuWnRviKMgIHVZCACpc1QYNRW3sHy/PH48H16TrGoBdydk2oKALoMG1WW3JUkWMdpBaKoUEbXEq2GkTWrIpIo1oG7LXxlr9QBPJibwmzoh4hKJVOqF2qSN1Gk6WCtqpvL3ojzNZrVpOL7NcySy5v7r+EuTeaMxfeY/w1a2MXTZQGR2VmS9XnFqQNWHnzh4U5b7rLGOjlVULmJZURa8q3IrKKMpo0TqGodlGtQEBzMqLl4mZX2AfSQFKhGZgWGoE2osWdXou10JPNnqQl3iOfnPwWii6gZEk1EBFUFpghoDyppGnqspDmhuygmgSUcveIEcJiy7wCKNdlkhTQj6aWkTuqtp1O+6sWNncnEWbknNqq5mHM1mpwhfQumPoOoISIk2wjXW2ogMNOzAknEDmvN5pYWik6TtKVgy7P/wCirGNYJGIUyANrId4213TFWrUUycTd4Y2gg1Mp9VDMKAUXpQ9wbKsNmQkGhsApxF4oSWXqJGTG7yIgkAclFBEljTaoQEYAHqGj6WKjlLIjKZboyynWAwlla95CCxWMsbVRH8FA7KARqJvrmU6kQYhk+Io0RUMiRlZYwjKAABROYvya3IKvQBqmQqjhm+EF45i0snRZTrjEgDvasX+GMyWVcaGVyEVQp3UY8DqE6jGAjFSJEMkjuw0NKXcoUiJCkahu5VNxaXeRcFjoSCMKsZUCRgD+ERrdms/E5Bk3YkrqF+YrjnBlWclbDQvqhKpQZFB0OukqEcPMCpDFnjUoQxGqsayFy9m4J0mWEjSWUnQRGAiswRoiKYvGFc0CSr0tC0GKmHLrGrmKOV7m0yBk6oYqXQkIGDaFmLP0hpavyUxbF+sKDp6vIdJkSPTGIi7TuIoxEGAGoLRkW1Ntp06kxVT8DlEYuNF0zs80YaUtIbXRIsl7kjzrEygaX0F10CysC7O0eQgUrFoYAfhuSo8/R1udciLdLqTokjR+W9hi/wCN8GhlUCVS6BG2eS6VAoR1I0kyE1qKFTYQ2CpGB7K8RlDKyrp6ciMVbSy5jLsWCapCpKOruWa1WmRBqKyg4nZLOKCJSi6mOqZktA7khqUg+YxkkAMfMaB3bDWCjxxDhI0SV0xoVpBJL5mWOMABdSAHddR1BiW/MDucepFkpowQGMSEGMBwmo0DsF7MRr09wdTBQRfSLNxwiWV3VlKMxdqA6B1MzEg2WDErugNKFJqziuynOnD9BMcjvDXUDqkjKhGgr1CSSVY6VUO5ABKkClpG0OrJHG+Y0EioVlaZ2TRENJeNQQjTMGtUh1gq76zq8qqGby4+5ieIQsZwyRRsOrKW0UTp2YWHRydJWRlGrQtfFWFZxzxRlLtHBBqEzDRLIlyFiBpMZIFaAp0x2ToINeYk1v8A9HZ2ZdWbeXQ7gNCpBlEhZNLQx6ZUkdVAdoy69MFfIQ2BfoLXsMuJ+KmXjQNHLHmGWRmSOAurAJrIMgtpZJk6l6nKxgaqU0GIjzD4lzyxFEC5cB94mZmzB1efTDGyM2vRTBAbOo9qOPHC+U8nk2Z5g2ZeQu2SCgx9GUeZlUFFVjITYZ9QUArattiJzR9oPhsLgRVJMjtI8pWSIQubYDVHIWk0HSqqDoCse9YPVyGUX4QQ8uPxLMQrpklVAqoJc0skZDljGxdQrbafgewJO97WffHPDKHLfe2Bad+mYpxMFGXj85d2WRAhUS15LcL2VX2NrzjX23ZJAmmIAlXaUmRmYSAAwrHJ5mMURVX0yWW8w9Tah4FzFm+KZnTmZ5Dl3P8A3ZR+kvSFlFIHl0lgFA07WSLN4ouJrL0P8cvI/uUfEfh2WePMGbKSOJHcLlUBzFBOiyjRIWchntDIpKxp6ljYF4yfaagOYnOUEsT2bd5WQbgXcIYgFwL1Ei7Gw3ufy/4U5cM6ZRPwDqBzMoaRlZ6FLJVnSL0nUiA2SRqOFxFwHLcR4vFkHnEuTXV05cvHDEzPpTXCrO2rRq1Aksx2JjA8oxTjhGT/AAalH9j3g5G41nOGRyLmcnwnL6BJp6j9ec0bM8o09IHy2vnNVbMLXHjwi5n4PwnMwZNBFm8/PEsWbzkMvVysMy3QWVwRGJmossQAVgmq7UGq8bPGfJwZhMnmMpnHGXjjVcsM0suWmWNg0fVBkLygFNSsTqZgoYELiQnDWzE02cyvCsssEsSyGbNTfdZXUbGliEiwa2ADArHfTU+wNFrQrtkL7YvFZZ0zCtnpCyFHTJRhFynRQW3VcAy5rMvepCyxIladBK6zB8AePZlOXnMrH7pJJKuWeMSSSwMshDpJGtuImZXYFCFFgMBrAK+8Z+WczG/32dYE4f8Ae4oujlswkysd5XjQ1vG6LJpkpQrX5FCg41vyjzSvEOGydDK5vhitBLKkkmXCRyCMbNGyMVAZXAOkR9Vd1DVeNK/jpiSSWUKTj/NEUkBngIhjhZIDrVxMXIsOjMTshIt6D6dQLDthw+CHiimaDwsKzGViFymjHMGGktEPy6aBksd2O+4xkbmvIyq4iY7n8VgsqOpEsYdXY22kkEaiNwwvcnBb4f5J4ss88b+c6ctJRCdMOA5anYGTUKPUCqBp3Pm25HFxVmvsPbLeNkmanaHJq2XmjWRRPmIpJoBpBIUtE6R2wIeLU6mgAFNmjaLn6WXKSrq6eaVYo5dwYg7KCgBZj+GSS6FlvTdr5WrKHg9xxoOIomoMk/4c8dlFdLJS4xrFrQbUPMBt+YjGi8lPfEAscSsqwzHMyligMTsRDcXmgkeRxqhcAED7wCUvSz/gRnPw855z0UTJmMtIzR2qztJD0mQmjWuRSxrsQtELYo+Uy8z4ZK2alldpAXXQuWRjFEdSGlnIaPqq57jSIw3fXqxVeK/NaZSONpPgV3ePLqPNmCjjSzK43iiZnbTdjTHTEaQRbI+LPEOINHJlIcrDldTxPNmXEmlwV1qygiRQpIeNVU6jtYAwKHUG8hfzX40xZOVfvLg2pLLGC7hW2QPtSMysUPmp9GxWsLTmTnTinFmaHIwHLZJo7edtOo22wmkUExoxsLGNRZVBL1dTuYPs+OOrmmeLM53SskpzbPBleoT/AIrrDG1qkYDxh7QaaYVgP+zX4oO/FjNmJkLTQSR6kRhHM0fTVUZFGgaKqJunv6kazZ8WWSitZYFc9w5bIT5eOTKz5lo1BkWWSstPYWmy+n8QBDYZCdBKgEd2w4+ZfFDJrHGvSizVRxSx5bLxmVYJIqZdQCgBh2BWtIW9NgnArxbg6ZyR5OIZqDhsWUVpGynlObMTgfiBASqszELpXqaiCAgI1YUnNPj8sA6PCBLkoBYkmlZHzE7HYSamDdFdjSBgKY2BuMVjByQJNf5bDXxO4HOuUXOzTrk4ZSP+2jeVZpwSLCI2wbQdTqwoHzMBuMLDi/2gZIomy/DOrkMvIpXMFXTr5mwATI6qNBA8txkHSE3FVg/5S+yHxXPOJc6WiSUM33hpo5ZFkYjSXj1UUeyajbUdu29Onkr7K3BMnHJDnlTMTaXcTzlozoYUBGqONLR0fZi297irx6ce8sjK3hGChmCRvuLutrJ+Z74PvD7wK4hn9DZfLs8Ttoaa1EaaT52NsG8igtVW4HlvBz4lfZeWBo/uOaHEDKaTLBdOZ0+bzqB5XUBbOyEVdN6aO5E4nxDI8Ljy54YcuEQedZVcqg+OWUEiRZCSSUsgWQD2GKT5UlcRvjb2AXJH2NeFxrmYM1n+rxAws0bQjprlAADrMJk1SubUESHTWwUXqMD/APdUy6ziAZ/NHLiAN02jijld3vW6P/hLEDpJj0tITY1Gji98QvtDQsPuq5Pr5xiyHotokEoQFJEkXzt5qYLp7KB22wqOaf8ArhyWWzM1ao5ZIQVEy8RAc2Bmcv0whiIjDIwDMVERe7JxJOcvIPjUUROZPsovBlGmEkmYzCsCMvBCamRn0h4t+q2gAs+lX7aQD3wt/Dnw1zWczX3eJAJTesTHphKNefXTA2a06SxO1Y0VwH7YMQOWMiqDGFSQ6NAC3TPZLWxY9U6ACAO57E6+0R4MLNBLn4b6scOpWWRlWaMENq3rUyoSbsFtsZcsliQnRWZ55d8XM7wbPPFMsWbbLOYminYzRj4GBgdr6djSUYKQAa0j0LPDbk3MZ/P5viKSQ5EMzSCBXMb1MgCpGNKr0zWmRhtqvyjekBlctJns0A08ayTMB1c3IyqzUFUPIqSEEgBVJFdhY2xtPLZqbJcNGXzbRZucExuVoDvUEayEI8iqK84RCfW/V+Woq/LMtgd4f+DmTzGYm+8IrlFZCsxb8UyAKrJIjBlkja2WUK9gGgKvGZPEfgAy2bnhX4Y30qDr8o9gZAHcD8shA6gpvXGxfCtZYml60SRnSOmyHXqqwIgrEaa31Om4IOBP7YvJzSZnLzSIi5ZlXRIoVHltVMiA3rYjyadQAClmvcjEuDkp09CzXkW3grkM0oEmUEcxahNHE6JmRHR1AlhfT9bXYEHBJzt4b5jOySM2SzERUKFKdMBT8DM0ZYLIC2nUYzqGokj4jhO8reJrcPzEjwVI6HTExJ0Iu9gqKL96NmrF4JeKeLeezLZdPvJkZipaKNREFLbFNQoNY7htgaPoGwJ8UlLujqhzWuow/CTN5XgSJnszls43FEeSNI1Dx5eSGXyMHd4jCCE1HSG1llVhakEOTOfaT4Y2noZgySZrdozG6rlm38mZZlCgAnR+Hua9t8C0zJFEscc2YeMNpqd0kRHK1bOSxZhv5SbFj335cz8T4bl8rDls8AZ1hGsxWHkUnyyJIqimCsdS9iQbvEflU8NZC+NLIBfaQ5Ohl6ee1xdeUCBolVpFlKXoaxoMTqgogq2taNjTRZ/2EuVsjLlM1DMmWbNmVpEhl0tLJAiqeoI5FNojEra2o9dzeAHi/E+FZPIzvDIc7LmFWOCGdYnXKuF19UA6X3BpjQOoKKsnFTyZ9qDKxtl3zGUkkaOQvohaOOJXI0rJGvlZTROqMtoYk2CCbunNxpCSjBCU4ZwObMSiOCKSd9j04UZyb7E18I9LYhb2vGlOR/smGGTJz5vMroYwvmMpEh1iUjWuXaVGZCAdKykqbHUUD1DG5LysPCcpDklQNmWXVm5om0BpGYFx1G8zhV0pGTQVewFGqTmXxYyuXiXMPHPry0qrlkyrrDEXZX87yMGDsdR12r0tkIpJwkudyl1gVy8jM4RwHLffZpxlI2zctKZZ1XpRRwhYoliD0iCt2Eau7GgewAzpzvy1LkeYFYqIIxMJkkmmSNDEVqeVmG6WwfSmhWYhQF3vCa5p59lzWYkneSTUz6kEkzSGKvh0NS1VXaKgvehtVBmczIzdR5Xd7vW7u72N1JdiWsem+2LQ42tsrGNH9AucMmM9UMfXjjzREhLRGHqrllpYIIiUkUljqkmmVQ0asNwRQr4U8vvFmDlWzDJJDKoEZTqglHuQRnUyKzjzOxJB271eLXwf5tkzOVhzgzQmzWUtM5py5EpjnoLGha1Mm5LSUdRHoKAk8Y5XljzUZgVjrQZlGEgB0s1sHLN+J6dQg211Vk48/kTTOeqbQ3+MzhZBaoYywjQAanb4CFkfUNclMWZQGRFB73eIMOT0mXykGMGORl8jGPzPr1El1LnZaKhVtwB5TjvzDDTwiR5AdOhtOlXkMg1SC+0IJ0Kz/wCIkasqkWWxW5PiCuJol3kdVd1FhIzIwijDltqIJ0mhYVqB0KSTnLPhjG4440iCDyxrHelEj2aRQSAioQFjB1Fy9gHGOfD3xJyGU4ln81MJI2hll+6RWSTKzuHkaNdPnkG5dgEAdjvQptc7c35jMSJwrISSgtKpz3EFUoyKkf4nRZr2QeXUSKNAbsWww874XZH7tFlVyi5yGOQgmVVcuwp3laVxGtyMaJUmkulrSDaLSQslkzX4V88HiXF5JPvk2WcAvDFFCJpG6nkdIyQ0cQjSixI7nVflNOGLwyigjnT7zmDmIkSeYRmJH21LH1pEQ9SRgWdhHQC2ABdmx8TOQOHZaIvl0g4XM6OI5MomnMBBWzGGi4IGyUBR3azhAc6ZWRc1lYeGSy5o6A0+gTrLOZKMj5iRyTJQI9QkcdICBpGElTdIdNpWHvLXhLpiR8xI8HWbWEjQCSmU7Sk626jKC2lPgVrdh5sR85kMnllVFV2kZwVS9etmoAs1KPN2Ajpe/cWcWfNPg7n83+K2aRYdRjCwdRii6iJizao1Z5bEZKoNI7DSawT8E8OIIwostO8zR3JqVI1UAFYg+ohkQhRJu2myAtHFYySJyVlLNMxABGwoN20lyDaqfVVPlHezqNHFHxqTTqHxyM3cL5QBtt60BXpZAHoNzfiMUcZOoKkcf4YDNT6+/mBsqdBtR6KdV74Do8qGeSYvpqwqE1piBAvTexcizqtqIFY61JHPQJccJSOqHcm/XehQ37kAX2wtc3nN/orH/wDN6f8APfDB5qmBXpgFnYl2dthpG1KPT/QXQwrG3Yj01Anv8IOo1/z3OKRYGXWc4wNSMzaY4UAUerMVvSBv3fdtqA7nthreGvHVyuTEh85VWYBttUsrFh2o0q2QPmMISR9bpt5QwVfay3p/4gWfp6YK+N841UQ3jhBsjYs+1D9L/lfphhSb4bcVaTNTZmQ+ZSZHv1NGh60CTQ9K2wxuCc0/gNIxCtbkk/ESQ1gD/wDMK/pucIzgOcKFlFW46kncCgQqgn3Y21fIe+CvnbmQQ5bLRAnXNIxatmUuNiduwQ0R7t3xjC75j4yzZu2//EVv8oRjdfopBxLymeIRSwq2ZiPezYIr19avEHLOCTNKwCvuNXmLbDYKDqJFfFQFAe+JPC4zmGjSMdmohjX5e25FKF33+eIzl4KRRIn4RHKj9SkjPxUdLVe/bV8J7Xt8sUI4dGseiFjIgN2aaie6+WgSR7LtveOnMEYd5MtCy5hdBIZNkXQNTMkm9ohPmJOn0s2Bhk8J8JmjyqvGWIRFPlZF1MwBbSWAW9RIJvSPQ98Sk6jTKRVsdXg7IWTLTsUaaKJmtmeNIqU0Iwm1ubXWQxA17qpwrvDxEm4nNnc7OuWaCXWwhplkb4AqakPkVQh2/EYMpWheLHwrzBebK5aWYKwqVYCoewrbLOyMOoml7EQdEJUFydlweZf7P0ObzuaebNTOKDFZNMUjE1TMYqEaKgVIgg1FCCXsG+Jqv9nYslVzf4jZKnzks5dCHjy+XjHTuWgVlMex/ijAbygC3/KDC5K8RszDls9LJHDH95aFoB1EE51kvoEIRlIF61EjK7vflN1hEc5eGE2Z4nJHkoEKh0UKC3QRQfjldu0bepJtgaCmwMag5947mhND9yycOZjyssH3lliQ1IKcL1XClFNBtaaiFKGtKgky41FKndjp2w0yuXmijSPLwK2ZmhSTMz5mnlDGMVEEYiMrErEKQ2lQv5m3wMc6eJnCIHM8J1Z1PwXnjVRP0ybzKysUClbtVAO47WFxLl8Qs90M5KMiVnllZ4mVi6QRwqYxIzoWeUw08hVRoLPuV3oP5N+z/BNG8mXJzzo34/VYK2uaMObVh511NrZAtkKQXY2TLC8i0RuP+LLZySNOH5aTLUmsMionUVrUuYAKZY1kOgzSF5JdFDYXEh8LMi+ZkVYpnkXRllbMSyyZidgQX/xj0EPmPljAiVVcBRscXHMEM3D5GbIRJmc3NIU6YVl8qKRGiwMRXRoyU7jU3mNBaBm/LDcThyUmY6sHEUUGfSnTeGRj+K7RyIahVpAyOllm+BiDeMnKrTwH63TAHw+4scrnc3Cyxw5RCEjNRiVwNTaWZbB0s1/Dp3TS11VjyfwbMNLnczkG/wC5gZ1iSYLLl5GlTqByCwKyDdVKHSDrLWWAAvzXybplXRI4Y6enJmAQ34T6Hcaists3byr1QrNVAYb/AIKcPgy6qiks/kbMMqkO07Kw/DCs1IFAVgLC7m7Y0I7saWh3eH/NmbSFDmpImzQjBmKKFUsSQVQKTtewJYg1d4m5TnpZw7RkMQDaqboj1P0IP6+9jCo5sDSQy6JNCxjplyxjDJHIXzEcRIDsGiLx61oK5JskbZ54D9o9onzQhqEv045Gcf4cYsRiIKDdJQ33LbnsK7YcrezifCno0XxfxcC5iKNQdc1qhIIB1FU+LYWdXl3rFT4084xvKrRuBHGWh09iDESCTfp6WP8AXGV/E/iGcnjSUGU5eKNFXMKrqiugVV/E7A2O6sSG9bApVeKU7tHBN94MjzIev03YxiQMe9EAOwoupG7Wd98NGp4vYzg45oeXjD48AJ93y725BLut+XuNF9tR7n2HtYwlOB8bGmmdidWy1qvb4rvve39cUHCsgTGvSQufilbehd92PlAJ23NtRrBBwjlcSlRHYlY7INOh29gb8p7kk7AAk13xRxjFUIrbsI8i/mBI7gAXSrY3OqiTYvfykn0A3wbctM1hCoLAbHpvRIFhkokmrAUEC9r3vAVyby7mXkKOmlUtrIYlggLFkoG6oG12II83fGr+QeRo0iMixvZYAybSbMCSy1qPSG2woGt7q8cPJKnR1Rj5YqG5dk1uDFpjCnTqNPI+kXp0uz0L12aFWACcNXwJ4i8TA6vI8o1U1rVkBztWgLVAeY2t1uTdczcoSK46T9EmMoTGA+rck6BY1NQJLb6TXegATeHPhrG8kKqryCONLkYkBRuxEvlVGYaVGhTQoDTteEi3aDJKjQ+XyBoOpseljtgh5S4O5YO8pCj8gA/qbrAhzDzMmXi0611etkD02A9T+mAnlfxyMbETRuVJJ6iAsoG1WO/7A7Y9FyUZHEoto0TxvOk0ooL7f874TfiBkqbUpIIP1set++JfHvFOJgumVabsdXtfbFfxXNiQbstshKLYs6dyR+mKSkpI5uvUCuIZ0PqDAAlaBv5e3vft+2MI/a24aeqNySKv0I7hT81O6t7MFNi8bL4tzPCsixu3mJHpuAT8R+Q9b9z88Ya+11mZG4nJGD5RGuk35WVwGsf+69/cfI4Ti/sPLERPcJy0oVvxUUMB3329rq19/fBDwLknMfGmmUEGqlXe/bURuR+Xc4gPyO5AMbK7eqalv5ld99vej3xJ4Lw/MJZET1EOobFgVsGo+U0R+W9h7YtN3piRVbDjhyuCsReaJo5VZ4+q0WoH4wxAoWp0BtxpP5t8M3lfxjzRzKpmo8skJSVKjjkElHeOGF/vJZmZmUKF3BLEUWsAvDPFuKQL18okqIrqGLDqB2C6tD0PKWBYKCKJ7jSLs+ZckpKyqSI2HVjGoF49diONn1liwCAq40tZ7WDjkqsSR1J+maOzPEo8uHeUJEpVgw2M2oCgpCSMrugZdCI7BlbU3baVluLxyx5lNDvEpkh/CjkjCtpKtHl7IIGp1JcBAvlpj6hXgPm8xNlVTpLojaVVmZ21yuzs0pijovRj0QlzqW1CigpGHLmM2N1AV31kMijUjMkY0xIg1BSGYbjSpYKDurqISw8nQvwA/DuRpkyoyrzfg63ZQFHU3mfpxvKNRaE6zZoTOUot/FE4P4XxwZzMzQ2cxp2UoOlGGLB3r4ihCxkBVDlZNAsa8HWSzraihZl6j6ltlX4Tq8p1FEaIO7KpOokMdKqAcd4oY01sNaagwdy+oBokDID5aKsNyxoyqi7kFaFsN0IHmP7N2T60hR5oIgY442uKRXzTyMtuGBCCRuikdCOG5WAI6Zqbwz7NMizo00yZrLKZUkUgpLoCKNcZRqDo1AF2C6Fc0bBDphyP4JcVpcLIIZNwusaTGytrVOmGjbqN5VYUqilx3izIXWskhYSUqqSCoL6tGoF7OgMfMKoefc7YPdlO7JMuRrSsf4aKvSVNxGE6aAaACNwVegzFtpaHmWu+Wzh0iTSsbBtEYc6vKB+Jrona2IjRHY7knc7ceGcQQqFYqzKAuzqNFlwAFL6jq8/lDWSFLFbUGbn80oWmMnVGwkQq7OQA5RU31liSfhZaXTqGm8ImSaIHEcx0xJJLGjBDqjDMgLMSyqlamQJIpUa9VaVoqALK95t8VctCsiRRl2mFTGNpCH1KVKSA6VEaBmCrCFo6TfvceJ/iF0UOXCiaUg9QMh6SoGOiOVpCNUgGgDzDyHsbOFFyJmVXMSTtG3TRgz9HW6IxBOliaRFCg04J30tW2Iydv8HTx8aq3sWPi54JOvTKxSjMSF5aaVmXKxK5BZj8K+lDUXXS1AnsTwZbM8QZIGOsily9IsahkUBlB8g07amLvvX6YMfFDxDhngVxIzRtmGQ5YPqmctdkorWFSMIodtnLFqu7KOROQ5NC5wHo1FIMtlisysNJVC8igqfOvmAoAIbJJoF+8mkitqKvyeOC/ZpdY3+9SOjMToSKVNWoJqp3IZkQPQCoTdrTXS4uuCeAU0GeGZSaNIEVykWlnZo9Lo0dyE6UPl1MWaQEnygjBzy7ncxIXEjurK+leorK8oVVbyEsR5Gt38zeXQNqvFvxbiqq7aUaRqNhRZTcgFidI03bP5gCaYnsMajlfJI98R4UTGBKREhjOuOG2CbnUqydNWKAECgB3BvbFTwvOwq0Uf4k2jUF2JVRTlVl0lQ7haCyOKonezeJGbyLTLJM7GIshF2SUUatQI2RgSqtqIK9hVbHtlcjHEpWLQNW7PIGkLMdtZHZ+kFYD8qigKFWaJ2fZM+pYNZoKSFQaAzEUq3QI07jzEeYK10pxODtRAAYahShtTE12eQldxu5oadqJa8U+ZzIuKONHVF0nVIQrEuCbAbzt593AW7YixW91EVP4RGpy3mvbbsjorC9JI2cD4VIvtgrBtgB4utOuXlSFFzHWDNIrKXCNoUaUQAD4lZlJoaxsSdsA3h14VSZkRzZ5PwlkIEJX8R32jjMqsbSPZ/IraiVJOlQww4s1LKZNAAFlqMy2GZSCpQahS6r0l1Yk6wt1j8nFiDrUBmLEK0aWqAyNIxIUF9bspi6raaRlIFE2MXZRSaVI9cQnbRqUm1cCMCtmIVSSq+URx7t5QW0qdqYA/o8vMiIgtygJZG2eUUul1JOrVIRpJsCttG147cNyKR65P8A8WR6N7eZBQVV8x3rahuVN0u3g8EZIYU1NCzyKpay5K3qKuzKwUuQRdakLAbkYzViWQuI5nqiNn0p+JZRzralLAyODdOBTIqnUenRDVQlrE56ihHaR52c9RiRoWtgY9OiIoSGCHUX0EkUcSzwAjR8GoKSoHdX1FRVncqGZQgIIOo3viJxXKLG7mVkjJIFSTLUytq7spGplBJMbVq8i+1DQHki8Azbg65SYjNGUjhmeNtLB2cSMYy6MrqOmAWFKoDUSuOWTyUjyMG6+Wiyp1xkGERZwsNTSroR3ABHnX8KVQNnIbYXbxTykMRv8XR+H0kjFoiGmA1DSqmg6hfhLC7JvFPxXxvmkaIZbLoWL7NK+ppL8tKY6NC78x0nyk9rxu6D0Y28zCgmFIKkZPOJNQkK6/gVywSFHAaRSikqVJBKg4Guac5EENTuQrPGWQiGdAkj610tQZoj8B0lWWqViA2AWKTiUznry/cnBBVbVGbUAFKCMu77adTHyuGFsQScQsp4dqSs8jv1VkphKOjCz2TocuepXkBaRV0nbzCiMZzvSMoLyy95i8ZIIyenU0OladS+jqAn8NaYtpkRVWimxDdtWKfh3PPE5G/Cy/ldVKl1ARNKhVVJJCuq9gQVJJUEE1WIma4vFlpUmBhWIyFm2JhdRZ6wGpmiYlAujyMSAfzFSMc4ePGUidzJIM+JE1s0RWVIpASyskrBWB1spX/8PSwbUKwFGTKV6QaZXko5hAc3m5lfUV6AZNIVHUanlCu0ZN6r6YABsd7M/i+cyGQ0vIoy0U2hUWZ2mK6WOtI4nBTpF0jMhlQEA6gQG8qa+0V4752NogqNl4cxCkvSc3OSFVWaayxR7AAJVWdbNCzhNxcEzvEYzKDLIYqQMzSTO11/hqSzEBygcRja1/TojwvbwjVezTfGvtIcPR2WWdp2RvwRAkyorBKZopEcaNTt8J7MuzFThUcS+1e6sxy0QVSixlMweuu3eRdRBWSyCKJUKAtEAAM+L7JmQhlb7y7suYEZyoGqLRJo/ESR2qM3Jsp07bJpvzYH+fvA7hOUDZiRMyMttS9ZK1MoZUV61Ekhog2qlcgEHsHShdbCuqZnLmznObNMXeQFt/LZVRuT5FvQoJ9FqqHsMceWeUjN1NZEZCjQx00W28gF2Wrfve2wOCvwn8PcpxHiPRWVstA0n4EchR53Xc9MtshIVTrf0G4VjjUh8C+FZLORjomU6NEkTHrRsxUhZFoMTKrA+igo2rTbLi85rjVIdtMSvLP2MM7LCJvveWjgIL2qyyuqDbUyBUAJbai1gUT3IBtyr4CLFJKsL6WVF6pmUSw5uEqwTMwICZY2MiOJYJTcYAK0DZKPEjx0HDI4cq+QeDLz65FEkR6DpRVg0TeeRlbTYZlJQIxUBltX8F8cOIZoPPEY1y+XVMtmYWM0mqKQkrmGAVnCh9QFt+GPICReJvvOOdE1J+AmmyWcyz2/SWJRIY5NUhW1pgNEZDRurW1HynSa7ra+PHBls1lcxJkmzWelnR583OssWXbryBYUycZ0QpKgopNNeqgxUW1Hvhj9qLJSSiDNZfqxxkvFo0lGcNdjqdiK1JZNkkBdxRx4nfaFgnXMQiBqaGgZBuFZSluqgWUO6Op13Q2xGF8eH5C25Ah4nczTHPxzZbLwTFXzGVyuag/EQzByJoZ4z0xFmIUVpOqSI/xCwJDMBC4N4YI3EzLmc5mBlofPmos20DHMTF/8CGHKO0bwXRZa1LqpVJZtKm5M46uQzn3XMZ3OZSE+fMSQAK4meFdNxNqUEoSjy0W0NemgCrT5k5O4jkZcq2Qjmz6Oerl85HGpcO2rWpjbUI+oi31GIElbUdsdErVKIn7B7xu5wLwJlsijR5FZAIsqVSxJJKGidUCWNcmkiJwWTa/iONjcjvmo4cscwoGYdI+vHE34YkUOG6NNpCNQ1qSSKsfCLyryFyLxPiPEMrmc5A+Ty8ci5hppfjzWaiYdLqLrSXUWj3ITQFjbvqXGsuLcTKmBi4TLuGMzghY9YA6RU7aZHCsFeyrWynzFTiU8RUX+xJtN4Ehzf4GJmDNmMvqysxaREgpRA3RddchGkCLUA1b/ABCumWBsQ5X8Cc/IxR+nGiqlzCUGJG0sB0yhDNuF1qVAGxLUKw/uB5pZuuPMy6/LuwhI1K7VqBLaCSXCXGDZ3KnATzH9pTJRGRMqGlzLAwhIoyYtSal0mQDzaQTGaG4o164mmKoN6BWP7O+Uy8uXY5uZn/Fkd2kgRF0KrRlAVDJJ1RUeouHCsSdQU4jeIv2ol19DLhpZHLRJIA3xO2nQiecTIwth20ux32Ixa8N8KoZoHzfF5ZYU2ZolYGRGJpLJDtTNbIqKV0kj1xR81ctcFGrKZWbM5PMIt/eHEnnAUnR59LAy6xpIMW4JW/QqV/2OiPHFfkveTPszZmTXJxSW59DCPLtIZjGjDWKk2plNHpoQq72WJoAHjX4SHK5iPSYI8nJGLjjaSIGaECQyPCzM0p1fC/8A5dqGL7J8lS5qMw8KzE87wAR5t55njZRIFYMXkZg4Y3aKToHwntis58z/AA/hxiTOO3EeIw5cnpFmkyrSEnSrGy0RU2Cr2AtEqxK0Um39Q3TyX3B8kc3kFaef7pkk0iaZnOifUpV4Y23KrQHTsMmrZtRFYAud/G/J5WN8pwhCInRo8xNOuuSawfOjmnDJqYBtkYFSI9qwmebfGvO5pEyzyaMoslx5VAEhj8x0rQALLHfkDbCrABN40RzL9nDhvC+Gfec+zZrMSydKBYnMWvUC3kTXt0lGpy2piL0ijRtHhUK7A79nSMpcQ4ozuS56kp31M2tmIHeybJr19sd+GcXmyksE5iGpGE0QzMLGGUA7WraBLHdA01A1uDWNm+B3hLJlMtJHLHFLHmujmY3fLkyxSKAXiDOLUhEUkLRViWC+ZgG7mOXYJVhleKKQwPJJlxMod4nZT5Vby6QxNHy2rKpIJUEU/wD6Ip0kc8ouxH8mfbGyc8d8Uy8uUk+GJsiJ0geNTeyBiQ0b1t5gNjYIofuO/bM4X1j/ANlPPEo1RyFwHeQqAysk51LHd2wOpiFOkg4CPFSZ+IRqdMxPVMjOQjxQyMp6sKuoU1qFEEdlQmyCcJrjHhrOFLD8UKgkZY1diqA0X2BpRsS1gAfQ0I/HJ5GakkaH4V42x5risHEMrpXM6Ok2TnKragEFVk0qhkk1WrrJa6VHYMMObxD5LXOxyrmmzEIVjKjRzMsqKxorYLoXAYjRIroRpoY/nbyVzGsGZhmZBMkciyMjVTKpurII+Y9LA9Dj+mHBc5muJZbNhEOVT8NoVlQrP05ERyCvmFFRY0lghHYYTl4+jwb5OyRiTnPw6ymR4jDH95m6ZEc3WdEk6che4jSBdcQIHWIUMBdY3LzB9pLh+QiSSRhJq0tGYEMvVBSwtqQFWrILhAuwBOEb448oJk+Hr9+VZCWEWXzEcep0un6QkBFKQpIFgXqXRYFIzg/2e5cxlZc8jHLZZEsddWBzABI1Zcr5ig9Cwstqq6ssmppOQawMfgXifkU4lmJmgiTI51hIPw1aQDSL1Ro71bjUy7NZ1Vu2H5ludI4cu83WX7syIISuoxRmVgukKLI6a+YgghVsbgGlxy/yQmZiWLOdCPPKifdsxHF04Z4wgqyGClzpYawNwdhsRhP+LORzOQCwyaTHJq0iNriIGx8uwJVT8VCwwI7GudrtLA/1YwB9mTh0meZus2YR36gh60CpJrLk2YwJOmrUAioGKd9W+GrzD4O5Nsi2aYmCaAT1HatCtWsaOpQsyhaKkEPqoX6Yyf4FcuTx53J5sRJJDcsisSAp6QMbAEHyyRlhVjvXvtqrPctZyd3bNEDLGTSYFcFpFIDW6i2GksSGJ+fl03h+S06bskI3I+Ij5bNOkMuXzMc7JTTxyIHtLPqpy5LEgNWkjcDF548eEcmciimMwXMx9KEwPOPuyI+kFUZl20lVOvVTLYNlVo4568G0WKSbLxqxje3ib8R2W0SOibAZATRo2O52wLcR8SZsozxNkXDDSCJBqjcdtwA6tvvYJr5UDiSm07iHqnszn40eEE/DzF1o40EmrS8UvVjcqBdGgwO90wFjcWLOKObI5jKdEsoRnQSqbViUcHTeknTY/K1HttjcPBee7iK5uGF3c6okhCyoU8o8ysG0MoavQbX7YTv2xuRYY1y0oYHMuFQJFoAEdE/ij4mYdkdT22K72Ozj5u9RZNx65QBckfaFMSzPJHrzJMZy7LSxrp2dXS99S3uBZ91IvA3z1yzmpLzbRu0c+qZGFuqqxsrdsVC2AA1bemxwSfZ28ITmc+izxOEiDSSRzQtolQKQUN1ROoFTuLU+2Nk5nlnK5fJtFEHMLXGuWrUwDHdFU+Yg2aAJC1VnAm48buJZO4/Y/m9wfg8sr9KJGlkb4UQWx9dh61v32G+DzgX2auIyyFBGI3QqZOqSqqCAwJcBlJIryiz2xrLlrlzI5LpCWLQ16svMEqWDVdqsnc6rthZHddO2DKN3mSRF1Rljq6isoSVFOxUjbUwBBBBPfYjAf8l+CUoI+R8qnLxLO8Jl0fiyJTOzgnYIg3Zr8yg7sAB7VWfaJ5QkzWR0FEywT8VA7AGJB8RlVBXUbZY4xZ8xtttizM8Omdwok6UaMqny6zK4uwthhS2ATRYnYUBjr4hcXC8L4g7zEumVZE6qqT1XU6AqoqnqOdIXfVZUUMefx4aOnt5P5ktlSWIBFj0PsO/b+mCeLw4z7ZYZz7tN9y8w+86fwfK2gm++kN5Q1aS1gE0cNnwx+xxKQZuKSHKRBY3WBHVszMHPmViRpi8v+YsSb8tbtTx+5wEPB5U0tHlHEeUyEDqV06ASG0oygJpBfWykll2A1b+pLlSaitmUwb+yczlJoEheUSvAHcBiDR7MwICKL1bm27AHDU8R8pmo5srMemFRXymXjjdh54tQLSVsBISDQsggX88y/ZP58zazywRB5XcB0jaVIsurLSmWZ2BcVahVjVyTXlNWHlzTmc6cs7OULK7CSaz0kJ0g/domJb8MneZwms+b/KOL+RFpuzXbsbXEcnmBGrLl0MhgjQ1M0g6pbcLYBc7As2oWVosAcLrnnmh8pksx5WkmkZJXl6cjERhmbqTug0KpJWFVLHSi0tgk4k+E7SPlo0JEvQQkymQrGSCzabOpmXzIXKx/CAqm2ILAyXDG6scDxmSMxzSzTgBYtcjExppO5ZwfIgXyKiEkE7xWSOmZBy3je2WzQzEUZmkZR1UaPoJcqksFBsFqohtIGmvLhzeFk3H+JfeMxJNHw7IO2tTLEXYRoAQMquqJun8I6jvpY9lZSLLcx4V8Fyyys0KzyK5YffWMpARFEcaj4QdyzF9RoEsdgMLPhfjHxfiOdbLcP6MccIHVmkQyxQotKu6jSWNBo4QB23IVTVo9apLIsreWNfnLiPDOEwo+dmmmmkCqWmYyZiYqodWEQqGNEBsoqKtkasUvCONS5vNgZaM9MsJmkFQMwcp+CWCgVpAUI3oS2mqxWwfZhZ3M3Es22fzjx6oWMSrFCiMrNJHCx0MAGAtg17BQLJxKzPNUkOZgymTzRkfLRTySKUjkdvw7LOEUKJN/LZ0ooFn0CzS8ARN5d5jnyOdlWcR6s3JrigSXrtH6NI8jhI1WgSVGwK7d8W/HvGKIhhDJE4DBOt5ZWIFN0ooVUGVqrW2tUsnzNRGOXh8sggVxD+LJRmbMDqZiQMwCvKNkTVWlIy1JQ8oG+DPj2ay2RywlkiSRctE02Z6axl7ZiyhASqgl7ZhQBVR6YTPgOPJnzI8aOezB+9zHor1JoUpI9cu1dQiu1bDU1KBZPY9DxThkfV15hZpkHVkiR76jKaKWu7nUQoAAH7Y55rw+SWTMcQzJkSLiDXlciAVaFbRQZ1ta1VrKIA25BJ7Ad8RpMjl5WE+WZqB6MahYo3RNLEydNvvC2a7sAqsaBoDDxu62aVVZxzadfphmCzsrMsaAj8M0NIHyU+W+41NgL41wTpt5gLI7X21fCCNq2DOf/bhw+GM2ZzZjY5IQnQ4j8ronS06i62dcmpigUsNGkAa6vEfxF8HGlHUyrpK90yO9gkVdEAWV2v0rsfTHVHl64ZzuN5RnnNTkSAgbCyPTbYk16Cu3v+uJeQyFyC9yxeRt62AY6RfpZG/6egxZcd8Op4XJnI1N2N+TszGiu41LsLUEbXW2Gd4dcjxFEzLUWZiiHtHHpq2cAam2U0tnsSR7O+aIqgwem5cXRGF8rKA7n1IXcL2INNsD6kgb1WFpzfI8k5dzSqfwYvULHszseyg1YvdjQ2rd2808ljXqWYBiut0YgMyL5tIXar06r8te/YYT/gzy7LmuIlSTHlw0jZiRkBYRAkFEv/1JSVVdiVvV+VQRGdpsLjoGs59ziGqnkYgBUIOgDb84uv8AxHv6CsOfwS8NZcyvXzMaxZWRSkEJSp5SzimutaxAK4LkFmWtI0kEvLiPgFkD0I/useiJl6IfXTB/MZZQJLkdyFBV9Rbcmrah3xB8bY8rLHAkJnzNCN4kpSmoahclP8RPmRVJRALrEu9qlsfrRTcv8HyGTiVCcvEsgdmMziMzhQIhqdirBF3coAENKtEsxxR80cyZXNR6dcsmVjzLg/dwqrKuqxWy3GGKgLGSAt6SdiKbJcNm++nPZ6KKSXpgQwKodSi2q0gc6VjOs6iNRLs21AYKOY+bIhGJ1zaZXN5aKWsk8CvFL51McYjNOzOy11QzUKbEXulsvFUrZz5W5IycUx4gytFlopnDEzO+4ULGqZdVeQux8mgv8Z2U1jQ+d4lGqddID95eK5YHcNKkIUsdVM4u9JZQDRpQTWMq8D4PLPBJnJUifOTyK2VaTUI4y5pZo4w6xRtGbbqtq0ooI3Yk8eX/ABsny2ezSqTncv0OiHbRHKzKEbqNJudLymStJZ5BobsN849v9FbikOzwz4zAssjLF0FX8QxnsdgJGOsnY/l3vvVAYp+M8/TTZeXL8H6CESO+YlZ9Kr1vPpRir9d3YfwuiLQsDTdF4AZPOusmfmRZVnOgrmNSQ5ZXenzBNN1FolIk6b/CW1LrDC9474W5bPtOctO8cscTCdoOnDARdHRCuiQq4RQFs97Ja6wkY9ZZH7JkvwL8RzmUKSnMNLGki5+Zo0gy0ZVjohhK6VKM7UWQBumpZ61IMfOF8lcRVFzmUlAfMaF6bkrQJP4jeQqSVAYaVBAKgEknCX8OefM1wZsyjZZ5JHjDMJZT040A2KxKkilW1IzuAG2C2PRteEn2j587NDlJssUzRDvIxXpQxQA0jKju0pAUxj4RcjCjRGH5OO8ozg1nwH0PhRHGY8xmDLmM9l90kTqFhK4K3HAGCstO4qTUQpt22wQ8ncPMmZndjJFO0WWuEzhpVRqqRgGMcbRuHqNbRTqbU2pAs/inHA0c5h0kIKlZDehltdKvfnk7MyWNNjUQCLEOJcQiyUE+YmlW5FM0kjMfi7pB+YvQUtoQ7s1+bVZhnRFoKeZuT8rMjNpDSOs8EMjs2o9UghmlouU1HU7dgAFB9xrlbwxyyJSPmjmVUx9bXpapNWqRISwh84Rwh0eUFWJ33MM6iSwxS6QY5Y1miRtUanWokJkXyue6qEPlJ/IaAxy5aySFQrvIxXWZCAqR6ZAQzfCCdDNoUAEJVlQTtrth0hWcS8L500xxtPPlpI2lnXSk+mtxEVkkjGuQRqKFhW6jsKZcZ04dyDlwZTmYM3lw+YVsnA2uOVoFWgW8p8zMVWipUAalYrRO7c/xX8E+QvIvRXpK4XW3WUmR2NqsQBDM3nGkMoV2CjGR/FaTiC8TlnfLtKJ3jjToo7ZdWYdNUEhVWiVQ6ByVC+az8VYrG1oykvIPcxc1ZrMZboSAyQxtEOjALmCLskbMi+gjHZQUJtqrd2c3/Z+yUuUiSOSPJENAsSOEdQzhxKssetGklYvXULarUFj6Yq+IeGpb7z96kSBcuIygyr9NukIOp+JIy6wrgvEoj3Yxu3qoCs4PwgSPHnKC5Vj93y8M0skr6VJEcqCQtIw1AKG9G1GtgcDKK2mGfMvLPCuG68kSZ5SzSKtLZJZVi1hbvSobREgYEkm7JOFhx/JxwZlVgglMyExiIu0DBqvW9spGxsrqFVRKi8NPg/CMnxLPi1lMuTVXtCVeWRHXzGWi4KyBAFtSbIpQSMPDLck5OOaTO9ESS7xvO5Z3+BQzJ1GaOJCQ5YKNR0OSDte7eRXSwJr7OOVWXJ5guQ+ZSQF01BhGOm3QAO7U5LK0Q2LWtnTeGpzBx5U0QKSW6ILaF8wVgemjRxkHYDvuV0qPz4teaslUkcQ0oDHqkaMaACqDSzDYlk19X4S5PZRucQDHF141JsQlXmMe9SBdMYZgTdgmUqzWCvbejKTt2IT+ZeCyzRQMGMDxyKAiAdSVQPxEZb6cepdmHmIXvpIGBHhfiZxVh0lhGVW3cFiqBIVYHquN20kOtGtTkkDZbLXp2JDIi7NqDXqFKbLV6KQCKIUuSLwuM3x0zQmSFCymPpxiJlGoFunJ1ZnBCmPcagzlL7FgSGi2jMouMcOzQRZZJDPK8jp1ALDKC28asNlJUjYk6RtZOB3mPmnieXLP0RJFsotlQBzYI077qosDtv3OHLwHKJ/2cTKz6UWTUWYxqURQri/jOtq1MCGcl+1DEPnTl4nKFIWbVrVLIBCoZBrkegBQDar3cxgqALsLcrDigX8IucMlnVCzIY5AzK4bbTpJAJY1Zc2FUem9CjhncQ4jJC+ldKIqnQdPmVCBQDHfsB/P3wq+KeDWUi1tqlkliqQyGV0U9PaSQLGoUIANLru1nT74EuffGl84kaQkAtEzySLa6FUW+2k0I1FEfEAR61jsjJNYwc0kyD4seJUUMjysRqVSQLFsaGkD9cZJ5u5jlzbqzm2C6AT303YB+lmsN2PwJzBH3jNNcNAanJNkhiG0mmAZQCupfMSu+2Iz+Bss0ZzUH4cUZYKXHnYIVUyEAFAqv5S25sEV5d7QnGBOUXJCdfl+WNgxJ2ZSaJvv2BOx2xpbw8jhmZUHm6tBTuPKxoRqLCk0Wvt3a+wxS8G8OZc5mleJIzloemJdbOEbYuyhRqfW1g0dIUbk9wdDQ8lGNU0IoKNGLYajlmIQSHphtMhOpY0QMSrDcAEqU5Z9q9jcceoJZ/wEyMmYGsuqJGv/AG4YRRgKGLFhGNZZjS3e+tLJrC45p8J5Eza8Ph/E6ijMqD3y6vasrAszkxgMFFqXJWhZsaW4ZkyRqYBQ4VgslaYtThgruCXkVq1FQZCNW4Ux0ZuZyBJk20yO4USHSpCoI6JYNvZbyLRCAawlXiSm1so4or+TeU/uUWXiiZhEhc20j65bJMjvaNoKSW2lAFDtQIA3ttDKYViSRTrUSk6EMUZ1dQybeeSXsHNuWZbrc4ljh8RV9TnS0pYgalJACxLGpAuytSHTpsNJbAMcDHNHiOmWikFoko8kKi2ZCSVZXtitC9fl/MVXX5dpNlYr0WmV4Yz9QI0K0AA6ojBWYkUCV09WSxrdnL7sNHwg+uF8T6zksioGborGyhmKgBzrjARE1qhaPSrMsRFm2UYBOK+N7WkawBItLho784Wh50NkAgEmMEtuQSCTY68t+M0c8kMEeXmi1h1jbylzIK1WSGcKQp8wNhztQWgnYfqxmZPhE0hkBKpayI4cl9B6qlAAC4REDuuoi3Yoe4JA7kog+ZlAaQ65XBdgQUUQgFYXLhaDykNXm0ozGguCN11qYlZVeVWTWuq1BC2QCGGnV/hnuZCCQKrFDwSVjt5ZjbINLs5jVa0JKLRNbKyxSDSKAB1NrskVYO/K/CwksllQr6EDlwwaVLjdYOoTaoOmOpGTqfqKDYJxb8VjjWXyNpBAto61iBFJJobQ6nbT5QpIc99BUDPDJJA0xkjaJEYLlqKySFB1NelSahBoIQSK9xpbV3PLRVnkGkzkJGNHmVUDKztTKQzxxvS6tZKqVAUHVjUBg5xHwEh6mvMTzya26hYlPIQ4Bs6Ws6WT4iSS3w2Bgh4xyJDlcp0YZZICzdZnIjkkcSMVlUrKQATEpAWqjVSV9cT55unGnedo1WIM5IlmkBPlItEUyFgC1jUotb0knpw93dnYggRppaMEN5Jgrl1Y0zSLSqpNKR1tO2kkaD2YNS+FGT+9ZaRQY+lN1FjURCOWow6sSACNf+Iq7ClWq0kg2mmiYnUzSKqHUisaJJBCjSwFK/lskksVJBo4/ZlTXYIpd0KjzSmQsgQhmrSteTQDvuNSgAY9ZOZuoo0RgXak0iR05okLevqDzFaJJGkaaOGFbbPEvB2IckiFQQ5KoF6NOBoiYUNTAOGkY0TsEogY7z5MfhOAadVu2LOQm4YkCqVW1Nfxmwfhx+/6RRnqo1ddSySszaQTQkkRriB07wxqVVALO7m/PFc8NDdNTagLpCsvmKEWGJA0bWSCK1FiKG+Ad0z+o+WMENJREpr8rEgKLIrdip20keU74j57iLujBNMkvl6axBlAIYHqOQWFBl00RVEAeteuIkBGZo0FIJHBaQiMqGOkFASTp8xYC3AOx2qp4bxuUKZmjJSaWHpKI/u7BHZE1sDM0gp/KWkAcr2jGMjEiLlAvIss26lCxAktmljUKNRoUBbDyuQTp2rvYZyJm6MysF02JnMYLOhRvIrWOmgIBLqdx6XdwOZuPQwo5mkWKirsVoylTMlBUbdWlUMqV8KA3ROA/injbl3ELRCRwbfoquh0SxvKDQkZq2XzRqh7NV4DklsKTYfSwRkLIu5A6Ytq02W10+oL5LCiyTuu4AxX8PzsWgSCQy9S2CR2zMAOkGpTp0aR52oD5ihaq41z/mnCwrlr6sR0Npcfh1+I7LWnVISCZHUBaBWtW8KPw1zeZWJ8xm+koOiKMRstxht0/Dj06jYJRyRQLMQFbCdvQ/X2HHNHP0MMXS+8jyq0TyJIX1AKxEcbKNSs/mV5L1ogFMrNqWqyfi/qZI8nD94NB4A4rYflZe1IirTWSKJZrNkRi5ZykEUnVUXUelzNGCsrSN+Q61LUAC+ykWpC3jtm/tGZXLBS0SBypSWSAR3IK0Kbb4A67yIoUbAr6HG+0hlFei+zvM/E5VJMsOXSdwU1HdNtysgDMnmXYMbPfbFfx/wgYqJsxmmDPQW43meRANQYRgl7bslMbBQ+W7wl+EeMitPK2Vyry6SZ2DMZFiiQWWk0kKijfdvi+CzqAxx4n9oXjGcPTgdgkT9VTDEivGDrNSS6bCKpYKGIFDSNRVcUjwSex+reh78pciQdYoUCAE9TrzoGURsrdRAumo2RjGV1WHIJNLYB+Z/GaOHNyJlswEysL0seWjXVKiFrtgp1lrKsWLLpsg+uM7ZedXniTONMy9b8UKV1hWbzFRJ5QxO7E+lnvjZecj4BweONtECTrGxg8skuZkYyA6dbEtpUhVZy4jaE0KFXT4lHf/oLjW8iP8SvtBjMkPlctKhIZnkaPYhSTGIygKLEKajYBC0R5DRX4a8wZXPw5WPP8W6UrakOUi8souRwITO2tnaYFdEaItaiAxIBJRy54+z57MJl8kuUWSWORY0zSsUjCKXdVEalqfUYwpFMpY9TzVi/4b9nXL5fq5yPpnPXs/TEOWSS9VQ5cayqSaPu7tbMCzlSpJw/1S0I3WNFPwb7FmUn0yxcRaaBpo3njZgwCHy9ASCTbMA6CZGClNVaR5cKzmTlvI8O4zl4naGVctmYw0WVyjvMYWYSI2bM8hjnlCsokVbYhRIoGpRgEm8KeMCWTpRTRZZnkzWrLylcuq026NqXzxopiUH8QaADVA4FvDfxclyOa+9RnqSi1JlJbWhI16jerWaHnDahvvucdcYOvYt+2bX+1N4HZTPZl5xM6TdHpw0VOWLxr+HGzNZTzPpYWqkm1sijjzlPjPEsjHmGSGboowV36cgTL5jZlbqqtI3lBZSQjjST+Ulu8nc08T4jnslnpIHHDVzAVyqj7uXpk6ksalWcGTR1G0lfKD72yfGPm7PRRLJlVkllWd0mVIWeIxsrqGdCzrKJSAFdTaVpoEHHP2cPq8lYpNC88J/tYZVYwnEkmaRBayMryISddhEUhojRWvKVLWxOFl49/aSfiKCCGAZbKI5ZV26kgBteqoJjRgfOQhJLblzuD08YeC8RzvFWgbIlM8UUHLQgEkBS+stens1li1KAqbaQMXuY+w/xZcoZmjjEwYs0HWQsIAlhyRsZC9p09R2o3e2OqEYR+xCUUmBv2XshP9/EkMcR6al2mmDXAAp80LDyiZhYUENY1bDc42PF4vJDlYC8fXzJndHoy+dNRIJ0jziQFNKAd7UVjG3glyzM0/VWePKCF49pg9Tytf8A28aaSjzBLZleumpUkeYYe/HuJHhSHOTSxzSyu0eWgaMspmU7mN42TpOBfnrayoDFhjk/kNvkSQ6iqCvx9ysvEYo8tPlJEnBjkRdavNGGUqCkjMSglVWBjrUoBJIOA7P+Iw4LxLLK/CossrxRxzNldTtMtqKVEVYpZ43G60XbVuTqFj8X20+IwZhWbLxwFXD5iMxussw06dLdQXF5Tt5bBJbfURhoc3+MWTz+UHEJ8ykNajDlmVWlilhCsFg7uHLjdj8SgaRVEFKUVnKA1WDP3i9JlMpxvOOuXniDMrrBPGqAtIgeZtH5VmLXHR8jM/8Alpy+HHLmamyn3nLpDCz5TMLk5HjBlgm1AJqd9Xk+JULA+VgaKgHAV4weMXDM4+UjdZc/FLolnjy5EWYSURiNEEjeYs7EmVC1A7g9jgu+0BxvPvGmVy3DczlYQkUQkUq5WJQqjQIHZiyqwWQkkvR+RDSj2pvYqfgg/ZW428+czK5yXL5nNTQQ6Q0cZn0REqYy8aqtKD5gLYHQ1mwcarlnB/yGMmRwGIR9WpdA76QQ+1gFXBI3BIzj4W/Z5yPD8zHm481JMhgmUSSxiNYHP/rWq0VdQ0aodLAs3mNbN3jXMXSDTlo4IqAvMoxMMS7spjU3qlBOhnZyoKkgHEuVpywIl6LLP51XkZSrBYZKok6eswEiIrGrCkrqa2WzXviDzPmMtFlJZJ5FaCNZTJEXDFtZJpArB/KxIVAfmPTCj518bsxmHcZDSkNhFlIqTW1hqaTbQW3F7/DR9uEHhRI3DjxJIlzubCyCfKTgAB0koTRMhpigUN02J1hgditYmssquPFyFnwrxz4hmVTKJEVB/C1QQMKZgdhIFAXUpptkB70Cbw4eLT5XhMOSVQhndWd5GVTI8Z2fqqLJJYhdza0flhb8h/aeeB2y3EYCUzDK7GNRGUjbzKvTQ+YFgd18wB+QOC7mvhq50SvErR8Ly6mSaZtRll1WSsTPbCKEE7Ar3B0tVYaaoZp60gd8dyc2cr93Zpc64jRYIQTEkJRXXqW5EbxkGO30ijd+uB/mLm/LZeaJuJSDP5mExhosuy2YdDOqzOQI3dJSAyEgkHud6r8r9owwRzZXhWTGqRG6s5jOZzMkZXTIXUKaCDZJBQQVteM7PN29+1G72+u9/LHTx8Nr7E3ydMIfPiB9qXNzhosp/wBhkioVYIljDgUb1yIoLXqYGq8pA/KDgl8IPs4w5zh2alnYxZtfxIcxJI/S6RQHXIOzBdy2+oeUg+mM3ROyjtt9PfDx+zNz6Tmo4Mw2amXplMtBG2qEGjccsdgmIgCiCAlEnbF5x6r6k4ytg/4FeCUfEM5JBJIWEdG4GUCZdeltIYElCBsRRGpSaGGP9s3mCVMxFlVnV8pAkZXKAgmHNxqVaSQUzRsyMNPnKkAnQPVv5nkHJ8N4g/Em6jZlEDyZOIxpHl+ouhnUKVLpqUEAFlJ1lq74TPi1zu/EOMR53hscgZEUGWSHVG8sepZCyNqj0gMIiD8Ve9Y5+/aVvR0xXlDOyf2ncjIkMkj5sdJo7qCz1FXzNKY/wnDA6K2J2IHpixy/ifJxDMxplB0YXPmd4tDMuxcaWOzgbKxUEne9jhX8vcv5yVSkAP4hMpEcaooQyNqVVbakcEaaGhaAOxxfRQZzKmMSTNEskqySKioxEOoDWgKsGKKSR20gEUaAxySaA0rJ3PPhnDFO4gMggd1XQsupnYEsHCghTT6leyWAOxqsNDww5UTKiVMz1WklKt5kVUEaoQF8rsa89SrYsebC3558ZBkX+78NcTynV18y6CQMXW/Ifg1V8VeSwQRd0f8AgvwGDOK2azUzSxujmSOzGUlUlWTVHWkdMWoTY7H03Xq1kk5WhV+K/JfD2zUZ0pK7dMsYlUOFBFoNJ0MyrWk7NvudsKPnTxq4jks7K+XzUyDW6prIZjFZCq6PrF0e4GoHscM3xj5qQ6splo0j1AAuh+GFCWQsTqOsgAu+xI2O+F34N8RzEWbnkzUDywpDpeRkD9Ppt+G0ZbZgTsxWzVH0x1cd7lkDl9aDXwi+0c2YzQi4kUiSOMyQJLqiT7xVanDr3dSSA3lFmhvs4+M825GMJDFmI3QlSsPUSRWkJ1CNRqICeZh8OnsKBGFdzpxDJ52NppYhKBcRzEgEdErqCqyeawAQrUAO2Ety94cQPmjMqunDIZo1kLMC+rTapWzlXba6FKTvuMNUZ50TyjR/PHGFinFz5eQHV+Gro7QRga/8KhR1ArYo2WGnajIz/NcEnD9uGy8T/LbxExxLsWDN5ioC7q8QJCglmXfFDzt4RZQRycQy6P8AhsksiRVqZdQ6sarITRWMkivKd9vM1tLgXP0GUyfXXMNLA8Z6MDxdOVS+ryFSI776WBBrajiKpO0MkzIuV5L4rnDJmMvBJHAhcwpH+HHGgHmSHtq2UAt+dgd72xZ8leL2fy0UKiKRljMquZFkYtI7FyGNalYChROwAoDcY0N4Zc8ZeWFdF5aMdQdNHJ+7vqJBPekbcCzp9NsV3g/zAczLxCdYhKiuEGoFVlqw7CibLCiT9KYbYpKd7Q6xsueKePQi4Wk2fhbKGY9KNFOqadSA5kRRpZVvf8SvKL31LZBy94qZKfLrP1FXLE6iZdEb3ut+Y6qLfEve7+Vr7x+5Sim4ZmP+00SxIsyyX5oqIalLG9FAhkHodjvjCKZnajdd/lfvXa8PDiU1aJydM3jnuZuEx5eTLRTRw52ScaZNVklm8hDDbRpOn0qx3vAH4leBZkCtmpppDpKxvHRKgEnSVby6SCKIN+t4TX2euA5fMZzpZiAzxmJmoFhoKUQ50MvlJ8rXY37b42FzHzRlVy8kZPTYRKY+mTqRx8AUNua9SDf6HE5x+N4eQpWrF7yz46ywOuXky4sJGkZAd2KqAdbXudrthbem9b0XjF4zzZx1MN6YtRUxxsjE2Duy77UfkTew9SPwP4VJmXleZ1ZfVZQQ2urXpsOwosNPZje2BnxZ8aEyeamyv3VTCy6ZUH4Zu/LIpH5gKIYHSTdj1wkbmwvBd8gcXkzuTmRupJJEQz2NXSvZHUnzle6su9d8fuTM/wARjPSiVnSwC5FAHULpj2JB2/i+eJP2WOOTzZzXkoVhyioUzJlYu029qLBOl12NgAEWDvWGj4jeOPDOGErJETmGKk5dNy4cECRSSE0AjvqBB2q8FcbugNh3x3nHJZV8vlnlrMPpCxLqMg3JY6gNKht/MaB7D3xS83cLyumMtl48xmGm6uWQIZB1F3VyoIBI2p2ACgXY3sb4V4cQ5nNmVbnzFgiRa0hBY/EksaEAv1JN998UnM/2ec5n2fNwZ45SCMyGLLxagzBLRWDrIgHXIsXemOt7JqSVv0UtBrluCZ2cBWUM/V1TKsiuIwSunzWFDoOyDVvV+mM7/b44/HHPlskmaafoIHmy50uMu7KdOqRVGqVlJ8psotHYOtrrP/aH47k4xlnmfLqQwjIRQ+hXNushtn1N3c2W298AYaKXVmM3M0s8khLJZaWQVXUkmY33oAbmttgKHXx8PR9mByKThnD3/ClaNliaVQkzI4iYqRqAegH0DdwpJq/XG7OdEbM5NY8sUzDZqJI0nQdOPTAut28x1aCq1sKrSt+625X45l+KZX7pMGcQHXDp2YEIAFhABULQIJolia+eC77PHCpc1HE3RkROHSCDzSMocFWLABtw4WQF3G3YDC8r7+NFPB3+z5EYcxGMxMqxqzEJIQA07rpQxR6SzMu9C9mIoWTWjOeMkzNmCrAukKzJGLvVDqB9RROoFyNwNI2wgeN+Gudy+fM2XgQoGbonqCRFJ3qm/wDUOogEdvfDb8PObzmV1kASLN0Jle7CyK1qDtrdnIJPYKKxxp+GTmryhR8H8Hcrmo45M2kksy5kSzSxsdEkRp9BDg64gvlcKoO/xeY4IMtnc3nHkOUy8WT4bltYjaWO2zsialqOCORESOMqD1ZFIa9gwUkWGfCjMrDJJoWTqR6VqMeVQFCGw2k77DZtPf2veYOPN5MtHECpjPneRV0qACbCAu22nZQBRokejRwqFlkRPFfGrNAmTMwSJmGikiikjRdKxAhmKsQN2ITQqiiAPcg1/hr4g8O4aZ81mPvU2clZ41lky79NS1u0COY0DPSxmZmrzAKKAw55eLwwLMimNyGEKKi9mAR6U2zPTC5G8wA8o+HbL3jKcxJM75yZdEcjJBCpBMimS3McaN+GKYa5pN22on0tx1pk5X4Hzw3PvLlBnM3O8EM1Nl8nlXdZZQw6cYllFya2+MxwmLSppmbcYUPi99/aQpl8q8eVy4DoIYwsUrrRWbMIPPKwdWC6u+5o3eDjxv8AE+A5GPLAoHljiP4R3hQNahSGsLt5Qd2JthVgwfBLx2hi6OThyM0pDjU8b9aeVzSCRwQKUE6mGoKgoWAt4MVtpAY0vsz8YzmaYS5tQxWBwJjC0YDEm4fP8UjqLZlNIigeX1z5zXyu/EOLTtFIp1yOkCKQVHTWlCq5CiM0CXY1qJxr7jXPpgiuSJYU305fqgvoRXYu5G1yGgUjdu/djQxmPwL4CMxxESZZWRI2Z5Q7/wCHCzHTHrUBrbYEVVD2GG43VtEp5pGn+C51c1kTDmpOlmmy8TZlMq5R1i1eaMSAO6qzWjGJvzEIw0gha8M5sSBRHGIMvBCgPRiDPMFANLqbSNRFFwFdwCWJNXhn+J/M8OTiMraYmKRpY0hnRWYqo/NQZiyoDQ39zhW8EgOcl1aRFlZ4n6MSsOtO02wmd1TVHGoS6vU2oEhQqjHJJtnRFUgg454TyZ4KmtocvIWeV9BeXqSilSDUShZdtTspUbeVj2oOceT14bkGEEMrMZGgjUydRtUxZpZCQx0yPXwKBpGlQq6hh05jjciHUFApSjVbBWEbtSLo2oBLZmFkld6rFHxbOMTHDCF6ojjzUjMSQOvr84Bs2SCGF32AHpg+KD5MoeFPgrLNmdWYBhc62j6ylg71TKN1GqNbfQbLV2NbaGynh5Bw1lGmTMSBdQlZVWOBy3wgVpHVcmQklyoAHlG2GDwfIJHbMqqsUTSKWs6GDOW1s3mtgx3HYEi6GBWbiCZqw0l5dlaQ0VRZXkfSY4/zJGqBrku2DDSRRwbM8gN4hfaeycCl+ojyedYsqCzSdQLoTqsl9EAnUS2nYkKCTWEz4E+IErzSyFOqcw/4+7CUHzsyxsJC4jmdwNCoxIUb+o0FkuR+E5IGLLRRCXMJIYQQ0zhkQl5JHZXZYQGI0kKp2rcrjnwDlfKJkjHHEsEUkIs5cAXIxXqMH8roQo+KOqNAURWKdklSEUc2xJcI8YOMKJ3ThWWiR++YaNkigWNBQOmVWzNGmFFdRoaTuMCXCMqq5jMZvPOc9mp1DpaBAGZtL2rEDZaVE7KLO5vGkOMcEHEIWy0D/dYoZIsvO3TdFEcY2CRnSWIYAeZr1AF9hvccneD2QhmSZVaTSEiV3PUuWFiTmKbbXIT8QAUAEL6Yz5MUsIahS8keEOYzuYy000ccmRSEzrlxMqtLJqb7vHIpalumco9Rqii7DsMD/jb4SRQ56ElZFgzhlkeCCYNGkkaJUaaYUZIiNRkZQQGGlas3pvi3H5LjVFCmdiepban+SRAaU1ANbOfKgHlNjCV8f+a8tHJAC7rPEju9yBxFl5TZVo7FM8gXpADcBiQfQKbqoo1W8hHxzORy8KZ5IpAuWgnlTKoeghWEfhfCGdmQjya2AFHy+UNjNfI/AeKo2WzeWQyB0MqNHTnTVhJYyVJ8gJoKwFd9QGNGeG/Furwd55elArpmXLZkqyxxtccUkrWLVk82kUB6A3hWeA3Omcy2XjM0DyZBpCkOeZvLGaIHTgP4zwlrKMKBLqNwNqQTUXayO4J5TLgfaEjMUssqJLO2XaLpKHGiSiZGm1AdRSxDUragVAAWtzefnjJ5xZYQc1FmJstlzPJw8JJI6gACJZHjl2VWCsPIobuyt3U/MngNHncwZMlmVjErtrSfLGMRGx1HTR8W9lgwUlm2PfBx4feAcizTwx5x44CsSyFI4hmpp1jbqAzKl5eJauNIyZCSp1KReA1FK0xFOSdNFVy1muG8JBgzUuYzWq1jy0mkw5WGQmQsII26azM19WUrqbcKBuSN8scKl4vm8xLklgbKw5iBmOb6ssixlxccCOXSErCjsfLZDBDJYGlvJ9kTL5jMdbM6Ui6gEeXgLN1FVgbzWYk1SHWla1XSAbXW1kYd/LPBoUFRRJEjk2IlVQNCrEHOlVWtKdMXflK98HslnbNKUpPJxzMimY6lbpqFPVDqFoWR0UBaQ9PYuxUIDtbVpwPsrkrmCRl4kjkiWFl85bqqwkzAUkKuldUa7OWdWaiQuDjORRxvJK1VMQqgjYabUje1GpmDkgV8wABhXvcj3qKheyRsWjeVZVYxgMSr9IDqSMezssZqmGOYZEjg/OEs0UbM65UFWJDIBO6bMkmnUACxItSrMOxHcLdji6+VbLGQuCS/e2XQ7laC0Qe5BYrVChiry/DI16zaojplZDqlDBDoRWBYke5ULuPNq9DVXzFmhl4o5GAbyOg73aG0k0kaFVRYViNidRPbASDg88x/jSQZQBZHKGSaUxao4ekAiiyAD1FJVULWLkY1YGKHh3hbkcpOuZcmfMRJZcuSkfm/xo0sguAxIGkBF3AF78eG8ZcZT70urrZyN/u0KyUkayEBZdSgayynU8jVpACr6nHvMcCd5nVSqQRFAqqhZ/vDUytJIf8A0gdDFdLM9jUfIRhgJhdw3K5dVfNiKNGnQs5AUSH1jZ3rzadQJWh5guxOJPH8xqjWCJVMjkOoe3UJbfAqgBiqFttOlXOonbFNJkAiCWVkdQIwo6bUlsEDWzOCNZO+kdgRucW+Qgbu7AyM8sZKRFAqKWNUdRXQpXWw76m7mqWwskzS2o0x9RnzBYz7RhQVtnDyEtSqohQqp1lRVhSRXcO5Qy4SZ4ShZpmnmk6gB64JB1B7NaAVWl0gjYMSTijl4gDI2s6Y449Ltr2kLVCyKo8qMASIY4wbLHf4sG2V4sqJCrxoNUYUxFFZ0cqSl0P4QASdgS1DbGoxTZCVZTmyS6gzlZI5XJDL0YiwCqfLrRxqDEltJ7UcfOOSRQxKFBijhCyrBGqEuqRswQBVpY9Y1SWVUgFSxLWPHLnFYVGa0j8P8ZmKN+E8jqom6bH4hGEiRSrNvqHo2B/OczRQxBQUZpDEoEkl5iaXQYwHHmLokh3UAoFViAAQWC2MTeBcQLxEkCN5Uh0q7a9Ked46SO9Glh5uoqgsT5jpALD4rm0Kao1WUsVJVWj0G1I1m2CRKpJ0u97aRuaGBifK/d4crGtVK+gtGhPUkL6/xGNECQll3tgAK02cTeOZWMCZBcUSwskrRj8UQgUoWjs+oHZQW0tdEveGSEPnGuBq/kkKvF0wHQ9iXa2JsAmHUwkdU0rTGydwVdnuQzljLIMr97OZlVVy8J6MUeXQlkDEsAFMijW2kKVUKTbElsJxGMssRYLGbCeUbxrs1irTzE0uqiysDZAXHjLZpT1G0s5iVYmutLElPIpogMuzMFXdmJ3AYYKM0KLh3JPFc/LHLmyuXhDsHyxS9UMTKjpWoC2UlUk1ltG407DDJn5PiXLjLBUWKMICI1VbR2RUQUxIQagzs3dgCaLkYuo5S6urNIXjLNK8LMpc2GCBrUiJCrDaitDYagDWZ3MyLfkKwQrGySrpXrMpWTp0wVt3GolrGlQNybw7di0UfAuXIYGkhjVUQSOlxgRAElNZbV/i6lNCQmiGY6KjsSI5Q0pWt0aOfSjUqFZBpXWfKx21M0fncV2vF9xbhu6kqGLKOlGKDPKyNYRFs6KamlYEqi3qGwEKDggDACVEWOKIlAeirTsxVRYZCNgVQkEkFixDNZSxjrx/jf4TulIFLFLBKag2mRhECpMgJfdiFqRbA1NiPzHnIioiEzxvqMsiwecrpMLPTANuVU7HTsR3FBu/EOEOZInaTVBErAgKul5VROmW72KVgVo76GO9EyouHRKJOkgWUSBT66HZEfVqonzEBACCavfYnGs1FPzvxKQRB4UMjBnKICKNxjR1CSnTQC9QJ/EIHcDALyLydlWyjT5sCQqJppFkEixhVVgxondrQOBpPUPbyrhqdBSXXaN30rbH4mUeVA16mF6lcKK2VffAlnOQYiZV6jdF20yQFmUTFSxZZHtiF1M1otLpXzMKIwrKI48W4bls5llzcQaNTAZY3Uoi/hqrEzBaOpD+GqijqUbEXhDZFT141UTB7pemT1XLhiCGFsDpJOoqKLEWKOH/AM0c/ZGDJmOHpTr5svFlYiESMiMib3+AkLHJdtvR81hP8p8Kzc0xXJxUAwEsrSMog/LGGZSzOas0i77k0LxNu2XiqVsb2X+75HKR5VZollAjZ2cGYrI0tSsTGUR6X3oKAuxo4v8AktejEqMKijEYAWlYyM5ZsxK24aQFQAI1CqWNljVUXBuTMpCVdw2aldURnIVopJNWuumtUwXzamVyNQLVscWc/FcwZMpphRDmJBrV36nRRVlnAoAAtoFkL5RIU76Th7a2RaXglMnWE5IZEYKqTFKZHJ0oYgwZ2ss0h8gOq6Ax3GWmZFjLOwUHrdTyGldGdn30hsyugBQNSoSzKtmpxkVAUDWzRyBdEdMgZyFJFDR57IK6nIABNBjiUktRwMwmMhAGllqQO6mwxZySzlCBqLME3B3vByIV/MDOjBjVBGlTaRnPTF9RmW/hQaUjFWz+YnTiXBl2WtRDlwhCxo1aWA7jsGBBc9RibZVJFb00ETxwmIFZKOiPWQylYTTTOT8eqVnVg1KERRY74quJ88ZZYH15mMzIuuGP4S7a20xssRIa7OvtosUdica0Hqwii1AhXQyShikYYBlRDpCBiFcFgBrfSxIStxsuJXGIWGsq7InxCKPSXRmouyEAjV8Zs0Ec+oNFS5nxsYBuhF1JnsElSQkjVq0Aa9TE7ajpFL7EjEPjXHOMTR6NEoSStBVFRWLDVuyn33AJB7XsuB2D09jaz+XiRNcskSKJhIA+piWjViqKNR1FSQyMQx1UdOlRip4t4uZVEVwWmJuip8tMoA1agChUUpK+Zj2O2FxkeQD0ZZJZmzGZLxaEjkLGHV8RkcgqS/w0rd7G++J7cPjy7RqYo0ZVLyPmmEulnBpTFtGoUgm2O3c+mFbegqKKrN+NGcmPRhjR5JbpkSU6msgEqW2bT5WO6gXvveIPK75/OM2Xkl0I5VR1F07xk6d1BLaWumDfEALJO0zmXxryuWjlihaPM5lmKdHI30kjPnYq6JZZhYYAmiL203hF537R0kTMcnEY1VdEbyuZWQHVqoXpti3xCqFUAd8VjxSkOOzIcMiizT5Vy88vURGmEbv1ogo6lrbuDYA1kbdq+Ikk5j4dk4cqkpvJjqmNSzszNpZQbjUK+1kh9WmtSihWMb8a8U87M3VMzRue7RsY2I7UCtN8h5tx70MOXwB8Csvm4/vOdmmkkDmsk7NECoOmNmdyWmWStSGMqnlKktisuBRVyNX5GBxv7QOTURNDLmpPu7DqRQMRHIF1MjO7qWVGA0hF2qxRrFPBzdxnPsJcvlli1T6g8jCKMSEAVpkZfytqdlQhl1DfZcOuPPwxRIsSwwR6QoVUiRFcFtBYpVxpqUxkjzAnVQvETkzmF5Mu8rSAE6z96e41mqQajGhciOFJEKrPq8yqSg0uGMsI1paQmed/s88RzGVknmzEfWXqH7pAi9MmMWV1KQgcBbNgqvlsk3gk8H/DfIPl48w2QjOZhKQAlmaCZwqhcyiSFEm1lwzyMKUWNR04JOe+fIsvlJmheItMKhV8wKeNUJd+rqL3pZl6a6f/AEwCSCDlfif2neKyKwE3SGtWUxLpePRGsapGTdIAgOn1eyT5iMdEIyksGttFR4t+LM+YkkykSRZXLJmGRctl16YlkDmPVMVLdRi10PgFigSA2Nm+Gv8A0zhkUWR6kZmcxdWOQ6pZszMKVpABpVA1qEYBVUoLGrfA/FuKtM4mZVErMWd1GnW5N6yq0oaxuVAs2SLw8fAnN51Xlm+5/wDUAxRpZJVMkwZPMjRysGIehY77qtkacV5o/VJDRi3sb3OPghw6RmH3KVp1Emp0mEEK6aPUllIEJ1MxAj0vJuoZSKrFXH+KF5CWC3smoADyoNC9tjSqBfr3xqLxQ8f85lZVSFLhaNg6TQNG7PISssTHZmagBrU7kt8VbZbz8SkkEMjEkAG/L3238wINjcX7+uNwJ7YXdUzfH2SOb0bhUYjg6XTvLSShVXrzBAGn1AElQKEpYA6wRuFGDTnEADUraQqg+W/w2JVuqBvek6yRQALUPi3EPBXmJpuFZN4MskPleFkQdKFdDCOWdV0kuJCDIR5mZiQW3LYL5ciWUxlltxECzobtyqOy9gAASqC20tQrHJyW5M55byDOd4p0olWEA5l2RQ87PIiSM0p1xKhCRoA7K1LuukWdzhC+B32foeLZ/ib8QjlyseWlSNlysiLE2Z1N1o9TpIxBVQ40aBUl2AUrT+c4DpaRUuVHEar5VBRGChl6gIJLaNSliCpFeoxc8EyPTaPYookc6UNpZKtbWAXpmYEtZOwFgYpxzcE0LZ8yy8N4akeTSRMrGkdRl5C1W2pnZyaZ2uxqIOo7bHCr+0n4uS5bLQ/c3VjKXy+oBmMiSI1CMKwIlBplaj8R+hA/tPcHzc8etcnWVE7iOZ3uZ72vRQKRl6qybAU7CsAP2avCA5zNGDPTtFl0XrxRJOFeXMBgsZjG7KqUeoU0teittRDQin9mzp6pKy28OPtStNmkXNZWF86IRB98a0zH4CuSraiGVySfKDs9kjcAaAXxWzEmZyMaHySMPwiGkkjTza2JF6gO+/awNiNWLfxblyUPUbNQQulrqkWCN9TiiPxv8XUraVYgqoVkbVuwxmjh/ikAZXyk8rN1X/DkQIYsqFDmSTM3pNEFQgN1eoG8T5Ps7isCxyhw/bfzsIhyckE0K/dZ5ZQoIDtKQPMFHxMtUxOk6Wu9qxY/Z24pmMzGcxJCHg0JFDG8eiZJRokkluVStSBtKMh9AwNEnCy8SOU83nsqGeKCTLBE0ZiKVXKa6LMGG7EAkHy/LVth+eF0sj5eVJmDtHmxH1IwsY6IiiCWqkraBgPegSNsBNNZ2CeIpIGvG/7PsfEFktly85YW5TW7sgOlWaxsyiwx/MPbv/PHiHANMxjCkuGMemgXLKSKGm73B2GP6scYy4dpfMRC8zrpFByVosyMN/iXyrQWrO94oM34e5CN5GjycEmacJL1ukplDEfieehTsp20mt9z2OL8fI4kVLFMzB9jrw5MU2ZzWZy8imONfu7MoJ1HX1FVAC+rTpJtR5QRYvGxuIOgeRHYISqlH3CMpKtSt/6bLv8ACdVXttQB+ZOcIcmBJIwjUAkkqEZhVqi7buRXv+Yb3jN3iZ44ZniJjhggaOHUav8AxZTv5qoBR3IAO2+/phZSc3Y0YOTsKudvGXiDZ+LKZKVGh1pHGFKu0pUlqd2pdI21ihQBonVsV5zwNkzE0sudzSyk62ji1BHWiAI2CMgKiiAI1NbGzQx15C8B1jyTLHmWTMO6POURHY0q1FFMVBj0DzMQaPeqOE/z48rZ+ZYpXzbwqoVlL2s4oPUikKqopt/Tfva4Rj3WIhX9oThcXDstlFy0QjL9WNtDlyQDdmRjcgsqV1jYjvi08I+WM3nuHrlJ5o8nBHOWdtEiTPGVLhdWsIQS17LqcdvfAbxwwcOOVzObl/6nmnsLAZQ0SMtgfxWLIUhhuwB9Nr3mrws4rxLMRDNSDJZeTLmSJYnLpG0ajRFKo0EsdTb+wodher2P2aQIc0cYyPD8yUWGPiaR5cr1S907lrNb6SBsRRoEFaYGlZkvELMZ2fL5ebNjL5baLU7FEjhGxVqssSoCDVdtpv1wxuUfsS56aWeOeZMmqKOlKKmjmc+lLIrBQO5Iu/T1NFxL7E/EVeWJXhzEsdao4Xs6GakcsxAXUN9JsiiLOxPZFQS2QlOUjY/JuV4bwcKuWy1nMRFhIlvJKqrudbeYL3aie3psMZ28WfsWSSCTPZPMicSK2ZeGUVK7uxd1hZAFNWQoYdxRYbHHXgPj0mpMnmI0jzsCnLRzmQdGMJS9NQNrYbE3RPY71hmx84rwjKHMZmR5dVKkOvfqvbaYg10hUG2rSBe4xBSnGYZRXWzCGfmaK45EKuDZVtip2NN3INbbe/bGq+CPwvhOSl4jkWOanndUyTTKBLlNaVMrKQjMgO6sU8wABY3qxlLm/i4nnklChA7FtC7qgPwqPehQvDWl4RAeHRzRu0yooWaInUVAI83e00knbtVH1x2cmEjnTydBzVn+M5iRhJF99jgAVFPRadQdOlWLBdYB3tlQgi6AGHx4Qc58VzWRThQRMpJEjO2fCBx0AaSLSp0CYyUGlVmNISQC+2XuT/DN5VbM20UYvRpbSznse1EDt27i8Hvhb4yvkGWAxIsevpy5kSyaxG76vgAKjp71tW5sAknEJVqJdSvZYx8W4tk+IQLmpRC7yhUmeRDExJJ6jFCCFcsQQVW2Pb1xo7/pbz50/ekEsceW1MIQ4VdQOkqfdjqIW9xRv0wsPHDkePiwhfK6HzMsyRrIHWvu1NI0soDgeUWdNWDVVrwTf/UMHBsnloczmerHHOUMmXH/AHDfmGtS7SBVoA+Y7bUCKMJR7JNbM5E3mXwohkmEkXTy8KQhQgX8TqFtTO38UlHYG/Ub4DeV+V+JQzhFVIsorkySTSRhJ0siukhLqzWdLMo0kf8AiMWvMH2peGnQysWRlYFOmRKlBtOpSvmBsANdreKXlrnzMcYkkyPD41y46TSvnMztpClRoCx1uxPlJcbAmthYjxtk3YN+NPJ6S5iOLJuwzmh26itoRYU1Bo5R3ayQsbDuT6i8CXKfjPmYZIMo8NZmMtDMsjBVlJ8wFg+UtsbOoEkVV4f3I/gxmMvI8rTCTOLllg8y3A6qXcj+MFrA1izq3NggCk8TvsxvmC+bgGqaaMP03a5IHULWl02Nny0ao73XaqcX9WTdozXzl4k5qV5IGqCJZWcZZRpVGN2Ca3IsnehZsDfGnOVuE5XiXDo5VUQzI0cGYeNFVLFKC6muooU6gwOpTtffCf5W8J4IZIZeM9aJJZJIwJDVlRQeY3qVb/NdDa9jjRnAeSMllc1C3D5Yzl5EKzQiUSxSEKCJQNXcEaTt+Y74PLVUjRvyC3HuW+KZWDMdEpOwXSqKwD9yCU3AOlfNRJv09sZ25g5x4rxGEqQJVy7DUqDTMD2BIZ7I2ohRd9xsca98TeLzuxgyy6WVNBloEqzHVsPUi9jfb6YzHwueXhecmbMyNM0qGTyoTrlViTqA3UpfcWPlifFSTxkpbKXkngHF0hcwoYzKGjYyDzNGwIYaW70d9vMO4wV8v+Iw4PFJwzNMwKMsqSZaMkyJOA7KWY99yqnTtVb0cNnmXxLihykGdeeIpNpIy4KmW2YaumgIYPGLL2B23qsIDIuOK8SAzcwSJI3OXklURGRAwKI5bc7E13pQQPXFE3JPssBWzUPFuS0ngC5jXHCYQWR5tVqDqjWXSdmA2oGvrjOHjfwTg0ULfdoiuYbSoIc6V0kFm0bgWD8rw8X8KJNCGOcywsUJjMmobNVbm2UDbv7YWn2yOQMvl0yrQ5VYmksvLHYtqA6ZXtfsf9cJxP7UVdCc8OvGmTIxSxQxQlpSbmZT1ApGkoCCLUjejsDfe8O7wN8eeHhoYc0GLk9NJ5gDHGJGs67NBAxIs9trNXSQ5M8GJjKpzkU2Xy2nqNKFB8vdaBIJDepG4+WHRwr7LORKSzHNa4ekWjaN1FNpLU4N0ygCx2O/bYY6eRQv8kot6NRcJ8HsrBl7jKS6tcjSBvKzXahD5ilHsO1D54xbz74EcUzk7y/cmgAJLSPMhQoCaYAsW+dKN72HoB7kn7SuYycTQ5QFIJFt4JnM6LKRpMkLEKVDCiUIK2LFE3j3lOYuN50SfjT6Nmc6iiAD4T6bAbWPTvicIODsWVPCJHKP2gRw7LSZbKwaZjtJmS+ovINtQWgAqndQPTYnE+bk+TMFc7xWV3DhBDFlyDIS7DSPzBFBsstXuDY3GPnJHB4MjMZPws9OVAaNltIGJOtyxsN8jt6HBFyRPl2z6vI5Kl+6/ACxpVVRsAG22Hb2wZciT+oqXsdniLz7nslks62XgiggDqerPJTEHSNAjAIOogKosAX2O+EJyF41cczheOPMCKKhqdUUCJTsFUgMVFWFAF1e474N/ta+Jcq5I5PNywSTO6SImXR1EaqwoszEjYrsB32x9+yVw2fJZPNzTQaRmtHQL0GZVUhm0HdV32sCz6e8kkuO2N5GLzj4b5biUXD8nmHb8NxKZYq60yqpRlsjUqPe7H1+GjRCG8eec8rw+fNZThuSykMJVYWnePrZp10246kpYpZqyBuVDd6rQjeJGVymUbiGZjZF19KJEUGSYnsoOwUADvsB39NsxDhEfHeJ3lcocvlVdZM3IXaxF+YsbYK7jyqEs35jvZL8LdZ0GX4Gx9jjI9HheczzIC7yOsTmiEhgVdRa7oa9W22qgLwo/Dz7TM8OclIZmizUx64b8wYkAxrVRkjSDQ+EAHsDj14v+O46UnDeHRrl+HAaNIRhM4VjrJYksQ5+Jj5m333wqPDvNdDNZbMSxM8Mc8bP5SENGwpcjTY7kXexxVQu5PyPF1g2rm+Y83Hk82U36JSUF9YAV716A3dkBBLCvl3xXfZey2YaSZwPidX1SMSO/mZIx5pJK+EkgKPX0wbeJ3FJ81lzPkpI2yrRNFJpUspDbMAwHmKm969t9iMLLw64Fmclmss0gDiSJljbX01TWQGL3uSoHYA7nvtjzWqY4Z8n8tNNxrMZmdmzP3eHVFS6I4i9po83lLKvqN7JN7Cj/OcvQnNxSogMgVo5HDuE0MvcKTpdrGx7DdsSM3AuVjKRqHOYlJFCqjZfc2xChS3r3Pa8QM3IXYWwWOREUqG0kob8rMKIsUtIAe+/rhiR4mzqBpDHTs8gjWlsKF0rI1jyhLO9Vq07nfAT4meG+VzBMvQSSZpVDSUyVGpp2d7AptPlFGxS7YL8pmkhjljU6jEGaYqKiiBHkUbHWVA2UdqsgYpOQm+8woY1Y5dX1Tz5lz+JJ+cxqNmCgFewRT2uhhWx0hZ/aQyJSJECLHe1Uodlu0JOkFUiSgf4m/m1/BTw0ymS4e0kC9fMTRebMKShl28ug2THEGPlo+pY2Tgd8WeSMnmHkcCR81NQVeoWTLjygM9bLajbVqJvYXeKjlPiOYhljyqMxM0QjCsvlj0ig4UGwo3Pz7+2N8jS6g+NSyGvOngXlcyYnneYusSgqmZk0KIwVDKGY2d/y1rJIO1YUfhvC/Cc4wzSThZ0qBI11dc66QuqtVqu66rOojbthl5PiPEEkJZSUjlWKOcx7SWT2QndVIJJII2GCrJc0QP1zNphMMpjd5nQzNKFB1gr8KDYhEFfLvh48uKJy482AXiPmGk4llI5Yos5H09PTldkhWV7BsgHUY63BQhrqvLs7hweo5Ebpoyo8UUEC6BDZA1IXGpiFoggKqC6wleN+GcmYZcxBIHR7tqEMaEVTKzU7ML1HT3J798WfDOM/wDT16rQSSTSnorJNmEdyHFOI4tqDkA2W1EEXQGJIo1gbQ5jgyqKZSFalH4jatVKAaIBBcKPr8OwvCH5x8QJczmmfKGtgsciggeWgI5OpWrzb6NlsEi9zjjybx/O8ZnjyxyyxZaBtWZncuDWpQCnp1iooBbUEWTQXUbcI8Ncq08mYlaOLJxytDDGBo1mFypaRbtyzX7lzRNdiZJmi1s782QxfdpJJJnfNNGhzEkbtKgUP500JUSLZ0lWFGrN4rfCoOIJZI3EeTZ1Z3mZTII02bTVqFIF3YqxpXa8GfintkJhpjyeX6emPWAJJDdhBApoCQbW7arPwDuAnwV8OahOazUSoixh4VlfYCr6rQ3oHlA037/TCtZDeAyg5lgmQtlojHE7aOq0ZvUSFMqFlGsUoFtasx+uLvl7gxijUB1Yhy87lFJkUttGFACKikDUVFEADcknHDmDjWrJdXyK7r1Yw7eUE7INu1HzH/MNr7Yp+EnOzZaAsOm7KaKLR1LuhYHsumyiD1okgDG7UJRf8WjIYhJfjDKVUKCwXdyLGwIB7WQR33OOPEeNmTLD7vHpVwPKQQwFjcGm2PcsRtR9d8QOH5MK4omQ6DGZWraVu/mHxEUfKoofU4m8EkBKt51DLLERekdPLkgyUAKBPw/xar9sYbAp/FnifEMtGJMtCmZeKF3mzMzio1O0gy8KlNjQJf4jXrZIzbkOB5riHEI3zdmWZoy1KI1aFFB0JqOhfIKQEk2b3ONAfaE42f8Ap4LNIonlSCGIyaS4IZg+nvpCfkJqtzuRgR8DuXfucM/E8zrkTLRlstEGUK0lhWbzE2QPKm2myTRpcdnG+sSLVyDj7TfOP3Hh0WTygSCSdmBjqNniyy9qQoVW9Kpf5fNpNgnBTwjnqRsjwqTpBiEWTNEBWVUihKiyRSsWNhVXcihhf+IWT4fmooszPlXTP5saoo+q/UpBpRpF6lJGrbgstuPTzVi18L+Xs5lIcx99n1K8aGOCOy6RiwXelAhjI8gBI3N9zpxOTuJ1NxqkU/irw7KR5+O5JYYszGs0jKrAKX7FRdKHq9xQ3NbYcfh9zBloMohjYfdtTNHJI5kZ5CWMrAkamIN6AFqhQFAYXnPPIUMxkmlDPmWWsuqlyhVBqjCp6qEBLyOK3JA3xz+zx4j9d0y5WnWOTpkkBdAe2RFA2LE6bI1V2I3xz+RWrQ9si41AB3KyCy1qqCrJKgUQV+EAebdje23mIiFBQJfSFC2WctVBm12FRVo/+W5JIx6yHCXjgR5pBoS1BXbq29AKGoClYrqO5Nm7Ax+5pekn1fE+tjoemdR5ViUi2BI2LKAbujteDRMq8pnJZGkGrXI0qx6hRSONKaWT0AaPX3PmaRQPLiS+bg1Rq7dKXU8iR9ljjDV1W0r8Un4bKt/E6mmtmxScRz0eVVIIo9cz2vSjsgxMU1s7kgIoYnXI51MboE0MZ75y8b+Kz5rMRcOQiPKR9GljR2LOQBMXY6VK0RFuRtqINArSMbA3RbfaD59liZctlYOi07DMM1K0tpQD9rCkp5jILIDHsxxN8Pc++ekVJvxujD5g4BRppNSy9NUFMzixrk1FdyoUDFFn+TiJMvGxkGYmhMcuclDzKiwqSydQmvxH1Ww0quy3VXC8M8o8ebhEMxInBjV4yoSFEti7hj55COy7LqO+qt83ihuvkY3MfHsvBH08zWhBHoXX5ygkNIQACFRvyqvmUemKjiniblHl6IdYwyajKC2hi7WpCguzuyExrrBAPoaAHfhXhfkk+8y5h/vLTt0ZGzDKGjDF1cAiyArhSxUqboKoGBfhURhnklyHDDmZY4li+8O0sqxdNRr0BnAZvhFx0wqu12FQmQ+4H9ozKRqYJFkHSYIjTRkM4IBWRgyDQ1gaVZRvRA3wrJfGObM8RjS5Fyq394aIlU6QBJ6j1SawArEsL3UemDTmTmyTJ5A5idoJs456gSRQGZ3CACRRXniUGo2JCrdm8UnJXh7PxGGFTnY4YyhlzEWXiWJHMjBzqZaEklki38qkEacMktsxorOqvUy1KmhWFad01OmlAvb4EDEnc+VjtQOBzxH8Yo8ssSKnUzD+VbUhWOvSTqAssDaoFs1sDjr4kczZKHLujvFIBDpQlydIjUgKWBtCwO5XzEE79sCfCMpJI+Vz7RLMiZZ5Io0A8jv/AITXIwUBQWFC/Rje5xHJRUyHw7mPijZcaMvBBojY65NMSxJGzEkKfTUACQKJBsGjgT5Z8LcznIEzEjapm1y5eW7tUYkJsvk6hFRbrvqNemJnAedY8pl5c1MDNLJmpBDk2bUIFdyGsOzA7WdWmgCNg2o4aHCuf4v+2istPKN4V3jiDLqR2CkUkbL3PzC9hhtBf4JHKWXneKMzK5ZtEiCRkVMuF21mKLzM0QCkM2rUTW14/cE4jmBD+MRrGYaGLTs8g9A+og3Jp8m4NecixiXyxmJjEzz6sxLC5QiKPQHDFTpKkixEDuWIU+U1iwjzKvJKzR6SjHQ7FFGtVADdq+F2tgLs1foBQLIfCeXT0JIun1FkcTlXcsWOtHZSynZSVYgbUqteqzghWZWc0yrrErKASOoIjbMK2TTahWF7dhuao5ubkhL6mASRGchQXfT2N1qoJGSRSgBiACQN7bhPDg4+8io1CSJECpDDqMjKwXYKHRVULWwFkemCayn4LLH180iBEjRFlYg/ExLO6uCGJUm9Pw62MmxrEnLcLTpNqVtErNLMJHoeVy0cTauyOaZgAvksG9ZOK7h8QQzsQXR3VSaJ3OzEL8TrEzOxd23X4aAxI5m4OGF0H0ovRNiVWYKfLRuNSVYyu9WiD6DBsU9nOrI07nUmkAxuFKrIzs1dKQW5iQEE6aqtQ9QeWU1apptAoSBcsAq6VbqHXM43JjogxgkGlIHxAmwzOdLAAL+E0YAkLBlZzuwiWupJq0pXwgLRrffxI0unW5jCqFjAZCwLAlpPKpbVekBbNAhUUbXjBKxXlYOi9OSRKke3dA4Ooq7kLQi06bq7FrfkxejKg6g2lI0jidmBpWJBDSagTsBuoILsFQgLvj9xbhiPCXlIgR+lr1tpJjQHTGxPbtZBNlDpAF1igi5+j/DjJULNLqjkVdMQSPaJQaJJYC+xADD1rE3geOS5i4MrSkRMVQ00li9CxbAxhgKaeqduwAY7b2Ec4eJnTjzEemMTFHWMqS1NLqGhwg8iqB1ECk2WF7jFQvDs27Z1lBZ50ECquqFIQGbRes+Z20i6BsNd3VTOVOV4Y4UkYD7ypBaScs3SYFhrjTdVj0oQjNvr0/OkuylJC+5M5aaekzuWeOARv0ZVPRXqBkssNncOwsnZtV77jDw5b4qImeOOAJBGFEEhB0SZg2tQqLklIVdQLeVmL2dsD3EfFbKmOSZ5A7JLJ08qmwLpvHJIvmtQfO1tpa60mt6Xg/ilnOnlo1Rc1mjNIY5nQBdMh1BVVPMrBToDNXk1dsPaQtthrJw+LLM6u0gLhepLqViULWk2gWA+s6GVAVEQOwCg498yeIWVjSSGTMBc0QzLpBLRnSaUuF7gNVDRoFja8JnnbIcQJOYkcRq40aVYBowzlCrIuwWiRbmgp2vHfj3h1t1WkRukEEkiKzqlUZXLjSrmvTY7dsK2wpING8dMrAvTRGzUwWRuoF0xs8p82kNqcqB7Akm7O5wM8P8AEjiuZ6P/AKOWBkj66oFUsNhrdrbWW8g09mPy2J/+vcNycTyQy5dEMYRJiwaRbsvd6mkZtygWqoAkdsJjjHjxk4YTFCZJzYGojTGdtTyL1CWGqTTtVjTfreKR45MNVpBc3L8wyzNLL1HUhukjPKY0ILU7qRGoJJ8p823cmhjl4XcGiebScrNnC8iABiIliAo/HYHmBJUPQpdtzhfci+IPFszCcnkUjVVPUlnQaSoLbGZydIGwBOkkgH54J28AuL5sZl5M1HHK7rKI4XPSkdLVnbQBp6ar3Fkm9sN8SW2PkYHiJzhkspHpDxwyJIrGNSOoHIBLP0nPUoE1qFDa1JYqF/mPtRZTLRSCBZs1mS2lHmCfd+nq8w0fETpFC0DWfioUc7+J/Ic+Rm6cxVi3mV4yWVhZB3IFtYOrv9TeKnh06KQ2m9NGj2u7/X6dsdcf48avYipsZ3/38zz9Xp6YFk3Koh3BFEqSCVFfoO9Ak4DsrxrMZmWOJ5JZpGk6a2zEDWwFe7d7PrQ+mOvMfiFPmB5ydOkCkVQCBt+UCgNvKNv3OIfJ3ML5aWOaCupGdSl1DAFgQSQ2x2J+nviqgksLJbGKNteCPhrlMrl3inaKbMpLJqcRFZYtQACix1LdQFA/hbymjhA/aB8N4stHG0GVCLI7Mskbu2lRqAiddRF/m1aV0hQu++Gl4V+IUOaQ5ieaOPOqdLJEWjMyagEZxuC4vyEWBXYYPM3xAiKbKu3Qnn1RRSMNSKhjILJrPnZt9+4YtjzozlCeRJWfzzyoMjqlqpY6QztoXf8Aib09r96xvDw/zvETlUTMRxrKouAxqH0gJGE1ILUFEZnRYjW2piCSBkLnDkTM8KzkZVlZk0vFOqXFqIYFKcMpZBYZTdd/o/uRPtExpGwzDpJPGEjhEYdWnUgGRzL2QAir2pRQUWMd3Ou6VCRtphrl+AgrIhBsM8U7yeZ5ZtKHqIV1qmolQqBANgB5QMeuKcmtPlhl5ArMJgY3E0oESBvxZSiH8QaTo6WkAsB2sYu+F8Wy0mZ0pMDL0GkAFKjw2iIx1HSSki9TWCTpG5FVgpy/CkkHV60jHprpuQaI9MiuLjT4pHZQ2ollIIO11jh0K7ALgHgPw0ZeCJ0TMy9NtcyrIBUoIVolVrKggCM/k8xJPqKwfZUykhkiiSdToaVMxJKpAJbTDCqikkDaWZnJ1KDve1MnKcdjA1xno65VVFG6u77lUShSMjNqZwRqViBW+Dbq6b0MoZOldHyKWJ7X+U/FZFUNIAwVySD2aP50888kS5SbpTgxHzMhoESRhioZCNiGI7+mNmeEH2j8pLl4FY/d5xF0DGsfkDJ2kUqKqQAkKLoHSao4C/tTc1ZJBl4cxlvvLAOQySmJkK+VvMnnOosH0sOmSDtsMEX2T+KZSPJhAixySOxS3Dyzudtekra2AygKAtC9sdE5doWyu1bI3F+L8L4jm5soS0eYCCTL5onSRJQLiPX+ZaD6CvmskdicZ28UOS2y7SJKUfMCZ3c6mZ5EIGhgdgAbFoLOsMb9z7xq5NZ+NQMNenMzD8WIENEY9nCf5owAST6fTBd4w/Z6llZc1lW6jIGGYWeRutKVAp0sEayBsmwNjsQQVh9apm7JGfOS/HLimWVIYJ3SFXVhGURlB1aiAWQsFYk6gD67Ud8a58TufMyV4a+STqzSM0q6YzpchdJ8rC+mbO7EU2/theeCnhrm1zkU3TSLLoP+4EwUuYyNRXSQxDHYg12rfesaF4bzfkjmpLdZJIoNtyumJmGtVrs3wfCO3fvheWSlVInKl+QL5R4jM0atP/20wkaOaF3WNoAzl45ogRTqR+HQDgW3m2ODDhdiEeVo4ySot2aUsQvTdmKt3PYnSSBZ2AGEd9qrMi8pO5EqqSugAqdIOvSX2YkgUwG/Y+uCrwG8S5uJ9Qu5y6xMI+lCLd43SkZnN7CtPlAbY7ixgKLasg6CTxZafMcPzCHXG0el2MamVpBBqbppH3LsFBJX3GxxgrIcacuZySH1jQFJ16jsSpHmWvl6nG+eRfEAT57OZGOIQ/dUDKZUdJWZ2ZWkCm9S6VFkk6gwI74V/M3Ii/f8xm41QvlIjmQBERG5jpQmgVWoblgLsWMNGajhrZWEqVGZ+eeCZ6JYMxOJgk6dSIyM5vptQBDGwRQNEdtJwzfC/wAL8yJcrLmIV6I0ZnoSsU6wlLnRIjV/5UVZdtJ741zyR4jQ5+GDMJEJY01q2uO+jOV3CqwJIUkjYkV8icfeKyQu+qXpmV38oDjVIpIIQfDpC99q3sfV5ctqkL3Fnyzz5MYGWDLBss0kywBRpEQ3DxskY3B/Ip9BQ+ZZ4D8iTxRTZiWW4cxIJostswi0+UyuTR8woBewXT86uuMoI8tmTDCOoraUiTbqymrf8rX2I9O+JHLPM8OVWGGV1qGEpNY6YOoay1ts1E1XcY50hXJtUgn4/wAxhZK8lWpDH8xYgEXVBe5F99j88Z98SvGjKh5stkIJZswJQxkR3ZIZnqNkVGJPTOn4EJjJqlHpWeJHjOM2DkcmWzEkjJGZNBCINVg2N/IO77j1+WJnh/4GJlZ+g0q5lwOrmpIiU0U1qRIbNqb7fOxhv65Y6illgxzXx2cypLn4mklGoRZdgDlYmAGiUkk+ZTbMnYE1/Di68W8lFPwwSNIs2Y/xFly1R1KdtColEhASpHY9+4OKvnrk/OZ3Oyo8ix5aFWKsJRJ5F219tTbC3vsfU4HeZ+c+F8NigOSb71nQSwlJ15cVYLNGaCt2KafTe9zjRjJvBbvEHuV+DZ6Lh7SyZmTJ5JCdLnWZJZZQAEC2G0+lihVgHYYpudvHeIZHL5PKhxLCtPna6TuD8ShQSW9izbkV+jE5D8MuL8fgkzE2YWKPUqQrIuiOWtmZFUUFXtqqyQfQXjM3NnKj5eeeCWhJBI8ThSCtoasH1B2YetEdu2PQhBN/YhN3oYvhP4F8RzZjzarUa5iFtUzEFgJAxdQ2xUAH183p3xr/AJ78SQ2WnCnUFcoH7PYoWhHp3HfbGMvD/wAV2ilgfNmXM5aKgmWWTQDo+DYUCq/wnY+uNG+HniJwaaYiPKzSmU7ZdnBGtydQCFqr1G/9cc/PGT/Q6qgYy0/EoEhzKLK0Ll0DAFia28y70CKo12/TBx4e8bZUlzM2aUdWLzQDdyBYGq99XoKuvbFlzt4i8UikbRCIoAelHlwg3FeVloHUdt9O22BLlLhGfbMRyTRCNZlaQkxgBUTdrNUrHtVea/THKTbOvij4FZd4jmMvDGk+mORSbRWGzPqQ93BHfb13F4VvjvwObO8Qd8uxzKhII0jQEqj6AjhFFqIw1219yca64m8MymBx05GjWRrYXHGwoH5Gtyo9/fCn8GuQBHJnBlcx126oEU6AeUx0TYPcehAG+LR5GgrQjuE/ZTzfUCzI6+aRXVdAKaF1A2TRBO1+g+uCiX7OeeysLtlJzmRaNJlOiAJgRbAOSR+GO9fFsdtsPrmnmfOq7/hKZFrWQLMl7Ej0o+o/piTwrmmTMbJPolsK0bL0tEYNOqrR1MQKDXYGHfO3slRl3xG5tkyunLBfu8+hWfULCAi1Ud1vuLAxJ5M4Tw6JYM7JKZsydQfKS6THIx2J1DsB+XUKIw4vtC+HS5+MvCNUyOIOmANR3G7EbgDv+/vjG/OHLssEphYedG00ve/UfzxbjUZKlhk5NxHHmOEjPcSQQoMiOkdTQyfEwBAfysApohSe5FXhrzcg5eCBXly8fEpIY2E6ympgig0YmJOo779rruDWEp4a8ktkz96lmMEio1Rut/GKAIPf3/asFfAOQsy2YTTnVny2a2zLK/TZVIsjSbvbYFaxOW6TwgxvZRw8Vm4gZMvkYIoYa0kELcasfh1VfoSPXv8AXGjvs9/Z3yuRtnc5mZ7RpFLIE2vSqBtu9am2uvpgF8LPBs5LiWcWJ45csFjIbq06FrIDqRvQsft6nDc5+doUkzETID0QCq/EwBBTb59trN/rhJSrC0MezzvF94SLNN/29PEjElSJF7a3A9thZNnEvnXi7JJHHCQsc66EcEsFkQAr8JBIkFi+9i8Z24FylLPHLJn5vusQ/GWyKo92omxey/8AN5cnigUjjInYqi3CJMs6dTSaWnI0tq9GH13xHKHcbQW+OPOWXzWWbJvlXzOcUsAYVbSkqLYk6zafL66T3G2+MYnNzZOYBkeOWNgxQlk7UdJqvK3Y1djG8uUvFOKRI2lIgdenJMWsqobYF9vXbuaq77DA19orlvhObEX/AHEfUSTUzxFbeNhZjv39Vs1tjs45rTJZSLHivjNqyb51Xy1NlU0pqBZJb+FiPOGB9TZ7D54W3gny2+fmbNZ0IAyA5aUOpXqWdjEG2rYkHdjV4zJzLw2JZXEDM8V0pYUfoQO9e+Lo8PSFFlieSKUEMBq2J/TsRivRRWPIUrNG8zfZiBzsILLJG+YaXMTKAsax7MIQgP5iCLHudh2w5c14TZR3j0wJSoY9bLbQ7khR3AGkVfsfrjKE/wBqzMNlegECTkBWzAN7e4U3Rr19Pniv4H47cRyszZiKfWHCiWKQXGxAC2U2rYbMpHzvEXxzexrNFc98g8Qd1i4WpQIAyM7hVBA8xXykMGO297jtjInitx/PmZoc7LI8sDFCrNYVr301Q37g12rBdy/9rPicE4mEoYLr/BYAxU97V8VC7BvbAHmuJ5jiWcY11szmHJ0rQ1Md6HsAP5YtxcbhsEuS1RTPzLOSC0sjEdtUjMAPaiar5dsXfDeG8QzXmiWZkd9BZNQjLVXmrbsNz6b/ADwz4fAzLZRFfPShpK3ykR/EVvZm7CvUYMuFDOz3DlFGTyyqCka7Frqmv+Jt73xp8sVoTqwW5e8I8hlI0fPXPO4LLBC4IsbBTp3+f/xi54EMzn2GVjP3eJrUX3Ceq0KLFRWxOO/M32b85BTKdMpBZWY3RG5rbZqvftiH4N8icTkczmYVl5RqjBQPLRIYayKW+xvvjnk+2Wx1jCDI/ZezECa4D1yD+IT5bCnzbd9JHoTufXfBD4YwxZLLzSyLAzSyAqhG8VCjTGxQN0BvqPbBrzL44R5fLzmYqHK6GRHDk6gRo2rcbaiBtjJ80+a4pKq5SIiGMrdtpVQCNWpj37323vE1Fsql5ZqTiP8A0pczLmcwiZrNxuYYFdbWLQLMgXT8Vk770AADscCHhvxl8xPMWMkvVmJqjsl2RZ2Rfl6jAhkOOZR3lnizRSBSFaWUB5Z5DRbQndQRt29/fBvy3xWaavuKtFHKf8R61O3a6UDSvy2wsr8k1+C88a/DjLZuSFs9mWTKxG0ycJAVtK1qdqJG221GiQDucEPJvG+GZXLNHlUWONQToRT5gTqJc1ZP1wEc28pcQgVxJoniUBpTptit2V1b0K/l6YDX5izGdmEUBOXyzBUbox/D2Fk0O/1Hte2FUm1V4GaSGIuZyoilEmWRTmRIFUV1GjJDEyHc777EivbA99o7P5KDgWXysam5CvQXcaNFF2+EBiPfuSdu+/HxB5v4PwqNMuv/AHubUt1W6mogkbCQm9HpSjt7dsV/EubMtmo+GqZU67NFIuWzA1AR6hsGoVsCa/PQ9sUipJ34HjTB/wAG/tNLl+HLk5VEfT/Dy4jR5JZSSSzOoBA3ND1Y7Vvi35p5JzrxffJnjSL44kkk/EVDubXsrf5e94WnPvO+Wi48ZMlHENEixEmhF1mIV5QOy6LIsbeU/PDZ5n5C/wCpJmP+8LxZVi6xxDUJXKg2PNWm7UEX2J2w3LHz7C/aCPwg5zaXej00jaEZmaTT5+xWOJRbMbHnNbbWe2GfwGEsVofB5Yr9EAIMrih5ib0g+9+uM6eCPGVitViMs53RWpY4QCCfMQSGPrpFn9cak4ZlZ+jVgSEFmKoLOprquwAGwvfHPsSSopeauCKVEK7l6MjFqQLq3FCtRbf5d7NYJZchHHFEbCKqyMyj4WWvWtgoq9I3wP8AD+HUpeTXs4IV2HmK/mZVGyqew9cVA5xcxysVWRRrEVi1ckHyAHdqIr2GAkCwE5Nzr5yfNdGQxFyhsJqsbLY222ur7fIWcOeDJ5XI0EiaacIFlmrXIwO3mkNADv5RQ9gBgD5Hl6eSeR3JzGZ/xGh0r062EaEfCFG1+9m7x8yWZ6GVuRXaWeykXUaSWStlLlrajse1AYVKhm7O0HiN151MsohClmjy927ADys6j0IOyDcnHdfCrLOjytB1J5md9UpCuXOwEYFCNBfdhqoHe8TuAcBjYZfNPl0jzNaH8vnVaqzQomtl22vBHkM6zNIzKyRREaIwAXkbv2q9t+96jv6YNWC/QIcB5DTKwaRI8sqEC5GZkieVvN0VAAA02NRBY36448XyRMvWmMQSHXpFHUiaKJ8xAEjAfEBaj6iyfhvHCvRZogHlJLam1fitZFH1KKLY9kUUO94FucuHw9HMMyq7FqlY27F5NgW32WhYS67YFAB7wq5jMcQkjPRSSSZ3ZzaRwgtUgY7k7jbdmIAFAWa7xS5hiqCca6D6NRK09oHVtI3W2UMRQpe+7YgeLXDEkySaXVfuzqemhCMNVBUZR+YiysdXeL0eBCyZGFqMEyyCZQ56lknZXDEXqoeWvKu2C8hVIHM9DLxTpXKspSIyTka1jiINrGf4pZR2ABIrehQLoznO+VYRQLJCrOiahJbdNVUWCCPM3fZ6Arf5rKLimZngMa6MvKk4jzCpeoaSL0KhXUZNWzGjp+mIXKvC1ycWalzQLKJiulEEkhQ2KJFlVN++9GzthXjRt7LfxFGWzLauuwhgQiadCp1O19KFFAokkX5LAFe4wT+Hk80sDq8wMUSLDCU8sjO2k6pGG+ykggADfuaGKmPk7LjL6hk0SNx1I+rIh1O4qKohY17g13G294neDnI7ZeLpqSV7u4BHUd+6i7ChDt8Xb64VLIXoMeIcIlZpxSxwxdJYioW2hKqXIJ3DDcaqAFnvvj1k+NRBEle/OMyik0zGNKNgdrI99v2x5z/Dy2XdXB3QxHSSWY+g27j8oH6++Fh4q8vcQzEmWykREEDQt1ChOoIBpZDJtpDir00Sf5WRMUfjz4tQ5hxkkKxxeQzZgL95nOnzdNNN01UCqE7kDbSbpuCeD+c4jE0GWeTLZCFtCrmWfqZiRiWMzrWlD7KBSVVX8LY5X8IeF5NxIIh1Y3bS+YY6AwAGtWIqw7WK7X6YZ3DoZG1NrRVCamIOqwQPNpGwFGgdz+uK/IqqIUmssucrw4KsbGNWcRrGzggsxWqAY9lVrazfrXYYz5zzx0zZlsj1khhZ/MwNKzWGkeVz5pGJrSCaF0Bts9cty8FCx7uo3aSQlY1BYtsmxJC+/pdnvjNHEc4DxmMCNX6uZjDsVFdNSNOlTtGrVe97b4i1Y0XRorg3BUCOw7GIIcwSS7gDQI4wRYW7ugBvYGF5zeJclL1IiiIWUKVSqk07rrO5XT3r83thhT8VmbN6FA+7xh2klYGmdzpjhjJAUlSLbT229TjrzLlFKMZQrlU0EstrGSNNQx/mlN1fffCuNoybTLbgnOUM6QOzK4jj8wSwgmcUscady5v4zdCzYsYn89c2DK5WTMmNdcccjtGqlyEUfDqHxG9IY2BQrfCV5e8I83AsZTSNzRLFJIruhW+qSj7bE1eOPM3PucOVbJZmFk1nphyTrliUjWATaszk01kjf9MFSrYXG9FR4e8MzPG4JM5JL9yijkWJjApLTkNrlYljsisQqoCfMN7ArBNz5zQuSyTxZMa5zJEoeYr1JlkN9SUEguaBIGyhF7AVYxzNwDjuU6OV4c0SwiLqLEqx61L/ABGSydTEm9Wm7uxjPXicOKQ5jpZ95DmGCaCSNDqTXlZQqnSTvQDLtfpjoUO+V/0LFU8jR4Xz5nMzM+V+/JloEhXqzqo1tqOkxxK1j38xFi/mKruZ/BOfh8YzcM5ljUiWJXWppLIKtSCyTudOkbD54hcs/Zpzcjq8cyAC5Se1CMW9i9wPS9jjXvA+V44cuXeQ5md4tRkdlLRIR5ERR5YlOrehZ+e2A2lhaLyj5FJ4deGS5xI83n3aNnDTHLpIIoxDSsGkAGrUw8xFqVB0neyBjmPxMWLLtluFuYcqkj3IdbsWdjrMLmyqEnYkb1t3GCDw68PYPvL5V88wYWXVWLtLHM5LQDWWGmgiGgKDkADbDIHGOE5P7yiiHJOX1yRFVsaE8mhKA0tWrSoo7nviL2RoSPFvDY5tNYjkZVQSM2k6wQACxZmttexvtd+xOLHlHwZmzEFZdSqI69TNyPoURimYRoPj9bI+QJwT8W8fleWTK5SnSfLQET9UBYCNQkVhsvw6aFjzMflgn5J5xmzcUmVZxEFURyZiAodCEMCFAOlGY0AdyCe5IwuR/FmYvF7NQtnI8n1OnCsghkmQhjoJALnamYGyRXyxddTM5CePKZbMSZ1zHUKKzKpV7KrTHT5R7EJR9PRgcr8ocByuZkkm8+YiOpUnk61tpUqyIdnmMvbuQ2wusSMn4M8QzPWzs5OXntBlIhSyIof/ANSt0DIwpRvZ3H5R0dlVeP8A7Ofr5LHwM5KlkzmcPEQkk0SRLHuXUKwZiilQFAKnT7jf+LFpy1mM7JnKymWTLZcq0UjSICWprWvMHYamAAFgL3I9GPBnofxlRzURL5hx5eoIgg0r2/WrFWO5OBnl3nT8TLMIp2MkkraEC6YEK7aydOyoI9KXsSx74jdlFgt5uIywQS9W5FWXWyxuvUlaSUqVAJpImbQFBLNV71vi3ldITKcxKoU3Iy15Y5HaNYwndnc6fnvqpQDim56zQeJ7IRNMckrUDIeq5Co6iyAN/h3FH4bxanj0ZQGVlETSLHG7+W50FBlsE0SgC7g9673hTHXgcgKTrKArxvUkY7lSpZR1DfmdnAFEGtq2x6jzpzESqA6RoBFIw1Jq8uhgqkW6knQXABIqh6448SnDzQOGXUzqkm9gN62K73QQn+L5YiT50ooSQCmmdRpJaTprRVNt7fTelQKBJsXWCZFhLnZCrRroDxr5WIYJGCAsh0ijKNmVV9NJDHfFRwXh8YVodLFEy7tZay8cjWWLbaDIxFr8axDSNNkAgyWePUVIcuQreZpfgQqxKgKx3JFk0dtr9bwMc482BOopkjgcRkRpqW2IumcLflFVuLOomxe4CF04LmwpCpUVgDssYqRdhQaQhW0kMVKbDvgM575ezE0U0eVcQqo6SswIMjxWX0gXSRx2pfcs5Y+hOA/gHjWqZXLrJrlmp3zDAlUWSRmOltrKoQulBSkCq9MS+B+KeazEkiwgJG0bDqsrIkVqbKtWkGTelv8AXvgdqD1FAOQcyZEg4hmiqsjvtMJRGVT8JWDAx6n9O7Dt3vF/yHzBl4VygZm6+UlYwnSvTeFtR81BmtnN2N/lV4M5PDDJQ5dZc1JqZcyrPJr2MRbSwLNqBsdio3J7+W8BPFuNnMZ2CLhqqraAkWlUUUQSzNf8JNajud29RhpOUhuOBfcc8VeJkz7HpLYcaBpi1EfDqNgud7O49cVfAeSczPDLmcxMYoWUMCPMZYgSd1+EbklRpsnsPeF4h8yumXlXPOkjyMI2GXnGuOWDcl0XynUK7j69zhT5LxozeVybZeOFlSZievKZHLJp0lIrGhEAN+Qmib7m8aHC5DydGj/CvkHJSRTuYJczIs7wxqTpAjQAqddhRsSXbcjsPTAh4meKHD45OgpOXeGVHlmgVnkYqoXRC3lA0Ami4IsG9V4pfs38o5jOxyLLPnYYNetOkjiB7DGQmWx8QBXSCQDRN7UvfFDlnIvmZ1ycqxxKVVOuzfiPX4ml62GoHvZPp6YtCC7UxWk0GXHPtgBY5ocvl76jWZ8zIZZnoUGcfCboEIDoUi8X/JfI3EuKQxyT58QwZjUfu0JCswJtdhSDW4qnLECrrGTZ4tL1YIWxqG6/UH1xoD7OvO8lSQRxww6opCcxKzapGUWsaMaRGB3AU7eY1jpnxqMbiCMwk8Qfs8w5Dh2bl0nOSvoEMpAVsqosyOdJq727bgD0s4y5logWAZiFsb99O+5r1rvQ7421ynmmzPDZkzSH7qqTHMuHcOxhsJpl/NZ7kd1A9zjEmciUOxW1XUdIJshb2BIqyBsTW+G4HaaZpO6s3Jyb4kR5PhYm4fl3zUSkwySFVgclKJlZKDPFbab3OogflOBrjvi/xBY0lykJaDMhWe4yZEkC6emQoU2wDecBhR3N4RXIvjjnMsgijOuKywirua8gJUaiofz6BsX3N4ufDzxZ4gmcil0yzyLcaxHUi+axQAFKRZ3INb455cLttllQ2OYvB0ZvMZVJm6cjlDIAwOhGXU8YALKjAilsEknthT+L/KGRyUrRxiaWQSKdEhKJFHu2gts7u/ZmBCqO243efHMxmIZOoYmSWeaCWRUJkRCoG6tswJBOo+gs/Iqn7WdSZtFh0SJoB1ppaUsfiErg7kG9IbcD1xLhk3KnoaWFYnZ+NNPK76VRW7rGuhEAFKqj0AAHckk374ucnyjLoEvRd0Nqp0toZgL2I76RvttjQPIP2VkTKapvxZpvVCNMWwdQpFlmIvUPoMNXkaRZ8oscRGnLsYCzx6D+GDqIs6A7jy2u473jolzr/EVSpZEXyx9lxZMrls2J5EMiq5ieOtNtpkAZRdDuhO1bmxjRfMHB4XaOCVS4AAjZiC1xrpYKw9HPYmtydjiVlmWJo401nyHSXO2ksNjfwhLsFrGy7b498w5OBUEzaYwgJZ9Y+MnSSSR8YS2VR2/bHHKTk8iObYOc4cjx5uJsvWgLmFm3AK+STV0wBWnUhYO24u9/TCy5++yoczmJny5EHqEG6AkWSDt5a28o739MN7IZiEiQJMDqjhj1WWcAu35uwMim5GHba99xz5k55gyiIHzaUHQEv5pWjXUxUFTtfwUTvff0xoya0BSaMpcxfZz4nApIQuqMIx0ntirgkMACG6bVRG1eoA3w6uHc3yBsrlM1w+abMQRqf8RNOsqLk2YIwCDyh22OwO2A9vtsOGzNRoAE/wC1UjVTBqPUv0aP03C9sJzmDxozmYcuXKWbAUkDtVD1ArarIx0uE57RRSvZp/mD7R+WXMiA5aZZFlLEMigq3T0KyqNy5v41NAfTC1n8ZczJOjZHKuZBE6yB1aQP1GLW16aVGtorNqCw9cDHKnApc5DrSSNs395j0LKwEroq6rLsdRjBu07EWL3rGvc3whFVWpeoIANEZ0qSUp2WvyL2FihZwnWMTSaj4Mw8G8K8nnNck+fH36ZxqQAIkMpO6sjLqcVpHlIANAd8VPOxk4NNeXzDSSshVpGg0KgJUkRMwosCvmK2AdsO/lnN5KE9NoIoZEYskgUEFz5+oz9xR27kWAcGD8LyWdcCSKLMCJiYHmAkXddTLfbctsPmD6YKl70J8pR+EnLGYMcGZzE3XeaBGSLSAIhIxZ9LD4nYUrEm6Hb3apzMZQx2A6lCoG9MznT/AOWn1vce3bAw/FI4pnd1aPLZdRHFdLGJJNKVVUAPhS9rJ/Xzlp1RVJZqTLuXJIJ0lw2zDbUu9MTZ9sTbOdtyYqeZfDjNRrK8MkstyP8AeSKUSaT3RRRAVdt8EXhr4lcLyeVM8gVJGbS4I1SMV7V3IGwPtgV5x8ZJXAy+VVwtdNWUl2kRjsWNbFie5wPQ/ZslmjYTgrM9lFUio17B3b0N7aT3snCRScrKP+uQW8YftFtxOToRxokLNSa1uTVd6gbpSRsa9McuUo58tIGy8nTYoY/QiwCPMD3om1PcHEzhX2Os5p1CaOtVK9Hy7WS29g3sAD7e+I3P3gzmoM2FRnkhjjWU5hgYUJVbkj32Mlj4fiPt3x1vrqLOW35Lbkbiy8PnkzmZabPZx106tdIiMKa78zMCFC76AKAHc4IPEb7SeiPNIsLAZqEKrF/xI2ArzUDqWrsL/fC4l42GQkbajdAEk1tpP1Pp+uHB4FeDcOZhkzOay0cupx0GeQstbqVCfkdWF37e2EdbkMmxt+EcP3TJwRMxfUihemi/C3m82mwQdVA2Gob+tFC8ORTK0kaIoKNDYU0R8YJ3ChWOw2N2bOOvB0yuSh6VJFFGC0mok6Rp3Yue2k+UV227YzFzr41ZzPK+WyaVDrMX3oX+KFYkElu3l9bO1YmVjGxtcw+NGQywcJOjzgeRQWYu/Yh6BqqoURVYzD4w8+5rMyxLmT93iJAXynpRhzXUIFsRVkjHvw8ghSZYzUmY66NrYARjT8SGwdQB+foTht/aRPXGWjy/TeUmiiqu1rRKkflBH88ZNJl+vUN+QM1l8kEhyanNyNDraSNU0kkHzvIRspAIKncbYAeE89TSzTapo+G5QktNJpppdO0gQt5rJFHYjcVgNzPiGnBoDDBIJOIEaXeNtUUYb8pX3A9PS+w3xnHP8yZjMzAzSSTF3FiySdTbhF7Am9gALNYtHhcssi2PXxm8WeHfd+hw6N+o1ibOOSsriza7VqVrPfavfbCl8K+Qxms1BG4dcu0gEsiKSABuRfYX2wyvHziuQigy+TyeVSExqr5iVlvMNKVFo7EWALuidu1DDG+zVwUfcbTMo6uS0kTR/wCG+406rv5ntizkuOGAtZHtytwjLRiHKxO8eWjU0tksAL3DDfS/r6/vjMn2yuDdSRc1Fllhy6Hodb4XnJqmZSbNUQG7mzh1eHMeWPxOolR3XX1QQQvspN18vTFBmODnM5npS5UZvKqk51swlWKZX1IpjBNa1FBh8O3viPHJpirZmHkz7O3EM1lRmoYw0dsF8w1HT3IBI2vYX39MNfw5+yrnIczwzMCQRZgy9SSGSqWOO9WllO5ZdqJO5v0xpTxSzC8N4TrgC5cJF5YR5VFjZVA9fY++Mj8I+2FnRGEmVZ9LXHMxKyILsqDRsVY7j0xTvOd0UUVRqbxE8XcoeIR5bqdGZJVtmBCqvxjSzDSCxBA+teuDDmZZiiXL09Fv5E1BxepdZ7EEd6rGBfGnxWizkiyJGwcEFnc+Y1Rrb0u69sPfjPjPxCdYcplY/LmMujM+lmaBaonV2+dk1jnlxtKxuqboXv2gvEvMPO0bmNdQt3itS4A2BN9h2r/fCw8IZuJ/eAeGiSSVTq0IRprtbhmVSvuSR9cRvErlTMxSkSs0lk0+5vTsR61XteBflrm7MZZ2eGR42ZGjJUlSUbv2r27+mO7iiumCXJhmwubftHzRmcZ1UTNw6IBl4W1q7MoLsSt3sfQ7EHFtxXmvXwuKcr05nlGyhgRX5wzfxD9/TA14VcPycmTUjLjNZlK1KQsjMzj/ABGkNtt381+tY0O/K6SZZY3RGrRcJoqCB2H+VaxwzST0KmAvIniPHl8nJOwFRgtMaJYj+Pfc+v8AbCa8KebctmeNGaBl1yuxiWceVmIHloi7O9eoF4cmW5P6nVTM9KWOYdNYkXpxqqg2l2Tr7d/0xlbnjw4K5524cskSwL1T8QbLvHuTrI7nYqPUe+KcSWvIkh+8Q+zDm5s3NNxMhVfUsUcT2B30sPYJuNPf9wMDviB9nRossGyrszooJWwWk32qthVXWxwP8I+2xn81G8WYjjm0w+WRbRgV/Ox3sn5H+tYDeXftH5mMxGNxFUq2WJZSCQGLg+ld/bDOM7Hiyd4Z8MzUXETG0wy+Y0KxE24mUka0sn4gtlfn9DjTHiNnYoMuquyvBI4EZ02yMV8rGq8moH53gG5z4jkM3n8tOhSaSJg0j5ZTIp8n5wAaAN73ff548cpeL+TzOanjnCpl8uheITUnUk1d1BHZfTvsflhJJvKE8nqLmJ8pGqPEkkbDfqDUrr3Bonte4Hpjpw/75xMdG0SFdNUoCqB8A332qhXy+WK7g/2goM/xBITkhmY0DLHRBK9/NVVpA7dsaB5Sy+X0zaYUheQhdA8unSPKa7X7gfvibi1hlbpWJHi3Li5IyDMr1lYrpcX03Qfle6FfLEXn/L5XN5MvFFECoOmKirmrAojtXcehGDrxN8RcmgXI54eSVCBL/Ab2JY7ij+2Ml8+88fd5SuVkDCOlWRDYZfmPc/2xSEG2qA3jII8NlbLyoWVb70SCKO29euGjwpFJ6jQiRWAIWrG/ptuPl7YS/MnN3WfX00Q0AwTsx9WPzPriy5az2cdtOW6pZxVIGPb0H0/l+2O3k4nJXZFSDfxbgjhGXAULuxbLsAWT6keYBr2B7YWvDcvmJpenChd2sBVF+X/QYanKXhAWL5jiLujBh+C5uWb3BJNqNttu2CXJcH6es5XKtASCRKdWvR7BqFA4n8kYY2zdW8gZkfCGHKFmzx6kgA6cMbWrXViQjtX1GCLP+IFhVykcWUjUDToA6gI9eofNv64uBk8myKFeRpZYvxWkFiN79L3/AOfXAZL4DZueeOJWQahYe6BXuC3besTU+7+zoKVaGRkuRMvIAA8k+c0daR6LxGxZUvXxem59cQMpyhxZG05SNmB0nuoKDuANTdh9MGHIPO+W4JDmctJMMw3c0osMRRUE3dfXb2wq4vH7iOZkSHLEqxkpJAPOEPZWYbFVu8IoW7WiutmlOMeLvRER4i8aSxw6WSMlgznvsLO4/nhDc7eOkmYlGVyES6WPk2piSbN71sPffBVlPswtPrbO5l3m1Xa7ivmSfrgu4B4O5LJyJNFGdaWocm9yK1AYyUY5eWM5LwJ/kj7OWcnzAfOaViB1SJqtnPcABSQB8/0xp3l3lWOKIqoRNLCinlBqu/qSQN/njzKusvYJDRUK2bUPXbsb9cW2VyKmMAnSwCnc35gN9/Une8CUrJOTZmbkLwAyUkUyRrPNnEdlUBj0gwoBmf4VHf3J71hgQcNzPDOGyy5jTl5InVYyG6gIsAdMCidXrdYd3GY48jlpGhjA0Laog+In02G5J2xhz7SfipxCd1hzaJAg/ESFSCQG7dQ+49BW2HivkeTLBbcC+0rxTNvJlE0uMwdJcJbrFdMVG4sLZs9vfEfmHxuUcQhyuUJyuVSaKGWSxrl0sFdyTZUA2AB7Y9fYn4fl3zskkkwRkjpIyaL6rDfoNv8AlYOvFXkrhMBaHLZdHnkOp3JZjH5iS2r0snYDBnKEHTQ3Vy0WfiJ9lXh6vmpOrJJJLqeFWkOiMnsXayzEn+K/QVtgX548IcvleDPmcxpbPloxC8bkCJRQSOMWLAFlzp3Nm+1euWcuTamRtJrWztbbeg1G/wBcPHmHwuyOdyokzkJEaR6YHEjK6oDu40mhYqiR2xzx5XedFnDqj+ccUGpyL9ySb7nf9TjePgA+XjycU0alxLH02SvhePZywv8AN6HvjLPM3JcBzDJklboId5pG1DvR83+nreGV9nDnl0zP3OMB9bl7B2Gmrb2IHevp746+V9o4EQTSZA5HPCSbyqX6ipValYkClO1D2xqfIZ0GN5y1B1BQeoA7Agd2J74zN9oHjwzLo7RkdFjGJKoOe5oH5/thn+BnM75jLhdgU8i1udI3Pfbt3PvjzlgMsoKHlVk6akhmjZnLgigTufXcm6FitvbAJ4s8LuBGDBMvDqIFlWckV5AO+5NEmjucHHHc8kYcsrPHaqWVRpsnZa2LfptZwNeJvBp54HCREWlKGZVqth5QTuR2G2362WIiFytxZfuEUMIbrOL0DztqbYlm/KAPmMcPEPOZrKGCXMFGdoekiKLINbszfLa6xbfZ84VEuWDq4E4J6gJNqVOmiNv+fXBtzDwmKUj7xG0yqGZpSAEQ1uB6/X3wrQ95EdyV4yZlmjUlXRpxrdgLFnyp3GxPr/XDx4VxPSpWSXQ2syMxFUGP5VPcAUBq/vjPEPjLwjL52W4yU06VKqXUSqbFAdje1ixt88XMnjTJMyomXYNJq0mWkB0jUptrIX327VV4dRYZRscfDwhok0qsalmPxavK+kHZbAqwB6gd8WvEOEokILEUWMmlVBMlE6RRFaiSKB9ABjFPNGWzuaYZjM5lFA8sWWheyaO3lWxZJJB3JHtghzfFePiMXJ0ok8yl2RZKqu1XdbDbFHAyg2hoeI3M+RyMsTNCseYzVyzWpmeEBQquVsrqA+Ghs1+2ALmL7Tk7NGmWoQCQdTMTfGxY32Gy6V22H6DA14K8x5w5yXp5c555KErPvpAPZpG8qAjavUDbtjQnMnhRlDlzmM5BHltDF9EJLLZ76qA1NuAKFX77Y1KOyOSn5d4/k81Is0E8fVZvOOp0/L2AKk27m/XcX8hiZz7zP00lIgeSDWwklICowIolU7lUOrzGvTc4GvBnwgyZnOYGVYPYOUWZ9dFhZlZVsJV+W6qu2+GJ4zcFaaGaBGWO0RZZibCqb1+U+rb1t9cTl18Dr8lB4d8bizsERHky+W6gAckqX2IcV30D3NAnttjpzZzM6r0cmXm6rEMUtlhNAhvKCAu11d7/AKEN+zRwSE/eyjnRC6xpEZCYwSvnlKju7k+tjbbD6zOQ6SaY2IMnlWq1KxIsjy+Uabq/9MI45obsir4PNMZrlk1sFPThSM6kYDzPISaB7gA0ADj4AR52uSbWYqjIIEbtZGxAAjXck74IouD6WkRRSLeohqBZq+JvjZj6712xxPDFXTajWzjSqWoVQSWIvvY7k98MkI2ceLQxNTgoUhDKF06iDsB3HmN7D0xKycfmQMAC0Z1AoO+xBYjvQA8vYfoMe8xw5zrRT5lk2JArS3mA376ReA/mTnBoGaKKNpp6BJXcHYdyTQF1/pg6AlYL+Lfi3GqDLIWlmMlvQtWcitHl37/lHYVib4f+GMOXRJ5oi+YkXXIpuwx2VR/DuQAo2Fbk1iu8KvCbpTGbMr/3UxkkT8yR16C+z9zsCaw0o00a21MzsYo/NRK++kAV3JPqe3tg1eTX6KjPcP1uoLaURkVFHlj6vcjy/GE9STu2LVYiCFUFyo80j7jVvZUep/p74r+IwoXKsfgFhgbIJ8oCjsXO5Pri24PAyoARojUVHZ1SP83PpZ9LJwDHnjvMaQmR3DGOGITSSEbAg1pBJqzVkD0+uM5eFPiHLn+LFsyjSRdRzlVO6QnuCQNjsL3vf6CtJcW4SjJLHK2tZEJdCKVVA+nfb9z8sYzzzZqMwLlIpYdczlCBZkpjoY3uAF2bVQIw8FaZOTaNO+KGbeHMLNFA88qEDXG+k0SKBS6IO49AO+EL9p/KNNnMtmMxIqwpH5YVUllYjUw1erMwqvStsQ+GeKPENU0moyziIrmH+BII1sEgdjI29AX29cTYDxSdoMx92Z3AVYyyjQwYfFRuzW9mvX3wKccotCavJ55H8U3yMM8ssczLmINEFqPw0dqfX9RXazsMKnI88TZnMZloXkhjl0IfxCoOmwoVdwAdu3b6nDij5maXLZiKaGSRmnSCZq8sS6l20jsQDsVG5IPpg4439jLLpNC+Wdvu2gtJGzlpFlC2hUkHZj3Fem3fZ4OKu9lOWd6KHwZ5W4lllXRBlx5evIWk/FmbcxsXold62utq98TuF5XiR68kuWhlzYuUTy9JmaIbGKJdwQO2+kEAk+uKQ+CPGo5YWibqJ1FFFgGEauBbj4dIUk6bvbFvH9nbNS55xPMYsrDZ6ytpd1eqjjomh3ux6et4VpeWc9sXHMvCpBknzSjL9PUDMkaqjs8jAAuF2Gkmgt7juMEng9yU08M0mUnCSssYeE1F23VQaawTZDVe3fesMPkn7PmSUSFZpMxlCod4XI0vKSQhYgAkIO3ezXtgo5K5diyz9PKoqIziMsCWeRlW273pSP51e49MLaqkNkkcN5Dy3D8ooEAmzLANK4Tqs06n4tRF6QxJAWvp3xX8Q51d58oZm6LSB5Ey9XNKy2ouvKvowHyH6HPFuHlpBNrcvEGCKCVisgi2UfGaG39MC+b4bEZMvNMyJmCx6YB33GoqAOw0LuTdGxteEu9mosMzkVZ5ESNWcoruFJKDVppW33NgsQBuRvtiBPkdTSKVEahQxdHZyrElS9AUHksaEuqG/tiszXill4mZFDSl5S0xjOkIi/h+X3FBaF2dzttgd5n8X53Tp5KEIik2+ghgbFWBZJPqe/0wtodRY5RwpI4UdltpGRGGm2djsGPopF36KoBwBeIPM+XMZXMODl5Y2AjUjqCQSeZ9Y7PXbSbBGFnmuZM95QHkaQjeNSNWphvQPZSDvZx25O5AErmPOHct1Io0dDoA7jfyrfc/Qe4wOw3U55PxdXSAsRRNcaFt2oJWkkGrcmyzGzTd9hiVzn4j58KXaM9FlaONlACkAfECRq+EAWCDiwPNWTSGZZDl8rDDIQ8UhLO58tPQYsXN7UO3z2AL4o/ah4e5iSCF8wsSbSuDEus7GkJBNemwGw74eMJPKQWvBZclcR4i40CdsvEUDszGgVWwKZgTZsbAUCfniu5s5Bji0skrZiQbyu+0SF/hBkJ332qv0GA1Oa8znGvLZd4utMkRzExLKNZFKOw02NRKjb9sNfiP2XeKZnpQZ7iEK5NVLt0YtEhMYpQbsH5XsNtidxXpW8AarYyvueSg4csxaCBNOpVYrIZHRask2zBm7AdqwgeO/aPhiDRsrzRh9QKMIUfyAUdP5FYml3sX71hkP9k7hk6CODMSB4zoVmcszH8zFT5RYsCgosYSHiZ9l+fryLlFaTKxyRw9WRqZpWoOUAFsqE+Y1tWGhCDeQ2q/JI5W5R4jx+aTMh0gyauI/O5CBV30RovxMq7Fmrc/phxeLnLnCOGZJRFphzqorQMsjdd/q1k0xvVY2B+mKvjXhwnDcrFDA8gOzSGzUkp+I0exF9gK2xG5u+y+mbdcxmszMWdFJIrSg2UEkilUbWBvf1OD3jJ14BmKEHxrniPOzhcvlOjK+xWNnm1miWYKQSDW5PrWDfwN5ji+8CHNss0bpJDHHKthZG8gGn8oFb18RAGH94MeH3BeD6naRDmzF0nzBlL9RX7mOMmoibAIA9PXGXfH7lI8L4lDmYpkmMkn3uJCptPMGUONgQxPl7Hb3Fm2JPrEk5vybT4vxHPQ8HzBAgywgjMeXeOIqZFCkFun2Qn8vf3xkTl/wjzOYyEuZRo0gi7pqDSyys3nYkjy3vptt+wxpLiH2gzmMhlYsxk5knzkRYqIWKEtsCCLC/xDVppbJqjhReFE65TPT5PPwSHL5pQuiidLlhokCI2+1+YfDjni2sFq+pK4n4WcOzEMTlIoJBGI3jRvzKQdb0TbMNXoSNrO+NBck8p8PbIRwxRRSQdPpgimYswp2LHcH3Njf2xnrjHhrl8tnWRXkKiYKyqCW0NYUFr7X5dzfe8aB5TYZXKTqmXEYiV3WNTqDbE9z3ugdtvnjSdkkI3xF5vlyUb8G4eGzEzmXrtoDmOOWyIgQSNlIJZqoUTucZW4ry4I1DGmbUylf4Cu1V69vpjU32WuZVkfiOYmoTZiYRtsS+lrJRfYjtXc0PbAJ9qvhPRMMaZdYoAbDgUZJD3DH3r+mKwnUup1KKUSw8FeUsp0PvI0vmEJXpSMECbbSA33LGgK/bfGkOX2hOXEv4dtoUOoQuJgaCHT3Ok+Y7gb/XGAslLMLjU9969DQu9/Ye2L7kLxTzGT1mMByQQockhGYUWVOxYix2wZ8Tk27HllG1+aeFvN+FGxg8pHVRderTetU9iQO59x7brfnfwNyeTy3WaSSGMyKJHZeq417xsTvQJu/Xfttjp4Qc3cTzkKuOnl1ibSGZTU8mwddI+EHaz6k/I4a7cAkaDTmnGZZpQZE0hY22IESBr+HY2T3vt6cvXrg5nJoRfhF4iZkrmYoYjKsYZ45HVhHGEW7ogNbAWqi/0xP5Y8R83mY+jCnVk1dSZtlHmN+XTQUAGjY1Ee5w9OBcTj19PYMWGihSkKNJJr4jsVN127YiZzMQGSeKOMKVZHYqoW2O4113F1fbb+QdeBFJij5j8SppVkykQ/7uIHVICD5F0kqABd0KPr7/IN4C+cbKztLB1oxRtiw0b7Og9vQn6j3w+08JIIcy+cC/iOjq6obW3A1aV76iL3si/ri9hSFUNE/d0j0U3qQfhb3pSfqSN9sK4jqRm3k/mXOM8qZaHUJl0Oumkj7LakdtA9j/bFFzpy1C8oyeYlMUkerp5gLccrMAVV73VQbAPpjWjZ6KMUoCg6mIUbgst7ULIoA7+tYQ/i5yXKo+8dMyRP+YgmTSSdyuxHy71+2AnTtDWC/AfsT+Z+vmAtr+F0l1j31OTVrp3oUcDfMn2Tc2rEQPFLGGAVi2gmxdkb0Pn9Dh5+EHOUeYlii6jL93VnERv8UjbcnfZRp0/PDJmzSCQJ21xlzIBS0rV02J7AA1t7DHSuaQttGS/DHlvNcMzTSZjJSyBUq4xr6RO4kAF2dIO3oD2F4cfKfOmQaQTCQrmtLxFJHZfK29vEaUMW77UB6YYfFeZ4b1NLGh1CxqFGge/0B2+gBwkPE6HIZyZnAbrsVVXiWg1beb3N+o3rthHNN2zO5BkODRfeZyyhokgLy7/GJe1V3AN9qFYUPFeU8w3V6OYTK5SImWJOsdTNpGwbZga3Fkj0rbEx/C3iscebdZekiRgDqbmcLZRBXah77emJP2ffFlJZfuuagTqMlKSop6YbEV3o9h7fphknVok8Fen2knkj6E4UxTDRM9a30AADSt0WBG3Yi8MPws8LRLlVb77J93kQ6ox8VatkJYmmruv7YW3jZ4RjL5xpctl2XJkDWRuiSXVAXaqbHYV++Cn7OfNUq5owkh4yjP0tgQyDYqTsCR3s4WSVYCmx5cq8p5aNdEMWlQmhpXWpDveoHvq237VtWJ3DsvoVdyzynTT2T0lJsk+g7Gvet8e+Kz5hgAsaqGXX/ibgEXvS9z7An1xz5TglVvMU86uFAYt8NGySNgCTQwlAs98Z5m+7xTM62ugtoG3U0gUyexJABArtjP3NZzfGstHLly0cbSESZdzShgdnB7uQLv0297xoXO8G84tyV0ghCAaJ+foL3P1+WBTnDxEgyCxq/wCCrlkNKAgN+3te5OCnX7NV6KbkP7KaZcKz5l5GrUoVFA1j62KU+/fFj4g+PmW4augRdeyBSaU0sB8VCh8zQ3OFLxrxKn4jn/wc392ymXCIZLMayNJ5QEH5i2wH+4w0By5w7JvH94RpHaw0s/n372PQE7Edv3wz3kqoULTK8w5ribyZjMM0GXHlEVNoaM0StitTb2bPywwODeI+ShyrqI4+rGdPQTZ5QTsQvewACfqb9cLvn/nWbPCVctojijeNe4RRrYIr0a+G7Pyvb0wv+YZ0EvSyCy5rMqBHLMFLDqg0zRkdl1WATtgqDkZuguzfhy7uc3LEuVywuVwW0uB3YqPc9qHreFfzV47ouqPKR9OP4UlfeUUxOoNZNn09a/bBfzf9nvjrwdXMSxkUKhfMDXue2jtdjteHl4PfZ9y8ceVjkyCNmHjYzTyurCNq3sE72aoAdsdEYRhl5Fc2zEPEuW80YDmnR+mzV1XB8xYd7PcH3xM8G8q7Z7KiMapBmI2ArVelgx27HYHH9Feb+So1jGXmCSRrHugWoyQfJQ9Dff5YUcfgfFk5MpmYIgczHMDoV6VkcG+530g7fTD/ADqmqIZuxLfbT5gyz8SdsudygGZUKFAmAAPzuu94geHPjcmW4c+WTyStqbqaRVm9ve/Y+mJPjN4TcSnzeazH3Rwu8pI0lSgHcUdzQ3rCa4XwfWQoBLk0AMUSjKGSytuj7nePTytqLHV2AU6f6Vgh5A8TM3kJxNFIyuPiViSjj1DKTv8AXv8APBflvC0aUD3HItgkbg1vviqz/g/NIMxJARImXjDyljpIG+wHqdjgR5YSdILg4mp/BPnqTmFZcvnY41y8KiR2Xu5BJrT7UN96/nhYeLeTy2YzmX4fB92gykjqFzYANMgIKE+jbVV1hJeEvirPw7MdSM2Kp4yfKw9j+/8APBlyLyInFpsy6Rtlk0u4KtcfWNGq3q7smv1GJuHWV+B28YH/AOKHhLwJk3lXVB8aQMqs4AGr1sg9/lv74RuU8Ysxkc4Dl5Y3yc2iIKwDCOEEKAx+IMgNk9jv9cDPKfgg7FjmHaKw4R1DMGZQb8wHuKo4d/hj9n/Kvk4cxl5I5MyisZwW7sdqKtsD7e3zwtxV5slFOy45u0QQyHp/eyTrSTR+C2oWVDdrHb5fXGOeac8zyOxQREn4FFAfKjjY3E88IYghSR8vGQGjkcUCx8zpp70br2xnTnLkYT5qbo1EigWHfUew3vfY4X+NJJs6efQ/PsXckhMq+cVo3DFkzCGSnQIbBVfQEd774ZuT8VlnzWiFXMSI0jygEJY20BuxK16YwFwDj75aXQXkWPUBMiMV6ieu212O141fP47ZeHhwTKhmiNosbipFZu52FkYfmhmziQVeK/jVlsrEGDmZMwxR1iKiSGTTtIoNVXc0b9gce/sq+JUGZTMZcqZW8zS5yUANLr7IUO+y0DW23zwu/DrP8KfI5gcSGiSSypZfNRunjPfUNu2E9nsyvDpYszw/NiVdXZtm2NhXWha+l7YMIJqvIWn5NT8Y8LMmTLl8rlUXXGxUqe8ntq7hdu3v+uMe89eBWfymtpofIg1sytYCk/pZHrjVsP2g8oI8vnmqHMMAk0KkFWDfnAHzOFV4/wDjKvEvwIbIA3cWLF3pIHxA4PE5ReSc0IjkXn+fKuTFI0aMQJAteZfXuDvV4IPF/PrmHTMwg9NkVCK3UoKOojbzHEvKeE8ZyyydSpNRBWu36YY/JPLwkg+5xxgsSfP6k+x+uKT54p2hoxdZFb4R8Zz2XlOYyo0sq0WZbXSe/fF/zV4+8QMwkMhikU2QlBWPuV3GCrnvNNw+Dpo/TzBGmWEgHynswP0xnzPTlms7k98NBLk+zQZOlQb89+LWYz7h5zbBQq0K2/3xI8P/AAazWamVOm0asNWqQFFK/wCViKJr+WDrws8OoIct9+zK3JqHQgf4ZAf4l70fS8F/PniPnXRVRDl4CoCrp2238p7jCS5VHETdbALLeFGTyjv96cZk7hYYW3U/529CPl7YY3L/ADNKuX6fD8usARXZmI1yNtuVYgn54pOK+HEiZQTRr1Hbcn4hftfoT7HB14Icj8U0SFolhjYb62p6I7pXYH5455Scs2MkJCDn49QvPrlfUL1Gjsfnh28U8b83noOjlMiVVY6JNWRVGj64uvFHw64TFEvXoFd2KMA7aveqs4UXN/jpEkKQ8NWRe4YsLYAdq+WNGKekVeENTwZngymTzJ4jCiyRksFei5ShVD5HCL5q8V5Js0zZQP38gA3Udq29Priz5c8GOI5h0nzN9MuusOx1Mvft7Y1Jy/yLkssymOJVdxWoDeh2wX1TyLdaM88lfZulzBGYzrFbfU0VWSO/mN7A4ePKfJWWypIijVbe1NbqT8z6fTBfmmvV5gvp/Yf74i8aREjJY9RmAC0KAJ/NfthHNsk3Z8j4iA2krZIYsb28v9sQ+IT/AIbFWGpaNnegdyR7V64iNmytE76lKg18Pp+oNYqeDZgjVq00QVJux9WX5+vtibZi84VxayF0sorVrP5vmD6/TEiLm1AKJBF1vXf3wC5w6kdGoKg8jKxF7bgfKvQYl8jcnTSrvGqw+hkNsa3sev8APGsDLLmr7R0MDrHEVncWZjdhADuSRY9NhV4xH47c3rms9NMkhlVzYJBXT/kAPouGd4W8jRKxHma++rSb2velF4A5+QoTnWXzBeqfKCtV7fD2x1cS6yf4GloZ3g9ynw/LZJJJ81FHmcy6flLypGNwiVspJ+Jv9Bix8RvFSPLs8eXm6s7rp0BFKi+2pq2NV64TvixyjHFOgTUBoG1j/TAhkMpUt2SbJsm+36Y3xqb7srF1hBNxnljiUarNmI5Y4rGmQkBGvsAVY7/XfD75a5c4xnuHCKHNDoHyTAjSQgHw9Te9vT39d7x88H823EIZ4c2xmihj1RxnZQ3o23cj0va96xE8OueMxlopYopCsaiR9NCiVNC6Av8A+MI5fjRqp0LLxI4oMuv3QVpiqNt9yw3Pb54E/DXnF8vm4pYfKwcKb7UxAN/LA/xqRpZmd2LM7szXXcmz6Y7Zvh4Hax/z6Y6lCo0TUsmx+es0GjlRnEqNcqsBeh9vUbC/QYr/ALPMxXMLI20QsG2pQx2A9t+5/THvwt4UhyuTjItXhaZ77u9VbHuQPQdsUvIMWjOCMEmMym0aipomtq+WPLkqZZs0txeeJ4PP5khm1KVsBtLagfnWI/E2MjqUvzCzdjYVf02xN4hJqCKQNPUGwFfOvpiRPLulbbkH5g3YP7YNEbFvN4W6NcyyGMMxalIA07D/ANxvt6X74SHNviDxNp5cp95McTFYxai9J33YWFYrufX5Y1rNlVsbbKNl/KO+9ev64EebOSIHyzgoLMgl1gDXrNb6qP0A9tsZYHjIV/I3CeFKkcUVSnLapJWah1pgLokjtq/T64zt4oR5553zGYO7ElEV/Ii/kVaPYDZu1m8M/j/Ica5gojSRq7oraGUWD3Hw4PfEDwfyuvKQgNoLIrDUCXA9GJBO/rVfpi0JU7LSqSozPyjwyaFopY4JJszI1wkg9MN2BRdtZHv2G2GF4n8gZ5UjzmelqZq1xXuqiqB0sQDv6ev0xq/iPDkTQyKqGMdOPSqjQtfl22O3f2xm77Q07SZqMMxIU3WxDGgfNYN9v64ft2dC4UbDT7NPNbjJ5oTkw5aCpVMA0ZiQgs5UndnWvkCe3piD44/aAyucgvLvOZG8q5etNFRWqRQL7Xua7jCc4NlZGYN15l60gRwjqq6brSAEoCtsaH8UOUYMtw+PoRpE+YdYZZlVetoN3pdgaO3evfAnDOTni/IAeC/jtDw/JaJZmkmdmdY920EgBRY3AH8sNznBos3w8vmdKhokcrqZSr9xuKLEj/T1wp+bPBTJwpEyIbWjuQdRDAebbfF7xjjbzvMkhtIYSEQABew8zCvMw9Ce2OWSt4LtUib9jpnBkgSNU0vrllJUkg7IO12B7mgMOnxT8Uo8sREg6uZ1llyyKWYqBWsnahdEknt74V3gFlhk+EZueH/GkZtUj0zUDQAoAAD02wgOGc55ls/HOZn6jVGTYrQ1WNwe53798XcbboHHFPLDmLx04t1TNO+hEbUkAWkc9gH31MoO59yMV3Pn2js9OTqkCyMoVRECo73Xe7v1/TDJ8ROVI2yTysCZCxXXtYFjYWKH7YTvhtyTE0sZbU34leYqe1n+HE1q2dkVGtDZ8Ms5nc1LHmM9MYY44WKoh0dVaq2BJs3vfp+pwAclc/mDPpoeSWMysdLMXZgT5R6lq22+mCTx4ciWNFJRFjICrQFUDXb3wl+T0MecjkVm1K6kXRG5HpWGjG8i9VRt6fiAnzSuFfVAjAKwKIskndiGqzpsD0HmxPyoN6un5e5Ja2J91F7Fj2Ndv0xH4bmy5mdqYvIt2NqVRQHsPUj1xb6t2b1IEe22lReyj0wErPPk6ZC4bwtw8Tu2iOISgRj85krzOW7lfSj3vHwcWiLhIvMwq9RJCLZJLegLHt64tHjBst5tJAAYkgD6fp64EOICg2ny9RvMQAD3A2222OAzJ2MCFF1F/MHK7ar0narHv8hhe8L4OyZhtc8jSyK4VAQdOofF2pV22re/XB03FWWOxVqh0ki+21/XELgygATUDJ071EWbq79vp6Y1AszJ418PC5qPJQnWGZBMFuzZoudO5O5u77Xt3xqPlLLplsqsYclFUlA7FihAuw2+3eh6dhgI5K5IgXMLm9GrMMJAzv5r1Pe47bdh7DBfmc3oylKF+N2sizeon12reqqqwz1gy2DXIfDcvl3lhUlpZSZ5GYEtI8g1CiRQoADbsPri05NfM6szNMNGqT8Mai2mNVoEj3O7H2B3xEyueZpyxNlUVV2ArXQY7VuRtfp6Vgi41myVQ0AaA2vcDajv++JDHjJ5tmR5F1OI+xDUhY+gHf0o3iLxjl/T5zGXneMGixIG1gMCaA9Ca7bY5c08wvHGVQKoK7gD1vv374Wvi14nZrWAsmjyKNSAat1372P3BwKvAyVh1wnhsGWhjy8kiiZkMrhG2Ja7VR+UAmgfQDC7l+1HloGeODL3odg1kWw9Xvvpu+/fcnvheNCzmKR5JGcgAsStkMd1+HttsBVfrg4y/h/lurIekv8AgEdhXY+Y7bt8zeB5H60SM34j8SzSRvCgjUuxXTZLrprbsDtfbttgB5f5bnzeZMb5iRZIY2ZgPKI0JBG/qxvejqO/zwz+V+dpcvw8GMITDG4jLICR3HpQ9PbGbf8A6vzC5kZgSsJWFtVBWN+oA3r09qGKQ4m2x7VGnsv4MxZa5lJlalGichE8xH4jqPMSN6U74puZPtP5fKRyJGVkzFlOokRSNaqtHv6kb2TuTWAXw1gfMyfjzTSdVmeQNJsxC0AaA8o9AMH+c8LsnM+VgeFOkF1kAAF2Wx5m+Ij3AIsge2AopSyMkKLif2qEVojBDaxodZl+OZmNsWI9Pbb5dsR+e/tWCWER5TL/AHdnj0SP/D6np/MnucffHzwYyeVELQIya5G1DVYqroAjYD0r+eEjnU81ei9hsB/THbHjhujLJQ8T4gSzFm1E7ktuSfmcSIZTQCjUT7emIK5UFmvGpX8JMquRyTqrI8ixF2BFtqq+6kDv6DHRJqJJbEhy34q5zJzBlkLMq0qyWyIPQqt6QR6HGpfBfx9/6gDlM89PNYtPKdIIPxGwt2br2GBjhXgbkpM7nNas6pl1KKSulDp7r5bva9yd7wO8Z8IcvHkY5EMqymVvxA4D0LoAhQB+gv5455qMvGRlk0PzFyBmo/NlVTpL2kDflX5g7mu37+uLHw55wzjSRxmNikWprKELJ5TRFn4u1H3s4E+S+MSxwZTLCVzFsTqILN6nUa3ut6AsXjQnDeKlValUaUFbdrG/rjh6VYjfsRnOWXmnzUCMNweoVsUu/Zv5Y68/+Ms6wyZLK5dZ5ZQ8S6mrSxHxHt2PYXXbH3nVCJRIrMrWdwfr32+WFtylnXPE4nLGw/yrtft3+d4XjjTsM5WjPnEORM7k8ycrIVzGYmSgiMZmQnZrr81Dc+1HGrfDDwGjzOZgzWZikaeKNVIehE3TUBG0mzsLIHbt8sD/AC/wZf8A6oWf83TlbTto1GNgTVX6++NKZPjbqJGFWTV12G2y+3fHZyyeCEC549m4oYm32SIln2AQ6ewPpQ9BjJfLUf3jjusSqQuXLwOzWGdgoVXs+XcsaG/88Cv2iPELNSTyQdVkhRl8kflDahvr7lvoTXywn+X8y8Tu6SOGHZrFj6benphI8bas6KSRpfm3mLMCVFKMczr1yFVJBNGh8xtYvtZOHH4XxyyQCSa+pKe3pGi7VXtVXeE59mfnWeRpDK3VZUBDOAxumN/82+WHdJmikJ07GmN+tsRfy9fUYm1WCdmW+D89ZvhWdz0Iybyx5jMu8EhiJutiylQR699qwwuC8fh4pH93zPnlklXStaRCid2DH83oRYJ7YeuX4gSTdGgALA8o9a9r7n54xH4gZh8vnsyYXaOpyw0kCtQBI7diSdsUcOztF+Odpphl47eBvTVXysbGlplUiwg21V8xRxX/AGUvC+KZ5psxAWWIr0mL0BKpvzL63Q77d9uxxS86eJOblcAzOg0BT06Wxt3u8ad8HeWY8tk0WME6/wAR2c6mZ9N2aod/YDDpyURJ8j0XXF4lUkJt1GjYoooWzDUxruK7n5fXEbMRCZ30yFESWiQRXkFFu/Ynb0o74quFcYkbQxYlmaSzQutXbtsKFfTBJHllAkAAGs70BtqFmvTc79jvjnrJCyTJm0iV2IUmtlA3tj2uvW++wAPywP5mSJFijumYqwSKSnZv4WY2WF3ZJxL4flPwSpJYOy6tRs912BPYbem/z7Y+cV4UjSQtpCmNtS6QB8PYH1I+V4PU1hPNH1EidW0smsaB8L3YYMT201tv/XApwfJ6WJYaYdf4dfnDD29Tdi99q/QpeU6ZB6M57bVe5C12B9f1xXZmAGSNa8qG1UdgdI39/wCeFkjJn7L8QBa7WqGlSRtV0p9iSN2sYCud/tC5aKQq3mdCRJGo2O+4s+1DtscRfHGQjLFkYxNrHmjoHdtJG4IqvSu++KLwW5Cy82W6k0Ylk67Au9FiK2BIrYdx88CvJZVWQY4Zzfms0uakymWSNHmUPmBSNEW22JrYjdq/vhl8v+FEpjfqZlpOou4Hw6gN/N7WKod+94OMvwaJYXiVEVHALBVAs0TiXyzGEQoo8uqgD6C/TC1bA5Cg4f4a5KJhI51iwtNuoNbkr3s3X7YKOCZ7LsenFEmoMWC0Ay12bVV+l/L3wgPGLjMq551DsEGltO1WTv6Yfnhzw1FUy0C5jUEnfuNz9fninWqFbAP7SniAixdLqKJgwUx6jqIPftsfkfphe/Zy4NrlnnfLdWNDcUx+NHTugFgm8GuR5XT/AKhKzXKGDeSUI6LS2CoKWpF+h/vgo+z3wtY8lOg3DZmVt6sEsfhoCq9NtsXqokryVPiTxbNZvLlHys8bSkRRqrKQy3fUejtprYN3rHHwy8O0y0ymWxJCWTq2NE8TDcNV+Zfa72vfDe4vnW0oQaK6KI71fY+9+uKXhnDlLb+a3MlGiAzAXW2w37Yj4HLDP82PsIgGS6Vj2AOwr18u14l8HycoZuo69rRV+YssW3rt/wArHNYQBQAA32A23H9vTFZzlxx4stOUNHpUGoEi+5BPYnGUTWLbnL7RsMGhMreYm1NZa9GrsQ39hv8AzwNcucOXOZ2ObiOYKszq2XiVT09Y9DdgA/Pv7+mKzlTkmFcvqolgA9tROo9z2xScycdlSQFXIMRtO2x/b09MbzUTuhBONhN9o7lBpJkltFVHCxpFSsz3YcgUdSmiDVj+oxzJncvl1T79PmJszpEjQ6yQ17KCfyED9P3wa+EnAVmU5iYtLKSzXIQQCO1LQAqvTGe+PZL7xxC5WZupmFVtx8OoDSNthW2LccOzp+BJz6RC1c/muJV1mEWUjZmj8qK5oClYrRfb3Hpis/8AvNmskzx5KURIT5mRRqJG3xEX/vjRH2keBRR5dlijSELGtCNQvp3+uMweBXKcU3EMvFKDJG7NqRqINKT7e+OmCu29I43LX5PHL3COIcUn0wibMy6ld21EiO22diWAUWL29jQ2wa+LnDuMZGaszLItqNEkch0tSiwKOx9Dth38s8XPDMtxFMmqRAs/m0242YCmsHahWMmc0c6ZnM1155JdJOnWQav9MFfZ6wG62bZ5E8WcpmsrlnklYymkdGNsujuzfU73/rhqQ8sQ5hA0Z6pUhhoNlb967XjBWV5VRMjHKhdXc+Ygj6e2G19m/njMZPL5pYZG/EYMWamZSFrymhQ2uqIuz6455Qu2UcVX5Ht4heNOQyEbRTE9RkKGI2WK1VUASPr23wjfBHlbh+fdWyydDMQOznVuHRm7Ht+nqKxx5w4IueinzOZLSzqpCsdI0gD0AUYQPK/F5cvPE0MjxnWoOk0GBYbMANxgLjtOh+vVWa15ygy2XzUACkNK5WRSLSx6g+59sLHxL56jyGaiVI2lkLMzRr8MsZY+R1HxUD5fYjDa8csyfuvU2DoVZWrcNV3fvgQ+yTkFmmzeZmUTTWigygMFG5pRW2+Ofjh/kxXIqOaOT4s7HLNBkhCjxI7pIhR1ksDy38IO/wDXFVwvx0y/DEeCGELalWrch7OoOT3+oxrbj2ePUOy0y6SoHlIG/bGKOVeToZ+MZpZl6q6cxJpatOpQNJoAdsWgu19tDRkX+e+18hy6QR5dY2W9xVWf63/fCDm5uzAZ2VzHrJLqhKg/oMU+byw1H03x9eOwDjrhxRjoPZssoOep7CtK7REqWQsTsD29ca65SzfBp2jk0LFNIgViQQjiqF2AA23f3wAfZw8EslnMtJJmIy7JNQOojYAGiB3HuDjTnF+RsqYul0IwiKFUBQCB6Ue+3pifNS0Su3krOKeDGQzSJ1wh0KQjAAMo9ATW/wBThL8H4dFl8+kTqkggJCCviHofYkDvhm83RmMRhHZAwAIB7i69QcXmV5Ey4Gvpgvo+M7t29/8Agxx9pM1JFDx/kTLZqPNSiFXk6LhI2I0hqsFPYn+W2MPnwfz7K0gy0hRb1NsNNd7s3jZXJ87xzsFdtIbYGiBZrbYYKfGJtOSkK+QuPMU21d+/p6YvxcjjgNXg/nEMpub7/wBMS+G594SHVqYfz+WGHzZyhEuUScAiQyFCQRRHzFd/nhY5gb49CL7E5rqMvhnjIFBLRhmetQI2BHsPnhiw/aahghDQ5dBmDsTRAC/X9jjOy5UWPng98IOSIc1m1il1FCjtQNbrVb123xF8MNm7OgWlmzefzG2ueZ9vehe30Ue59MNfg/JGXyAYZtVlziOrxKh1LVdnrvR9MMXknJLlzFHCqx6rDOqjqsL7F6usL/xU4Oozq0W3K3uD3O/cYm+Ts+qwjKPkJuUMo2YzIzU7osakFlatCL6AL/tiL4q8W4hJMyqS0RP4YRTo0n+E9rwFc4cGrMFQ8iqUUlValP1FY0pHxFk4QumtQSg5A1evr8vTbEGnGn7OiNaIMPGYOGcOSCd+oZAJJE/MpatgPkRhdw/aR4hIXXJxO8arpU0SyqNgcKp0bMZpOs7yW6qdTXY/bG9eSeXoYIwsUaINIulFnb1PrhnFR2a60ZB5R8Ec1xF5Js28kI7gsO59RR7Yd/LXhhlMmB00GygPIRqZzf5R869MG3EeJsNYGwJI7Y7QxDQl77euEc29HO5WRMxmGosSStEqpoFSMceC8QJkDM2pANrrYkY8s5Jck35T/PEGGD8K97CgX9MJROy1nVdeokuXtR6aBe+398ds1D1AY22W6U7C9O/f54q+DSG3JNkdr9P+VjjDn2Ik37DUvyJ9RhQ2VfMPGFZChJQA+UnspXer+mI3C43nUDLptdGT0J9Tv3/+Md+V+ErPPGJfMAurSaoncW22+G/NCsaaY1VFA2CihhhWwP4H4ZpES8rB2JBpvhU+tDE7i/NyIKXavT0/TFVxnijENZuu2EZz9zDIOzVvgbdGP//Z";
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
