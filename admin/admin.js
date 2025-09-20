/**
 * Admin Dashboard JavaScript
 * Handles all admin functionality including section management, treasurer management, etc.
 */

let currentSection = 'dashboard';
let sectionsData = [];
let treasurersData = [];
let studentsData = [];
let dashboardData = {};
let previewData = null;

/**
 * Initialize admin dashboard
 */
async function initializeAdmin() {
    try {
        // Check database initialization first
        await checkDatabaseInitialization();
        
        // Update user info in header
        updateUserInfo();
        
        // Setup navigation
        setupNavigation();
        
        // Setup mobile hamburger menu
        setupMobileMenu();
        
        // Load initial dashboard data
        await loadDashboardData();
        
        // Setup real-time updates
        setupAutoRefresh();
        
        console.log('Admin dashboard initialized successfully');
    } catch (error) {
        console.error('Failed to initialize admin dashboard:', error);
        if (error.message.includes('database') || error.message.includes('setup')) {
            showDatabaseSetupModal();
        } else {
            showToast('Failed to load dashboard. Please refresh the page.', 'error');
        }
    }
}

/**
 * Check if database is properly initialized
 */
async function checkDatabaseInitialization() {
    try {
        const response = await API.call('checkDatabaseInit');
        if (response.status === 'error' && response.message.includes('not initialized')) {
            throw new Error('Database not initialized');
        }
    } catch (error) {
        throw new Error('Database initialization check failed');
    }
}

/**
 * Show database setup modal for first-time setup
 */
function showDatabaseSetupModal() {
    const modal = document.createElement('div');
    modal.id = 'databaseSetupModal';
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-backdrop"></div>
        <div class="modal-content">
            <div class="modal-header">
                <h3>🔧 Database Setup Required</h3>
            </div>
            <div class="modal-body">
                <div class="setup-notice">
                    <h4>First Time Setup</h4>
                    <p>The system database needs to be initialized. This will create the necessary data structure and the first admin account.</p>
                </div>
                
                <form id="setupForm">
                    <div class="form-group">
                        <label class="form-label required">Admin Full Name</label>
                        <input type="text" id="setupAdminName" class="form-control" placeholder="Enter admin full name" required>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label required">Admin Username</label>
                        <input type="text" id="setupAdminUsername" class="form-control" placeholder="Enter username" required>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label required">Admin Password</label>
                        <div class="form-group-icon">
                            <input type="password" id="setupAdminPassword" class="form-control" placeholder="Enter secure password" required>
                            <button type="button" class="password-toggle" onclick="togglePassword('setupAdminPassword')">👁️</button>
                        </div>
                        <small class="form-text">Password must be at least 8 characters long</small>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label required">Confirm Password</label>
                        <div class="form-group-icon">
                            <input type="password" id="setupConfirmPassword" class="form-control" placeholder="Confirm password" required>
                            <button type="button" class="password-toggle" onclick="togglePassword('setupConfirmPassword')">👁️</button>
                        </div>
                    </div>
                </form>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-accent" onclick="initializeDatabase()">
                    Initialize Database
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

/**
 * Initialize database with admin account
 */
async function initializeDatabase() {
    const name = document.getElementById('setupAdminName').value.trim();
    const username = document.getElementById('setupAdminUsername').value.trim();
    const password = document.getElementById('setupAdminPassword').value;
    const confirmPassword = document.getElementById('setupConfirmPassword').value;
    
    // Validation
    if (!name || !username || !password || !confirmPassword) {
        showToast('Please fill in all fields', 'error');
        return;
    }
    
    if (password.length < 8) {
        showToast('Password must be at least 8 characters long', 'error');
        return;
    }
    
    if (password !== confirmPassword) {
        showToast('Passwords do not match', 'error');
        return;
    }
    
    try {
        showLoading('Initializing database...');
        
        const response = await API.call('initializeDatabase', {
            adminName: name,
            adminUsername: username,
            adminPassword: password
        });
        
        hideLoading();
        
        if (response.status === 'ok') {
            showToast('Database initialized successfully! Please log in with your new admin account.', 'success');
            
            // Remove setup modal
            document.getElementById('databaseSetupModal').remove();
            
            // Redirect to login
            setTimeout(() => {
                Auth.logout();
                window.location.href = '../index.html';
            }, 2000);
        } else {
            throw new Error(response.message);
        }
    } catch (error) {
        hideLoading();
        console.error('Database initialization failed:', error);
        showToast('Failed to initialize database: ' + error.message, 'error');
    }
}

/**
 * Password toggle functionality (Enhanced version)
 */
function togglePassword(fieldId) {
    const field = document.getElementById(fieldId);
    if (!field) {
        console.error('Password field not found:', fieldId);
        return;
    }
    
    // Try multiple selectors to find the toggle button
    let toggle = field.parentElement.querySelector('.password-toggle');
    if (!toggle) {
        toggle = document.querySelector(`button[onclick="togglePassword('${fieldId}')"]`);
    }
    if (!toggle) {
        toggle = field.nextElementSibling;
    }
    
    if (!toggle) {
        console.error('Password toggle button not found for:', fieldId);
        return;
    }
    
    console.log('Toggling password for:', fieldId);
    
    if (field.type === 'password') {
        field.type = 'text';
        toggle.textContent = '🙈';
        console.log('Password shown');
    } else {
        field.type = 'password';
        toggle.textContent = '👁️';
        console.log('Password hidden');
    }
}

/**
 * Update user info in header
 */
function updateUserInfo() {
    const userInfo = Auth.getUserDisplayInfo();
    if (userInfo) {
        document.getElementById('top_user').textContent = `${userInfo.name} | Admin`;
        document.getElementById('top_lastSync').textContent = `Last Sync: ${userInfo.lastSync}`;
    }
}

/**
 * Setup navigation system
 */
function setupNavigation() {
    const navLinks = document.querySelectorAll('.nav-link[data-section]');
    
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const section = link.getAttribute('data-section');
            switchSection(section);
        });
    });
}

