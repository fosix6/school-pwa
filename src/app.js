// ===== CONFIGURATION =====
// ⚠️ THIS GETS REPLACED DURING BUILD BY GITHUB ACTIONS
// DO NOT EDIT THIS LINE - Edit the GitHub Secret instead
const API_URL = '{{APPS_SCRIPT_URL}}';

const CONFIG = {
    API_URL: API_URL,
    CACHE_DURATION: 3600000, // 1 hour
    DB_VERSION: 1,
};

console.log('✅ API_URL configured successfully:', API_URL);

// ===== STATE =====
let state = {
    currentClass: '',
    currentDate: new Date().toISOString().split('T')[0],
    students: [],
    attendance: {},
    piket: [],
    pendingActions: [],
    isOnline: navigator.onLine,
};

// ===== DOM REFS =====
const $ = (id) => document.getElementById(id);
const els = {
    classSelector: $('class-selector'),
    dateSelector: $('date-selector'),
    studentList: $('student-list'),
    piketList: $('piket-list'),
    piketSection: $('piket-section'),
    statsSummary: $('stats-summary'),
    statHadir: $('stat-hadir'),
    statAbsen: $('stat-absen'),
    statSakit: $('stat-sakit'),
    statIzin: $('stat-izin'),
    whatsappBtn: $('whatsapp-btn'),
    connectionStatus: $('connection-status'),
    offlineBanner: $('offline-banner'),
    pendingCounter: $('pending-counter'),
    historyContainer: $('history-container'),
    historyDate: $('history-date'),
    historyLoadBtn: $('history-load-btn'),
    refreshBtn: $('refresh-btn'),
    csvUpload: $('csv-upload'),
    uploadCsvBtn: $('upload-csv-btn'),
    uploadStatus: $('upload-status'),
    totalStudents: $('total-students'),
    totalAttendance: $('total-attendance'),
    clearCacheBtn: $('clear-cache-btn'),
};

// ========================================
// PIKET SCHEDULE BUILDER (Admin Panel)
// ========================================

const piketEls = {
    classSelector: document.getElementById('piket-class-selector'),
    daySelector: document.getElementById('piket-day-selector'),
    dayLabel: document.getElementById('piket-day-label'),
    studentSearch: document.getElementById('piket-student-search'),
    studentList: document.getElementById('piket-student-list'),
    selectedList: document.getElementById('piket-selected-students'),
    generateBtn: document.getElementById('piket-generate-btn'),
    saveBtn: document.getElementById('piket-save-btn'),
    clearBtn: document.getElementById('piket-clear-btn'),
    jsonOutput: document.getElementById('piket-json-output'),
    jsonPreview: document.getElementById('piket-json-preview'),
    status: document.getElementById('piket-status'),
};

let piketState = {
    kelas: '',
    day: 'Monday',
    allStudents: [],
    selectedStudents: [],
    filteredStudents: [],
    currentSchedule: null,
};

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', async () => {
    // Set today's date
    els.dateSelector.value = state.currentDate;
    els.historyDate.value = state.currentDate;
    
    // Load classes
    await loadClasses();
    
    // Load cached data
    loadFromCache();
    
    // Setup event listeners
    setupEventListeners();
    
    // Setup piket builder
    setupPiketBuilder();
    
    // Register service worker
    registerSW();
    
    // Check pending actions
    processPendingActions();
    
    // Update online status
    updateOnlineStatus();
});

// ===== API CALLS =====
async function apiCall(action, params = {}) {
    const url = new URL(CONFIG.API_URL);
    url.searchParams.append('action', action);
    Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));
    
    try {
        const response = await fetch(url.toString());
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        if (!navigator.onLine) {
            queueAction(action, params);
        }
        throw error;
    }
}

