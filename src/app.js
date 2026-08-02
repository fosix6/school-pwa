// ===== CONFIGURATION =====
// ⚠️ REPLACE WITH YOUR APPS SCRIPT URL OR USE {{APPS_SCRIPT_URL}} FOR BUILD
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
    view: { screen: 'home', instanceId: null, tab: 'attendance' },
    templates: [],
    instances: [],
};

// ===== STORAGE KEYS =====
const STORAGE_KEY = 'school-manager-data-v2';

function loadData() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { templates: [], instances: [] };
        return JSON.parse(raw);
    } catch { return { templates: [], instances: [] }; }
}

function saveData() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ templates: state.templates, instances: state.instances }));
    } catch (e) { console.error('Save error', e); }
}

// ===== UID =====
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

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

function weekdayNameFromISO(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[date.getDay()];
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
        throw error;
    }
}

// ===== LOAD CLASSES =====
async function loadClasses() {
    try {
        const data = await apiCall('getClasses');
        return data.classes || [];
    } catch (error) {
        console.error('Failed to load classes:', error);
        return [];
    }
}

// ===== LOAD STUDENTS =====
async function loadStudents(kelas, date) {
    if (!kelas) return { students: [], attendance: {}, piket: [] };
    try {
        const [studentData, attData, piketData] = await Promise.all([
            apiCall('getStudents', { kelas }),
            apiCall('getAttendance', { date, kelas }),
            apiCall('getPiket', { date, kelas })
        ]);
        return {
            students: studentData.students || [],
            attendance: attData.attendance || {},
            piket: piketData.piket || []
        };
    } catch (error) {
        console.error('Failed to load students:', error);
        return { students: [], attendance: {}, piket: [] };
    }
}

// ===== RENDER ENGINE =====
const app = document.getElementById('app');

function render() {
    if (state.view.screen === 'instance' && state.view.instanceId) {
        renderInstanceDetail(state.view.instanceId);
    } else {
        renderHome();
    }
}

