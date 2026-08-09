// ===== CONFIGURATION =====
const API_URL = '{{APPS_SCRIPT_URL}}';

const CONFIG = {
    API_URL: API_URL,
    CACHE_DURATION: 60000,
    BATCH_DELAY: 300,
    MAX_CACHE_ITEMS: 10,
};

// ===== STATE =====
let state = {
    currentClass: '',
    currentDate: new Date().toISOString().split('T')[0],
    students: [],
    attendance: {},
    piket: [],
    lateness: [],
    pendingActions: [],
    isOnline: navigator.onLine,
    currentTab: 'today',
    pendingUpdates: [],
    updateTimeout: null,
    faceModelsLoaded: false,
    faceDescriptors: {}, // cache: { nis: { name, descriptor } }
};

// ===== DOM REFS =====
const $ = (id) => document.getElementById(id);
const els = {
    studentSearch: $('student-search'),
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
    statTerlambat: $('stat-terlambat'),
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
    latenessSection: $('lateness-section'),
    latenessList: $('lateness-list'),
    markLateBtn: $('mark-late-btn'),
    lateStudentSelect: $('late-student-select'),
    latenessCount: $('lateness-count'),
    faceStatus: $('face-status'),
    faceDate: $('face-date'),
    faceScanBtn: $('face-scan-btn'),
    faceStatusMsg: $('face-status-msg'),
    faceRegisterNis: $('face-register-nis'),
    faceRegisterBtn: $('face-register-btn'),
    faceRegisterMsg: $('face-register-msg'),
    cameraContainer: $('camera-container'),
    cameraPreview: $('camera-preview'),
    faceOverlay: $('face-overlay'),
    capturePhotoBtn: $('capture-photo-btn'),
    closeCameraBtn: $('close-camera-btn'),
    modelStatus: $('model-status'),
};

// ===== API CACHE =====
const apiCache = new Map();
const studentListCache = new Map();

// ========================================
// FACE RECOGNITION - face-api.js
// ========================================

let cameraStream = null;
let isCameraOpen = false;
let detectionInterval = null;

// Face detection threshold
const FACE_MATCH_THRESHOLD = 0.55;

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
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : str;
    return div.innerHTML;
}

// ===== API CALL =====
async function apiCall(action, params = {}, showLoadingToast = true, method = 'GET') {
    const actionLabels = {
        'getFullClassData': 'Memuat data kelas',
        'batchMarkAttendance': 'Menyimpan absensi',
        'getClasses': 'Memuat daftar kelas',
        'getPiket': 'Memuat jadwal piket',
        'togglePiket': 'Mengupdate piket',
        'uploadPiketPhoto': 'Mengupload foto',
        'getHistory': 'Memuat history',
        'uploadCSV': 'Mengupload CSV',
        'saveConfig': 'Menyimpan konfigurasi',
        'getStudents': 'Memuat data siswa',
        'registerFace': 'Mendaftar wajah',
        'getFaceData': 'Memuat data wajah',
        'markFaceAttendance': 'Absen dengan wajah',
    };
    
    const label = actionLabels[action] || `Menjalankan ${action}`;
    
    const cacheKey = `${action}_${JSON.stringify(params)}`;
    if (method === 'GET' && apiCache.has(cacheKey)) {
        const cached = apiCache.get(cacheKey);
        if (Date.now() - cached.timestamp < CONFIG.CACHE_DURATION) {
            return cached.data;
        }
    }

    if (showLoadingToast) showToast(label, 'Menghubungi server...', 10);

    try {
        if (showLoadingToast) updateToast(label, 'Mengirim request...', 30);
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

        if (showLoadingToast) updateToast(label, 'Menerima response...', 70);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        
        if (method === 'GET') {
            apiCache.set(cacheKey, {
                data: data,
                timestamp: Date.now()
            });
            
            if (apiCache.size > 50) {
                const firstKey = apiCache.keys().next().value;
                apiCache.delete(firstKey);
            }
        }
        
        if (showLoadingToast) {
            updateToast(label, 'Selesai!', 100);
            setTimeout(() => hideToastDelayed(300), 200);
        }
        return data;
    } catch (error) {
        console.error('API Error:', error);
        if (showLoadingToast) {
            showToast(`Gagal: ${label}`, error.message || 'Unknown error', null, true);
            setTimeout(() => hideToastDelayed(2000), 1500);
        }
        throw error;
    }
}

// ========================================
// FACE RECOGNITION - MAIN FUNCTIONS
// ========================================

// Load face-api.js models
async function loadFaceModels() {
    const modelStatus = els.modelStatus;
    modelStatus.style.display = 'block';
    modelStatus.className = 'status-msg';
    modelStatus.textContent = 'Memuat model face recognition...';
    
    try {
        const MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/models';
        
        await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
        await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
        await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
        
        state.faceModelsLoaded = true;
        
        modelStatus.className = 'status-msg success';
        modelStatus.textContent = 'Model face recognition siap!';
        
        els.faceScanBtn.disabled = false;
        els.faceScanBtn.innerHTML = '<span class="camera-icon"></span> Buka Kamera';
        els.faceRegisterBtn.disabled = false;
        
        setTimeout(() => {
            modelStatus.style.display = 'none';
        }, 2000);
        
        await loadFaceDescriptors();
        
    } catch (error) {
        console.error('Failed to load face models:', error);
        modelStatus.className = 'status-msg error';
        modelStatus.textContent = 'Gagal memuat model: ' + error.message;
    }
}

// Load face descriptors from Google Sheets
async function loadFaceDescriptors() {
    try {
        const data = await apiCall('getFaceData', {}, false);
        if (data && data.descriptors) {
            state.faceDescriptors = {};
            data.descriptors.forEach(item => {
                // Name comes from the server (fetched from Students sheet)
                state.faceDescriptors[item.nis] = {
                    name: item.name,
                    descriptor: new Float32Array(item.descriptor)
                };
            });
            console.log('Loaded', Object.keys(state.faceDescriptors).length, 'face descriptors');
        }
    } catch (error) {
        console.warn('️ Failed to load face descriptors:', error);
        state.faceDescriptors = {};
    }
}