// ===== LOAD CLASSES =====
async function loadClasses() {
    try {
        const data = await apiCall('getClasses');
        els.classSelector.innerHTML = '<option value="">Pilih Kelas...</option>';
        if (data.classes && data.classes.length > 0) {
            data.classes.forEach(cls => {
                const opt = document.createElement('option');
                opt.value = cls;
                opt.textContent = cls;
                els.classSelector.appendChild(opt);
            });
        } else {
            els.classSelector.innerHTML = '<option value="">Tidak ada kelas</option>';
        }
        localStorage.setItem('classes_cache', JSON.stringify(data.classes || []));
    } catch (error) {
        const cached = localStorage.getItem('classes_cache');
        if (cached) {
            const classes = JSON.parse(cached);
            els.classSelector.innerHTML = '<option value="">Pilih Kelas...</option>';
            classes.forEach(cls => {
                const opt = document.createElement('option');
                opt.value = cls;
                opt.textContent = cls;
                els.classSelector.appendChild(opt);
            });
        } else {
            els.classSelector.innerHTML = '<option value="">Gagal memuat kelas</option>';
        }
    }
}

// ===== LOAD STUDENTS =====
async function loadStudents(kelas, date) {
    if (!kelas) {
        els.studentList.innerHTML = '<p class="empty-state">Pilih kelas untuk mulai</p>';
        els.piketSection.style.display = 'none';
        els.whatsappBtn.style.display = 'none';
        els.statsSummary.style.display = 'none';
        return;
    }
    
    try {
        const studentData = await apiCall('getStudents', { kelas });
        state.students = studentData.students || [];
        
        const attData = await apiCall('getAttendance', { date, kelas });
        state.attendance = attData.attendance || {};
        
        const piketData = await apiCall('getPiket', { date, kelas });
        state.piket = piketData.piket || [];
        
        renderStudents();
        renderPiket();
        updateStats();
        cacheData(kelas, date);
        
        els.piketSection.style.display = 'block';
        els.whatsappBtn.style.display = 'block';
        els.statsSummary.style.display = 'grid';
        
    } catch (error) {
        const cached = getCachedData(kelas, date);
        if (cached) {
            state.students = cached.students || [];
            state.attendance = cached.attendance || {};
            state.piket = cached.piket || [];
            renderStudents();
            renderPiket();
            updateStats();
            els.piketSection.style.display = 'block';
            els.whatsappBtn.style.display = 'block';
            els.statsSummary.style.display = 'grid';
        } else {
            els.studentList.innerHTML = '<p class="empty-state">❌ Gagal memuat data. Periksa koneksi.</p>';
        }
    }
}

// ===== RENDER STUDENTS =====
function renderStudents() {
    if (!state.students || !state.students.length) {
        els.studentList.innerHTML = '<p class="empty-state">Tidak ada siswa di kelas ini</p>';
        return;
    }
    
    let html = '';
    state.students.forEach(student => {
        const nis = student[0];
        const name = student[1];
        const status = state.attendance[nis] || 'hadir';
        const statusClass = `active-${status}`;
        
        html += `
            <div class="student-card" data-nis="${nis}">
                <div class="student-info">
                    <span class="student-name">${name}</span>
                    <span class="student-nis">NIS: ${nis}</span>
                </div>
                <div class="status-btns">
                    ${['hadir', 'absen', 'sakit', 'izin'].map(s => `
                        <button class="status-btn ${status === s ? statusClass : ''}" 
                                data-status="${s}" 
                                onclick="markAttendance('${nis}', '${s}')">
                            ${s === 'hadir' ? '✅' : s === 'absen' ? '❌' : s === 'sakit' ? '🏠' : '📝'}
                        </button>
                    `).join('')}
                </div>
            </div>
        `;
    });
    els.studentList.innerHTML = html;
}

// ===== MARK ATTENDANCE =====
async function markAttendance(nis, status) {
    const date = els.dateSelector.value;
    const kelas = els.classSelector.value;
    
    state.attendance[nis] = status;
    renderStudents();
    updateStats();
    
    try {
        await apiCall('markAttendance', { nis, date, status, kelas });
        cacheData(kelas, date);
    } catch (error) {
        queueAction('markAttendance', { nis, date, status, kelas });
    }
}

