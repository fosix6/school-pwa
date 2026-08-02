// ===== CONFIGURATION =====
// ⚠️ REPLACE WITH YOUR APPS SCRIPT URL
const API_URL = '{{APPS_SCRIPT_URL}}';

const CONFIG = {
    API_URL: API_URL,
    CACHE_DURATION: 3600000,
};

// ===== STATE =====
let state = {
    currentClass: '',
    currentDate: new Date().toISOString().split('T')[0],
    students: [],
    attendance: {},
    piket: [],
    lateness: [], // Added for lateness tracking
    pendingActions: [],
    isOnline: navigator.onLine,
    currentTab: 'today',
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
    statTerlambat: $('stat-terlambat'), // Added
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
    clearCacheBtn: $('clear-cache-btn'),
    loadingToast: $('loading-toast'),
    toastMessage: $('toast-message'),
    toastDetail: $('toast-detail'),
    toastProgress: $('toast-progress'),
    tabBtns: document.querySelectorAll('.tab-btn'),
    // Lateness elements
    latenessSection: $('lateness-section'),
    latenessList: $('lateness-list'),
    markLateBtn: $('mark-late-btn'),
    lateStudentSelect: $('late-student-select'),
    latenessCount: $('lateness-count'),
};

// ========================================
// PIKET SCHEDULE BUILDER (Admin Panel)
// ========================================

let piketState = {
    kelas: '',
    allStudents: [],
    monday: [],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [],
    filteredStudents: [],
    currentSchedule: null,
};

// ===== LOADING TOAST =====
let toastTimeout = null;
let toastActive = false;

function showToast(message, detail = '', progress = null, isError = false) {
    const toast = els.loadingToast;
    const msgEl = els.toastMessage;
    const detailEl = els.toastDetail;
    const progressEl = els.toastProgress;
    
    if (toastTimeout) {
        clearTimeout(toastTimeout);
        toastTimeout = null;
    }
    
    msgEl.textContent = message || 'Loading...';
    detailEl.textContent = detail || '';
    
    if (progress !== null && progress >= 0 && progress <= 100) {
        progressEl.style.display = 'block';
        progressEl.value = progress;
    } else {
        progressEl.style.display = 'none';
    }
    
    if (isError) {
        toast.classList.add('error');
    } else {
        toast.classList.remove('error');
    }
    
    toast.style.zIndex = '999999';
    toast.classList.add('active');
    toastActive = true;
}

function updateToast(message, detail = '', progress = null) {
    if (!toastActive) {
        showToast(message, detail, progress);
        return;
    }
    
    const msgEl = els.toastMessage;
    const detailEl = els.toastDetail;
    const progressEl = els.toastProgress;
    
    if (message) msgEl.textContent = message;
    if (detail) detailEl.textContent = detail;
    
    if (progress !== null && progress >= 0 && progress <= 100) {
        progressEl.style.display = 'block';
        progressEl.value = progress;
    } else {
        progressEl.style.display = 'none';
    }
}

function hideToast() {
    if (toastTimeout) {
        clearTimeout(toastTimeout);
        toastTimeout = null;
    }
    els.loadingToast.classList.remove('active');
    toastActive = false;
}

function hideToastDelayed(delay = 800) {
    if (toastTimeout) {
        clearTimeout(toastTimeout);
        toastTimeout = null;
    }
    toastTimeout = setTimeout(() => {
        hideToast();
        toastTimeout = null;
    }, delay);
}

// ===== HELPERS =====
function todayISO() {
    const d = new Date();
    const tz = d.getTimezoneOffset() * 60000;
    return new Date(d - tz).toISOString().slice(0, 10);
}

function formatDate(iso) {
    if (!iso) return 'Untitled';
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' });
}

function getDayIndonesian(day) {
    const map = { 'Monday': 'Senin', 'Tuesday': 'Selasa', 'Wednesday': 'Rabu', 'Thursday': 'Kamis', 'Friday': 'Jumat' };
    return map[day] || day;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : str;
    return div.innerHTML;
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

async function apiCall(action, params = {}, showLoadingToast = true, method = 'GET') {
        const actionLabels = {
        'getClasses': 'Memuat daftar kelas',
        'getStudents': 'Memuat data siswa',
        'getAttendance': 'Memuat absensi',
        'getPiket': 'Memuat jadwal piket',
        'markAttendance': 'Menyimpan absensi',
        'togglePiket': 'Mengupdate piket',
        'uploadPiketPhoto': 'Mengupload foto',
        'getHistory': 'Memuat history',
        'uploadCSV': 'Mengupload CSV',
        'saveConfig': 'Menyimpan konfigurasi',
    };
    const label = actionLabels[action] || `Menjalankan ${action}`;

    if (showLoadingToast) showToast(label, 'Menghubungi server...', 10);

    try {
        updateToast(label, 'Mengirim request...', 30);
        let response;

        if (method === 'POST') {
            response = await fetch(CONFIG.API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action, ...params }),
            });
        } else {
            const url = new URL(CONFIG.API_URL);
            url.searchParams.append('action', action);
            Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));
            response = await fetch(url.toString());
        }

        updateToast(label, 'Menerima response...', 70);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        updateToast(label, 'Selesai!', 100);
        setTimeout(() => hideToastDelayed(600), 300);
        return data;
    } catch (error) {
        console.error('API Error:', error);
        showToast(`Gagal: ${label}`, error.message || 'Unknown error', null, true);
        if (!navigator.onLine) {
            queueAction(action, params);
            setTimeout(() => hideToastDelayed(1500), 1000);
        } else {
            setTimeout(() => hideToastDelayed(2000), 1500);
        }
        throw error;
    }
}