// Open camera
async function openCamera() {
    if (isCameraOpen) {
        closeCamera();
        return;
    }
    
    if (!state.faceModelsLoaded) {
        const statusEl = els.faceStatusMsg;
        statusEl.style.display = 'block';
        statusEl.className = 'status-msg error';
        statusEl.textContent = 'Model face recognition belum siap. Tunggu sebentar...';
        return;
    }
    
    try {
        const statusEl = els.faceStatusMsg;
        statusEl.style.display = 'block';
        statusEl.className = 'status-msg';
        statusEl.textContent = 'Membuka kamera...';
        
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'user',
                width: { ideal: 640 },
                height: { ideal: 480 }
            },
            audio: false
        });
        
        els.cameraPreview.srcObject = cameraStream;
        await els.cameraPreview.play();
        
        // Set canvas size
        const video = els.cameraPreview;
        els.faceOverlay.width = video.videoWidth || 640;
        els.faceOverlay.height = video.videoHeight || 480;
        
        els.cameraContainer.style.display = 'block';
        isCameraOpen = true;
        
        els.faceScanBtn.innerHTML = '<span class="camera-icon"></span> Tutup Kamera';
        els.faceScanBtn.style.background = '#b13e3e';
        
        statusEl.style.display = 'none';
        
        startFaceDetection();
        
        // Auto-capture after 2 seconds
        setTimeout(() => {
            if (isCameraOpen) {
                capturePhoto();
            }
        }, 2000);
        
    } catch (error) {
        console.error('Camera error:', error);
        const statusEl = els.faceStatusMsg;
        statusEl.style.display = 'block';
        statusEl.className = 'status-msg error';
        statusEl.textContent = 'Gagal membuka kamera: ' + (error.message || 'Izin kamera ditolak');
    }
}

// Start face detection for preview
function startFaceDetection() {
    if (detectionInterval) {
        clearInterval(detectionInterval);
    }
    
    detectionInterval = setInterval(async () => {
        if (!isCameraOpen || !els.cameraPreview.srcObject) {
            return;
        }
        
        try {
            const detection = await faceapi.detectSingleFace(
                els.cameraPreview,
                new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 })
            );
            
            const canvas = els.faceOverlay;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            if (detection) {
                const box = detection.box;
                ctx.strokeStyle = '#00ff00';
                ctx.lineWidth = 3;
                ctx.strokeRect(box.x, box.y, box.width, box.height);
                
                ctx.fillStyle = '#00ff00';
                ctx.font = '16px Arial';
                ctx.fillText('Wajah terdeteksi', box.x, box.y - 10);
            } else {
                ctx.fillStyle = '#ff0000';
                ctx.font = '20px Arial';
                ctx.fillText('Tidak ada wajah', 20, 50);
            }
        } catch (e) {
            // Ignore
        }
    }, 200);
}

// Close camera
function closeCamera() {
    if (detectionInterval) {
        clearInterval(detectionInterval);
        detectionInterval = null;
    }
    
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
    
    els.cameraContainer.style.display = 'none';
    isCameraOpen = false;
    
    els.faceScanBtn.innerHTML = '<span class="camera-icon">span> Buka Kamera';
    els.faceScanBtn.style.background = '';
    
    const canvas = els.faceOverlay;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// Capture photo and recognize face
async function capturePhoto() {
    if (!isCameraOpen || !els.cameraPreview.srcObject) {
        const statusEl = els.faceStatusMsg;
        statusEl.style.display = 'block';
        statusEl.className = 'status-msg error';
        statusEl.textContent = 'Kamera tidak terbuka';
        return;
    }
    
    if (!state.faceModelsLoaded) {
        const statusEl = els.faceStatusMsg;
        statusEl.style.display = 'block';
        statusEl.className = 'status-msg error';
        statusEl.textContent = 'Model belum siap';
        return;
    }
    
    try {
        const statusEl = els.faceStatusMsg;
        statusEl.style.display = 'block';
        statusEl.className = 'status-msg';
        statusEl.textContent = 'Memproses wajah...';
        
        const canvas = document.createElement('canvas');
        const video = els.cameraPreview;
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        const photoData = canvas.toDataURL('image/jpeg', 0.9);
        
        const detection = await faceapi.detectSingleFace(
            canvas,
            new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 })
        );
        
        if (!detection) {
            statusEl.className = 'status-msg error';
            statusEl.textContent = 'Tidak ada wajah terdeteksi. Coba lagi dengan posisi yang lebih jelas.';
            return;
        }
        
        const descriptor = await faceapi.computeFaceDescriptor(canvas, detection);
        
        await processFaceWithDescriptor(photoData, descriptor, detection);
        
    } catch (error) {
        console.error('Capture error:', error);
        const statusEl = els.faceStatusMsg;
        statusEl.className = 'status-msg error';
        statusEl.textContent = 'Gagal memproses: ' + error.message;
    }
}
// ========================================
// CORE FACE PROCESSING - COMPLETELY DECOUPLED FROM CLASS
// ========================================