// ===== RENDER PIKET =====
function renderPiket() {
    if (!state.piket || !state.piket.length) {
        els.piketList.innerHTML = '<p class="empty-state">Tidak ada piket untuk hari ini</p>';
        return;
    }
    
    let html = '';
    state.piket.forEach(piket => {
        const done = piket.done || false;
        html += `
            <div class="piket-item">
                <span>${piket.name} - ${piket.task}</span>
                <button class="piket-toggle" onclick="togglePiket('${piket.id}', ${!done})">
                    ${done ? '✅ Selesai' : '⬜ Belum'}
                </button>
            </div>
        `;
    });
    els.piketList.innerHTML = html;
}

// ===== TOGGLE PIKET =====
async function togglePiket(id, done) {
    const date = els.dateSelector.value;
    
    const piket = state.piket.find(p => p.id === id);
    if (piket) piket.done = done;
    renderPiket();
    
    try {
        await apiCall('togglePiket', { id, done, date });
    } catch (error) {
        queueAction('togglePiket', { id, done, date });
    }
}

// ===== UPDATE STATS =====
function updateStats() {
    const stats = { hadir: 0, absen: 0, sakit: 0, izin: 0 };
    if (state.students) {
        state.students.forEach(student => {
            const nis = student[0];
            const status = state.attendance[nis] || 'hadir';
            stats[status] = (stats[status] || 0) + 1;
        });
    }
    
    els.statHadir.textContent = stats.hadir;
    els.statAbsen.textContent = stats.absen;
    els.statSakit.textContent = stats.sakit;
    els.statIzin.textContent = stats.izin;
}

// ===== WHATSAPP REPORT =====
document.getElementById('whatsapp-btn')?.addEventListener('click', () => {
    const kelas = els.classSelector.value;
    const date = els.dateSelector.value;
    const formattedDate = new Date(date + 'T00:00:00').toLocaleDateString('id-ID', {
        day: 'numeric', month: 'long', year: 'numeric'
    });
    
    let report = `📊 *REKAP ABSENSI ${kelas}*\n`;
    report += `📅 ${formattedDate}\n`;
    report += `━━━━━━━━━━━━━━━━\n`;
    report += `✅ Hadir: ${els.statHadir.textContent}\n`;
    report += `❌ Absen: ${els.statAbsen.textContent}\n`;
    report += `🏠 Sakit: ${els.statSakit.textContent}\n`;
    report += `📝 Izin: ${els.statIzin.textContent}\n`;
    report += `━━━━━━━━━━━━━━━━\n`;
    
    if (state.students) {
        const absentStudents = state.students
            .filter(s => state.attendance[s[0]] === 'absen')
            .map(s => s[1]);
        if (absentStudents.length) {
            report += `❌ Absen: ${absentStudents.join(', ')}\n`;
        }
    }
    
    const piketDone = state.piket ? state.piket.filter(p => p.done).length : 0;
    const piketTotal = state.piket ? state.piket.length : 0;
    report += `🧹 Piket: ${piketDone}/${piketTotal} selesai\n`;
    
    navigator.clipboard.writeText(report).then(() => {
        alert('✅ Laporan disalin! Tempelkan ke WhatsApp.');
    }).catch(() => {
        prompt('Salin teks ini:', report);
    });
});

// ===== QUEUE SYSTEM =====
function queueAction(action, params) {
    const pending = JSON.parse(localStorage.getItem('pending_actions') || '[]');
    pending.push({ action, params, timestamp: Date.now() });
    localStorage.setItem('pending_actions', JSON.stringify(pending));
    updatePendingCounter();
}

async function processPendingActions() {
    const pending = JSON.parse(localStorage.getItem('pending_actions') || '[]');
    if (!pending.length || !navigator.onLine) return;
    
    const failed = [];
    for (const item of pending) {
        try {
            await apiCall(item.action, item.params);
        } catch (error) {
            failed.push(item);
        }
    }
    
    if (failed.length) {
        localStorage.setItem('pending_actions', JSON.stringify(failed));
    } else {
        localStorage.removeItem('pending_actions');
    }
    updatePendingCounter();
}