// ===== QUEUE SYSTEM (Offline) =====
function queueAction(action, params) {
    const pending = JSON.parse(localStorage.getItem('pending_actions') || '[]');
    pending.push({ action, params, timestamp: Date.now() });
    localStorage.setItem('pending_actions', JSON.stringify(pending));
    updatePendingCounter();
    showToast('Disimpan offline', 'Akan disinkronkan saat online', null, false);
    setTimeout(() => hideToastDelayed(1500), 1000);
}

async function processPendingActions() {
    const pending = JSON.parse(localStorage.getItem('pending_actions') || '[]');
    if (!pending.length || !navigator.onLine) return;
    
    showToast('Menyinkronkan data offline', `Memproses ${pending.length} item...`, 10);
    
    const failed = [];
    let processed = 0;
    const total = pending.length;
    
    for (const item of pending) {
        try {
            processed++;
            const progress = Math.round((processed / total) * 90);
            updateToast('Menyinkronkan data offline', `Item ${processed}/${total}`, progress);
            await apiCall(item.action, item.params, false);
        } catch (error) {
            failed.push(item);
        }
    }
    
    if (failed.length) {
        localStorage.setItem('pending_actions', JSON.stringify(failed));
        updateToast('⚠️ Sinkronisasi sebagian', `${failed.length} item gagal`, 100);
        setTimeout(() => hideToastDelayed(2000), 1500);
    } else {
        localStorage.removeItem('pending_actions');
        updateToast('Sinkronisasi selesai', 'Semua data tersimpan', 100);
        setTimeout(() => hideToastDelayed(1200), 500);
    }
    updatePendingCounter();
}

function updatePendingCounter() {
    const pending = JSON.parse(localStorage.getItem('pending_actions') || '[]');
    const el = document.getElementById('pending-counter');
    if (pending.length && el) {
        el.style.display = 'block';
        el.textContent = `${pending.length} pending`;
    } else if (el) {
        el.style.display = 'none';
    }
}

// ===== TAB SWITCHING =====
function switchTab(tabName) {
    state.currentTab = tabName;
    
    els.tabBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `tab-${tabName}`);
    });
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
            localStorage.setItem('classes_cache', JSON.stringify(data.classes));
        }
        return data.classes || [];
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
            return classes;
        }
        return [];
    }
}

// ===== LOAD STUDENTS =====
// ===== LOAD STUDENTS =====
async function loadStudents(kelas, date) {
    if (!kelas) {
        els.studentList.innerHTML = '<p class="empty-state">Pilih kelas untuk mulai</p>';
        els.piketSection.style.display = 'none';
        els.latenessSection.style.display = 'none';
        els.whatsappBtn.style.display = 'none';
        els.statsSummary.style.display = 'none';
        return;
    }
    
    try {
        showToast('Memuat data kelas', `Kelas ${kelas} - ${formatDate(date)}`, 20);
        
        const [studentData, attData, piketData] = await Promise.all([
            apiCall('getStudents', { kelas }, false),
            apiCall('getAttendance', { date, kelas }, false),
            apiCall('getPiket', { date, kelas }, false)
        ]);
        
        updateToast('Memproses data', 'Menyusun tampilan...', 80);
        
        state.students = studentData.students || [];
        state.attendance = attData.attendance || {};
        state.piket = piketData.piket || [];
        
        // FIX: Build lateness from attendance data where status is 'telat'
        state.lateness = [];
        for (const [nis, status] of Object.entries(state.attendance)) {
            if (status === 'telat') {
                const student = state.students.find(s => s[0].toString() === nis);
                if (student) {
                    state.lateness.push({
                        nis: nis,
                        name: student[1],
                        date: date,
                        timestamp: new Date().toISOString()
                    });
                }
            }
        }
        
        renderStudents();
        renderPiket();
        renderLateness();
        updateStats();
        updateLatenessSelect();
        
        els.piketSection.style.display = 'block';
        els.latenessSection.style.display = 'block';
        els.whatsappBtn.style.display = 'block';
        els.statsSummary.style.display = 'grid';
        cacheData(kelas, date);
        
        updateToast('Data siap', `${state.students.length} siswa dimuat`, 100);
        setTimeout(() => hideToastDelayed(600), 300);
        
    } catch (error) {
        const cached = getCachedData(kelas, date);
        if (cached) {
            state.students = cached.students || [];
            state.attendance = cached.attendance || {};
            state.piket = cached.piket || [];
            
            // FIX: Build lateness from cached attendance data
            state.lateness = [];
            for (const [nis, status] of Object.entries(state.attendance)) {
                if (status === 'telat') {
                    const student = state.students.find(s => s[0].toString() === nis);
                    if (student) {
                        state.lateness.push({
                            nis: nis,
                            name: student[1],
                            date: date,
                            timestamp: new Date().toISOString()
                        });
                    }
                }
            }
            
            renderStudents();
            renderPiket();
            renderLateness();
            updateStats();
            updateLatenessSelect();
            els.piketSection.style.display = 'block';
            els.latenessSection.style.display = 'block';
            els.whatsappBtn.style.display = 'block';
            els.statsSummary.style.display = 'grid';
            showToast('Data dari cache', 'Koneksi offline, menggunakan data tersimpan', null, false);
            setTimeout(() => hideToastDelayed(2000), 1000);
        } else {
            els.studentList.innerHTML = '<p class="empty-state">Gagal memuat data. Periksa koneksi.</p>';
        }
    }
}

