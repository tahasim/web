function formatTime(seconds) {
    const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
}

const colors = ['#f43f5e', '#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#06b6d4', '#d946ef', '#ec4899', '#14b8a6', '#f97316'];
let myChart = null;
let histChart = null;
let currentData = {};
let currentHistData = {};

document.addEventListener('DOMContentLoaded', () => {
    // Nav 
    document.getElementById('tab-dashboard').addEventListener('click', () => switchTab('dashboard'));
    document.getElementById('tab-history').addEventListener('click', () => switchTab('history'));
    document.getElementById('tab-settings').addEventListener('click', () => switchTab('settings'));
    
    // History Events
    const datePicker = document.getElementById('date-picker');
    datePicker.value = getTodayString();
    datePicker.max = getTodayString(); // Can't view future dates natively
    datePicker.addEventListener('change', loadHistoryData);

    // Filter Add logic
    document.getElementById('btn-wl').addEventListener('click', () => addToList('whitelist', 'wl-input'));
    document.getElementById('btn-bl').addEventListener('click', () => addToList('blacklist', 'bl-input'));
    document.getElementById('wl-input').addEventListener('keypress', (e) => { if(e.key === 'Enter') addToList('whitelist', 'wl-input'); });
    document.getElementById('bl-input').addEventListener('keypress', (e) => { if(e.key === 'Enter') addToList('blacklist', 'bl-input'); });
    
    // Exports
    document.getElementById('btn-export').addEventListener('click', () => exportReport(currentData, getTodayString(), document.getElementById('score-text').textContent));
    document.getElementById('btn-export-hist').addEventListener('click', () => exportReport(currentHistData, datePicker.value, document.getElementById('hist-score-text').textContent));

    chrome.runtime.sendMessage({ action: "syncNow" }, () => {
        loadData();
        setInterval(() => chrome.runtime.sendMessage({ action: "syncNow" }, () => {
            loadData();
            if(document.getElementById('view-history').style.display === 'block' && datePicker.value === getTodayString()){
                loadHistoryData();
            }
        }), 1000);
    });
    
    loadLists();
});

function switchTab(tab) {
    document.getElementById('tab-dashboard').className = 'nav-btn' + (tab==='dashboard'?' active':'');
    document.getElementById('tab-history').className = 'nav-btn' + (tab==='history'?' active':'');
    document.getElementById('tab-settings').className = 'nav-btn' + (tab==='settings'?' active':'');
    
    document.getElementById('view-dashboard').style.display = tab==='dashboard'?'block':'none';
    document.getElementById('view-history').style.display = tab==='history'?'block':'none';
    document.getElementById('view-settings').style.display = tab==='settings'?'block':'none';

    if (tab === 'history') {
        loadHistoryData();
    }
}

function processAndRender(dataObj, elements, wl) {
    if (!dataObj || Object.keys(dataObj).length === 0) {
        document.getElementById(elements.contentContainer).style.display = 'none';
        document.getElementById(elements.noDataIndicator).style.display = 'block';
        return;
    }
    
    document.getElementById(elements.contentContainer).style.display = 'block';
    if(elements.noDataIndicator) document.getElementById(elements.noDataIndicator).style.display = 'none';
    
    let sortedSites = Object.entries(dataObj).sort(([,a], [,b]) => b - a);
    let totalTime = sortedSites.map(i => i[1]).reduce((a, b) => a + b, 0);
    
    let productiveTime = 0;
    sortedSites.forEach(([domain, time]) => {
        if (wl.some(w => domain.includes(w))) productiveTime += time;
    });
    
    // Dynamic Scoring Logic
    let scoreText = "--";
    if (totalTime > 0) {
        let percentage = (productiveTime / totalTime) * 100;
        if (percentage >= 80) scoreText = "A+";
        else if (percentage >= 60) scoreText = "B";
        else if (percentage >= 40) scoreText = "C";
        else if (percentage >= 20) scoreText = "D";
        else scoreText = "F";
    }
    document.getElementById(elements.scoreText).textContent = scoreText;

    // Render List & Prepare Chart Data
    let labels = [];
    let dataBlocks = [];
    let listHtml = '';
    
    let chartIndex = 0;
    sortedSites.slice(0, 10).forEach(([domain, time]) => {
        labels.push(domain);
        dataBlocks.push(time);
        let color = colors[chartIndex % colors.length];
        let isProd = wl.some(w => domain.includes(w)) ? '⭐ ' : '';
        listHtml += `
            <li class="site-item">
                <div class="domain-name"><div class="dot" style="background:${color}"></div>${isProd}${domain}</div>
                <div class="domain-time">${formatTime(time)}</div>
            </li>
        `;
        chartIndex++;
    });
    document.getElementById(elements.siteList).innerHTML = listHtml;
    
    Chart.defaults.color = '#64748b';
    Chart.defaults.font.family = "'Nunito', sans-serif";
    Chart.defaults.font.weight = 'bold';
    
    let targetChart = elements.isHistory ? histChart : myChart;
    
    if (targetChart) {
        targetChart.data.labels = labels;
        targetChart.data.datasets[0].data = dataBlocks;
        targetChart.update('none');
    } else {
        const ctx = document.getElementById(elements.chartId).getContext('2d');
        const newChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{ data: dataBlocks, backgroundColor: colors, borderWidth: 0, hoverOffset: 4 }]
            },
            options: { cutout: '70%', plugins: { legend: { display: false } }, animation: { duration: 0 } }
        });
        if(elements.isHistory) histChart = newChart;
        else myChart = newChart;
    }
    
    return scoreText;
}

