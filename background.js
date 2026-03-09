let activeTabId = null;
let currentHostname = null;
let activeTabStartTime = Date.now();

// Lists for filtering and blocking
let blacklist = [];
let whitelist = [];

// Load initial lists from storage
chrome.storage.local.get(['blacklist', 'whitelist'], (res) => {
    blacklist = res.blacklist || [];
    whitelist = res.whitelist || [];
});

// Watch for changes in the popup settings
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (changes.blacklist) blacklist = changes.blacklist.newValue || [];
    if (changes.whitelist) whitelist = changes.whitelist.newValue || [];
});

function getHostnameFromUrl(url) {
    if (!url || !url.startsWith('http')) return null;
    try { return new URL(url).hostname; } catch (e) { return null; }
}

function getTodayString() {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

// Helper to block the page if it's on the blacklist
function checkAndBlock(tabId, hostname) {
    if (hostname && blacklist.some(domain => hostname.includes(domain))) {
        const blockUrl = chrome.runtime.getURL(`blocked.html?domain=${encodeURIComponent(hostname)}`);
        chrome.tabs.update(tabId, { url: blockUrl });
        return true;
    }
    return false;
}

function updateTimeAndSave() {
    if (currentHostname && !currentHostname.includes('chrome-extension://')) {
        const timeSpent = Math.floor((Date.now() - activeTabStartTime) / 1000); // seconds
        if (timeSpent > 0) {
            const dateStr = getTodayString();
            chrome.storage.local.get([dateStr], function(result) {
                let todayData = result[dateStr] || {};
                todayData[currentHostname] = (todayData[currentHostname] || 0) + timeSpent;
                
                let saveObj = {};
                saveObj[dateStr] = todayData;
                chrome.storage.local.set(saveObj);
            });
        }
    }
}

chrome.tabs.onActivated.addListener((activeInfo) => {
    updateTimeAndSave(); // Close out time for old tab
    
    activeTabId = activeInfo.tabId;
    activeTabStartTime = Date.now();
    
    chrome.tabs.get(activeTabId, (tab) => {
        currentHostname = getHostnameFromUrl(tab.url);
        // Instant block check on tab switch
        checkAndBlock(activeTabId, currentHostname);
    });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url) {
        const newHost = getHostnameFromUrl(changeInfo.url);
        // Instant block check on URL navigation
        if (checkAndBlock(tabId, newHost)) {
            currentHostname = null; // Don't track time on blocked sites
            return;
        }
    }

    if (tabId === activeTabId && changeInfo.url) {
        updateTimeAndSave(); // Close out time for old URL
        currentHostname = getHostnameFromUrl(changeInfo.url);
        activeTabStartTime = Date.now(); 
    }
});

chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
        updateTimeAndSave();
        currentHostname = null; 
    } else {
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            if (tabs.length > 0) {
                activeTabId = tabs[0].id;
                currentHostname = getHostnameFromUrl(tabs[0].url);
                activeTabStartTime = Date.now();
                checkAndBlock(activeTabId, currentHostname);
            }
        });
    }
});

// Force sync when requested by popup scoreboard
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "syncNow") {
        updateTimeAndSave(); 
        activeTabStartTime = Date.now();
        sendResponse({ success: true, currentHostname: currentHostname });
    }
});