// ===== CACHE =====
function cacheData(kelas, date) {
    // Rebuild lateness from attendance before caching
    state.lateness = [];
    for (const [nis, status] of Object.entries(state.attendance)) {
        if (status === 'telat') {
            const student = state.students.find(s => s[0].toString() === nis);
            if (student) {
                state.lateness.push({
                    nis: nis,
                    name: student[1],
                    date: date,
                    timestamp: new Date().toISOString()
                });
            }
        }
    }
    
    const cache = {
        students: state.students,
        attendance: state.attendance,
        piket: state.piket,
        lateness: state.lateness,
        timestamp: Date.now(),
    };
    localStorage.setItem(`cache_${kelas}_${date}`, JSON.stringify(cache));
}

function getCachedData(kelas, date) {
    const data = localStorage.getItem(`cache_${kelas}_${date}`);
    if (!data) return null;
    const parsed = JSON.parse(data);
    if (Date.now() - parsed.timestamp > CONFIG.CACHE_DURATION) return null;
    return parsed;
}

// ===== RENDER STUDENTS =====
// ===== RENDER STUDENTS =====
function renderStudents() {
    if (!state.students || !state.students.length) {
        els.studentList.innerHTML = '<p class="empty-state">Tidak ada siswa di kelas ini</p>';
        return;
    }
    
    // Build lateness NIS set from state.lateness
    const lateNIS = new Set(state.lateness.map(l => l.nis.toString()));
    
    let html = '';
    state.students.forEach(student => {
        const nis = student[0].toString();
        const name = student[1];
        // Get status from attendance
        const status = state.attendance[nis] || 'hadir';
        // Check if in lateness list - this will also show 'telat' if the status is 'telat'
        const isLate = lateNIS.has(nis) || status === 'telat';
        
        // Determine display status - use 'terlambat' for CSS class
        const displayStatus = isLate ? 'terlambat' : status;
        
        const statusLabels = {
            hadir: { label: 'Hadir', emoji: 'H', class: 'status-hadir' },
            absen: { label: 'Absen', emoji: 'A', class: 'status-absen' },
            sakit: { label: 'Sakit', emoji: 'S', class: 'status-sakit' },
            izin: { label: 'Izin', emoji: 'I', class: 'status-izin' },
            terlambat: { label: 'Telat', emoji: 'T', class: 'status-terlambat' }
        };
        const info = statusLabels[displayStatus] || statusLabels.hadir;
        
        // For the status buttons, use 'telat' as the value but 'terlambat' for display
        const statusOptions = [
            { value: 'hadir', label: 'H', class: 'status-hadir' },
            { value: 'absen', label: 'A', class: 'status-absen' },
            { value: 'sakit', label: 'S', class: 'status-sakit' },
            { value: 'izin', label: 'I', class: 'status-izin' },
            { value: 'telat', label: 'T', class: 'status-terlambat' }
        ];
        
        html += `
            <div class="student-card status-${displayStatus}">
                <div class="student-info">
                    <span class="student-name">${escapeHtml(name)}</span>
                    <span class="student-nis">#${nis}</span>
                </div>
                <div class="student-status-badge ${info.class}">
                    ${info.emoji} ${info.label}
                </div>
                <div class="status-btns">
                    ${statusOptions.map(s => {
                        const isActive = displayStatus === s.value || (s.value === 'telat' && isLate);
                        return `
                            <button class="status-btn ${isActive ? 'active' : ''} ${s.class}" 
                                    data-status="${s.value}" 
                                    onclick="markAttendance('${nis}', '${s.value}')">
                                ${s.label}
                            </button>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    });
    els.studentList.innerHTML = html;
}

// ===== MARK ATTENDANCE =====
// ===== MARK ATTENDANCE =====
async function markAttendance(nis, status) {
    const date = els.dateSelector.value;
    const kelas = els.classSelector.value;
    
    // Update attendance
    state.attendance[nis] = status;
    
    // Rebuild lateness from attendance - only include entries with status 'telat'
    state.lateness = [];
    for (const [sNis, sStatus] of Object.entries(state.attendance)) {
        if (sStatus === 'telat') {
            const student = state.students.find(s => s[0].toString() === sNis);
            if (student) {
                state.lateness.push({
                    nis: sNis,
                    name: student[1],
                    date: date,
                    timestamp: new Date().toISOString()
                });
            }
        }
    }
    
    renderStudents();
    renderLateness();
    updateStats();
    updateLatenessSelect();
    
    try {
        await apiCall('markAttendance', { nis, date, status, kelas });
        cacheData(kelas, date);
    } catch (error) {
        queueAction('markAttendance', { nis, date, status, kelas });
    }
}

// ===== LATENESS FUNCTIONS =====
function updateLatenessSelect() {
    const select = els.lateStudentSelect;
    select.innerHTML = '<option value="">Pilih siswa...</option>';
    
    // Get students who aren't already marked late today
    const lateNIS = new Set(state.lateness.map(l => l.nis));
    
    state.students.forEach(student => {
        const nis = student[0].toString();
        if (!lateNIS.has(nis)) {
            const opt = document.createElement('option');
            opt.value = nis;
            opt.textContent = `${student[1]} (${nis})`;
            select.appendChild(opt);
        }
    });
}