async function processFaceWithDescriptor(photoData, descriptor, detection) {
    const statusEl = els.faceStatusMsg;
    
    try {
        const status = els.faceStatus.value;
        const date = els.faceDate.value || new Date().toISOString().split('T')[0];
        const kelas = els.classSelector.value; // ONLY used for marking attendance, NOT for filtering students
        
        if (!date) {
            statusEl.className = 'status-msg error';
            statusEl.textContent = 'Silakan pilih tanggal';
            return;
        }
        
        statusEl.textContent = 'Memuat semua siswa dari database...';
        
        // ===== STEP 1: Get ALL students (NO CLASS FILTER) =====
        let allStudents = [];
        try {
            const data = await apiCall('getAllStudents', {}, false);
            allStudents = data.students || [];
            console.log('Loaded ALL students:', allStudents.length);
        } catch (error) {
            console.error('Failed to load all students:', error);
            statusEl.className = 'status-msg error';
            statusEl.textContent = 'Gagal memuat data siswa. Periksa koneksi.';
            return;
        }
        
        if (!allStudents || allStudents.length === 0) {
            statusEl.className = 'status-msg error';
            statusEl.textContent = 'Tidak ada siswa di database. Import CSV dulu.';
            return;
        }
        
        // ===== STEP 2: Compare with stored face descriptors =====
        statusEl.textContent = 'Membandingkan dengan database wajah...';
        
        const results = [];
        for (const [nis, data] of Object.entries(state.faceDescriptors)) {
            // Check if this NIS exists in allStudents (should always be true)
            const student = allStudents.find(s => s[0].toString() === nis);
            if (!student) continue;
            
            const distance = faceapi.euclideanDistance(descriptor, data.descriptor);
            const similarity = Math.max(0, 1 - distance);
            
            results.push({
                nis: nis,
                name: data.name || student[1],
                distance: distance,
                similarity: similarity
            });
        }
        
        results.sort((a, b) => b.similarity - a.similarity);
        
        // ===== STEP 3: Check if we have a match =====
        if (results.length > 0 && results[0].similarity > FACE_MATCH_THRESHOLD) {
            const match = results[0];
            console.log('Face match:', match.name, 'similarity:', match.similarity);
            
            const confirmed = await showFaceConfirmationDialog(photoData, match.name, match.nis, match.similarity);
            
            if (confirmed) {
                statusEl.textContent = 'Merekam absen...';
                
                const result = await apiCall('markFaceAttendance', {
                    nis: match.nis,
                    date: date,
                    status: status,
                    kelas: kelas || ''
                }, false, 'POST');
                
                if (result.success) {
                    statusEl.className = 'status-msg success';
                    const statusLabel = status === 'hadir' ? 'Hadir' : 'Terlambat';
                    statusEl.textContent = `${statusLabel} untuk ${result.student.name}`;
                    
                    // Refresh the class view if a class is selected
                    if (kelas) {
                        await loadStudents(kelas, date);
                    }
                    
                    showToast('Absen berhasil', `${result.student.name} - ${statusLabel}`, null, false);
                    setTimeout(() => hideToastDelayed(2000), 500);
                } else {
                    statusEl.className = 'status-msg error';
                    statusEl.textContent = `Gagal absen: ${result.error || 'Unknown error'}`;
                }
            } else {
                statusEl.className = 'status-msg';
                statusEl.textContent = ' Dibatalkan';
            }
        } else {
            // ===== NO MATCH - Ask to register =====
            statusEl.className = 'status-msg';
            statusEl.textContent = 'Wajah tidak dikenali. Apakah Anda ingin mendaftar?';
            
            const shouldRegister = await showRegistrationPrompt(photoData);
            
            if (shouldRegister) {
                // Use ALL students (already loaded)
                statusEl.textContent = `Pilih nama Anda dari ${allStudents.length} siswa...`;
                const selectedNis = await showStudentSelectionDialog(allStudents);
                
                if (selectedNis) {
                    await registerFace(selectedNis, photoData, descriptor, date, status, kelas);
                } else {
                    statusEl.className = 'status-msg';
                    statusEl.textContent = '️ Dibatalkan';
                }
            } else {
                statusEl.className = 'status-msg';
                statusEl.textContent = '️ Dibatalkan';
            }
        }
        
        setTimeout(() => closeCamera(), 1500);
        
    } catch (error) {
        console.error('Face processing error:', error);
        statusEl.className = 'status-msg error';
        statusEl.textContent = `Error: ${error.message || 'Unknown error'}`;
    }
}

// ========================================
// REGISTER FACE - COMPLETELY DECOUPLED FROM CLASS
// ========================================

async function registerFace(nis, photoData, descriptor, date, status, kelas) {
    const statusEl = els.faceStatusMsg;
    
    try {
        statusEl.textContent = 'Mendaftarkan wajah...';
        
        const descriptorArray = Array.from(descriptor);
        
        const result = await apiCall('registerFace', {
            nis: nis,
            descriptor: descriptorArray,
            photoData: photoData
        }, false, 'POST');
        
        if (result.success) {
            // Get ALL students to find name
            const data = await apiCall('getAllStudents', {}, false);
            const allStudents = data.students || [];
            const student = allStudents.find(s => s[0].toString() === nis);
            
            state.faceDescriptors[nis] = {
                name: student ? student[1] : nis,
                descriptor: descriptor
            };
            
            statusEl.className = 'status-msg success';
            statusEl.textContent = `Wajah terdaftar untuk ${student ? student[1] : nis}`;
            
            // Mark attendance
            statusEl.textContent = 'Merekam absen...';
            
            const attResult = await apiCall('markFaceAttendance', {
                nis: nis,
                date: date,
                status: status,
                kelas: kelas || ''
            }, false, 'POST');
            
            if (attResult.success) {
                statusEl.className = 'status-msg success';
                const statusLabel = status === 'hadir' ? 'Hadir' : 'Terlambat';
                statusEl.textContent = `${statusLabel} untuk ${attResult.student.name}`;
                
                if (kelas) {
                    await loadStudents(kelas, date);
                }
                
                showToast('Absen berhasil', `${attResult.student.name} - ${statusLabel}`, null, false);
                setTimeout(() => hideToastDelayed(2000), 500);
            } else {
                statusEl.className = 'status-msg error';
                statusEl.textContent = `Gagal absen: ${attResult.error || 'Unknown error'}`;
            }
        } else {
            statusEl.className = 'status-msg error';
            statusEl.textContent = `Gagal mendaftar: ${result.error || 'Unknown error'}`;
            console.error('Register failed:', result);
        }
    } catch (error) {
        console.error('Register error:', error);
        statusEl.className = 'status-msg error';
        statusEl.textContent = `Error: ${error.message || 'Unknown error'}`;
    }
}

// ========================================
// SHOW REGISTRATION PROMPT - FIXED
// ========================================