/**
 * Setup mobile hamburger menu
 */
function setupMobileMenu() {
    const hamburgerBtn = document.getElementById('btn_hamburger_toggle');
    const sidebar = document.getElementById('sidebar');
    const contentArea = document.getElementById('contentArea');
    
    hamburgerBtn.addEventListener('click', () => {
        sidebar.classList.toggle('visible');
        contentArea.classList.toggle('expanded');
    });
    
    // Close sidebar when clicking outside on mobile
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768) {
            if (!sidebar.contains(e.target) && !hamburgerBtn.contains(e.target)) {
                sidebar.classList.remove('visible');
                contentArea.classList.add('expanded');
            }
        }
    });
}

/**
 * Switch between sections
 */
function switchSection(sectionName) {
    // Update active nav link
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
    });
    document.querySelector(`[data-section="${sectionName}"]`).classList.add('active');
    
    // Hide all sections
    document.querySelectorAll('[id$="-section"]').forEach(section => {
        section.style.display = 'none';
    });
    
    // Show target section
    const targetSection = document.getElementById(`${sectionName}-section`);
    if (targetSection) {
        targetSection.style.display = 'block';
    }
    
    currentSection = sectionName;
    
    // Load section-specific data
    loadSectionData(sectionName);
    
    // Close mobile menu
    if (window.innerWidth <= 768) {
        document.getElementById('sidebar').classList.remove('visible');
        document.getElementById('contentArea').classList.add('expanded');
    }
}

/**
 * Load data for specific section
 */