async function markLateness() {
    const select = els.lateStudentSelect;
    const nis = select.value;
    if (!nis) {
        showToast('⚠️ Pilih siswa', 'Silakan pilih siswa yang terlambat', null, true);
        setTimeout(() => hideToastDelayed(1500), 1000);
        return;
    }
    
    // Just call markAttendance with 'telat' status
    await markAttendance(nis, 'telat');
    
    // Reset the select dropdown
    select.value = '';
    updateLatenessSelect();
}

async function toggleLateness(nis) {
    const date = els.dateSelector.value;
    const kelas = els.classSelector.value;
    const lateNIS = new Set(state.lateness.map(l => l.nis));
    
    if (lateNIS.has(nis.toString())) {
        // Remove lateness (not supported by API yet - would need delete endpoint)
        // For now, just show a message
        showToast('⚠️ Hapus tidak didukung', 'Gunakan tombol di panel keterlambatan', null, true);
        setTimeout(() => hideToastDelayed(1500), 1000);
        return;
    }
    
    // Mark as late
    const student = state.students.find(s => s[0].toString() === nis);
    const name = student ? student[1] : nis;
    
    try {
        await apiCall('markLateness', { nis, date }, false, 'POST');
        state.lateness.push({
            nis: nis.toString(),
            name: name,
            date: date,
            timestamp: new Date().toISOString()
        });
        renderLateness();
        renderStudents();
        updateStats();
        updateLatenessSelect();
        cacheData(kelas, date);
    } catch (error) {
        queueAction('markLateness', { nis, date });
        state.lateness.push({
            nis: nis.toString(),
            name: name,
            date: date,
            timestamp: new Date().toISOString()
        });
        renderLateness();
        renderStudents();
        updateStats();
        updateLatenessSelect();
    }
}

function renderLateness() {
    if (!state.lateness || !state.lateness.length) {
        els.latenessList.innerHTML = '<p class="empty-state">Tidak ada siswa terlambat hari ini</p>';
        els.latenessCount.textContent = '0';
        return;
    }
    
    els.latenessCount.textContent = state.lateness.length;
    
    let html = '';
    state.lateness.forEach((item, index) => {
        const time = item.timestamp ? new Date(item.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '';
        html += `
            <div class="lateness-item">
                <span class="lateness-name">${escapeHtml(item.name)}</span>
                <span class="lateness-time">${time}</span>
                <button class="lateness-remove-btn" onclick="removeLateness(${index})">✕</button>
            </div>
        `;
    });
    els.latenessList.innerHTML = html;
}

// Note: This removes from UI only. For full delete support, you'd need a server endpoint.
function removeLateness(index) {
    if (confirm('Hapus catatan keterlambatan ini?')) {
        state.lateness.splice(index, 1);
        renderLateness();
        renderStudents();
        updateStats();
        updateLatenessSelect();
        const kelas = els.classSelector.value;
        const date = els.dateSelector.value;
        cacheData(kelas, date);
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
        const hasPhoto1 = piket.photo1 && piket.photo1.length > 0;
        const hasPhoto2 = piket.photo2 && piket.photo2.length > 0;
        const names = piket.names ? piket.names.join(', ') : '';
        
        html += `
            <div class="piket-item ${done ? 'done' : ''}" id="piket-${piket.id}">
                <div class="piket-info">
                    <span class="piket-name">${escapeHtml(names)}</span>
                    <span class="piket-status ${done ? 'done' : 'pending'}">
                        ${done ? 'Selesai' : 'Belum'}
                    </span>
                </div>
                <div class="piket-actions">
                    <button class="piket-toggle ${done ? 'done' : ''}" onclick="togglePiket('${piket.id}', ${!done})">
                        ${done ? 'Batal' : 'Selesai'}
                    </button>
                    <button class="piket-photo-btn ${hasPhoto1 ? 'has-photo' : ''}" onclick="uploadPiketPhoto('${piket.id}', 1)">
                        foto 1
                    </button>
                    <button class="piket-photo-btn ${hasPhoto2 ? 'has-photo' : ''}" onclick="uploadPiketPhoto('${piket.id}', 2)">
                        foto 2
                    </button>
                </div>
                ${(hasPhoto1 || hasPhoto2) ? `
                    <div class="piket-photos">
                        ${hasPhoto1 ? `<a href="${piket.photo1}" target="_blank"><img src="${piket.photo1}" class="piket-thumb" alt="Foto 1"></a>` : ''}
                        ${hasPhoto2 ? `<a href="${piket.photo2}" target="_blank"><img src="${piket.photo2}" class="piket-thumb" alt="Foto 2"></a>` : ''}
                    </div>
                ` : ''}
            </div>
        `;
    });
    els.piketList.innerHTML = html;
}

// ===== TOGGLE PIKET =====
async function togglePiket(id, done) {
    const date = els.dateSelector.value;
    const kelas = els.classSelector.value;
    
    const piket = state.piket.find(p => p.id === id);
    if (piket) {
        piket.done = done;
        renderPiket();
    }
    
    try {
        await apiCall('togglePiket', { id, done, date, kelas });
        cacheData(kelas, date);
        await loadStudents(kelas, date);
    } catch (error) {
        if (piket) {
            piket.done = !done;
            renderPiket();
        }
        queueAction('togglePiket', { id, done, date, kelas });
    }
}