function showRegistrationPrompt(photoData) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.7);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000001;
            padding: 20px;
        `;
        
        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: white;
            border-radius: 16px;
            padding: 28px 24px;
            max-width: 400px;
            width: 100%;
            text-align: center;
            box-shadow: 0 8px 40px rgba(0,0,0,0.4);
        `;
        
        dialog.innerHTML = `
            <h3 style="margin:0 0 4px 0;font-size:20px;">Wajah Tidak Dikenali</h3>
            <p style="margin:0 0 16px 0;color:#666;font-size:14px;">Apakah Anda ingin mendaftarkan wajah ini?</p>
            <div style="background:#f5f5f5;border-radius:12px;overflow:hidden;margin-bottom:20px;">
                <img src="${photoData}" style="width:100%;max-height:150px;object-fit:cover;display:block;" />
            </div>
            <div style="display:flex;gap:10px;">
                <button id="reg-prompt-cancel" style="
                    flex:1;
                    padding:14px;
                    border:2px solid #ddd;
                    border-radius:10px;
                    background:transparent;
                    cursor:pointer;
                    font-weight:600;
                    font-size:15px;
                    color:#666;
                    transition:background 0.15s;
                ">✕ Batal</button>
                <button id="reg-prompt-register" style="
                    flex:1;
                    padding:14px;
                    border:none;
                    border-radius:10px;
                    background:#1a6bb0;
                    color:white;
                    cursor:pointer;
                    font-weight:600;
                    font-size:15px;
                    transition:background 0.15s;
                ">Daftar</button>
            </div>
        `;
        
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        
        const cancelBtn = dialog.querySelector('#reg-prompt-cancel');
        const registerBtn = dialog.querySelector('#reg-prompt-register');
        
        cancelBtn.addEventListener('mouseenter', () => cancelBtn.style.background = '#f5f5f5');
        cancelBtn.addEventListener('mouseleave', () => cancelBtn.style.background = 'transparent');
        registerBtn.addEventListener('mouseenter', () => registerBtn.style.background = '#155a96');
        registerBtn.addEventListener('mouseleave', () => registerBtn.style.background = '#1a6bb0');
        
        cancelBtn.addEventListener('click', () => {
            document.body.removeChild(overlay);
            resolve(false);
        });
        
        registerBtn.addEventListener('click', () => {
            document.body.removeChild(overlay);
            resolve(true);
        });
        
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
                resolve(false);
            }
        });
    });
}

// ========================================
// SHOW STUDENT SELECTION - USES ALL STUDENTS
// ========================================

function showStudentSelectionDialog(students) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.7);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000001;
            padding: 20px;
        `;
        
        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: white;
            border-radius: 16px;
            padding: 24px;
            max-width: 400px;
            width: 100%;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 8px 40px rgba(0,0,0,0.4);
        `;
        
        dialog.innerHTML = `
            <h3 style="margin:0 0 4px 0;font-size:18px;">Pilih Nama Anda</h3>
            <p style="margin:0 0 16px 0;color:#666;font-size:14px;">Pilih nama untuk mendaftarkan wajah ini.</p>
            <input type="text" id="student-select-search" placeholder="Cari nama..." style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:15px;box-sizing:border-box;margin-bottom:12px;" />
            <div id="student-select-list" style="display:flex;flex-direction:column;gap:6px;max-height:200px;overflow-y:auto;"></div>
            <button id="student-select-cancel" style="margin-top:12px;padding:10px;border:1px solid #ddd;border-radius:8px;background:transparent;cursor:pointer;width:100%;font-size:15px;">✕ Batal</button>
        `;
        
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        
        const listEl = dialog.querySelector('#student-select-list');
        const searchEl = dialog.querySelector('#student-select-search');
        const cancelBtn = dialog.querySelector('#student-select-cancel');
        
        function renderList(filter = '') {
            // Sort students by name
            const sorted = [...students].sort((a, b) => a[1].localeCompare(b[1]));
            
            const filtered = filter 
                ? sorted.filter(s => s[1].toLowerCase().includes(filter.toLowerCase()) || s[0].toString().includes(filter))
                : sorted;
            
            if (!filtered.length) {
                listEl.innerHTML = '<p style="text-align:center;color:#999;padding:20px 0;">Tidak ada siswa yang cocok</p>';
                return;
            }
            
            listEl.innerHTML = filtered.map(s => `
                <button data-nis="${s[0]}" style="
                    padding:10px 14px;
                    border:1px solid #eee;
                    border-radius:8px;
                    background:white;
                    cursor:pointer;
                    text-align:left;
                    font-size:14px;
                    transition:background 0.15s;
                    width:100%;
                ">
                    <strong>${escapeHtml(s[1])}</strong>
                    <span style="color:#999;font-size:12px;"> #${s[0]}</span>
                    <span style="color:#999;font-size:11px;display:block;">${escapeHtml(s[2] || '')} ${escapeHtml(s[3] || '')}</span>
                </button>
            `).join('');
            
            listEl.querySelectorAll('button').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.body.removeChild(overlay);
                    resolve(btn.dataset.nis);
                });
                btn.addEventListener('mouseenter', () => btn.style.background = '#f0f0f0');
                btn.addEventListener('mouseleave', () => btn.style.background = 'white');
            });
        }
        
        searchEl.addEventListener('input', () => renderList(searchEl.value));
        cancelBtn.addEventListener('click', () => {
            document.body.removeChild(overlay);
            resolve(null);
        });
        
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
                resolve(null);
            }
        });
        
        renderList();
    });
}

// ========================================
// SHOW FACE CONFIRMATION DIALOG
// ========================================

