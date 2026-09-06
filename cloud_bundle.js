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
                    x, y, mo, products: [],
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
            b.style.cssText = 'position:absolute;background:rgba(20,20,30,0.85);color:#fff;padding:8px 12px;border-radius:8px;font-size:13px;font-weight:bold;font-family:sans-serif;white-space:nowrap;transform:translate(-50%,-100%);border:1px solid #3498db;box-shadow:0 4px 10px rgba(0,0,0,0.5);pointer-events:none;z-index:9000;display:flex;flex-direction:column;gap:4px;';
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
                
                const isHovered = Math.hypot(sx - this._mouseX, sy - this._mouseY) < 60;
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
            return Object.values(dict).find(mo => {
                if (!mo) return false;
                const cd = mo.configData || {};
                const sd = mo.serverData || {};
                return (cd.id || mo.id) === item.id && (parseInt(sd.x || sd.map_x) || 0) === item.x && (parseInt(sd.y || sd.map_y) || 0) === item.y;
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