async function uploadPiketPhoto(id, photoNum) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';

    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const base64 = await compressImage(file, 2000, 0.9);
            const piketEl = document.getElementById(`piket-${id}`);
            if (piketEl) piketEl.style.opacity = '0.5';

            showToast('Mengupload foto', 'Mengirim ke server...', 30);
            const result = await apiCall('uploadPiketPhoto', { id, photoNum, photo: base64 }, false, 'POST');
            if (result.success) {
                updateToast('Foto terupload', 'Berhasil!', 100);
                setTimeout(() => hideToastDelayed(800), 500);
                await loadStudents(els.classSelector.value, els.dateSelector.value);
            } else {
                showToast('Gagal upload', result.error || 'Unknown error', null, true);
                setTimeout(() => hideToastDelayed(2000), 1500);
            }
        } catch (error) {
            showToast('Gagal upload', error.message || 'Periksa koneksi', null, true);
            setTimeout(() => hideToastDelayed(2000), 1500);
        } finally {
            const piketEl = document.getElementById(`piket-${id}`);
            if (piketEl) piketEl.style.opacity = '1';
        }
    };
    input.click();
}

function compressImage(file, maxDim = 1000, quality = 0.7) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let { width, height } = img;
                if (width > height && width > maxDim) {
                    height = Math.round(height * (maxDim / width));
                    width = maxDim;
                } else if (height > maxDim) {
                    width = Math.round(width * (maxDim / height));
                    height = maxDim;
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = () => reject(new Error('Gagal membaca gambar'));
            img.src = e.target.result;
        };
        reader.onerror = () => reject(new Error('Gagal membaca file'));
        reader.readAsDataURL(file);
    });
}

// ===== UPDATE STATS =====
function updateStats() {
    const stats = { hadir: 0, absen: 0, sakit: 0, izin: 0, telat: 0 };
    
    if (state.students) {
        state.students.forEach(student => {
            const nis = student[0].toString();
            const status = state.attendance[nis] || 'hadir';
            // Count the status as-is from attendance
            if (stats[status] !== undefined) {
                stats[status]++;
            } else {
                // If status is something unexpected, count as hadir
                stats.hadir++;
            }
        });
    }
    
    els.statHadir.textContent = stats.hadir;
    els.statAbsen.textContent = stats.absen;
    els.statSakit.textContent = stats.sakit;
    els.statIzin.textContent = stats.izin;
    els.statTerlambat.textContent = stats.telat;
}

// ===== WHATSAPP REPORT =====
function copyWhatsAppReport() {
    const kelas = els.classSelector.value;
    const date = els.dateSelector.value;
    const formattedDate = new Date(date + 'T00:00:00').toLocaleDateString('id-ID', {
        day: 'numeric', month: 'long', year: 'numeric'
    });
    
    let report = `*REKAP ABSENSI ${kelas}*\n`;
    report += `${formattedDate}\n`;
    report += `━━━━━━━━━━━━━━━━\n`;
    report += `Hadir: ${els.statHadir.textContent}\n`;
    report += `Absen: ${els.statAbsen.textContent}\n`;
    report += `Sakit: ${els.statSakit.textContent}\n`;
    report += `Izin: ${els.statIzin.textContent}\n`;
    report += `Terlambat: ${els.statTerlambat.textContent}\n`;
    report += `━━━━━━━━━━━━━━━━\n`;
    
    if (state.students) {
        const absentStudents = state.students
            .filter(s => state.attendance[s[0]] === 'absen')
            .map(s => s[1]);
        if (absentStudents.length) {
            report += `Absen: ${absentStudents.join(', ')}\n`;
        }
    }
    
    // Add late students
    if (state.lateness && state.lateness.length) {
        const lateNames = state.lateness.map(l => l.name);
        report += `Terlambat: ${lateNames.join(', ')}\n`;
    }
    
    if (state.piket && state.piket.length) {
        report += `\n*PIKET*:\n`;
        state.piket.forEach(p => {
            const status = p.done ? 'Selesai' : 'Belum';
            const names = p.names ? p.names.join(', ') : '';
            report += `${names}: ${status}\n`;
        });
    }
    
    navigator.clipboard.writeText(report).then(() => {
        showToast('Laporan disalin', 'Tempelkan ke WhatsApp', null, false);
        setTimeout(() => hideToastDelayed(1500), 1000);
    }).catch(() => {
        prompt('Salin teks ini:', report);
    });
}

// ===== HISTORY =====
async function loadHistory() {
    const date = els.historyDate.value;
    if (!date) {
        showToast('⚠️ Pilih tanggal', 'Tanggal harus diisi', null, true);
        setTimeout(() => hideToastDelayed(1500), 1000);
        return;
    }
    
    try {
        showToast('Memuat history', `Tanggal ${formatDate(date)}`, 20);
        const data = await apiCall('getHistory', { date }, false);
        
        updateToast('Memproses history', 'Menyusun data...', 70);
        
        let html = `<h3>Rekap ${formatDate(date)}</h3>`;
        
        if (data.attendance && data.attendance.length) {
            html += `<div class="student-grid">`;
            data.attendance.forEach(record => {
                const statusLabels = {
                    hadir: 'Hadir',
                    absen: 'Absen',
                    sakit: 'Sakit',
                    izin: 'Izin'
                };
                const label = statusLabels[record.status] || record.status;
                html += `
                    <div class="student-card status-${record.status}">
                        <span class="student-name">${escapeHtml(record.name)}</span>
                        <span class="student-status-badge status-${record.status}">${label}</span>
                    </div>
                `;
            });
            html += `</div>`;
        } else {
            html += `<p class="empty-state">Tidak ada data absensi untuk tanggal ini</p>`;
        }
        
        // Add lateness to history
        if (data.lateness && data.lateness.length) {
            html += `<h4>Terlambat</h4>`;
            html += `<div class="student-grid">`;
            data.lateness.forEach(record => {
                html += `
                    <div class="student-card status-terlambat">
                        <span class="student-name">${escapeHtml(record.name)}</span>
                        <span class="student-status-badge status-terlambat">Terlambat</span>
                    </div>
                `;
            });
            html += `</div>`;
        }
        
        if (data.piket && data.piket.length) {
            html += `<h4>Piket</h4>`;
            data.piket.forEach(p => {
                const names = p.names ? p.names.join(', ') : '';
                html += `<div class="piket-item">
                    <span>${escapeHtml(names)}: ${p.done ? 'Selesai' : 'Belum'}</span>
                </div>`;
            });
        }
        
        els.historyContainer.innerHTML = html;
        updateToast('History dimuat', `${data.attendance?.length || 0} record ditemukan`, 100);
        setTimeout(() => hideToastDelayed(800), 500);
    } catch (error) {
        els.historyContainer.innerHTML = '<p class="empty-state">Gagal memuat history</p>';
    }
}