function showFaceConfirmationDialog(photoData, name, nis, similarity) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.7);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000001;
            padding: 20px;
        `;
        
        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: white;
            border-radius: 16px;
            padding: 28px 24px;
            max-width: 400px;
            width: 100%;
            max-height: 90vh;
            overflow-y: auto;
            box-shadow: 0 8px 40px rgba(0,0,0,0.4);
            text-align: center;
        `;
        
        const confidencePercent = Math.round(similarity * 100);
        const confidenceColor = confidencePercent > 80 ? '#2e7d32' : confidencePercent > 60 ? '#ed6c02' : '#c62828';
        const confidenceEmoji = confidencePercent > 80 ? '🟢' : confidencePercent > 60 ? '🟡' : '🔴';
        
        dialog.innerHTML = `
            <h3 style="margin:0 0 4px 0;font-size:20px;">Face Match Found</h3>
            <p style="margin:0 0 16px 0;color:#666;font-size:14px;">Apakah ini wajah yang benar?</p>
            
            <div style="background:#f5f5f5;border-radius:12px;overflow:hidden;margin-bottom:16px;">
                <img src="${photoData}" style="width:100%;max-height:200px;object-fit:cover;display:block;" />
            </div>
            
            <div style="margin-bottom:16px;">
                <div style="font-weight:700;font-size:22px;color:#1a6bb0;">${escapeHtml(name)}</div>
                <div style="color:#999;font-size:14px;">NIS: ${nis}</div>
            </div>
            
            <div style="background:#f5f5f5;border-radius:8px;padding:10px 12px;margin-bottom:20px;display:flex;align-items:center;justify-content:center;gap:8px;">
                <span style="font-size:20px;">${confidenceEmoji}</span>
                <span style="font-weight:600;color:${confidenceColor};">${confidencePercent}% match</span>
                <span style="color:#999;font-size:13px;">(similarity)</span>
            </div>
            
            <div style="display:flex;gap:10px;">
                <button id="face-confirm-cancel" style="
                    flex:1;
                    padding:14px;
                    border:2px solid #ddd;
                    border-radius:10px;
                    background:transparent;
                    cursor:pointer;
                    font-weight:600;
                    font-size:15px;
                    color:#666;
                    transition:all 0.15s;
                ">✕ Cancel</button>
                <button id="face-confirm-continue" style="
                    flex:1;
                    padding:14px;
                    border:none;
                    border-radius:10px;
                    background:#1a6bb0;
                    color:white;
                    cursor:pointer;
                    font-weight:600;
                    font-size:15px;
                    transition:all 0.15s;
                ">Continue</button>
            </div>
        `;
        
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        
        const cancelBtn = dialog.querySelector('#face-confirm-cancel');
        const continueBtn = dialog.querySelector('#face-confirm-continue');
        
        cancelBtn.addEventListener('mouseenter', () => cancelBtn.style.background = '#f5f5f5');
        cancelBtn.addEventListener('mouseleave', () => cancelBtn.style.background = 'transparent');
        continueBtn.addEventListener('mouseenter', () => continueBtn.style.background = '#155a96');
        continueBtn.addEventListener('mouseleave', () => continueBtn.style.background = '#1a6bb0');
        
        cancelBtn.addEventListener('click', () => {
            document.body.removeChild(overlay);
            resolve(false);
        });
        
        continueBtn.addEventListener('click', () => {
            document.body.removeChild(overlay);
            resolve(true);
        });
        
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
                resolve(false);
            }
        });
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                document.body.removeChild(overlay);
                resolve(true);
            }
            if (e.key === 'Escape') {
                document.body.removeChild(overlay);
                resolve(false);
            }
        }, { once: true });
    });
}

// ========================================
// MANUAL FACE REGISTRATION - DECOUPLED
// ========================================

async function registerFaceManually() {
    const nis = els.faceRegisterNis.value.trim();
    const msgEl = els.faceRegisterMsg;
    
    if (!nis) {
        msgEl.style.display = 'block';
        msgEl.className = 'status-msg error';
        msgEl.textContent = 'Masukkan NIS siswa';
        return;
    }
    
    msgEl.style.display = 'block';
    msgEl.className = 'status-msg';
    msgEl.textContent = 'Memeriksa siswa...';
    
    try {
        // Get ALL students from server
        const data = await apiCall('getAllStudents', {}, false);
        const allStudents = data.students || [];
        const student = allStudents.find(s => s[0].toString() === nis);
        
        if (!student) {
            msgEl.className = 'status-msg error';
            msgEl.textContent = 'Siswa dengan NIS tersebut tidak ditemukan di database';
            return;
        }
        
        msgEl.textContent = 'Buka kamera untuk mengambil foto...';
        
        await openCameraForRegistration(nis);
        
    } catch (error) {
        msgEl.className = 'status-msg error';
        msgEl.textContent = `Error: ${error.message || 'Unknown error'}`;
    }
}

async function openCameraForRegistration(nis) {
    const msgEl = els.faceRegisterMsg;
    
    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
            audio: false
        });
        
        els.cameraPreview.srcObject = cameraStream;
        await els.cameraPreview.play();
        
        els.faceOverlay.width = els.cameraPreview.videoWidth || 640;
        els.faceOverlay.height = els.cameraPreview.videoHeight || 480;
        
        els.cameraContainer.style.display = 'block';
        isCameraOpen = true;
        
        els.faceScanBtn.innerHTML = '<span class="camera-icon"></span> Tutup Kamera';
        els.faceScanBtn.style.background = '#b13e3e';
        
        msgEl.textContent = 'Siap mengambil foto untuk NIS ' + nis;
        msgEl.className = 'status-msg';
        
        startFaceDetection();
        
        setTimeout(async () => {
            if (isCameraOpen) {
                const result = await capturePhotoForRegistration(nis);
                if (result) {
                    await completeFaceRegistration(nis, result);
                }
            }
        }, 2000);
        
    } catch (error) {
        msgEl.className = 'status-msg error';
        msgEl.textContent = 'Gagal membuka kamera: ' + error.message;
    }
}

async function capturePhotoForRegistration(nis) {
    if (!isCameraOpen || !els.cameraPreview.srcObject) return null;
    
    try {
        const canvas = document.createElement('canvas');
        const video = els.cameraPreview;
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        const photoData = canvas.toDataURL('image/jpeg', 0.9);
        
        const detection = await faceapi.detectSingleFace(
            canvas,
            new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 })
        );
        
        if (!detection) {
            els.faceRegisterMsg.className = 'status-msg error';
            els.faceRegisterMsg.textContent = 'Tidak ada wajah terdeteksi. Coba lagi.';
            return null;
        }
        
        const descriptor = await faceapi.computeFaceDescriptor(canvas, detection);
        
        return { photoData, descriptor };
    } catch (error) {
        return null;
    }
}