function updatePendingCounter() {
    const pending = JSON.parse(localStorage.getItem('pending_actions') || '[]');
    if (pending.length) {
        els.pendingCounter.style.display = 'block';
        els.pendingCounter.textContent = `📤 ${pending.length} pending`;
    } else {
        els.pendingCounter.style.display = 'none';
    }
}

// ===== CACHE SYSTEM =====
function cacheData(kelas, date) {
    const cache = {
        students: state.students,
        attendance: state.attendance,
        piket: state.piket,
        timestamp: Date.now(),
    };
    const key = `cache_${kelas}_${date}`;
    localStorage.setItem(key, JSON.stringify(cache));
}

function getCachedData(kelas, date) {
    const key = `cache_${kelas}_${date}`;
    const data = localStorage.getItem(key);
    if (!data) return null;
    
    const parsed = JSON.parse(data);
    if (Date.now() - parsed.timestamp > CONFIG.CACHE_DURATION) {
        return null;
    }
    return parsed;
}

function loadFromCache() {
    const classesCache = localStorage.getItem('classes_cache');
    if (classesCache) {
        const classes = JSON.parse(classesCache);
        if (els.classSelector.options.length <= 1) {
            els.classSelector.innerHTML = '<option value="">Pilih Kelas...</option>';
            classes.forEach(cls => {
                const opt = document.createElement('option');
                opt.value = cls;
                opt.textContent = cls;
                els.classSelector.appendChild(opt);
            });
        }
    }
}

// ===== ONLINE/OFFLINE HANDLING =====
function updateOnlineStatus() {
    state.isOnline = navigator.onLine;
    els.connectionStatus.textContent = state.isOnline ? '● Online' : '● Offline';
    els.connectionStatus.className = state.isOnline ? 'status-online' : 'status-offline';
    els.offlineBanner.style.display = state.isOnline ? 'none' : 'block';
    
    if (state.isOnline) {
        processPendingActions();
    }
}

window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

// ===== EVENT LISTENERS =====
function setupEventListeners() {
    els.classSelector.addEventListener('change', async () => {
        state.currentClass = els.classSelector.value;
        await loadStudents(state.currentClass, els.dateSelector.value);
    });
    
    els.dateSelector.addEventListener('change', async () => {
        state.currentDate = els.dateSelector.value;
        await loadStudents(els.classSelector.value, state.currentDate);
    });
    
    els.refreshBtn.addEventListener('click', async () => {
        await loadStudents(els.classSelector.value, els.dateSelector.value);
        await loadClasses();
    });
    
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            const tabId = btn.dataset.tab;
            document.getElementById(`tab-${tabId}`).classList.add('active');
        });
    });
    
    els.historyLoadBtn.addEventListener('click', loadHistory);
    els.uploadCsvBtn.addEventListener('click', uploadCSV);
    
    els.clearCacheBtn.addEventListener('click', () => {
        if (confirm('Hapus semua data cache lokal?')) {
            localStorage.clear();
            alert('Cache dibersihkan!');
            location.reload();
        }
    });
}

// ===== HISTORY =====
async function loadHistory() {
    const date = els.historyDate.value;
    if (!date) {
        alert('Pilih tanggal terlebih dahulu');
        return;
    }
    
    try {
        const data = await apiCall('getHistory', { date });
        let html = `<h3>📅 Rekap ${date}</h3>`;
        
        if (data.attendance && data.attendance.length) {
            html += `<div class="student-grid">`;
            data.attendance.forEach(record => {
                html += `
                    <div class="student-card">
                        <span class="student-name">${record.name}</span>
                        <span>${record.status}</span>
                    </div>
                `;
            });
            html += `</div>`;
        } else {
            html += `<p class="empty-state">Tidak ada data untuk tanggal ini</p>`;
        }
        
        if (data.piket && data.piket.length) {
            html += `<h4>🧹 Piket</h4>`;
            data.piket.forEach(p => {
                html += `<div class="piket-item">
                    <span>${p.name} - ${p.task}</span>
                    <span>${p.done ? '✅ Selesai' : '⬜ Belum'}</span>
                </div>`;
            });
        }
        
        els.historyContainer.innerHTML = html;
    } catch (error) {
        els.historyContainer.innerHTML = '<p class="empty-state">❌ Gagal memuat history</p>';
    }
}