async function loadSectionData(sectionName) {
    try {
        switch (sectionName) {
            case 'dashboard':
                await loadDashboardData();
                break;
            case 'sections':
                await loadSectionsData();
                break;
            case 'treasurers':
                await loadTreasurersData();
                break;
            case 'students':
                await loadStudentsData();
                break;
            case 'reports':
                await loadReportsData();
                break;
            case 'audit':
                await loadAuditLogData();
                break;
            case 'settings':
                loadSettings();
                break;
        }
    } catch (error) {
        console.error(`Failed to load ${sectionName} data:`, error);
        showToast(`Failed to load ${sectionName} data`, 'error');
    }
}

/**
 * Load dashboard data
 */
async function loadDashboardData() {
    try {
        const response = await API.getDashboardData();
        
        if (response.status === 'ok') {
            dashboardData = response.data;
            updateDashboardStats();
            await loadRecentActivity();
        } else {
            throw new Error(response.message);
        }
    } catch (error) {
        console.error('Failed to load dashboard data:', error);
        showToast('Failed to load dashboard data', 'error');
    }
}

/**
 * Update dashboard statistics
 */
function updateDashboardStats() {
    document.getElementById('totalSections').textContent = sectionsData.length;
    document.getElementById('totalStudents').textContent = dashboardData.totalStudents || 0;
    document.getElementById('activeTreasurers').textContent = treasurersData.filter(t => t.isActive).length;
    document.getElementById('totalCollections').textContent = API.formatCurrency(dashboardData.totalCollected || 0);
    
    // Update change indicators
    document.getElementById('sectionsChange').textContent = 'Active';
    document.getElementById('studentsChange').textContent = 'Enrolled';
    document.getElementById('treasurersChange').textContent = 'Active';
    document.getElementById('collectionsChange').textContent = 'Total';
}

/**
 * Load recent activity
 */
async function loadRecentActivity() {
    try {
        const response = await API.getAuditLog({ limit: 10 });
        
        if (response.status === 'ok') {
            displayRecentActivity(response.data.logs);
        } else {
            throw new Error(response.message);
        }
    } catch (error) {
        console.error('Failed to load recent activity:', error);
        document.getElementById('recentActivity').innerHTML = `
            <div class="alert alert-error">Failed to load recent activity</div>
        `;
    }
}

/**
 * Display recent activity
 */