async function completeFaceRegistration(nis, result) {
    const msgEl = els.faceRegisterMsg;
    const { photoData, descriptor } = result;
    
    try {
        const descriptorArray = Array.from(descriptor);
        
        const registerResult = await apiCall('registerFace', {
            nis: nis,
            descriptor: descriptorArray,
            photoData: photoData
        }, false, 'POST');
        
        if (registerResult.success) {
            // Get ALL students to find name
            const data = await apiCall('getAllStudents', {}, false);
            const allStudents = data.students || [];
            const student = allStudents.find(s => s[0].toString() === nis);
            
            state.faceDescriptors[nis] = {
                name: student ? student[1] : nis,
                descriptor: descriptor
            };
            
            msgEl.className = 'status-msg success';
            msgEl.textContent = `Wajah terdaftar untuk ${student ? student[1] : nis}`;
            els.faceRegisterNis.value = '';
        } else {
            msgEl.className = 'status-msg error';
            msgEl.textContent = `Gagal mendaftar: ${registerResult.error || 'Unknown error'}`;
        }
    } catch (error) {
        msgEl.className = 'status-msg error';
        msgEl.textContent = `Error: ${error.message || 'Unknown error'}`;
    }
    
    setTimeout(() => closeCamera(), 1000);
}
// ========================================
// REST OF APP - TAB SWITCHING, LOAD CLASSES, STUDENTS, ETC
// ========================================

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
        const data = await apiCall('getClasses', {}, true);
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
        els.latenessSection.style.display = 'none';
        els.whatsappBtn.style.display = 'none';
        els.statsSummary.style.display = 'none';
        return;
    }
    
    els.studentList.innerHTML = `
        <div class="loading-state" style="text-align:center;padding:40px;">
            <div style="display:inline-block;width:40px;height:40px;border:4px solid #f3f3f3;border-top:4px solid #3498db;border-radius:50%;animation:spin 1s linear infinite;"></div>
            <p style="margin-top:10px;color:#666;">Memuat data kelas ${kelas}...</p>
        </div>
    `;
    
    try {
        const data = await apiCall('getFullClassData', { 
            kelas, 
            date,
            fields: 'students,attendance,piket'
        }, false);
        
        state.students = data.students || [];
        state.attendance = data.attendance || {};
        state.piket = data.piket || [];
        
        const latenessMap = new Map();
        for (const [nis, status] of Object.entries(state.attendance)) {
            if (status === 'telat') {
                const student = state.students.find(s => s[0].toString() === nis);
                if (student) {
                    latenessMap.set(nis, {
                        nis: nis,
                        name: student[1],
                        date: date,
                        timestamp: new Date().toISOString()
                    });
                }
            }
        }
        state.lateness = Array.from(latenessMap.values());
        
        renderOptimizedStudents();
        renderPiket();
        renderLateness();
        updateStats();
        updateLatenessSelect();
        
        els.piketSection.style.display = 'block';
        els.latenessSection.style.display = 'block';
        els.whatsappBtn.style.display = 'block';
        els.statsSummary.style.display = 'grid';
        
        cacheData(kelas, date);
        
        if (toastActive) hideToast();
        
    } catch (error) {
        const cached = getCachedData(kelas, date);
        if (cached) {
            state.students = cached.students || [];
            state.attendance = cached.attendance || {};
            state.piket = cached.piket || [];
            
            const latenessMap = new Map();
            for (const [nis, status] of Object.entries(state.attendance)) {
                if (status === 'telat') {
                    const student = state.students.find(s => s[0].toString() === nis);
                    if (student) {
                        latenessMap.set(nis, {
                            nis: nis,
                            name: student[1],
                            date: date,
                            timestamp: new Date().toISOString()
                        });
                    }
                }
            }
            state.lateness = Array.from(latenessMap.values());
            
            renderOptimizedStudents();
            renderPiket();
            renderLateness();
            updateStats();
            updateLatenessSelect();
            els.piketSection.style.display = 'block';
            els.latenessSection.style.display = 'block';
            els.whatsappBtn.style.display = 'block';
            els.statsSummary.style.display = 'grid';
            
            showToast('Data dari cache', 'Koneksi offline, menggunakan data tersimpan', null, false);
            setTimeout(() => hideToastDelayed(1500), 1000);
        } else {
            els.studentList.innerHTML = '<p class="empty-state">Gagal memuat data. Periksa koneksi.</p>';
            if (toastActive) hideToast();
        }
    }
}