// ===== CSV UPLOAD =====
async function uploadCSV() {
    const file = els.csvUpload.files[0];
    if (!file) {
        els.uploadStatus.textContent = '⚠️ Pilih file CSV terlebih dahulu';
        els.uploadStatus.className = 'status-msg error';
        return;
    }
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        const csv = e.target.result;
        try {
            els.uploadStatus.textContent = '📤 Mengupload...';
            els.uploadStatus.className = 'status-msg';
            
            const result = await apiCall('uploadCSV', { csv: encodeURIComponent(csv) });
            
            if (result.success) {
                els.uploadStatus.textContent = `✅ ${result.message}`;
                els.uploadStatus.className = 'status-msg success';
                await loadClasses();
                await loadStudents(state.currentClass, els.dateSelector.value);
            } else {
                els.uploadStatus.textContent = `❌ ${result.message}`;
                els.uploadStatus.className = 'status-msg error';
            }
        } catch (error) {
            els.uploadStatus.textContent = '❌ Gagal upload. Periksa koneksi.';
            els.uploadStatus.className = 'status-msg error';
        }
    };
    reader.readAsText(file);
}

// ===== SERVICE WORKER =====
function registerSW() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(() => console.log('SW Registered'))
            .catch(() => console.log('SW Register failed'));
    }
}

// ===== PERIODIC SYNC =====
setInterval(() => {
    if (navigator.onLine) {
        processPendingActions();
        if (els.classSelector.value) {
            loadStudents(els.classSelector.value, els.dateSelector.value);
        }
    }
}, 300000);

// ========================================
// PIKET SCHEDULE BUILDER (Admin Panel)
// ========================================

// ===== LOAD CLASSES FOR PIKET BUILDER =====
async function loadPiketClasses() {
    try {
        const data = await apiCall('getClasses');
        piketEls.classSelector.innerHTML = '<option value="">-- Pilih Kelas --</option>';
        if (data.classes && data.classes.length > 0) {
            data.classes.forEach(cls => {
                const opt = document.createElement('option');
                opt.value = cls;
                opt.textContent = cls;
                piketEls.classSelector.appendChild(opt);
            });
        }
    } catch (error) {
        console.error('Failed to load classes:', error);
        piketEls.classSelector.innerHTML = '<option value="">Gagal memuat kelas</option>';
    }
}

// ===== LOAD STUDENTS FOR PIKET BUILDER =====
async function loadPiketStudents(kelas) {
    if (!kelas) {
        piketEls.studentList.innerHTML = '<p class="empty-state">Pilih kelas terlebih dahulu</p>';
        piketEls.selectedList.innerHTML = '<p class="empty-state">Belum ada siswa terpilih</p>';
        piketState.allStudents = [];
        piketState.selectedStudents = [];
        return;
    }
    
    try {
        const data = await apiCall('getStudents', { kelas });
        piketState.allStudents = data.students || [];
        piketState.selectedStudents = [];
        piketState.filteredStudents = piketState.allStudents;
        
        renderPiketStudentList();
        renderPiketSelectedStudents();
        
        await loadExistingSchedule(kelas);
        
    } catch (error) {
        console.error('Failed to load students:', error);
        piketEls.studentList.innerHTML = '<p class="empty-state">❌ Gagal memuat siswa</p>';
    }
}

// ===== LOAD EXISTING SCHEDULE =====
async function loadExistingSchedule(kelas) {
    try {
        const scheduleKey = `piket_schedule_${kelas.replace(' ', '_')}`;
        const data = await apiCall('getConfig', { key: scheduleKey });
        if (data && data.value) {
            const schedule = JSON.parse(data.value);
            const day = piketState.day;
            if (schedule[day]) {
                const nisList = schedule[day].split(',').map(n => n.trim());
                const selected = piketState.allStudents.filter(s => nisList.includes(s[0].toString()));
                piketState.selectedStudents = selected;
                renderPiketSelectedStudents();
                renderPiketStudentList();
                piketEls.status.textContent = `✅ Loaded existing schedule for ${getDayIndonesian(day)}`;
                piketEls.status.className = 'status-msg success';
            }
        }
    } catch (error) {
        console.log('No existing schedule found');
    }
}