// ===== CSV UPLOAD =====
async function uploadCSV() {
    const file = els.csvUpload.files[0];
    if (!file) {
        showToast('⚠️ Pilih file', 'File CSV diperlukan', null, true);
        setTimeout(() => hideToastDelayed(1500), 1000);
        return;
    }
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        const csv = e.target.result;
        try {
            showToast('Mengupload CSV', 'Mengirim ke server...', 30);
            const result = await apiCall('uploadCSV', { csv: encodeURIComponent(csv) }, false);
            
            if (result.success) {
                updateToast('Upload berhasil', result.message || 'Data terimport', 100);
                setTimeout(() => hideToastDelayed(1200), 500);
                await loadClasses();
                await loadStudents(els.classSelector.value, els.dateSelector.value);
            } else {
                showToast('Upload gagal', result.message || 'Unknown error', null, true);
                setTimeout(() => hideToastDelayed(2000), 1500);
            }
        } catch (error) {
            showToast('Upload gagal', 'Periksa koneksi', null, true);
            setTimeout(() => hideToastDelayed(2000), 1500);
        }
    };
    reader.readAsText(file);
}

// ========================================
// PIKET SCHEDULE BUILDER (Full Week)
// ========================================

async function openPiketBuilderDialog() {
    const dialog = document.getElementById('piketBuilderDialog');
    const classes = await loadClasses();
    const selector = document.getElementById('piket-class-selector');
    selector.innerHTML = '<option value="">-- Select Class --</option>';
    classes.forEach(cls => {
        const opt = document.createElement('option');
        opt.value = cls;
        opt.textContent = cls;
        selector.appendChild(opt);
    });
    
    piketState.kelas = '';
    piketState.allStudents = [];
    piketState.monday = [];
    piketState.tuesday = [];
    piketState.wednesday = [];
    piketState.thursday = [];
    piketState.friday = [];
    piketState.filteredStudents = [];
    
    document.getElementById('piket-student-list').innerHTML = '<p class="empty-state">Pilih kelas terlebih dahulu</p>';
    updatePiketSelectedDisplay();
    document.getElementById('piket-status').textContent = '';
    document.getElementById('piket-status').className = '';
    document.getElementById('piket-save-btn').style.display = 'none';
    
    document.getElementById('piket-mon-list').innerHTML = '';
    document.getElementById('piket-tue-list').innerHTML = '';
    document.getElementById('piket-wed-list').innerHTML = '';
    document.getElementById('piket-thu-list').innerHTML = '';
    document.getElementById('piket-fri-list').innerHTML = '';
    
    dialog.showModal();
}

function updatePiketSelectedDisplay() {
    const days = [
        { id: 'piket-mon-list', data: piketState.monday, label: 'Senin' },
        { id: 'piket-tue-list', data: piketState.tuesday, label: 'Selasa' },
        { id: 'piket-wed-list', data: piketState.wednesday, label: 'Rabu' },
        { id: 'piket-thu-list', data: piketState.thursday, label: 'Kamis' },
        { id: 'piket-fri-list', data: piketState.friday, label: 'Jumat' },
    ];
    
    days.forEach(day => {
        const container = document.getElementById(day.id);
        if (!container) return;
        if (!day.data.length) {
            container.innerHTML = `<span class="empty-tag">Belum ada siswa</span>`;
            return;
        }
        container.innerHTML = day.data.map(s => `
            <span class="selected-student-tag" data-day="${day.label}" data-nis="${s[0]}">${escapeHtml(s[1])}</span>
        `).join('');
        container.querySelectorAll('.selected-student-tag').forEach(el => {
            el.onclick = (e) => {
                e.stopPropagation();
                const nis = el.dataset.nis;
                const dayLabel = el.dataset.day;
                const dayMap = { 'Senin': 'monday', 'Selasa': 'tuesday', 'Rabu': 'wednesday', 'Kamis': 'thursday', 'Jumat': 'friday' };
                const key = dayMap[dayLabel];
                if (key) {
                    piketState[key] = piketState[key].filter(s => s[0].toString() !== nis);
                    updatePiketSelectedDisplay();
                    renderPiketBuilderStudents();
                }
            };
        });
    });
}