// ===== CACHE =====
function cacheData(kelas, date) {
    const latenessMap = new Map();
    for (const [nis, status] of Object.entries(state.attendance)) {
        if (status === 'telat') {
            const student = state.students.find(s => s[0].toString() === nis);
            if (student) {
                latenessMap.set(nis, {
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
        lateness: Array.from(latenessMap.values()),
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

function fuzzyMatch(query, text) {
    if (!query) return true;
    query = query.toLowerCase();
    text = text.toLowerCase();
    let qi = 0;
    for (let i = 0; i < text.length && qi < query.length; i++) {
        if (text[i] === query[qi]) qi++;
    }
    return qi === query.length;
}

function renderOptimizedStudents() {
    if (!state.students || !state.students.length) {
        els.studentList.innerHTML = '<p class="empty-state">Tidak ada siswa di kelas ini</p>';
        return;
    }

    const query = (els.studentSearch?.value || '').trim();

    const cacheKey = `${els.classSelector.value}_${els.dateSelector.value}`;
    const stateHash = JSON.stringify({
        students: state.students.map(s => s[0]),
        attendance: state.attendance,
        lateness: state.lateness.map(l => l.nis)
    });

    if (!query) {
        const cached = studentListCache.get(cacheKey);
        if (cached && cached.hash === stateHash) {
            els.studentList.innerHTML = cached.html;
            return;
        }
    }

    const lateNIS = new Set(state.lateness.map(l => l.nis.toString()));
    const statusLabels = {
        hadir: { label: 'H', class: 'status-hadir' },
        absen: { label: 'A', class: 'status-absen' },
        sakit: { label: 'S', class: 'status-sakit' },
        izin: { label: 'I', class: 'status-izin' },
        telat: { label: 'T', class: 'status-terlambat' }
    };

    const filteredStudents = query
        ? state.students.filter(s => fuzzyMatch(query, s[1]) || fuzzyMatch(query, s[0].toString()))
        : state.students;

    if (query && !filteredStudents.length) {
        els.studentList.innerHTML = '<p class="empty-state">Tidak ada siswa yang cocok</p>';
        return;
    }

    const studentHTML = filteredStudents.map(student => {
        const nis = student[0].toString();
        const status = state.attendance[nis] || 'hadir';
        const isLate = lateNIS.has(nis) || status === 'telat';
        const displayStatus = isLate ? 'telat' : status;
        const info = statusLabels[displayStatus] || statusLabels.hadir;

        let btnsHtml = '';
        for (const [key, val] of Object.entries(statusLabels)) {
            const isActive = displayStatus === key || (key === 'telat' && isLate);
            btnsHtml += `<button class="status-btn ${isActive ? 'active' : ''} ${val.class}" 
                         data-status="${key}" 
                         onclick="markAttendance('${nis}', '${key}')">${val.label}</button>`;
        }

        return `<div class="student-card status-${displayStatus}">
            <div class="student-info">
                <span class="student-name">${escapeHtml(student[1])}</span>
                <span class="student-nis">#${nis}</span>
            </div>
            <div class="student-status-badge ${info.class}">${info.label}</div>
            <div class="status-btns">${btnsHtml}</div>
        </div>`;
    }).join('');

    els.studentList.innerHTML = studentHTML;

    if (!query) {
        studentListCache.set(cacheKey, { html: studentHTML, hash: stateHash });
        if (studentListCache.size > CONFIG.MAX_CACHE_ITEMS) {
            const firstKey = studentListCache.keys().next().value;
            studentListCache.delete(firstKey);
        }
    }
}

async function markAttendance(nis, status) {
    const date = els.dateSelector.value;
    const kelas = els.classSelector.value;
    
    state.attendance[nis] = status;
    
    const latenessMap = new Map();
    for (const [sNis, sStatus] of Object.entries(state.attendance)) {
        if (sStatus === 'telat') {
            const student = state.students.find(s => s[0].toString() === sNis);
            if (student) {
                latenessMap.set(sNis, {
                    nis: sNis,
                    name: student[1],
                    date: date,
                    timestamp: new Date().toISOString()
                });
            }
        }
    }
    state.lateness = Array.from(latenessMap.values());
    
    renderOptimizedStudents();
    renderLateness();
    updateStats();
    updateLatenessSelect();
    
    state.pendingUpdates.push({ nis, date, status, kelas });
    
    if (state.updateTimeout) {
        clearTimeout(state.updateTimeout);
    }
    state.updateTimeout = setTimeout(() => {
        flushAttendanceUpdates();
    }, CONFIG.BATCH_DELAY);
}

async function flushAttendanceUpdates() {
    if (!state.pendingUpdates.length) return;
    
    const updates = state.pendingUpdates;
    state.pendingUpdates = [];
    state.updateTimeout = null;
    
    try {
        await apiCall('batchMarkAttendance', { updates }, true, 'POST');
        const kelas = els.classSelector.value;
        const date = els.dateSelector.value;
        cacheData(kelas, date);
    } catch (error) {
        updates.forEach(u => queueAction('markAttendance', u));
    }
}

// ===== QUEUE SYSTEM =====
function queueAction(action, params) {
    const pending = JSON.parse(localStorage.getItem('pending_actions') || '[]');
    pending.push({ action, params, timestamp: Date.now() });
    localStorage.setItem('pending_actions', JSON.stringify(pending));
    updatePendingCounter();
    showToast('Disimpan offline', 'Akan disinkronkan saat online', null, false);
    setTimeout(() => hideToastDelayed(1500), 1000);
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

// ===== LATENESS FUNCTIONS =====
function updateLatenessSelect() {
    const select = els.lateStudentSelect;
    select.innerHTML = '<option value="">Pilih siswa...</option>';
    
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
        showToast('️ Pilih siswa', 'Silakan pilih siswa yang terlambat', null, true);
        setTimeout(() => hideToastDelayed(1500), 1000);
        return;
    }
    
    await markAttendance(nis, 'telat');
    select.value = '';
    updateLatenessSelect();
}

function renderLateness() {
    if (!state.lateness || !state.lateness.length) {
        els.latenessList.innerHTML = '<p class="empty-state">Tidak ada siswa terlambat hari ini</p>';
        els.latenessCount.textContent = '0';
        return;
    }
    
    els.latenessCount.textContent = state.lateness.length;
    
    const fragment = document.createDocumentFragment();
    
    state.lateness.forEach((item) => {
        const time = item.timestamp ? new Date(item.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '';
        const div = document.createElement('div');
        div.className = 'lateness-item';
        div.innerHTML = `
            <span class="lateness-name">${escapeHtml(item.name)}</span>
            <span class="lateness-time">${time}</span>
        `;
        fragment.appendChild(div);
    });
    
    els.latenessList.innerHTML = '';
    els.latenessList.appendChild(fragment);
}

// ===== RENDER PIKET =====
function renderPiket() {
    if (!state.piket || !state.piket.length) {
        els.piketList.innerHTML = '<p class="empty-state">Tidak ada piket untuk hari ini</p>';
        return;
    }
    
    const fragment = document.createDocumentFragment();
    
    state.piket.forEach(piket => {
        const done = piket.done || false;
        const hasPhoto1 = piket.photo1 && piket.photo1.length > 0;
        const hasPhoto2 = piket.photo2 && piket.photo2.length > 0;
        const names = piket.names ? piket.names.join(', ') : '';
        
        const div = document.createElement('div');
        div.className = `piket-item ${done ? 'done' : ''}`;
        div.id = `piket-${piket.id}`;
        
        let photosHtml = '';
        if (hasPhoto1 || hasPhoto2) {
            photosHtml = `<div class="piket-photos">
                ${hasPhoto1 ? `<a href="${piket.photo1}" target="_blank"><img src="${piket.photo1}" class="piket-thumb" alt="Foto 1"></a>` : ''}
                ${hasPhoto2 ? `<a href="${piket.photo2}" target="_blank"><img src="${piket.photo2}" class="piket-thumb" alt="Foto 2"></a>` : ''}
            </div>`;
        }
        
        div.innerHTML = `
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
            ${photosHtml}
        `;
        
        fragment.appendChild(div);
    });
    
    els.piketList.innerHTML = '';
    els.piketList.appendChild(fragment);
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
        await apiCall('togglePiket', { id, done, date, kelas }, true);
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
                hideToast();
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
            if (stats[status] !== undefined) {
                stats[status]++;
            } else {
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
        showToast(' Pilih tanggal', 'Tanggal harus diisi', null, true);
        setTimeout(() => hideToastDelayed(1500), 1000);
        return;
    }
    
    try {
        showToast('Memuat history', `Tanggal ${formatDate(date)}`, 20);
        const data = await apiCall('getHistory', { date }, false);
        
        let html = `<h3>Rekap ${formatDate(date)}</h3>`;
        
        if (data.attendance && data.attendance.length) {
            html += `<div class="student-grid">`;
            data.attendance.forEach(record => {
                const statusLabels = {
                    hadir: 'Hadir',
                    absen: 'Absen',
                    sakit: 'Sakit',
                    izin: 'Izin',
                    telat: 'Terlambat'
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
        hideToast();
    } catch (error) {
        els.historyContainer.innerHTML = '<p class="empty-state">Gagal memuat history</p>';
        if (toastActive) hideToast();
    }
}

function formatDate(iso) {
    if (!iso) return 'Untitled';
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' });
}

// ===== CSV UPLOAD =====
async function uploadCSV() {
    const file = els.csvUpload.files[0];
    if (!file) {
        showToast('️ Pilih file', 'File CSV diperlukan', null, true);
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
                hideToast();
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
        hideToast();
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

    const fragment = document.createDocumentFragment();
    
    filtered.forEach(s => {
        const nis = s[0].toString();
        const isSelected = selectedNIS.has(nis);
        const assignedDay = findAssignedDay(nis);
        const dayLabel = assignedDay ? dayLabels[assignedDay] : '';
        const isOpen = expandedNis === nis;

        const div = document.createElement('div');
        div.className = `student-search-item ${isSelected ? 'selected' : ''}`;
        div.dataset.nis = nis;
        
        let dayPickerHtml = '';
        if (isOpen) {
            dayPickerHtml = `
                <div class="inline-day-picker">
                    ${days.map(d => `
                        <button type="button" class="day-picker-btn ${assignedDay === d.key ? 'active' : ''}" data-nis="${nis}" data-key="${d.key}">
                            ${d.label} ${assignedDay === d.key ? '✓' : ''}
                        </button>
                    `).join('')}
                    ${assignedDay ? `<button type="button" class="day-picker-btn remove" data-nis="${nis}" data-key="remove">✕ Hapus</button>` : ''}
                </div>
            `;
        }
        
        div.innerHTML = `
            <div class="student-search-item-row" data-toggle="${nis}">
                <span class="student-name">${escapeHtml(s[1])}</span>
                <span class="student-nis">${s[0]}</span>
                ${isSelected ? ` <span class="assigned-day">${dayLabel}</span>` : ''}
            </div>
            ${dayPickerHtml}
        `;
        
        fragment.appendChild(div);
    });
    
    list.innerHTML = '';
    list.appendChild(fragment);

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
        document.getElementById('piket-status').textContent = '️ Pilih kelas terlebih dahulu';
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
        document.getElementById('piket-status').textContent = '️ Generate JSON first';
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
            hideToast();
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

// ========================================
// EVENT LISTENERS
// ========================================

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
        apiCache.clear();
        studentListCache.clear();
        await loadStudents(els.classSelector.value, els.dateSelector.value);
    });
    
    els.studentSearch.addEventListener('input', () => {
        renderOptimizedStudents();
    });
    
    els.whatsappBtn.addEventListener('click', copyWhatsAppReport);
    els.historyLoadBtn.addEventListener('click', loadHistory);
    els.uploadCsvBtn.addEventListener('click', uploadCSV);
    
    els.clearCacheBtn.addEventListener('click', () => {
        if (confirm('Hapus semua data cache lokal?')) {
            localStorage.clear();
            apiCache.clear();
            studentListCache.clear();
            showToast('Cache dibersihkan', 'Refresh halaman', null, false);
            setTimeout(() => {
                hideToast();
                location.reload();
            }, 1500);
        }
    });
    
    els.markLateBtn.addEventListener('click', markLateness);
    
    // FACE RECOGNITION EVENTS
    if (els.faceScanBtn) {
        els.faceScanBtn.addEventListener('click', openCamera);
    }
    
    if (els.capturePhotoBtn) {
        els.capturePhotoBtn.addEventListener('click', capturePhoto);
    }
    
    if (els.closeCameraBtn) {
        els.closeCameraBtn.addEventListener('click', closeCamera);
    }
    
    if (els.faceRegisterBtn) {
        els.faceRegisterBtn.addEventListener('click', registerFaceManually);
    }
    
    if (els.faceDate) {
        els.faceDate.value = new Date().toISOString().split('T')[0];
    }
}

// ========================================
// ONLINE/OFFLINE
// ========================================

function updateOnlineStatus() {
    state.isOnline = navigator.onLine;
    if (els.connectionStatus) {
        els.connectionStatus.textContent = state.isOnline ? '● Online' : '● Offline';
        els.connectionStatus.className = state.isOnline ? 'status-online' : 'status-offline';
    }
    if (els.offlineBanner) {
        els.offlineBanner.style.display = state.isOnline ? 'none' : 'block';
    }
}

window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

// ========================================
// SERVICE WORKER
// ========================================

function registerSW() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(() => console.log('SW Registered'))
            .catch(() => console.log('SW Register failed'));
    }
}

// ========================================
// INITIALIZATION
// ========================================

document.addEventListener('DOMContentLoaded', async () => {
    els.dateSelector.value = state.currentDate;
    els.historyDate.value = state.currentDate;
    
    setupEventListeners();
    registerSW();
    updateOnlineStatus();
    
    await loadClasses();
    await loadFaceModels();
    
    setTimeout(async () => {
        if (els.classSelector.options.length > 1) {
            els.classSelector.value = els.classSelector.options[1].value;
            await loadStudents(els.classSelector.value, els.dateSelector.value);
        }
    }, 500);
});

// ========================================
// PERIODIC SYNC
// ========================================

setInterval(() => {
    if (navigator.onLine && els.classSelector.value) {
        apiCache.clear();
        studentListCache.clear();
        loadStudents(els.classSelector.value, els.dateSelector.value);
    }
}, 300000);

// ========================================
// EXPOSE FUNCTIONS
// ========================================

window.markAttendance = markAttendance;
window.togglePiket = togglePiket;
window.uploadPiketPhoto = uploadPiketPhoto;
window.openPiketBuilderDialog = openPiketBuilderDialog;
window.markLateness = markLateness;
window.openCamera = openCamera;
window.capturePhoto = capturePhoto;
window.closeCamera = closeCamera;
window.registerFaceManually = registerFaceManually;