// ===== RENDER STUDENT LIST =====
function renderPiketStudentList() {
    const searchTerm = piketEls.studentSearch.value.toLowerCase().trim();
    let filtered = piketState.allStudents;
    
    if (searchTerm) {
        filtered = filtered.filter(s => 
            s[1].toLowerCase().includes(searchTerm) || 
            s[0].toString().includes(searchTerm)
        );
    }
    
    piketState.filteredStudents = filtered;
    
    if (!filtered.length) {
        piketEls.studentList.innerHTML = '<p class="empty-state">Tidak ada siswa yang cocok</p>';
        return;
    }
    
    const selectedNIS = new Set(piketState.selectedStudents.map(s => s[0].toString()));
    
    let html = '';
    filtered.forEach(student => {
        const nis = student[0];
        const name = student[1];
        const isSelected = selectedNIS.has(nis.toString());
        html += `
            <div class="student-search-item ${isSelected ? 'selected' : ''}" 
                 onclick="togglePiketStudent('${nis}')">
                <span class="student-name">${name}</span>
                <span class="student-nis">NIS: ${nis}</span>
            </div>
        `;
    });
    piketEls.studentList.innerHTML = html;
}

// ===== RENDER SELECTED STUDENTS =====
function renderPiketSelectedStudents() {
    if (!piketState.selectedStudents.length) {
        piketEls.selectedList.innerHTML = '<p class="empty-state">Belum ada siswa terpilih</p>';
        return;
    }
    
    let html = '';
    piketState.selectedStudents.forEach(student => {
        const nis = student[0];
        const name = student[1];
        html += `
            <span class="selected-student-tag" onclick="togglePiketStudent('${nis}')">
                ${name} (${nis})
            </span>
        `;
    });
    piketEls.selectedList.innerHTML = html;
    piketEls.dayLabel.textContent = getDayIndonesian(piketState.day);
}

// ===== TOGGLE STUDENT SELECTION =====
function togglePiketStudent(nis) {
    const student = piketState.allStudents.find(s => s[0].toString() === nis.toString());
    if (!student) return;
    
    const index = piketState.selectedStudents.findIndex(s => s[0].toString() === nis.toString());
    if (index >= 0) {
        piketState.selectedStudents.splice(index, 1);
    } else {
        piketState.selectedStudents.push(student);
    }
    
    renderPiketStudentList();
    renderPiketSelectedStudents();
    piketEls.jsonOutput.style.display = 'none';
    piketEls.saveBtn.style.display = 'none';
}

// ===== GENERATE JSON SCHEDULE =====
function generatePiketJSON() {
    const kelas = piketEls.classSelector.value;
    if (!kelas) {
        piketEls.status.textContent = '⚠️ Pilih kelas terlebih dahulu';
        piketEls.status.className = 'status-msg error';
        return;
    }
    
    if (!piketState.selectedStudents.length) {
        piketEls.status.textContent = '⚠️ Pilih minimal 1 siswa untuk piket';
        piketEls.status.className = 'status-msg error';
        return;
    }
    
    const scheduleKey = `piket_schedule_${kelas.replace(' ', '_')}`;
    const nisList = piketState.selectedStudents.map(s => s[0]).join(',');
    
    const fullSchedule = {
        "Monday": "",
        "Tuesday": "",
        "Wednesday": "",
        "Thursday": "",
        "Friday": ""
    };
    
    fullSchedule[piketState.day] = nisList;
    
    const jsonString = JSON.stringify(fullSchedule, null, 2);
    
    piketEls.jsonPreview.textContent = jsonString;
    piketEls.jsonOutput.style.display = 'block';
    piketEls.saveBtn.style.display = 'inline-block';
    
    piketState.currentSchedule = {
        key: scheduleKey,
        schedule: fullSchedule,
        day: piketState.day,
        nisList: nisList
    };
    
    piketEls.status.textContent = `✅ JSON generated for ${kelas} - ${getDayIndonesian(piketState.day)}`;
    piketEls.status.className = 'status-msg success';
}