document.getElementById('piket-class-selector').addEventListener('change', async () => {
    const kelas = document.getElementById('piket-class-selector').value;
    piketState.kelas = kelas;
    if (!kelas) {
        document.getElementById('piket-student-list').innerHTML = '<p class="empty-state">Pilih kelas terlebih dahulu</p>';
        return;
    }
    try {
        showToast('Memuat siswa', `Kelas ${kelas}`, 20);
        const data = await apiCall('getStudents', { kelas }, false);
        piketState.allStudents = data.students || [];
        piketState.monday = [];
        piketState.tuesday = [];
        piketState.wednesday = [];
        piketState.thursday = [];
        piketState.friday = [];
        piketState.filteredStudents = piketState.allStudents;
        renderPiketBuilderStudents();
        updatePiketSelectedDisplay();
        document.getElementById('piket-status').textContent = '';
        document.getElementById('piket-status').className = '';
        document.getElementById('piket-save-btn').style.display = 'none';
        updateToast('Siswa dimuat', `${piketState.allStudents.length} siswa`, 100);
        setTimeout(() => hideToastDelayed(600), 300);
    } catch (error) {
        document.getElementById('piket-student-list').innerHTML = '<p class="empty-state">Gagal memuat siswa</p>';
    }
});

document.getElementById('piket-student-search').addEventListener('input', renderPiketBuilderStudents);

let expandedNis = null;

function renderPiketBuilderStudents() {
    const search = document.getElementById('piket-student-search').value.toLowerCase().trim();
    let filtered = piketState.allStudents;
    if (search) {
        filtered = filtered.filter(s => s[1].toLowerCase().includes(search) || s[0].toString().includes(search));
    }
    piketState.filteredStudents = filtered;

    const list = document.getElementById('piket-student-list');
    if (!filtered.length) {
        list.innerHTML = '<p class="empty-state">Tidak ada siswa yang cocok</p>';
        return;
    }

    const selectedNIS = new Set([
        ...piketState.monday.map(s => s[0].toString()),
        ...piketState.tuesday.map(s => s[0].toString()),
        ...piketState.wednesday.map(s => s[0].toString()),
        ...piketState.thursday.map(s => s[0].toString()),
        ...piketState.friday.map(s => s[0].toString()),
    ]);

    const days = [
        { key: 'monday', label: 'Senin' },
        { key: 'tuesday', label: 'Selasa' },
        { key: 'wednesday', label: 'Rabu' },
        { key: 'thursday', label: 'Kamis' },
        { key: 'friday', label: 'Jumat' },
    ];
    const dayLabels = { monday: 'Senin', tuesday: 'Selasa', wednesday: 'Rabu', thursday: 'Kamis', friday: 'Jumat' };

    list.innerHTML = filtered.map(s => {
        const nis = s[0].toString();
        const isSelected = selectedNIS.has(nis);
        const assignedDay = findAssignedDay(nis);
        const dayLabel = assignedDay ? dayLabels[assignedDay] : '';
        const isOpen = expandedNis === nis;

        return `
            <div class="student-search-item ${isSelected ? 'selected' : ''}" data-nis="${nis}">
                <div class="student-search-item-row" data-toggle="${nis}">
                    <span class="student-name">${escapeHtml(s[1])}</span>
                    <span class="student-nis">${s[0]}</span>
                    ${isSelected ? ` <span class="assigned-day">${dayLabel}</span>` : ''}
                </div>
                ${isOpen ? `
                    <div class="inline-day-picker">
                        ${days.map(d => `
                            <button type="button" class="day-picker-btn ${assignedDay === d.key ? 'active' : ''}" data-nis="${nis}" data-key="${d.key}">
                                ${d.label} ${assignedDay === d.key ? '✓' : ''}
                            </button>
                        `).join('')}
                        ${assignedDay ? `<button type="button" class="day-picker-btn remove" data-nis="${nis}" data-key="remove">✕ Hapus</button>` : ''}
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');

    list.querySelectorAll('[data-toggle]').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const nis = el.dataset.toggle;
            expandedNis = expandedNis === nis ? null : nis;
            renderPiketBuilderStudents();
        });
    });

    list.querySelectorAll('.inline-day-picker .day-picker-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const nis = btn.dataset.nis;
            const key = btn.dataset.key;
            const student = piketState.allStudents.find(s => s[0].toString() === nis);
            if (!student) return;

            ['monday','tuesday','wednesday','thursday','friday'].forEach(d => {
                piketState[d] = piketState[d].filter(s => s[0].toString() !== nis);
            });
            if (key !== 'remove') {
                piketState[key].push(student);
            }

            expandedNis = null;
            renderPiketBuilderStudents();
            updatePiketSelectedDisplay();
            document.getElementById('piket-save-btn').style.display = 'none';
        });
    });
}

function findAssignedDay(nis) {
    if (piketState.monday.some(s => s[0].toString() === nis)) return 'monday';
    if (piketState.tuesday.some(s => s[0].toString() === nis)) return 'tuesday';
    if (piketState.wednesday.some(s => s[0].toString() === nis)) return 'wednesday';
    if (piketState.thursday.some(s => s[0].toString() === nis)) return 'thursday';
    if (piketState.friday.some(s => s[0].toString() === nis)) return 'friday';
    return null;
}

