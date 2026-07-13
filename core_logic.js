console.log("[Cloud Sandbox] تم حقن الكود السحابي بنجاح!");

// محاكاة واجهة اللعبة (بدون التأثير على اللعبة الحقيقية)
const runSandboxTest = () => {
    // إنشاء مربع تجريبي بسيط في زاوية الشاشة لتأكيد العمل
    const testDiv = document.createElement("div");
    testDiv.id = "sandbox-test-bot";
    testDiv.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: #28a745;
        color: white;
        padding: 15px;
        border-radius: 8px;
        z-index: 999999;
        font-family: Arial, sans-serif;
        box-shadow: 0 4px 6px rgba(0,0,0,0.3);
    `;
    testDiv.innerHTML = "✅ النظام السحابي يعمل بكفاءة! (الإصدار التجريبي 1.0)";
    document.body.appendChild(testDiv);
    
    setTimeout(() => {
        if(testDiv) testDiv.remove();
    }, 10000);
};

// تشغيل المحاكاة
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    runSandboxTest();
} else {
    window.addEventListener('DOMContentLoaded', runSandboxTest);
}