// ===== SAVE SCHEDULE TO CONFIG =====
async function savePiketSchedule() {
    if (!piketState.currentSchedule) {
        piketEls.status.textContent = '⚠️ Generate JSON terlebih dahulu';
        piketEls.status.className = 'status-msg error';
        return;
    }
    
    const { key, day, nisList } = piketState.currentSchedule;
    const kelas = piketEls.classSelector.value;
    
    try {
        const existingData = await apiCall('getConfig', { key });
        let existingSchedule = {};
        
        if (existingData && existingData.value) {
            try {
                existingSchedule = JSON.parse(existingData.value);
            } catch (e) {
                existingSchedule = {};
            }
        }
        
        existingSchedule[day] = nisList;
        
        const result = await apiCall('saveConfig', { 
            key, 
            value: JSON.stringify(existingSchedule) 
        });
        
        if (result.success) {
            piketEls.status.textContent = `✅ Schedule saved for ${kelas} - ${getDayIndonesian(day)}!`;
            piketEls.status.className = 'status-msg success';
            piketEls.saveBtn.style.display = 'none';
            
            piketEls.jsonPreview.textContent = JSON.stringify(existingSchedule, null, 2);
        } else {
            piketEls.status.textContent = `❌ Failed to save: ${result.error || 'Unknown error'}`;
            piketEls.status.className = 'status-msg error';
        }
    } catch (error) {
        console.error('Save error:', error);
        piketEls.status.textContent = '❌ Gagal menyimpan schedule';
        piketEls.status.className = 'status-msg error';
    }
}

// ===== CLEAR SELECTION =====
function clearPiketSelection() {
    piketState.selectedStudents = [];
    piketState.currentSchedule = null;
    renderPiketStudentList();
    renderPiketSelectedStudents();
    piketEls.jsonOutput.style.display = 'none';
    piketEls.saveBtn.style.display = 'none';
    piketEls.status.textContent = '';
    piketEls.status.className = '';
}

// ===== HELPER: Get Day in Indonesian =====
function getDayIndonesian(day) {
    const map = {
        'Monday': 'Senin',
        'Tuesday': 'Selasa',
        'Wednesday': 'Rabu',
        'Thursday': 'Kamis',
        'Friday': 'Jumat',
        'Saturday': 'Sabtu',
        'Sunday': 'Minggu'
    };
    return map[day] || day;
}

// ===== SETUP PIKET BUILDER EVENTS =====
function setupPiketBuilder() {
    // Make toggle function global for onclick
    window.togglePiketStudent = togglePiketStudent;
    
    // Load classes when admin tab is shown
    document.querySelector('[data-tab="admin"]').addEventListener('click', () => {
        if (piketEls.classSelector.options.length <= 1) {
            loadPiketClasses();
        }
    });
    
    piketEls.classSelector.addEventListener('change', () => {
        const kelas = piketEls.classSelector.value;
        piketState.kelas = kelas;
        piketEls.jsonOutput.style.display = 'none';
        piketEls.saveBtn.style.display = 'none';
        piketEls.status.textContent = '';
        piketEls.status.className = '';
        loadPiketStudents(kelas);
    });
    
    piketEls.daySelector.addEventListener('change', () => {
        piketState.day = piketEls.daySelector.value;
        piketEls.dayLabel.textContent = getDayIndonesian(piketState.day);
        piketEls.jsonOutput.style.display = 'none';
        piketEls.saveBtn.style.display = 'none';
        if (piketState.kelas) {
            loadExistingSchedule(piketState.kelas);
        }
    });
    
    piketEls.studentSearch.addEventListener('input', renderPiketStudentList);
    piketEls.generateBtn.addEventListener('click', generatePiketJSON);
    piketEls.saveBtn.addEventListener('click', savePiketSchedule);
    piketEls.clearBtn.addEventListener('click', clearPiketSelection);
}