document.getElementById('piket-generate-btn').onclick = () => {
    const kelas = document.getElementById('piket-class-selector').value;
    if (!kelas) {
        document.getElementById('piket-status').textContent = '⚠️ Pilih kelas terlebih dahulu';
        document.getElementById('piket-status').className = 'status-msg error';
        return;
    }
    
    const schedule = {
        Monday: piketState.monday.map(s => s[0]).join(','),
        Tuesday: piketState.tuesday.map(s => s[0]).join(','),
        Wednesday: piketState.wednesday.map(s => s[0]).join(','),
        Thursday: piketState.thursday.map(s => s[0]).join(','),
        Friday: piketState.friday.map(s => s[0]).join(','),
    };
    
    const json = JSON.stringify(schedule, null, 2);
    document.getElementById('piket-json-preview').textContent = json;
    document.getElementById('piket-json-output').style.display = 'block';
    document.getElementById('piket-save-btn').style.display = 'inline-block';
    document.getElementById('piket-status').textContent = 'Full week JSON generated';
    document.getElementById('piket-status').className = 'status-msg success';
    piketState.currentSchedule = { key: `piket_schedule_${kelas.replace(' ', '_')}`, schedule };
};

document.getElementById('piket-save-btn').onclick = async () => {
    if (!piketState.currentSchedule) {
        document.getElementById('piket-status').textContent = '⚠️ Generate JSON first';
        document.getElementById('piket-status').className = 'status-msg error';
        return;
    }
    const { key, schedule } = piketState.currentSchedule;
    try {
        showToast('Menyimpan jadwal', 'Mengirim ke server...', 30);
        const result = await apiCall('saveConfig', { key, value: JSON.stringify(schedule) }, false);
        if (result.success) {
            document.getElementById('piket-status').textContent = 'Full week schedule saved!';
            document.getElementById('piket-status').className = 'status-msg success';
            document.getElementById('piket-save-btn').style.display = 'none';
            updateToast('Jadwal tersimpan', 'Berhasil!', 100);
            setTimeout(() => hideToastDelayed(800), 500);
            await loadStudents(els.classSelector.value, els.dateSelector.value);
        } else {
            showToast('Gagal simpan', result.error || 'Unknown error', null, true);
            setTimeout(() => hideToastDelayed(2000), 1500);
            document.getElementById('piket-status').textContent = 'Failed to save';
            document.getElementById('piket-status').className = 'status-msg error';
        }
    } catch (error) {
        showToast('Error saving', 'Periksa koneksi', null, true);
        setTimeout(() => hideToastDelayed(2000), 1500);
        document.getElementById('piket-status').textContent = 'Error saving';
        document.getElementById('piket-status').className = 'status-msg error';
    }
};

document.getElementById('piket-clear-btn').onclick = () => {
    piketState.monday = [];
    piketState.tuesday = [];
    piketState.wednesday = [];
    piketState.thursday = [];
    piketState.friday = [];
    piketState.currentSchedule = null;
    document.getElementById('piket-json-output').style.display = 'none';
    document.getElementById('piket-save-btn').style.display = 'none';
    document.getElementById('piket-status').textContent = '';
    document.getElementById('piket-status').className = '';
    renderPiketBuilderStudents();
    updatePiketSelectedDisplay();
};

document.getElementById('piket-close-btn').onclick = () => {
    document.querySelectorAll('.day-picker-popup').forEach(p => p.remove());
    document.getElementById('piketBuilderDialog').close();
};

// ===== EVENT LISTENERS =====
function setupEventListeners() {
    els.tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            switchTab(tab);
        });
    });
    
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
    });
    
    els.whatsappBtn.addEventListener('click', copyWhatsAppReport);
    els.historyLoadBtn.addEventListener('click', loadHistory);
    els.uploadCsvBtn.addEventListener('click', uploadCSV);
    els.clearCacheBtn.addEventListener('click', () => {
        if (confirm('Hapus semua data cache lokal?')) {
            localStorage.clear();
            showToast('Cache dibersihkan', 'Refresh halaman', null, false);
            setTimeout(() => {
                hideToast();
                location.reload();
            }, 1500);
        }
    });
    
    // Lateness event listeners
    els.markLateBtn.addEventListener('click', markLateness);
    els.lateStudentSelect.addEventListener('change', () => {
        // Optional: auto-mark when selected? For now just enable button
    });
}

// ===== ONLINE/OFFLINE =====
function updateOnlineStatus() {
    state.isOnline = navigator.onLine;
    if (els.connectionStatus) {
        els.connectionStatus.textContent = state.isOnline ? '● Online' : '● Offline';
        els.connectionStatus.className = state.isOnline ? 'status-online' : 'status-offline';
    }
    if (els.offlineBanner) {
        els.offlineBanner.style.display = state.isOnline ? 'none' : 'block';
    }
    if (state.isOnline) {
        processPendingActions();
    }
}

window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

// ===== SERVICE WORKER =====
function registerSW() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(() => console.log('SW Registered'))
            .catch(() => console.log('SW Register failed'));
    }
}

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', async () => {
    els.dateSelector.value = state.currentDate;
    els.historyDate.value = state.currentDate;
    
    switchTab('today');
    
    await loadClasses();
    setupEventListeners();
    registerSW();
    updateOnlineStatus();
    processPendingActions();
    
    setTimeout(async () => {
        if (els.classSelector.options.length > 1) {
            els.classSelector.value = els.classSelector.options[1].value;
            await loadStudents(els.classSelector.value, els.dateSelector.value);
        }
    }, 300);
});

// ===== PERIODIC SYNC =====
setInterval(() => {
    if (navigator.onLine && els.classSelector.value) {
        loadStudents(els.classSelector.value, els.dateSelector.value);
        processPendingActions();
    }
}, 300000);

window.markAttendance = markAttendance;
window.togglePiket = togglePiket;
window.uploadPiketPhoto = uploadPiketPhoto;
window.openPiketBuilderDialog = openPiketBuilderDialog;
window.markLateness = markLateness;
window.toggleLateness = toggleLateness;
window.removeLateness = removeLateness;