// ===== HOME SCREEN =====
function renderHome() {
    const templatesHtml = state.templates.length
        ? state.templates.map(t => `
            <div class="card" data-action="open-template" data-id="${t.id}">
                <div class="card-title-row">
                    <div>
                        <div class="card-title">${escapeHtml(t.name)}</div>
                        <div class="card-sub">${t.students.length} students</div>
                    </div>
                    <div class="row">
                        <button class="icon" data-action="edit-template" data-id="${t.id}">Edit</button>
                        <button class="icon danger" data-action="delete-template" data-id="${t.id}">Delete</button>
                    </div>
                </div>
            </div>
        `).join('')
        : `<div class="empty-state">No rosters yet. Create one to get started.</div>`;

    const instancesHtml = state.instances.length
        ? state.instances.slice().sort((a, b) => b.date.localeCompare(a.date)).map(inst => {
            const totalTasks = inst.tasks ? inst.tasks.length : 0;
            const doneTasks = inst.tasks ? inst.tasks.filter(t => t.done || t.excused).length : 0;
            const absentCount = inst.attendance ? inst.attendance.filter(a => a.status).length : 0;
            return `
                <div class="card" data-action="open-instance" data-id="${inst.id}">
                    <div class="card-title-row">
                        <div>
                            <div class="card-title">${formatDate(inst.date)} <span class="card-sub">(${inst.weekday})</span></div>
                            <div class="card-sub">${absentCount} absent · ${doneTasks}/${totalTasks} tasks done</div>
                        </div>
                        <button class="icon danger" data-action="delete-instance" data-id="${inst.id}">Delete</button>
                    </div>
                </div>
            `;
        }).join('')
        : `<div class="empty-state">No days yet. Create one from a roster below.</div>`;

    app.innerHTML = `
        <header>
            <h1>🏫 School Manager</h1>
            <div id="connection-status">${state.isOnline ? '● Online' : '● Offline'}</div>
        </header>

        <section>
            <div class="card-title-row" style="margin-bottom:0.75rem;">
                <h2>📅 Days</h2>
                <button class="primary" id="newInstanceBtn" ${state.templates.length === 0 ? 'disabled' : ''}>+ New day</button>
            </div>
            ${instancesHtml}
        </section>

        <section>
            <div class="card-title-row" style="margin-bottom:0.75rem;">
                <h2>📋 Class rosters</h2>
                <button id="newTemplateBtn">+ New roster</button>
            </div>
            ${templatesHtml}
            <button id="piketBuilderBtn" class="primary" style="margin-top:8px;width:100%;">🧹 Piket Schedule Builder</button>
        </section>

        <div id="offline-banner" style="display:${state.isOnline ? 'none' : 'block'};" class="offline-banner">⚠️ Offline - changes will sync when online</div>
        <div id="pending-counter" class="pending-badge" style="display:none;">📤 0 pending</div>
    `;

    // Event listeners
    document.getElementById('newTemplateBtn').onclick = () => openTemplateDialog();
    document.getElementById('newInstanceBtn').onclick = () => openInstantiateDialog();
    document.getElementById('piketBuilderBtn').onclick = () => openPiketBuilderDialog();

    app.querySelectorAll('[data-action="open-template"]').forEach(card => {
        card.onclick = () => { state.view = { screen: 'template', templateId: card.dataset.id }; render(); };
    });
    app.querySelectorAll('[data-action="edit-template"]').forEach(btn => {
        btn.onclick = (e) => { e.stopPropagation(); openTemplateDialog(btn.dataset.id); };
    });
    app.querySelectorAll('[data-action="delete-template"]').forEach(btn => {
        btn.onclick = (e) => { e.stopPropagation(); deleteTemplate(btn.dataset.id); };
    });
    app.querySelectorAll('[data-action="open-instance"]').forEach(card => {
        card.onclick = () => { state.view = { screen: 'instance', instanceId: card.dataset.id, tab: 'attendance' }; render(); };
    });
    app.querySelectorAll('[data-action="delete-instance"]').forEach(btn => {
        btn.onclick = (e) => { e.stopPropagation(); deleteInstance(btn.dataset.id); };
    });
}

// ===== TEMPLATE DIALOG =====
const templateDialog = document.getElementById('templateDialog');
const templateForm = document.getElementById('templateForm');
const templateNameInput = document.getElementById('templateNameInput');
const rosterNamesInput = document.getElementById('rosterNamesInput');
const dayInputsContainer = document.getElementById('dayInputsContainer');
let editingTemplateId = null;

function buildDayInputs(existingDays) {
    const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    dayInputsContainer.innerHTML = DAYS.map(day => `
        <div class="day-block">
            <div class="day-block-title">${day}</div>
            <textarea data-day="${day}" rows="2" placeholder="One name per line">${(existingDays[day] || []).join('\n')}</textarea>
        </div>
    `).join('');
}

function openTemplateDialog(id) {
    editingTemplateId = id || null;
    if (id) {
        const t = state.templates.find(t => t.id === id);
        document.getElementById('templateDialogTitle').textContent = 'Edit roster';
        templateNameInput.value = t.name;
        rosterNamesInput.value = t.students.join('\n');
        buildDayInputs(t.days || {});
    } else {
        document.getElementById('templateDialogTitle').textContent = 'New roster';
        templateNameInput.value = '';
        rosterNamesInput.value = '';
        buildDayInputs({});
    }
    templateDialog.showModal();
}

document.getElementById('templateCancelBtn').onclick = () => templateDialog.close();

templateForm.addEventListener('submit', () => {
    const name = templateNameInput.value.trim();
    const students = rosterNamesInput.value.split('\n').map(s => s.trim()).filter(Boolean);
    if (!name || !students.length) return;

    const days = {};
    dayInputsContainer.querySelectorAll('textarea[data-day]').forEach(ta => {
        const names = ta.value.split('\n').map(s => s.trim()).filter(Boolean);
        days[ta.dataset.day] = names;
    });

    if (editingTemplateId) {
        const t = state.templates.find(t => t.id === editingTemplateId);
        t.name = name;
        t.students = students;
        t.days = days;
    } else {
        state.templates.push({ id: uid(), name, students, days });
    }
    saveData();
    templateDialog.close();
    render();
});