function loadData() {
    chrome.storage.local.get(['whitelist', getTodayString()], (res) => {
        const wl = res.whitelist || [];
        const todayData = res[getTodayString()] || {};
        currentData = todayData;
        
        const score = processAndRender(todayData, {
            contentContainer: 'view-dashboard', // Not hiding whole view
            noDataIndicator: null, // Using specific logic for dashboard if empty? No, we just let it render empty donut
            scoreText: 'score-text',
            siteList: 'site-list',
            chartId: 'productivityChart',
            isHistory: false
        }, wl);
        
        if ((score === "A+" || score === "B") && !window.confettiShown && Object.keys(todayData).length > 0) {
            window.confettiShown = true;
            shootConfetti();
        }
    });
}

function loadHistoryData() {
    const dateStr = document.getElementById('date-picker').value;
    chrome.storage.local.get(['whitelist', dateStr], (res) => {
        currentHistData = res[dateStr] || {};
        processAndRender(currentHistData, {
            contentContainer: 'history-content',
            noDataIndicator: 'hist-no-data',
            scoreText: 'hist-score-text',
            siteList: 'hist-site-list',
            chartId: 'historyChart',
            isHistory: true
        }, res.whitelist || []);
    });
}

function loadLists() {
    chrome.storage.local.get(['whitelist', 'blacklist'], (res) => {
        const wl = res.whitelist || [];
        const bl = res.blacklist || [];
        document.getElementById('wl-list').innerHTML = wl.map(w => `<div class="list-item">${w} <span class="remove-btn" onclick="removeList('whitelist', '${w}')">X</span></div>`).join('');
        document.getElementById('bl-list').innerHTML = bl.map(b => `<div class="list-item">${b} <span class="remove-btn" onclick="removeList('blacklist', '${b}')">X</span></div>`).join('');
    });
}

window.removeList = function(listType, domain) {
    chrome.storage.local.get([listType], (res) => {
        let list = res[listType] || [];
        list = list.filter(d => d !== domain);
        let obj = {}; obj[listType] = list;
        chrome.storage.local.set(obj, loadLists);
    });
};

function addToList(listType, inputId) {
    const el = document.getElementById(inputId);
    let val = el.value.trim().toLowerCase();
    try { if (val.startsWith('http')) val = new URL(val).hostname; } catch(e){}
    if (!val) return;
    chrome.storage.local.get([listType], (res) => {
        let list = res[listType] || [];
        if (!list.includes(val)) {
            list.push(val);
            let obj = {}; obj[listType] = list;
            chrome.storage.local.set(obj, loadLists);
        }
        el.value = '';
    });
}

function exportReport(dataDict, dateStr, score) {
    if(!dataDict || Object.keys(dataDict).length === 0) { alert('No data to export!'); return; }
    let report = `ChronoFocus Productivity Report - ${dateStr}\n===========\n\n`;
    let sortedSites = Object.entries(dataDict).sort(([,a], [,b]) => b - a);
    let totalTime = 0;
    
    sortedSites.forEach(([domain, time]) => {
        report += `${domain}: ${formatTime(time)}\n`;
        totalTime += time;
    });
    
    report += `\n===========\nTotal Time Tracked: ${formatTime(totalTime)}\nProductivity Score: ${score}\n`;
    
    const blob = new Blob([report], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ChronoFocus_Report_${dateStr}.txt`;
    a.click();
    URL.revokeObjectURL(url);
}

function getTodayString() {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

// 🎊 Confetti Surprise! 🎊
function shootConfetti() {
    const canvas = document.getElementById('confetti');
    canvas.style.display = 'block';
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    let particles = [];
    for(let i=0; i<150; i++) {
        particles.push({
            x: canvas.width / 2, y: canvas.height * 0.25,
            vx: (Math.random() - 0.5) * 15, vy: (Math.random() - 0.8) * 15,
            color: colors[Math.floor(Math.random() * colors.length)],
            size: Math.random() * 8 + 4
        });
    }
    
    function render() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let active = false;
        particles.forEach(p => {
            p.x += p.vx; p.y += p.vy; p.vy += 0.4;
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x, p.y, p.size, p.size);
            if(p.y < canvas.height) active = true;
        });
        if(active) requestAnimationFrame(render);
        else canvas.style.display = 'none';
    }
    render();
}
