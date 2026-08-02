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
    clearCacheBtn: $('clear-cache-btn'),
};

// ========================================
// PIKET SCHEDULE BUILDER (Admin Panel)
// ========================================

const piketEls = {
    classSelector: document.getElementById('piket-class-selector'),
    studentSearch: document.getElementById('piket-student-search'),
    studentList: document.getElementById('piket-student-list'),
    selectedList: document.getElementById('piket-selected-students'),
    generateBtn: document.getElementById('piket-generate-btn'),
    saveBtn: document.getElementById('piket-save-btn'),
    clearBtn: document.getElementById('piket-clear-btn'),
    status: document.getElementById('piket-status'),
    // Day slots
    monList: document.getElementById('piket-mon-list'),
    tueList: document.getElementById('piket-tue-list'),
    wedList: document.getElementById('piket-wed-list'),
    thuList: document.getElementById('piket-thu-list'),
    friList: document.getElementById('piket-fri-list'),
};

let piketState = {
    kelas: '',
    allStudents: [],
    // Each day stores selected students
    monday: [],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [],
    // For search/filter
    filteredStudents: [],
};

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

// ===== QUEUE SYSTEM (Offline) =====
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
    const el = document.getElementById('pending-counter');
    if (pending.length && el) {
        el.style.display = 'block';
        el.textContent = `📤 ${pending.length} pending`;
    } else if (el) {
        el.style.display = 'none';
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
async function loadStudents(kelas, date) {
    if (!kelas) {
        els.studentList.innerHTML = '<p class="empty-state">Pilih kelas untuk mulai</p>';
        els.piketSection.style.display = 'none';
        els.whatsappBtn.style.display = 'none';
        els.statsSummary.style.display = 'none';
        return;
    }
    
    try {
        const [studentData, attData, piketData] = await Promise.all([
            apiCall('getStudents', { kelas }),
            apiCall('getAttendance', { date, kelas }),
            apiCall('getPiket', { date, kelas })
        ]);
        
        state.students = studentData.students || [];
        state.attendance = attData.attendance || {};
        state.piket = piketData.piket || [];
        
        renderStudents();
        renderPiket();
        updateStats();
        
        els.piketSection.style.display = 'block';
        els.whatsappBtn.style.display = 'block';
        els.statsSummary.style.display = 'grid';
        cacheData(kelas, date);
        
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

// ===== CACHE =====
function cacheData(kelas, date) {
    const cache = {
        students: state.students,
        attendance: state.attendance,
        piket: state.piket,
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
                    <span class="student-name">${escapeHtml(name)}</span>
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
        const hasPhoto1 = piket.photo1 && piket.photo1.length > 0;
        const hasPhoto2 = piket.photo2 && piket.photo2.length > 0;
        const names = piket.names ? piket.names.join(', ') : '';
        
        html += `
            <div class="piket-item ${done ? 'done' : ''}" id="piket-${piket.id}">
                <div class="piket-info">
                    <span class="piket-name">👥 ${escapeHtml(names)}</span>
                    <span class="piket-status ${done ? 'done' : 'pending'}">
                        ${done ? '✅ Selesai' : '⬜ Belum'}
                    </span>
                </div>
                <div class="piket-actions">
                    <button class="piket-toggle ${done ? 'done' : ''}" onclick="togglePiket('${piket.id}', ${!done})">
                        ${done ? '↩️ Batal' : '✅ Selesai'}
                    </button>
                    <button class="piket-photo-btn ${hasPhoto1 ? 'has-photo' : ''}" onclick="uploadPiketPhoto('${piket.id}', 1)">
                        📷1
                    </button>
                    <button class="piket-photo-btn ${hasPhoto2 ? 'has-photo' : ''}" onclick="uploadPiketPhoto('${piket.id}', 2)">
                        📷2
                    </button>
                </div>
                ${(hasPhoto1 || hasPhoto2) ? `
                    <div class="piket-photos">
                        ${hasPhoto1 ? `<a href="${piket.photo1}" target="_blank">📸 Foto 1</a>` : ''}
                        ${hasPhoto2 ? `<a href="${piket.photo2}" target="_blank">📸 Foto 2</a>` : ''}
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

// ===== UPLOAD PIKET PHOTO =====
async function uploadPiketPhoto(id, photoNum) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (event) => {
            const base64 = event.target.result;
            const piketEl = document.getElementById(`piket-${id}`);
            if (piketEl) piketEl.style.opacity = '0.5';
            try {
                const result = await apiCall('uploadPiketPhoto', { id, photoNum, photo: base64 });
                if (result.success) {
                    await loadStudents(els.classSelector.value, els.dateSelector.value);
                } else {
                    alert('❌ Gagal upload foto: ' + (result.error || 'Unknown error'));
                }
            } catch (error) {
                alert('❌ Gagal upload foto. Periksa koneksi.');
            } finally {
                if (piketEl) piketEl.style.opacity = '1';
            }
        };
        reader.readAsDataURL(file);
    };
    input.click();
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
function copyWhatsAppReport() {
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
    
    if (state.piket && state.piket.length) {
        report += `\n🧹 *PIKET*:\n`;
        state.piket.forEach(p => {
            const status = p.done ? '✅ Selesai' : '⬜ Belum';
            const names = p.names ? p.names.join(', ') : '';
            report += `${names}: ${status}\n`;
        });
    }
    
    navigator.clipboard.writeText(report).then(() => {
        alert('✅ Laporan disalin! Tempelkan ke WhatsApp.');
    }).catch(() => {
        prompt('Salin teks ini:', report);
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
        let html = `<h3>📅 Rekap ${formatDate(date)}</h3>`;
        
        if (data.attendance && data.attendance.length) {
            html += `<div class="student-grid">`;
            data.attendance.forEach(record => {
                html += `
                    <div class="student-card">
                        <span class="student-name">${escapeHtml(record.name)}</span>
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
                const names = p.names ? p.names.join(', ') : '';
                html += `<div class="piket-item">
                    <span>${escapeHtml(names)}: ${p.done ? '✅ Selesai' : '⬜ Belum'}</span>
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
                await loadStudents(els.classSelector.value, els.dateSelector.value);
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
    
    // Reset state
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
    
    // Clear day lists
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
            container.innerHTML = `<span class="empty-state" style="padding:4px;font-size:12px;">Belum ada siswa</span>`;
            return;
        }
        container.innerHTML = day.data.map(s => `
            <span class="selected-student-tag" data-day="${day.label}" data-nis="${s[0]}">${escapeHtml(s[1])}</span>
        `).join('');
        container.querySelectorAll('.selected-student-tag').forEach(el => {
            el.onclick = () => {
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
        const data = await apiCall('getStudents', { kelas });
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
    } catch (error) {
        document.getElementById('piket-student-list').innerHTML = '<p class="empty-state">❌ Gagal memuat siswa</p>';
    }
});

document.getElementById('piket-student-search').addEventListener('input', renderPiketBuilderStudents);

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
    
    list.innerHTML = filtered.map(s => `
        <div class="student-search-item ${selectedNIS.has(s[0].toString()) ? 'selected' : ''}" data-nis="${s[0]}">
            <span class="student-name">${escapeHtml(s[1])}</span>
            <span class="student-nis">${s[0]}</span>
            ${selectedNIS.has(s[0].toString()) ? ' ✅' : ''}
        </div>
    `).join('');
    
    list.querySelectorAll('.student-search-item').forEach(el => {
        el.onclick = (e) => {
            const nis = el.dataset.nis;
            const student = piketState.allStudents.find(s => s[0].toString() === nis);
            if (!student) return;
            showDayPicker(el, nis, student);
        };
    });
}

function showDayPicker(anchorEl, nis, student) {
    document.querySelectorAll('.day-picker-popup').forEach(p => p.remove());

    const days = [
        { key: 'monday', label: 'Senin' },
        { key: 'tuesday', label: 'Selasa' },
        { key: 'wednesday', label: 'Rabu' },
        { key: 'thursday', label: 'Kamis' },
        { key: 'friday', label: 'Jumat' },
    ];
    const assignedDay = findAssignedDay(nis);

    const popup = document.createElement('div');
    popup.className = 'day-picker-popup';
    popup.innerHTML = `
        ${days.map(d => `
            <button type="button" class="day-picker-btn ${assignedDay === d.key ? 'active' : ''}" data-key="${d.key}">
                ${d.label}
            </button>
        `).join('')}
        ${assignedDay ? `<button type="button" class="day-picker-btn remove" data-key="remove">✕ Hapus</button>` : ''}
    `;

    // Position relative to viewport, append to body so it's never clipped
    const rect = anchorEl.getBoundingClientRect();
    popup.style.position = 'fixed';
    popup.style.top = `${rect.bottom + 4}px`;
    popup.style.left = `${rect.left}px`;
    popup.style.zIndex = '9999';

    popup.querySelectorAll('.day-picker-btn').forEach(btn => {
        btn.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const key = btn.dataset.key;
            ['monday','tuesday','wednesday','thursday','friday'].forEach(d => {
                piketState[d] = piketState[d].filter(s => s[0].toString() !== nis);
            });
            if (key !== 'remove') {
                piketState[key].push(student);
            }
            popup.remove();
            renderPiketBuilderStudents();
            updatePiketSelectedDisplay();
            document.getElementById('piket-save-btn').style.display = 'none';
        });
    });

    document.body.appendChild(popup);

    setTimeout(() => {
        document.addEventListener('click', function closePopup(ev) {
            if (!popup.contains(ev.target) && ev.target !== anchorEl) {
                popup.remove();
                document.removeEventListener('click', closePopup);
            }
        });
    }, 0);
}

function findAssignedDay(nis) {
    if (piketState.monday.some(s => s[0].toString() === nis)) return 'monday';
    if (piketState.tuesday.some(s => s[0].toString() === nis)) return 'tuesday';
    if (piketState.wednesday.some(s => s[0].toString() === nis)) return 'wednesday';
    if (piketState.thursday.some(s => s[0].toString() === nis)) return 'thursday';
    if (piketState.friday.some(s => s[0].toString() === nis)) return 'friday';
    return null;
}

function removeFromDay(nis, day) {
    piketState[day] = piketState[day].filter(s => s[0].toString() !== nis);
}

// Day button handlers
document.querySelectorAll('.piket-day-btn').forEach(btn => {
    btn.onclick = () => {
        const day = btn.dataset.day;
        const targetDay = btn.dataset.target;
        const nis = btn.dataset.nis;
        const student = piketState.allStudents.find(s => s[0].toString() === nis);
        if (!student) return;
        
        // Remove from all days first
        ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].forEach(d => {
            piketState[d] = piketState[d].filter(s => s[0].toString() !== nis);
        });
        
        // Add to selected day
        const dayMap = { 'Senin': 'monday', 'Selasa': 'tuesday', 'Rabu': 'wednesday', 'Kamis': 'thursday', 'Jumat': 'friday' };
        const key = dayMap[day];
        if (key) {
            piketState[key].push(student);
        }
        
        renderPiketBuilderStudents();
        updatePiketSelectedDisplay();
        document.getElementById('piket-save-btn').style.display = 'none';
    };
});

// Move student to a specific day via right-click context (simplified - click to cycle)
function cycleStudentDay(nis) {
    const student = piketState.allStudents.find(s => s[0].toString() === nis);
    if (!student) return;
    
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
    const currentDay = findAssignedDay(nis);
    let nextIndex = 0;
    if (currentDay) {
        const idx = days.indexOf(currentDay);
        nextIndex = (idx + 1) % days.length;
    }
    // Remove from all days
    days.forEach(d => {
        piketState[d] = piketState[d].filter(s => s[0].toString() !== nis);
    });
    // Add to next day
    piketState[days[nextIndex]].push(student);
    
    renderPiketBuilderStudents();
    updatePiketSelectedDisplay();
    document.getElementById('piket-save-btn').style.display = 'none';
}

// Generate full week JSON
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
    document.getElementById('piket-status').textContent = '✅ Full week JSON generated';
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
        const result = await apiCall('saveConfig', { key, value: JSON.stringify(schedule) });
        if (result.success) {
            document.getElementById('piket-status').textContent = '✅ Full week schedule saved!';
            document.getElementById('piket-status').className = 'status-msg success';
            document.getElementById('piket-save-btn').style.display = 'none';
            // Refresh the main view
            await loadStudents(els.classSelector.value, els.dateSelector.value);
        } else {
            document.getElementById('piket-status').textContent = '❌ Failed to save';
            document.getElementById('piket-status').className = 'status-msg error';
        }
    } catch (error) {
        document.getElementById('piket-status').textContent = '❌ Error saving';
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
    document.getElementById('piketBuilderDialog').close();
};

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
    });
    
    els.whatsappBtn.addEventListener('click', copyWhatsAppReport);
    els.historyLoadBtn.addEventListener('click', loadHistory);
    els.uploadCsvBtn.addEventListener('click', uploadCSV);
    els.clearCacheBtn.addEventListener('click', () => {
        if (confirm('Hapus semua data cache lokal?')) {
            localStorage.clear();
            alert('Cache dibersihkan!');
            location.reload();
        }
    });
    
    // Admin tab - load piket builder
    document.querySelector('[data-tab="admin"]').addEventListener('click', () => {
        // Pre-fill class selector if classes are loaded
        setTimeout(() => {
            const piketSelector = document.getElementById('piket-class-selector');
            if (piketSelector && piketSelector.options.length <= 1) {
                loadClasses().then(classes => {
                    if (classes.length) {
                        piketSelector.innerHTML = '<option value="">-- Select Class --</option>';
                        classes.forEach(cls => {
                            const opt = document.createElement('option');
                            opt.value = cls;
                            opt.textContent = cls;
                            piketSelector.appendChild(opt);
                        });
                    }
                });
            }
        }, 100);
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
    
    await loadClasses();
    setupEventListeners();
    registerSW();
    updateOnlineStatus();
    processPendingActions();
    
    // Auto-load first class if available
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

// Make functions global for onclick
window.markAttendance = markAttendance;
window.togglePiket = togglePiket;
window.uploadPiketPhoto = uploadPiketPhoto;
window.openPiketBuilderDialog = openPiketBuilderDialog;