function displayRecentActivity(logs) {
    const container = document.getElementById('recentActivity');
    
    if (!logs || logs.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📋</div>
                <div class="empty-state-title">No Recent Activity</div>
                <div class="empty-state-text">System activity will appear here</div>
            </div>
        `;
        return;
    }
    
    const activityHtml = logs.map(log => `
        <div class="activity-item" style="display: flex; justify-content: space-between; padding: var(--spacing-sm) 0; border-bottom: 1px solid var(--border-color);">
            <div>
                <strong>${log.user}</strong> ${formatActionType(log.actionType)}
                ${log.details ? `<br><small style="color: var(--text-muted);">${log.details}</small>` : ''}
            </div>
            <div style="color: var(--text-muted); font-size: var(--font-size-sm);">
                ${API.formatDate(log.actionTime, { hour: '2-digit', minute: '2-digit' })}
            </div>
        </div>
    `).join('');
    
    container.innerHTML = activityHtml;
}

/**
 * Format action type for display
 */
function formatActionType(actionType) {
    const formats = {
        'LOGIN': 'logged in',
        'LOGOUT': 'logged out',
        'SECTION_CREATE': 'created a section',
        'PAYMENT_RECORD': 'recorded a payment',
        'TREASURER_CREATE': 'created a treasurer account',
        'CASH_HANDOVER': 'recorded cash handover'
    };
    
    return formats[actionType] || actionType.toLowerCase().replace('_', ' ');
}

/**
 * Load sections data
 */
async function loadSectionsData() {
    try {
        const response = await API.getSections();
        
        if (response.status === 'ok') {
            sectionsData = response.data.sections;
            displaySectionsTable();
            updateDashboardStats();
        } else {
            throw new Error(response.message);
        }
    } catch (error) {
        console.error('Failed to load sections:', error);
        document.getElementById('sectionsTableBody').innerHTML = `
            <tr><td colspan="8" class="alert alert-error">Failed to load sections</td></tr>
        `;
    }
}

/**
 * Display sections table
 */
function displaySectionsTable() {
    const tbody = document.getElementById('sectionsTableBody');
    
    if (!sectionsData || sectionsData.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-state">
                    <div class="empty-state-icon">🏫</div>
                    <div class="empty-state-title">No Sections Found</div>
                    <div class="empty-state-text">Create your first section to get started</div>
                </td>
            </tr>
        `;
        return;
    }
    
    const rowsHtml = sectionsData.map(section => {
        const progress = API.calculateProgress(section.totalCollected || 0, section.totalExpected || 0);
        
        return `
            <tr>
                <td><strong>${section.sectionName}</strong></td>
                <td><span class="badge badge-primary">${section.department}</span></td>
                <td>${section.studentCount}</td>
                <td>${API.formatCurrency(section.totalExpected || 0)}</td>
                <td>${API.formatCurrency(section.totalCollected || 0)}</td>
                <td>
                    <div class="progress-container">
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${progress}%"></div>
                        </div>
                        <div class="progress-text">
                            <span>${progress}%</span>
                        </div>
                    </div>
                </td>
                <td>${API.formatDate(section.createdAt, { month: 'short', day: 'numeric' })}</td>
                <td>
                    <div class="btn-group">
                        <button class="btn btn-sm btn-secondary" onclick="editSection('${section.sectionId}')">
                            Edit
                        </button>
                        <button class="btn btn-sm btn-danger" onclick="deactivateSection('${section.sectionId}')">
                            Deactivate
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
    
    tbody.innerHTML = rowsHtml;
}

/**
 * Load treasurers data
 */
async function loadTreasurersData() {
    try {
        const response = await API.getTreasurers();
        
        if (response.status === 'ok') {
            treasurersData = response.data.treasurers;
            displayTreasurersTable();
            updateDashboardStats();
        } else {
            throw new Error(response.message);
        }
    } catch (error) {
        console.error('Failed to load treasurers:', error);
        document.getElementById('treasurersTableBody').innerHTML = `
            <tr><td colspan="7" class="alert alert-error">Failed to load treasurers</td></tr>
        `;
    }
}

/**
 * Display treasurers table
 */
function displayTreasurersTable() {
    const tbody = document.getElementById('treasurersTableBody');
    
    if (!treasurersData || treasurersData.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="empty-state">
                    <div class="empty-state-icon">👥</div>
                    <div class="empty-state-title">No Treasurers Found</div>
                    <div class="empty-state-text">Add treasurers to manage sections</div>
                </td>
            </tr>
        `;
        return;
    }
    
    const rowsHtml = treasurersData.map(treasurer => `
        <tr>
            <td><strong>${treasurer.fullName}</strong></td>
            <td><code>${treasurer.username}</code></td>
            <td><span class="badge badge-primary">${treasurer.department}</span></td>
            <td>${treasurer.section}</td>
            <td>${API.formatDate(treasurer.startDate, { year: 'numeric', month: 'short', day: 'numeric' })}</td>
            <td>
                <span class="badge ${treasurer.isActive ? 'badge-success' : 'badge-secondary'}">
                    ${treasurer.isActive ? 'Active' : 'Inactive'}
                </span>
            </td>
            <td>
                <div class="btn-group">
                    <button class="btn btn-sm btn-secondary" onclick="editTreasurer('${treasurer.treasurerId}')">
                        Edit
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="deactivateTreasurer('${treasurer.treasurerId}')">
                        Deactivate
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
    
    tbody.innerHTML = rowsHtml;
}

/**
 * Load students data
 */
async function loadStudentsData() {
    try {
        const response = await API.getStudents();
        
        if (response.status === 'ok') {
            studentsData = response.data.students;
            displayStudentsTable();
            populateStudentFilters();
        } else {
            throw new Error(response.message);
        }
    } catch (error) {
        console.error('Failed to load students:', error);
        document.getElementById('studentsTableBody').innerHTML = `
            <tr><td colspan="9" class="alert alert-error">Failed to load students</td></tr>
        `;
    }
}

/**
 * Display students table
 */
function displayStudentsTable(filteredData = null) {
    const data = filteredData || studentsData;
    const tbody = document.getElementById('studentsTableBody');
    
    if (!data || data.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="empty-state">
                    <div class="empty-state-icon">🎓</div>
                    <div class="empty-state-title">No Students Found</div>
                    <div class="empty-state-text">Students will appear when sections are created</div>
                </td>
            </tr>
        `;
        return;
    }
    
    const rowsHtml = data.map(student => {
        const statusClass = {
            'PAID': 'badge-success',
            'PARTIAL': 'badge-warning',
            'NOT_PAID': 'badge-danger'
        }[student.paymentStatus] || 'badge-secondary';
        
        return `
            <tr>
                <td><code>${student.studentNo || 'N/A'}</code></td>
                <td><strong>${student.fullName}</strong></td>
                <td>${student.sectionId}</td>
                <td>${API.formatCurrency(student.expectedAmount)}</td>
                <td>${API.formatCurrency(student.totalPaid)}</td>
                <td>${API.formatCurrency(student.remaining)}</td>
                <td><span class="badge ${statusClass}">${student.paymentStatus}</span></td>
                <td>${student.lastPaymentDate ? API.formatDate(student.lastPaymentDate, { month: 'short', day: 'numeric' }) : 'Never'}</td>
                <td>
                    <button class="btn btn-sm btn-secondary" onclick="viewStudentHistory('${student.studentId}')">
                        View History
                    </button>
                </td>
            </tr>
        `;
    }).join('');
    
    tbody.innerHTML = rowsHtml;
}

/**
 * Populate student filters
 */
function populateStudentFilters() {
    const sectionFilter = document.getElementById('studentSectionFilter');
    
    // Get unique sections
    const sections = [...new Set(studentsData.map(s => s.sectionId))];
    
    sectionFilter.innerHTML = '<option value="">All Sections</option>' +
        sections.map(section => `<option value="${section}">${section}</option>`).join('');
}

/**
 * Show create section modal
 */
function showCreateSectionModal() {
    showModal('createSectionModal');
    
    // Reset form
    document.getElementById('createSectionForm').reset();
    document.getElementById('auto_count_students').textContent = '0 students';
    document.getElementById('btn_save_section').disabled = true;
    previewData = null;
    
    // Setup auto-count
    const textarea = document.getElementById('textarea_students');
    textarea.addEventListener('input', updateStudentCount);
}

/**
 * Update student count
 */
function updateStudentCount() {
    const textarea = document.getElementById('textarea_students');
    const students = API.parseStudentData(textarea.value);
    document.getElementById('auto_count_students').textContent = `${students.length} students`;
}

/**
 * Preview section before saving
 */
function previewSection() {
    const sectionName = document.getElementById('input_section_name').value.trim();
    const department = document.getElementById('select_department').value;
    const studentsText = document.getElementById('textarea_students').value;
    
    if (!sectionName) {
        showToast('Section name is required', 'error');
        return;
    }
    
    if (!department) {
        showToast('Department is required', 'error');
        return;
    }
    
    const students = API.parseStudentData(studentsText);
    
    previewData = {
        sectionName,
        department,
        students
    };
    
    // Generate preview content
    const previewHtml = `
        <div class="preview-summary">
            <h4>Section: ${sectionName}</h4>
            <p><strong>Department:</strong> ${department}</p>
            <p><strong>Total Students:</strong> ${students.length}</p>
        </div>
        
        ${students.length > 0 ? `
            <div class="preview-students">
                <h5>Students:</h5>
                <div class="table-container">
                    <table class="table table-sm">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Student No</th>
                                <th>Full Name</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${students.map((student, index) => `
                                <tr>
                                    <td>${index + 1}</td>
                                    <td><code>${student.studentNo || 'Auto-generated'}</code></td>
                                    <td>${student.fullName}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        ` : '<p><em>No students added</em></p>'}
    `;
    
    document.getElementById('sectionPreviewContent').innerHTML = previewHtml;
    document.getElementById('btn_save_section').disabled = false;
    
    closeModal('createSectionModal');
    showModal('previewSectionModal');
}

/**
 * Confirm and save section
 */
async function confirmSaveSection() {
    if (!previewData) {
        showToast('No preview data available', 'error');
        return;
    }
    
    await saveSection();
}

/**
 * Save section
 */
async function saveSection() {
    if (!previewData) {
        showToast('Please preview the section first', 'error');
        return;
    }
    
    try {
        showLoading('Creating section...');
        
        const response = await API.createSection({
            sectionName: previewData.sectionName,
            department: previewData.department,
            students: previewData.students.map(s => s.fullName),
            createdBy: Auth.getCurrentUser().user
        });
        
        hideLoading();
        
        if (response.status === 'ok') {
            showToast(`Section created successfully! Added ${response.data.createdStudents} students.`, 'success');
            closeModal('previewSectionModal');
            
            // Refresh sections data
            await loadSectionsData();
            
            // Switch to sections view
            switchSection('sections');
        } else {
            throw new Error(response.message);
        }
    } catch (error) {
        hideLoading();
        console.error('Failed to create section:', error);
        showToast('Failed to create section: ' + error.message, 'error');
    }
}

/**
 * Show create treasurer modal
 */
async function showCreateTreasurerModal() {
    showModal('createTreasurerModal');
    
    // Reset form
    document.getElementById('createTreasurerForm').reset();
    
    // Load sections for the section dropdown
    await populateTreasurerSections();
    
    // Setup department change handler
    document.getElementById('treasurerDepartment').addEventListener('change', filterSectionsByDepartment);
}

/**
 * Populate treasurer sections dropdown
 */
async function populateTreasurerSections() {
    try {
        if (!sectionsData.length) {
            await loadSectionsData();
        }
        
        const sectionSelect = document.getElementById('treasurerSection');
        sectionSelect.innerHTML = '<option value="">Select Section</option>' +
            sectionsData.map(section => 
                `<option value="${section.sectionId}" data-department="${section.department}">
                    ${section.sectionName} (${section.department})
                </option>`
            ).join('');
    } catch (error) {
        console.error('Failed to load sections for treasurer:', error);
    }
}

/**
 * Filter sections by department
 */
function filterSectionsByDepartment() {
    const selectedDepartment = document.getElementById('treasurerDepartment').value;
    const sectionSelect = document.getElementById('treasurerSection');
    const options = sectionSelect.querySelectorAll('option');
    
    options.forEach(option => {
        if (option.value === '') {
            option.style.display = 'block';
            return;
        }
        
        const optionDepartment = option.getAttribute('data-department');
        option.style.display = (!selectedDepartment || optionDepartment === selectedDepartment) ? 'block' : 'none';
    });
    
    // Reset selection if current selection is filtered out
    if (selectedDepartment && sectionSelect.value) {
        const currentOption = sectionSelect.querySelector(`option[value="${sectionSelect.value}"]`);
        if (currentOption && currentOption.style.display === 'none') {
            sectionSelect.value = '';
        }
    }
}

/**
 * Save treasurer
 */
async function saveTreasurer() {
    const form = document.getElementById('createTreasurerForm');
    const formData = new FormData(form);
    
    const treasurerData = {
        fullName: document.getElementById('treasurerFullName').value.trim(),
        username: document.getElementById('treasurerUsername').value.trim(),
        password: document.getElementById('treasurerPassword').value,
        department: document.getElementById('treasurerDepartment').value,
        section: document.getElementById('treasurerSection').value,
        startDate: document.getElementById('treasurerStartDate').value || new Date().toISOString().split('T')[0]
    };
    
    // Validation
    if (!treasurerData.fullName || !treasurerData.username || !treasurerData.password || 
        !treasurerData.department || !treasurerData.section) {
        showToast('Please fill in all required fields', 'error');
        return;
    }
    
    if (treasurerData.password.length < 6) {
        showToast('Password must be at least 6 characters', 'error');
        return;
    }
    
    try {
        showLoading('Creating treasurer...');
        
        const response = await API.createTreasurer(treasurerData);
        
        hideLoading();
        
        if (response.status === 'ok') {
            showToast('Treasurer created successfully!', 'success');
            closeModal('createTreasurerModal');
            
            // Refresh treasurers data
            await loadTreasurersData();
            
            // Switch to treasurers view
            switchSection('treasurers');
        } else {
            throw new Error(response.message);
        }
    } catch (error) {
        hideLoading();
        console.error('Failed to create treasurer:', error);
        showToast('Failed to create treasurer: ' + error.message, 'error');
    }
}

/**
 * Refresh functions
 */
async function refreshDashboard() {
    await loadDashboardData();
    showToast('Dashboard refreshed', 'success');
}

async function refreshSections() {
    await loadSectionsData();
    showToast('Sections refreshed', 'success');
}

async function refreshTreasurers() {
    await loadTreasurersData();
    showToast('Treasurers refreshed', 'success');
}

async function refreshStudents() {
    await loadStudentsData();
    showToast('Students refreshed', 'success');
}

/**
 * Setup auto-refresh
 */
function setupAutoRefresh() {
    // Refresh data every 5 minutes
    setInterval(async () => {
        if (currentSection === 'dashboard') {
            await loadDashboardData();
        }
    }, 5 * 60 * 1000);
}

/**
 * Utility functions
 */
function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

function showLoading(message = 'Loading...') {
    // Create or update loading overlay
    let overlay = document.getElementById('loadingOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'loadingOverlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1100;
            color: white;
            font-size: 1.2rem;
        `;
        document.body.appendChild(overlay);
    }
    
    overlay.innerHTML = `
        <div style="text-align: center;">
            <div class="spinner" style="margin: 0 auto 1rem; border-color: rgba(255,255,255,0.3); border-top-color: white;"></div>
            ${message}
        </div>
    `;
    overlay.style.display = 'flex';
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
}

function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    
    toast.className = `toast show alert-${type}`;
    toast.innerHTML = `
        <div class="toast-header">
            <span class="toast-title">${type.charAt(0).toUpperCase() + type.slice(1)}</span>
            <span class="toast-time">now</span>
        </div>
        <div class="toast-body">${message}</div>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.remove();
    }, duration);
}

// Placeholder functions for future implementation
function editSection(sectionId) {
    showToast('Edit section feature coming soon', 'info');
}

function deactivateSection(sectionId) {
    if (confirm('Are you sure you want to deactivate this section?')) {
        showToast('Section deactivation feature coming soon', 'info');
    }
}

function editTreasurer(treasurerId) {
    showToast('Edit treasurer feature coming soon', 'info');
}

function deactivateTreasurer(treasurerId) {
    if (confirm('Are you sure you want to deactivate this treasurer?')) {
        showToast('Treasurer deactivation feature coming soon', 'info');
    }
}

function viewStudentHistory(studentId) {
    showToast('Student history feature coming soon', 'info');
}

function loadReportsData() {
    showToast('Reports section coming soon', 'info');
}

function loadAuditLogData() {
    showToast('Audit log section coming soon', 'info');
}

function loadSettings() {
    showToast('Settings section coming soon', 'info');
}

function exportSystemReport() {
    showToast('Export feature coming soon', 'info');
}

function showAuditLog() {
    switchSection('audit');
}