// ===== INSTANTIATE DIALOG =====
const instantiateDialog = document.getElementById('instantiateDialog');
const instantiateForm = document.getElementById('instantiateForm');
const instanceDateInput = document.getElementById('instanceDateInput');
const instanceTemplateSelect = document.getElementById('instanceTemplateSelect');

function openInstantiateDialog() {
    instanceDateInput.value = todayISO();
    instanceTemplateSelect.innerHTML = state.templates
        .map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`)
        .join('');
    instantiateDialog.showModal();
}

document.getElementById('instantiateCancelBtn').onclick = () => instantiateDialog.close();

instantiateForm.addEventListener('submit', async () => {
    const date = instanceDateInput.value;
    const templateId = instanceTemplateSelect.value;
    const template = state.templates.find(t => t.id === templateId);
    if (!date || !template) return;

    const weekday = weekdayNameFromISO(date);
    if (!weekday || weekday === 'Sunday') {
        alert('Selected date is a Sunday — pick Monday–Saturday.');
        return;
    }

    const piketNames = template.days[weekday] || [];
    const attendance = template.students.map(name => ({ id: uid(), name, status: null }));
    const tasks = piketNames.map(name => ({
        id: uid(),
        name: name,
        done: false,
        excused: false,
        photo1: '',
        photo2: ''
    }));

    const newInstance = {
        id: uid(),
        date,
        weekday,
        templateId: template.id,
        attendance,
        tasks,
        proof: { note: '', photos: [] }
    };
    state.instances.push(newInstance);
    saveData();
    state.view = { screen: 'instance', instanceId: newInstance.id, tab: 'attendance' };
    instantiateDialog.close();
    render();
});

// ===== DELETE FUNCTIONS =====
function deleteInstance(id) {
    if (!confirm('Delete this day?')) return;
    state.instances = state.instances.filter(i => i.id !== id);
    saveData();
    render();
}

function deleteTemplate(id) {
    if (!confirm('Delete this roster?')) return;
    state.templates = state.templates.filter(t => t.id !== id);
    saveData();
    render();
}

// ===== INSTANCE DETAIL =====
function renderInstanceDetail(instanceId) {
    const inst = state.instances.find(i => i.id === instanceId);
    if (!inst) { state.view = { screen: 'home' }; return render(); }

    const tab = state.view.tab || 'attendance';

    app.innerHTML = `
        <span class="back-link" id="backBtn">&larr; Back</span>
        <header>
            <h1>${formatDate(inst.date)} <span class="card-sub">(${inst.weekday})</span></h1>
        </header>
        <div class="tab-row">
            <div class="tab-btn ${tab === 'attendance' ? 'active' : ''}" data-tab="attendance">Attendance</div>
            <div class="tab-btn ${tab === 'piket' ? 'active' : ''}" data-tab="piket">Piket</div>
            <div class="tab-btn ${tab === 'proof' ? 'active' : ''}" data-tab="proof">Proof</div>
        </div>
        <div id="tabContent"></div>
    `;

    document.getElementById('backBtn').onclick = () => { state.view = { screen: 'home' }; render(); };
    app.querySelectorAll('.tab-btn').forEach(btn =>
        btn.onclick = () => { state.view.tab = btn.dataset.tab; render(); }
    );

    const tabContent = document.getElementById('tabContent');
    if (tab === 'attendance') renderAttendanceTab(inst, tabContent);
    else if (tab === 'piket') renderPiketTab(inst, tabContent);
    else renderProofTab(inst, tabContent);
}

// ===== ATTENDANCE TAB =====
function renderAttendanceTab(inst, container) {
    const sickCount = inst.attendance.filter(a => a.status === 'sick').length;
    const alphaCount = inst.attendance.filter(a => a.status === 'alpha').length;
    const permissionCount = inst.attendance.filter(a => a.status === 'permission').length;
    const totalAbsent = sickCount + alphaCount + permissionCount;
    const parts = [];
    if (sickCount) parts.push(`${sickCount} sick`);
    if (alphaCount) parts.push(`${alphaCount} alpha`);
    if (permissionCount) parts.push(`${permissionCount} permission`);
    const summary = totalAbsent ? `${totalAbsent} absent (${parts.join(', ')})` : '0 absent';

    const entriesHtml = inst.attendance.map(e => `
        <li class="entry-item ${e.status ? 'crossed' : ''}" data-id="${e.id}">
            <span>${escapeHtml(e.name)}</span>
            <div class="status-btns">
                <button class="status-btn sick ${e.status === 'sick' ? 'active' : ''}" data-action="status" data-id="${e.id}" data-status="sick">Sick</button>
                <button class="status-btn alpha ${e.status === 'alpha' ? 'active' : ''}" data-action="status" data-id="${e.id}" data-status="alpha">Alpha</button>
                <button class="status-btn permission ${e.status === 'permission' ? 'active' : ''}" data-action="status" data-id="${e.id}" data-status="permission">Permission</button>
            </div>
        </li>
    `).join('');

    container.innerHTML = `
        <div class="card-sub" style="margin-bottom:0.75rem;">${summary}</div>
        <ul style="list-style:none; margin:0; padding:0;">${entriesHtml}</ul>
    `;

    container.querySelectorAll('[data-action="status"]').forEach(btn => {
        btn.onclick = () => {
            const entry = inst.attendance.find(e => e.id === btn.dataset.id);
            entry.status = entry.status === btn.dataset.status ? null : btn.dataset.status;
            saveData();
            render();
        };
    });
}

// ===== PIKET TAB =====
function renderPiketTab(inst, container) {
    const totalTasks = inst.tasks.length;
    const resolvedTasks = inst.tasks.filter(t => t.done || t.excused).length;
    const pct = totalTasks ? Math.round((resolvedTasks / totalTasks) * 100) : 0;

    const tasksHtml = inst.tasks.map(t => {
        const done = t.done || false;
        const excused = t.excused || false;
        const hasPhoto1 = t.photo1 && t.photo1.length > 0;
        const hasPhoto2 = t.photo2 && t.photo2.length > 0;
        return `
            <div class="task-card ${done ? 'done' : ''} ${excused ? 'excused' : ''}" data-task-id="${t.id}">
                <div class="task-top-row">
                    <span class="task-label">${escapeHtml(t.name)}</span>
                    <div class="row">
                        <button class="task-done-btn" data-action="toggle-done" data-id="${t.id}" ${excused ? 'disabled' : ''}>${excused ? '—' : (done ? '✓' : '')}</button>
                        <button class="piket-photo-btn ${hasPhoto1 ? 'has-photo' : ''}" data-action="photo" data-id="${t.id}" data-num="1">📷1</button>
                        <button class="piket-photo-btn ${hasPhoto2 ? 'has-photo' : ''}" data-action="photo" data-id="${t.id}" data-num="2">📷2</button>
                    </div>
                </div>
                ${(hasPhoto1 || hasPhoto2) ? `
                    <div class="piket-photos">
                        ${hasPhoto1 ? `<a href="${t.photo1}" target="_blank">📸 Foto 1</a>` : ''}
                        ${hasPhoto2 ? `<a href="${t.photo2}" target="_blank">📸 Foto 2</a>` : ''}
                    </div>
                ` : ''}
                ${excused ? `<div class="excused-tag">Excused — marked absent today</div>` : ''}
            </div>
        `;
    }).join('');

    container.innerHTML = `
        <div class="card-sub">${resolvedTasks}/${totalTasks} tasks resolved</div>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        ${tasksHtml}
    `;

    container.querySelectorAll('[data-action="toggle-done"]').forEach(btn => {
        btn.onclick = () => {
            const task = inst.tasks.find(t => t.id === btn.dataset.id);
            if (!task || task.excused) return;
            task.done = !task.done;
            saveData();
            render();
        };
    });

    container.querySelectorAll('[data-action="photo"]').forEach(btn => {
        btn.onclick = () => uploadTaskPhoto(inst.id, btn.dataset.id, parseInt(btn.dataset.num));
    });
}

// ===== UPLOAD TASK PHOTO =====
function uploadTaskPhoto(instanceId, taskId, photoNum) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (event) => {
            const base64 = event.target.result;
            const inst = state.instances.find(i => i.id === instanceId);
            const task = inst.tasks.find(t => t.id === taskId);
            if (photoNum === 1) task.photo1 = base64;
            else task.photo2 = base64;
            saveData();
            render();
        };
        reader.readAsDataURL(file);
    };
    input.click();
}

// ===== PROOF TAB =====
function renderProofTab(inst, container) {
    const hasProof = inst.proof && (inst.proof.note || (inst.proof.photos && inst.proof.photos.length));
    const proofPhotosHtml = (inst.proof.photos || []).map(p => `<img src="${p}" alt="proof photo" />`).join('');

    container.innerHTML = `
        <div class="proof-section">
            <div class="card-title-row" style="margin-bottom:0.5rem;">
                <h3 style="margin:0;">Proof of work</h3>
                <button class="icon" id="editProofBtn">${hasProof ? 'Edit' : 'Add'}</button>
            </div>
            ${hasProof ? `
                ${inst.proof.note ? `<div class="proof-note">${escapeHtml(inst.proof.note)}</div>` : ''}
                ${inst.proof.photos && inst.proof.photos.length ? `<div class="proof-photos">${proofPhotosHtml}</div>` : ''}
            ` : `<div class="card-sub">No proof attached yet.</div>`}
        </div>
    `;
    document.getElementById('editProofBtn').onclick = () => openProofDialog(inst.id);
}

// ===== PROOF DIALOG =====
const proofDialog = document.getElementById('proofDialog');
const proofForm = document.getElementById('proofForm');
const proofNoteInput = document.getElementById('proofNoteInput');
const proofPhotoInput = document.getElementById('proofPhotoInput');
const proofPhotoPreview = document.getElementById('proofPhotoPreview');
let editingProofInstanceId = null;
let pendingPhotos = [];

function openProofDialog(instanceId) {
    editingProofInstanceId = instanceId;
    const inst = state.instances.find(i => i.id === instanceId);
    proofNoteInput.value = inst.proof.note || '';
    pendingPhotos = (inst.proof.photos || []).slice();
    renderProofPreview();
    proofPhotoInput.value = '';
    proofDialog.showModal();
}

function renderProofPreview() {
    proofPhotoPreview.innerHTML = pendingPhotos.map((src, idx) => `
        <div class="photo-thumb-wrap">
            <img src="${src}" alt="photo" />
            <button type="button" class="photo-remove-btn" data-idx="${idx}">&times;</button>
        </div>
    `).join('');
    proofPhotoPreview.querySelectorAll('.photo-remove-btn').forEach(btn =>
        btn.onclick = () => {
            pendingPhotos.splice(Number(btn.dataset.idx), 1);
            renderProofPreview();
        }
    );
}

proofPhotoInput.addEventListener('change', async () => {
    const files = Array.from(proofPhotoInput.files || []);
    for (const file of files) {
        const dataUrl = await fileToResizedDataUrl(file);
        pendingPhotos.push(dataUrl);
    }
    proofPhotoInput.value = '';
    renderProofPreview();
});

function fileToResizedDataUrl(file, maxDim = 1000, quality = 0.75) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = reject;
        reader.onload = () => {
            const img = new Image();
            img.onerror = reject;
            img.onload = () => {
                let { width, height } = img;
                if (width > maxDim || height > maxDim) {
                    const scale = maxDim / Math.max(width, height);
                    width = Math.round(width * scale);
                    height = Math.round(height * scale);
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

document.getElementById('proofCancelBtn').onclick = () => proofDialog.close();

proofForm.addEventListener('submit', () => {
    const inst = state.instances.find(i => i.id === editingProofInstanceId);
    inst.proof = { note: proofNoteInput.value.trim(), photos: pendingPhotos.slice() };
    saveData();
    proofDialog.close();
    render();
});

// ===== PIKET BUILDER DIALOG =====
const piketBuilderDialog = document.getElementById('piketBuilderDialog');
const piketBuilderForm = document.getElementById('piketBuilderForm');
let piketBuilderState = { kelas: '', day: 'Monday', allStudents: [], selectedStudents: [] };

async function openPiketBuilderDialog() {
    const classes = await loadClasses();
    const selector = document.getElementById('piket-class-selector');
    selector.innerHTML = '<option value="">-- Select --</option>';
    classes.forEach(cls => {
        const opt = document.createElement('option');
        opt.value = cls;
        opt.textContent = cls;
        selector.appendChild(opt);
    });
    piketBuilderState.selectedStudents = [];
    document.getElementById('piket-day-label').textContent = 'Senin';
    document.getElementById('piket-json-output').style.display = 'none';
    document.getElementById('piket-save-btn').style.display = 'none';
    document.getElementById('piket-status').textContent = '';
    document.getElementById('piket-status').className = '';
    document.getElementById('piket-student-list').innerHTML = '<p class="empty-state">Pilih kelas terlebih dahulu</p>';
    document.getElementById('piket-selected-students').innerHTML = '<p class="empty-state">Belum ada siswa terpilih</p>';
    piketBuilderDialog.showModal();
}

document.getElementById('piket-close-btn').onclick = () => piketBuilderDialog.close();

document.getElementById('piket-class-selector').addEventListener('change', async () => {
    const kelas = document.getElementById('piket-class-selector').value;
    piketBuilderState.kelas = kelas;
    if (!kelas) {
        document.getElementById('piket-student-list').innerHTML = '<p class="empty-state">Pilih kelas terlebih dahulu</p>';
        return;
    }
    try {
        const data = await apiCall('getStudents', { kelas });
        piketBuilderState.allStudents = data.students || [];
        piketBuilderState.selectedStudents = [];
        renderPiketBuilderStudents();
        renderPiketBuilderSelected();
    } catch (error) {
        document.getElementById('piket-student-list').innerHTML = '<p class="empty-state">❌ Gagal memuat siswa</p>';
    }
});

document.getElementById('piket-day-selector').addEventListener('change', () => {
    piketBuilderState.day = document.getElementById('piket-day-selector').value;
    document.getElementById('piket-day-label').textContent = getDayIndonesian(piketBuilderState.day);
    document.getElementById('piket-json-output').style.display = 'none';
    document.getElementById('piket-save-btn').style.display = 'none';
});

document.getElementById('piket-student-search').addEventListener('input', renderPiketBuilderStudents);

function renderPiketBuilderStudents() {
    const search = document.getElementById('piket-student-search').value.toLowerCase().trim();
    let filtered = piketBuilderState.allStudents;
    if (search) {
        filtered = filtered.filter(s => s[1].toLowerCase().includes(search) || s[0].toString().includes(search));
    }
    const selectedNIS = new Set(piketBuilderState.selectedStudents.map(s => s[0].toString()));
    const list = document.getElementById('piket-student-list');
    if (!filtered.length) {
        list.innerHTML = '<p class="empty-state">Tidak ada siswa yang cocok</p>';
        return;
    }
    list.innerHTML = filtered.map(s => `
        <div class="student-search-item ${selectedNIS.has(s[0].toString()) ? 'selected' : ''}" data-nis="${s[0]}">
            <span class="student-name">${escapeHtml(s[1])}</span>
            <span class="student-nis">${s[0]}</span>
        </div>
    `).join('');
    list.querySelectorAll('.student-search-item').forEach(el => {
        el.onclick = () => togglePiketBuilderStudent(el.dataset.nis);
    });
}

function togglePiketBuilderStudent(nis) {
    const student = piketBuilderState.allStudents.find(s => s[0].toString() === nis);
    if (!student) return;
    const index = piketBuilderState.selectedStudents.findIndex(s => s[0].toString() === nis);
    if (index >= 0) piketBuilderState.selectedStudents.splice(index, 1);
    else piketBuilderState.selectedStudents.push(student);
    renderPiketBuilderStudents();
    renderPiketBuilderSelected();
    document.getElementById('piket-json-output').style.display = 'none';
    document.getElementById('piket-save-btn').style.display = 'none';
}

function renderPiketBuilderSelected() {
    const container = document.getElementById('piket-selected-students');
    if (!piketBuilderState.selectedStudents.length) {
        container.innerHTML = '<p class="empty-state">Belum ada siswa terpilih</p>';
        return;
    }
    container.innerHTML = piketBuilderState.selectedStudents.map(s => `
        <span class="selected-student-tag" data-nis="${s[0]}">${escapeHtml(s[1])}</span>
    `).join('');
    container.querySelectorAll('.selected-student-tag').forEach(el => {
        el.onclick = () => togglePiketBuilderStudent(el.dataset.nis);
    });
}

document.getElementById('piket-generate-btn').onclick = () => {
    const kelas = document.getElementById('piket-class-selector').value;
    const day = document.getElementById('piket-day-selector').value;
    if (!kelas || !piketBuilderState.selectedStudents.length) {
        const status = document.getElementById('piket-status');
        status.textContent = '⚠️ Pilih kelas dan minimal 1 siswa';
        status.className = 'status-msg error';
        return;
    }
    const nisList = piketBuilderState.selectedStudents.map(s => s[0]).join(',');
    const schedule = { Monday: '', Tuesday: '', Wednesday: '', Thursday: '', Friday: '' };
    schedule[day] = nisList;
    const json = JSON.stringify(schedule, null, 2);
    document.getElementById('piket-json-preview').textContent = json;
    document.getElementById('piket-json-output').style.display = 'block';
    document.getElementById('piket-save-btn').style.display = 'inline-block';
    document.getElementById('piket-status').textContent = '✅ JSON generated';
    document.getElementById('piket-status').className = 'status-msg success';
    piketBuilderState.currentSchedule = { key: `piket_schedule_${kelas.replace(' ', '_')}`, schedule, day, nisList };
};

document.getElementById('piket-save-btn').onclick = async () => {
    if (!piketBuilderState.currentSchedule) {
        document.getElementById('piket-status').textContent = '⚠️ Generate JSON first';
        document.getElementById('piket-status').className = 'status-msg error';
        return;
    }
    const { key, day, nisList } = piketBuilderState.currentSchedule;
    try {
        const existing = await apiCall('getConfig', { key });
        let existingSchedule = {};
        if (existing && existing.value) {
            try { existingSchedule = JSON.parse(existing.value); } catch (e) {}
        }
        existingSchedule[day] = nisList;
        const result = await apiCall('saveConfig', { key, value: JSON.stringify(existingSchedule) });
        if (result.success) {
            document.getElementById('piket-status').textContent = '✅ Schedule saved!';
            document.getElementById('piket-status').className = 'status-msg success';
            document.getElementById('piket-save-btn').style.display = 'none';
            document.getElementById('piket-json-preview').textContent = JSON.stringify(existingSchedule, null, 2);
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
    piketBuilderState.selectedStudents = [];
    piketBuilderState.currentSchedule = null;
    renderPiketBuilderStudents();
    renderPiketBuilderSelected();
    document.getElementById('piket-json-output').style.display = 'none';
    document.getElementById('piket-save-btn').style.display = 'none';
    document.getElementById('piket-status').textContent = '';
    document.getElementById('piket-status').className = '';
};

// ===== INIT =====
const saved = loadData();
state.templates = saved.templates || [];
state.instances = saved.instances || [];
render();

// ===== SERVICE WORKER =====
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    });
}