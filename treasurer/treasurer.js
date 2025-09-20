/**
 * Treasurer Dashboard JavaScript
 * Handles treasurer-specific functionality including payment recording, student management, and reporting
 */

let currentSection = 'dashboard';
let studentsData = [];
let paymentsData = [];
let dashboardData = {};
let currentUser = null;

/**
 * Initialize treasurer dashboard
 */
async function initializeTreasurer() {
    try {
        currentUser = Auth.getCurrentUser();
        
        // Update user info in header
        updateUserInfo();
        
        // Setup navigation
        setupNavigation();
        
        // Setup mobile hamburger menu
        setupMobileMenu();
        
        // Setup payment form
        setupPaymentForm();
        
        // Load initial dashboard data
        await loadDashboardData();
        
        // Setup real-time updates
        setupAutoRefresh();
        
        console.log('Treasurer dashboard initialized successfully');
    } catch (error) {
        console.error('Failed to initialize treasurer dashboard:', error);
        showToast('Failed to load dashboard. Please refresh the page.', 'error');
    }
}

/**
 * Update user info in header
 */
function updateUserInfo() {
    const userInfo = Auth.getUserDisplayInfo();
    if (userInfo) {
        document.getElementById('top_user').textContent = `${userInfo.name} | Dept: ${userInfo.department} | Section: ${userInfo.section}`;
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
 * Setup payment form with enhanced real-time validation
 */
function setupPaymentForm() {
    const paymentForm = document.getElementById('paymentForm');
    const amountInput = document.getElementById('input_amount');
    const receiptInput = document.getElementById('input_physical_receipt_no');
    const studentSelect = document.getElementById('paymentStudent');
    const paymentDateInput = document.getElementById('paymentDate');
    
    // Set default payment date to today
    paymentDateInput.value = new Date().toISOString().split('T')[0];
    
    // Real-time validation with debouncing
    let validationTimeout;
    
    const triggerValidation = () => {
        clearTimeout(validationTimeout);
        validationTimeout = setTimeout(validatePaymentFormRealTime, 300);
    };
    
    // Setup event listeners
    amountInput.addEventListener('input', triggerValidation);
    amountInput.addEventListener('blur', triggerValidation);
    receiptInput.addEventListener('input', triggerValidation);
    receiptInput.addEventListener('blur', triggerValidation);
    studentSelect.addEventListener('change', triggerValidation);
    paymentDateInput.addEventListener('change', triggerValidation);
    
    // Form submission
    paymentForm.addEventListener('submit', handlePaymentSubmission);
}

/**
 * Real-time payment form validation
 */
async function validatePaymentFormRealTime() {
    const studentId = document.getElementById('paymentStudent').value;
    const amount = document.getElementById('input_amount').value;
    const receiptNo = document.getElementById('input_physical_receipt_no').value.trim();
    const paymentDate = document.getElementById('paymentDate').value;
    
    // Skip if no significant data entered
    if (!amount && !receiptNo && !studentId) {
        clearValidationErrors();
        return;
    }
    
    try {
        const paymentData = {
            studentId: studentId,
            amount: parseFloat(amount) || 0,
            physicalReceiptNo: receiptNo,
            paymentDate: paymentDate
        };
        
        const response = await API.validatePaymentData(paymentData);
        
        if (response.status === 'ok') {
            const validation = response.data.validation;
            updateValidationUI(validation);
            updateSubmitButton(response.data.canProceed);
        } else {
            console.warn('Validation error:', response.message);
        }
    } catch (error) {
        console.warn('Real-time validation failed:', error);
        // Don't show errors for network issues during typing
    }
}

/**
 * Update validation UI based on server response
 */
function updateValidationUI(validation) {
    // Amount validation
    const amountInput = document.getElementById('input_amount');
    const amountError = document.getElementById('amountError');
    
    if (validation.amount.valid) {
        amountInput.classList.remove('error');
        amountError.style.display = 'none';
    } else {
        amountInput.classList.add('error');
        amountError.textContent = validation.amount.message;
        amountError.style.display = 'block';
    }
    
    // Receipt number validation
    const receiptInput = document.getElementById('input_physical_receipt_no');
    let receiptError = document.getElementById('receiptError');
    
    if (!receiptError) {
        receiptError = document.createElement('div');
        receiptError.id = 'receiptError';
        receiptError.className = 'error-message';
        receiptInput.parentNode.appendChild(receiptError);
    }
    
    if (validation.receiptNumber.valid) {
        receiptInput.classList.remove('error');
        receiptError.style.display = 'none';
    } else {
        receiptInput.classList.add('error');
        receiptError.textContent = validation.receiptNumber.message;
        receiptError.style.display = 'block';
    }
    
    // Student validation
    const studentSelect = document.getElementById('paymentStudent');
    let studentError = document.getElementById('studentError');
    
    if (!studentError) {
        studentError = document.createElement('div');
        studentError.id = 'studentError';
        studentError.className = 'error-message';
        studentSelect.parentNode.appendChild(studentError);
    }
    
    if (validation.student.valid) {
        studentSelect.classList.remove('error');
        studentError.style.display = 'none';
    } else {
        studentSelect.classList.add('error');
        studentError.textContent = validation.student.message;
        studentError.style.display = 'block';
    }
    
    // Duplicate payment warning
    let duplicateWarning = document.getElementById('duplicateWarning');
    
    if (!validation.duplicate.valid) {
        if (!duplicateWarning) {
            duplicateWarning = document.createElement('div');
            duplicateWarning.id = 'duplicateWarning';
            duplicateWarning.className = 'alert alert-warning';
            duplicateWarning.style.marginTop = '10px';
            document.getElementById('paymentForm').insertBefore(duplicateWarning, document.getElementById('paymentForm').lastElementChild);
        }
        duplicateWarning.textContent = validation.duplicate.message;
        duplicateWarning.style.display = 'block';
    } else if (duplicateWarning) {
        duplicateWarning.style.display = 'none';
    }
}

/**
 * Update submit button state
 */
function updateSubmitButton(canProceed) {
    const saveBtn = document.getElementById('btn_save_payment');
    saveBtn.disabled = !canProceed;
    
    if (canProceed) {
        saveBtn.classList.remove('btn-disabled');
        saveBtn.classList.add('btn-primary');
    } else {
        saveBtn.classList.add('btn-disabled');
        saveBtn.classList.remove('btn-primary');
    }
}

/**
 * Clear all validation errors
 */
function clearValidationErrors() {
    const errorElements = document.querySelectorAll('.error-message, .alert-warning');
    errorElements.forEach(el => el.style.display = 'none');
    
    const inputElements = document.querySelectorAll('.error');
    inputElements.forEach(el => el.classList.remove('error'));
    
    updateSubmitButton(false);
}

/**
 * Enhanced payment amount validation (client-side)
 */
function validatePaymentAmount() {
    const amountInput = document.getElementById('input_amount');
    const errorDiv = document.getElementById('amountError');
    const amount = parseFloat(amountInput.value);
    
    const validation = API.validatePaymentAmount(amount);
    
    if (!validation.valid) {
        amountInput.classList.add('error');
        errorDiv.textContent = validation.message;
        errorDiv.style.display = 'block';
        return false;
    } else {
        amountInput.classList.remove('error');
        errorDiv.style.display = 'none';
        return true;
    }
}

/**
 * Handle payment form submission
 */
async function handlePaymentSubmission(e) {
    e.preventDefault();
    
    // Validate form
    if (!validatePaymentForm()) {
        return;
    }
    
    const formData = getPaymentFormData();
    await recordPayment(formData);
}

/**
 * Enhanced payment form validation
 */
function validatePaymentForm() {
    const studentId = document.getElementById('paymentStudent').value;
    const amount = document.getElementById('input_amount').value;
    const receiptNo = document.getElementById('input_physical_receipt_no').value.trim();
    const paymentDate = document.getElementById('paymentDate').value;
    
    let isValid = true;
    let firstError = null;
    
    // Student validation
    if (!studentId) {
        showToast('Please select a student', 'error');
        return false;
    }
    
    // Amount validation
    const amountValidation = API.validatePaymentAmount(amount);
    if (!amountValidation.valid) {
        showToast(amountValidation.message, 'error');
        if (!firstError) firstError = document.getElementById('input_amount');
        isValid = false;
    }
    
    // Receipt number validation
    if (!receiptNo) {
        showToast('Physical receipt number is required', 'error');
        if (!firstError) firstError = document.getElementById('input_physical_receipt_no');
        isValid = false;
    }
    
    // Payment date validation
    if (!paymentDate) {
        showToast('Payment date is required', 'error');
        if (!firstError) firstError = document.getElementById('paymentDate');
        isValid = false;
    }
    
    // Focus on first error field
    if (firstError) {
        firstError.focus();
    }
    
    return isValid;
}

/**
 * Get payment form data
 */
function getPaymentFormData() {
    return {
        studentId: document.getElementById('paymentStudent').value,
        amount: parseFloat(document.getElementById('input_amount').value),
        paymentDate: document.getElementById('paymentDate').value,
        physicalReceiptNo: document.getElementById('input_physical_receipt_no').value.trim(),
        notes: document.getElementById('paymentNotes').value.trim(),
        idempotencyKey: API.generateUUID()
    };
}

/**
 * Record payment
 */
async function recordPayment(paymentData) {
    const saveBtn = document.getElementById('btn_save_payment');
    const saveText = document.getElementById('savePaymentText');
    const saveSpinner = document.getElementById('savePaymentSpinner');
    
    try {
        // Show loading state
        saveBtn.disabled = true;
        saveText.style.display = 'none';
        saveSpinner.style.display = 'inline-block';
        
        const response = await API.recordPayment(paymentData);
        
        if (response.status === 'ok') {
            const receiptNo = response.data.receiptNo || 'Generated';
            const paymentId = response.data.paymentId;
            
            showToast(`Payment recorded successfully! Receipt No: ${receiptNo}. PaymentID: ${paymentId}`, 'success');
            
            // Clear form
            clearPaymentForm();
            
            // Refresh data
            await loadDashboardData();
            await loadStudentsData();
            
            // Switch to dashboard to see updated stats
            switchSection('dashboard');
        } else {
            throw new Error(response.message);
        }
    } catch (error) {
        console.error('Failed to record payment:', error);
        showToast('Failed to record payment: ' + error.message, 'error');
    } finally {
        // Reset loading state
        saveBtn.disabled = false;
        saveText.style.display = 'inline';
        saveSpinner.style.display = 'none';
    }
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
            case 'students':
                await loadStudentsData();
                break;
            case 'payments':
                await loadPaymentFormData();
                break;
            case 'reports':
                await loadReportsData();
                break;
            case 'receipts':
                await loadReceiptsData();
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
            updateDashboardDisplay();
        } else {
            throw new Error(response.message);
        }
    } catch (error) {
        console.error('Failed to load dashboard data:', error);
        showToast('Failed to load dashboard data', 'error');
    }
}

/**
 * Update dashboard display
 */
function updateDashboardDisplay() {
    // Section info
    document.getElementById('dashboardSection').textContent = dashboardData.section || 'N/A';
    document.getElementById('dashboardTreasurer').textContent = dashboardData.treasurer || 'N/A';
    document.getElementById('dashboardStudentCount').textContent = dashboardData.totalStudents || 0;
    
    // Statistics
    document.getElementById('expectedAmount').textContent = API.formatCurrency(dashboardData.totalExpected || 0);
    document.getElementById('collectedAmount').textContent = API.formatCurrency(dashboardData.totalCollected || 0);
    document.getElementById('remainingAmount').textContent = API.formatCurrency(dashboardData.remaining || 0);
    document.getElementById('progressPercent').textContent = (dashboardData.progress || 0) + '%';
    
    // Progress bar
    const progressBar = document.getElementById('progressBar');
    progressBar.style.width = (dashboardData.progress || 0) + '%';
}

/**
 * Load students data
 */
async function loadStudentsData() {
    try {
        const response = await API.getStudents();
        
        if (response.status === 'ok') {
            // Filter students for current treasurer's section
            studentsData = response.data.students.filter(student => 
                student.sectionId === currentUser.section
            );
            displayStudentsTable();
        } else {
            throw new Error(response.message);
        }
    } catch (error) {
        console.error('Failed to load students:', error);
        document.getElementById('studentsTableBody').innerHTML = `
            <tr><td colspan="6" class="alert alert-error">Failed to load students</td></tr>
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
                <td colspan="6" class="empty-state">
                    <div class="empty-state-icon">🎓</div>
                    <div class="empty-state-title">No Students Found</div>
                    <div class="empty-state-text">No students in your section</div>
                </td>
            </tr>
        `;
        return;
    }
    
    const rowsHtml = data.map((student, index) => `
        <tr>
            <td data-label="#">${index + 1}</td>
            <td data-label="Student Name"><strong>${student.fullName}</strong></td>
            <td data-label="Student No"><code>${student.studentNo || 'N/A'}</code></td>
            <td data-label="Given">${API.formatCurrency(student.totalPaid)}</td>
            <td data-label="Remaining">${API.formatCurrency(student.remaining)}</td>
            <td data-label="Action">
                <button class="btn btn-sm btn-secondary" onclick="viewStudentHistory('${student.studentId}')">
                    View History
                </button>
            </td>
        </tr>
    `).join('');
    
    tbody.innerHTML = rowsHtml;
}

/**
 * Load payment form data
 */
async function loadPaymentFormData() {
    try {
        // Populate student dropdown
        const studentSelect = document.getElementById('paymentStudent');
        
        if (!studentsData.length) {
            await loadStudentsData();
        }
        
        studentSelect.innerHTML = '<option value="">Select Student</option>' +
            studentsData.map(student => 
                `<option value="${student.studentId}">
                    ${student.fullName} ${student.studentNo ? `(${student.studentNo})` : ''} - Remaining: ${API.formatCurrency(student.remaining)}
                </option>`
            ).join('');
            
    } catch (error) {
        console.error('Failed to load payment form data:', error);
    }
}

/**
 * Load reports data
 */
async function loadReportsData() {
    // Reports section is mostly static forms, no initial data loading needed
    console.log('Reports section loaded');
}

/**
 * Load receipts data
 */
async function loadReceiptsData() {
    try {
        // Load payments for receipt generation
        const response = await API.getPayments();
        
        if (response.status === 'ok') {
            paymentsData = response.data.payments;
            populateReceiptDropdown();
        } else {
            throw new Error(response.message);
        }
    } catch (error) {
        console.error('Failed to load receipts data:', error);
        showToast('Failed to load receipts data', 'error');
    }
}

/**
 * Populate receipt payment dropdown
 */
function populateReceiptDropdown() {
    const receiptSelect = document.getElementById('receiptPayment');
    
    if (!paymentsData || paymentsData.length === 0) {
        receiptSelect.innerHTML = '<option value="">No payments found</option>';
        return;
    }
    
    receiptSelect.innerHTML = '<option value="">Select a payment to generate receipt</option>' +
        paymentsData
            .filter(payment => !payment.isVoided)
            .map(payment => 
                `<option value="${payment.paymentId}">
                    ${payment.student ? payment.student.fullName : 'Unknown'} - ${API.formatCurrency(payment.amount)} - ${API.formatDate(payment.paymentDate)}
                </option>`
            ).join('');
}

/**
 * View student payment history
 */
async function viewStudentHistory(studentId) {
    try {
        showLoading('Loading payment history...');
        
        const response = await API.getPayments({ studentId: studentId });
        
        hideLoading();
        
        if (response.status === 'ok') {
            displayStudentHistory(studentId, response.data.payments);
        } else {
            throw new Error(response.message);
        }
    } catch (error) {
        hideLoading();
        console.error('Failed to load student history:', error);
        showToast('Failed to load payment history', 'error');
    }
}

/**
 * Display student history modal
 */
function displayStudentHistory(studentId, payments) {
    const student = studentsData.find(s => s.studentId === studentId);
    if (!student) return;
    
    document.getElementById('studentHistoryTitle').textContent = `Payment History — ${student.fullName} (${student.studentNo || 'N/A'})`;
    
    const totalExpected = student.expectedAmount || 0;
    const totalPaid = student.totalPaid || 0;
    const remaining = student.remaining || 0;
    const status = API.getPaymentStatus(totalExpected, totalPaid);
    
    const historyHtml = `
        <div class="page-section">
            <h4>Summary</h4>
            <div class="stats-grid" style="grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));">
                <div class="stat-card">
                    <div class="stat-label">Total Expected</div>
                    <div class="stat-value">${API.formatCurrency(totalExpected)}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Total Given</div>
                    <div class="stat-value">${API.formatCurrency(totalPaid)}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Remaining</div>
                    <div class="stat-value">${API.formatCurrency(remaining)}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Status</div>
                    <div class="stat-value">
                        <span class="badge ${status === 'PAID' ? 'badge-success' : status === 'PARTIAL' ? 'badge-warning' : 'badge-danger'}">
                            ${status}
                        </span>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="page-section">
            <h4>All Payments (Newest First)</h4>
            ${payments.length > 0 ? `
                <div class="table-container">
                    <table class="table table-sm">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Amount</th>
                                <th>Receipt No</th>
                                <th>Payment ID</th>
                                <th>Entered By</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${payments.map(payment => `
                                <tr>
                                    <td>${API.formatDate(payment.paymentDate)}</td>
                                    <td>${API.formatCurrency(payment.amount)}</td>
                                    <td><code>${payment.physicalReceiptNo}</code></td>
                                    <td><code>${payment.paymentId}</code></td>
                                    <td>${payment.enteredBy}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            ` : '<p><em>No payments recorded yet</em></p>'}
        </div>
    `;
    
    document.getElementById('studentHistoryContent').innerHTML = historyHtml;
    showModal('studentHistoryModal');
}

/**
 * Generate enhanced print summary with multiple options
 */
async function generatePrintSummary() {
    try {
        const reportType = document.querySelector('input[name="reportType"]:checked').value;
        const month = document.getElementById('reportMonth').value;
        const format = document.querySelector('input[name="reportFormat"]:checked')?.value || 'text';
        
        const options = {
            period: reportType,
            sectionId: currentUser.section,
            reportType: 'summary',
            format: format
        };
        
        if (reportType === 'monthly' && month) {
            options.month = month;
        }
        
        showLoading('Generating report...');
        
        let response;
        if (format === 'detailed') {
            // Use detailed report for comprehensive data
            response = await API.generateDetailedReport({
                sectionId: currentUser.section,
                reportType: 'detailed',
                format: 'text'
            });
        } else {
            response = await API.printSummary(options);
        }
        
        hideLoading();
        
        if (response.status === 'ok') {
            const content = response.data.summary || response.data.report;
            document.getElementById('summaryContent').textContent = content;
            document.getElementById('summaryPreview').style.display = 'block';
            
            // Store for printing
            window.currentReportContent = content;
            window.currentReportTitle = `SSC Collection Report - ${reportType}`;
            
            // Auto-scroll to preview
            document.getElementById('summaryPreview').scrollIntoView({ behavior: 'smooth' });
            
            showToast('Report generated successfully!', 'success');
        } else {
            throw new Error(response.message);
        }
    } catch (error) {
        hideLoading();
        console.error('Failed to generate report:', error);
        showToast('Failed to generate report: ' + error.message, 'error');
    }
}

/**
 * Generate detailed report with multiple export options
 */
async function generateDetailedReport() {
    try {
        const dateFrom = document.getElementById('reportDateFrom')?.value;
        const dateTo = document.getElementById('reportDateTo')?.value;
        const format = document.querySelector('input[name="detailedFormat"]:checked')?.value || 'text';
        
        showLoading('Generating detailed report...');
        
        const options = {
            sectionId: currentUser.section,
            reportType: 'detailed',
            format: format
        };
        
        if (dateFrom) options.dateFrom = dateFrom;
        if (dateTo) options.dateTo = dateTo;
        
        const response = await API.generateDetailedReport(options);
        
        hideLoading();
        
        if (response.status === 'ok') {
            if (format === 'html') {
                // Open in new window for HTML reports
                const newWindow = window.open('', '_blank');
                newWindow.document.write(response.data.report);
                newWindow.document.close();
            } else {
                const content = response.data.report;
                document.getElementById('summaryContent').textContent = content;
                document.getElementById('summaryPreview').style.display = 'block';
                
                window.currentReportContent = content;
                window.currentReportTitle = 'SSC Detailed Report';
                
                document.getElementById('summaryPreview').scrollIntoView({ behavior: 'smooth' });
            }
            
            showToast('Detailed report generated successfully!', 'success');
        } else {
            throw new Error(response.message);
        }
    } catch (error) {
        hideLoading();
        console.error('Failed to generate detailed report:', error);
        showToast('Failed to generate detailed report: ' + error.message, 'error');
    }
}

/**
 * Enhanced print summary function
 */
function printSummary() {
    const summaryContent = window.currentReportContent || document.getElementById('summaryContent').textContent;
    const title = window.currentReportTitle || 'SSC Collection Summary';
    
    if (!summaryContent) {
        showToast('Please generate a report first', 'warning');
        switchSection('reports');
        return;
    }
    
    API.printContent(summaryContent, title);
}

/**
 * Download summary as file
 */
function downloadSummary() {
    const summaryContent = window.currentReportContent || document.getElementById('summaryContent').textContent;
    const title = window.currentReportTitle || 'SSC Collection Summary';
    
    if (!summaryContent) {
        showToast('Please generate a report first', 'warning');
        return;
    }
    
    const filename = `${title.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.txt`;
    API.downloadFile(summaryContent, filename);
    showToast('Report downloaded successfully!', 'success');
}

/**
 * Clear payment form
 */
function clearPaymentForm() {
    document.getElementById('paymentForm').reset();
    document.getElementById('paymentDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('amountError').style.display = 'none';
    document.getElementById('input_amount').classList.remove('error');
}

/**
 * Record payment modal functions
 */
function showRecordPaymentModal() {
    // Populate quick payment form
    populateQuickPaymentStudents();
    showModal('recordPaymentModal');
}

function populateQuickPaymentStudents() {
    const quickStudentSelect = document.getElementById('quickPaymentStudent');
    
    if (!studentsData.length) {
        quickStudentSelect.innerHTML = '<option value="">No students available</option>';
        return;
    }
    
    quickStudentSelect.innerHTML = '<option value="">Select Student</option>' +
        studentsData
            .filter(student => student.remaining > 0)
            .map(student => 
                `<option value="${student.studentId}">
                    ${student.fullName} - Remaining: ${API.formatCurrency(student.remaining)}
                </option>`
            ).join('');
}

async function saveQuickPayment() {
    const studentId = document.getElementById('quickPaymentStudent').value;
    const amount = parseFloat(document.getElementById('quickPaymentAmount').value);
    const receiptNo = document.getElementById('quickReceiptNo').value.trim();
    
    if (!studentId || !amount || !receiptNo) {
        showToast('Please fill in all fields', 'error');
        return;
    }
    
    const validation = API.validatePaymentAmount(amount);
    if (!validation.valid) {
        showToast(validation.message, 'error');
        return;
    }
    
    const paymentData = {
        studentId: studentId,
        amount: amount,
        paymentDate: new Date().toISOString().split('T')[0],
        physicalReceiptNo: receiptNo,
        idempotencyKey: API.generateUUID()
    };
    
    try {
        await recordPayment(paymentData);
        closeModal('recordPaymentModal');
        document.getElementById('quickPaymentForm').reset();
    } catch (error) {
        console.error('Failed to save quick payment:', error);
    }
}

/**
 * Cash handover functions
 */
function showCashHandoverModal() {
    showModal('cashHandoverModal');
}

async function saveCashHandover() {
    const amount = parseFloat(document.getElementById('handoverAmount').value);
    const custodianName = document.getElementById('custodianName').value.trim();
    const notes = document.getElementById('handoverNotes').value.trim();
    
    if (!amount || !custodianName) {
        showToast('Amount and custodian name are required', 'error');
        return;
    }
    
    try {
        showLoading('Recording handover...');
        
        const response = await API.recordCashHandover({
            amount: amount,
            custodianName: custodianName,
            notes: notes
        });
        
        hideLoading();
        
        if (response.status === 'ok') {
            showToast('Cash handover recorded successfully!', 'success');
            closeModal('cashHandoverModal');
            document.getElementById('form_cash_handover').reset();
        } else {
            throw new Error(response.message);
        }
    } catch (error) {
        hideLoading();
        console.error('Failed to record cash handover:', error);
        showToast('Failed to record cash handover: ' + error.message, 'error');
    }
}

/**
 * Enhanced receipt generation with multiple formats
 */
async function generatePaymentReceipt() {
    const paymentId = document.getElementById('receiptPayment').value;
    const format = document.querySelector('input[name="receiptFormat"]:checked')?.value || 'text';
    
    if (!paymentId) {
        showToast('Please select a payment first', 'warning');
        return;
    }
    
    try {
        showLoading('Generating receipt...');
        
        const response = await API.generateReceipt(paymentId, format);
        
        hideLoading();
        
        if (response.status === 'ok') {
            const receipt = response.data.receipt;
            const isHtml = format === 'html';
            
            if (isHtml) {
                // Open HTML receipt in new window
                const receiptWindow = window.open('', '_blank');
                receiptWindow.document.write(`
                    <!DOCTYPE html>
                    <html>
                        <head>
                            <title>Payment Receipt</title>
                            <meta charset="UTF-8">
                            <style>
                                body { margin: 0; padding: 20px; }
                                @media print {
                                    body { margin: 0; }
                                }
                            </style>
                        </head>
                        <body>
                            ${receipt}
                            <script>
                                window.onload = function() {
                                    setTimeout(function() {
                                        window.print();
                                    }, 500);
                                };
                            </script>
                        </body>
                    </html>
                `);
                receiptWindow.document.close();
            } else {
                // Print text receipt
                API.printContent(receipt, 'Payment Receipt');
            }
            
            showToast('Receipt generated successfully!', 'success');
        } else {
            throw new Error(response.message);
        }
    } catch (error) {
        hideLoading();
        console.error('Failed to generate receipt:', error);
        showToast('Failed to generate receipt: ' + error.message, 'error');
    }
}

/**
 * Download receipt as file
 */
async function downloadReceipt() {
    const paymentId = document.getElementById('receiptPayment').value;
    const format = document.querySelector('input[name="receiptFormat"]:checked')?.value || 'text';
    
    if (!paymentId) {
        showToast('Please select a payment first', 'warning');
        return;
    }
    
    try {
        showLoading('Preparing download...');
        
        const response = await API.generateReceipt(paymentId, format);
        
        hideLoading();
        
        if (response.status === 'ok') {
            const receipt = response.data.receipt;
            const payment = response.data.data.payment;
            const student = response.data.data.student;
            
            const filename = `Receipt_${payment.paymentId}_${student ? student.fullName.replace(/\s+/g, '_') : 'Unknown'}.${format === 'html' ? 'html' : 'txt'}`;
            
            if (format === 'html') {
                API.downloadHtml(receipt, filename);
            } else {
                API.downloadFile(receipt, filename);
            }
            
            showToast('Receipt downloaded successfully!', 'success');
        } else {
            throw new Error(response.message);
        }
    } catch (error) {
        hideLoading();
        console.error('Failed to download receipt:', error);
        showToast('Failed to download receipt: ' + error.message, 'error');
    }
}

/**
 * Export data functions
 */
async function exportExcel() {
    try {
        const exportType = document.getElementById('exportType')?.value || 'students';
        
        showLoading('Preparing Excel export...');
        
        const response = await API.exportExcel(currentUser.section, exportType);
        
        hideLoading();
        
        if (response.status === 'ok') {
            const csvData = response.data.csvData;
            const filename = response.data.filename;
            
            API.downloadCsv(csvData, filename);
            showToast('Excel file downloaded successfully!', 'success');
        } else {
            throw new Error(response.message);
        }
    } catch (error) {
        hideLoading();
        console.error('Failed to export Excel:', error);
        showToast('Failed to export Excel: ' + error.message, 'error');
    }
}

async function exportPDF() {
    showToast('PDF export feature coming soon', 'info');
}

/**
 * Generate student-specific report
 */
async function generateStudentReport(studentId) {
    try {
        showLoading('Generating student report...');
        
        const response = await API.generateStudentReport(studentId, 'text');
        
        hideLoading();
        
        if (response.status === 'ok') {
            const report = response.data.report;
            const student = response.data.data.student;
            
            // Display in modal or new window
            const reportWindow = window.open('', '_blank');
            reportWindow.document.write(`
                <html>
                    <head>
                        <title>Student Report - ${student.fullName}</title>
                        <style>
                            body { font-family: Arial, sans-serif; margin: 20px; }
                            pre { white-space: pre-wrap; font-family: monospace; }
                        </style>
                    </head>
                    <body>
                        <pre>${report}</pre>
                        <script>
                            window.onload = function() {
                                setTimeout(function() {
                                    window.print();
                                }, 500);
                            };
                        </script>
                    </body>
                </html>
            `);
            reportWindow.document.close();
            
            showToast('Student report generated successfully!', 'success');
        } else {
            throw new Error(response.message);
        }
    } catch (error) {
        hideLoading();
        console.error('Failed to generate student report:', error);
        showToast('Failed to generate student report: ' + error.message, 'error');
    }
}

function viewHandoverHistory() {
    showToast('Handover history feature coming soon', 'info');
}

function generateReceipt() {
    switchSection('receipts');
}

function printStudentHistory() {
    const historyContent = document.getElementById('studentHistoryContent').innerText;
    API.printContent(historyContent, 'Student Payment History');
}

/**
 * Enhanced student history display with print/export options
 */
function displayStudentHistory(studentId, payments) {
    const student = studentsData.find(s => s.studentId === studentId);
    if (!student) return;
    
    document.getElementById('studentHistoryTitle').textContent = `Payment History — ${student.fullName} (${student.studentNo || 'N/A'})`;
    
    const totalExpected = student.expectedAmount || 0;
    const totalPaid = student.totalPaid || 0;
    const remaining = student.remaining || 0;
    const status = API.getPaymentStatus(totalExpected, totalPaid);
    
    const historyHtml = `
        <div class="page-section">
            <h4>Summary</h4>
            <div class="stats-grid" style="grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));">
                <div class="stat-card">
                    <div class="stat-label">Total Expected</div>
                    <div class="stat-value">${API.formatCurrency(totalExpected)}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Total Given</div>
                    <div class="stat-value">${API.formatCurrency(totalPaid)}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Remaining</div>
                    <div class="stat-value">${API.formatCurrency(remaining)}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Status</div>
                    <div class="stat-value">
                        <span class="badge ${status === 'PAID' ? 'badge-success' : status === 'PARTIAL' ? 'badge-warning' : 'badge-danger'}">
                            ${status}
                        </span>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="page-section">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <h4>All Payments (Newest First)</h4>
                <div>
                    <button class="btn btn-sm btn-secondary" onclick="printStudentHistory()">
                        🖨️ Print
                    </button>
                    <button class="btn btn-sm btn-secondary" onclick="generateStudentReport('${studentId}')">
                        📄 Full Report
                    </button>
                </div>
            </div>
            ${payments.length > 0 ? `
                <div class="table-container">
                    <table class="table table-sm">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Amount</th>
                                <th>Receipt No</th>
                                <th>Payment ID</th>
                                <th>Entered By</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${payments.map(payment => `
                                <tr>
                                    <td>${API.formatDate(payment.paymentDate)}</td>
                                    <td>${API.formatCurrency(payment.amount)}</td>
                                    <td><code>${payment.physicalReceiptNo}</code></td>
                                    <td><code>${payment.paymentId}</code></td>
                                    <td>${payment.enteredBy}</td>
                                    <td>
                                        <button class="btn btn-xs btn-primary" onclick="printPaymentReceipt('${payment.paymentId}')">
                                            🧾 Receipt
                                        </button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            ` : '<p><em>No payments recorded yet</em></p>'}
        </div>
    `;
    
    document.getElementById('studentHistoryContent').innerHTML = historyHtml;
    showModal('studentHistoryModal');
}

/**
 * Print individual payment receipt
 */
async function printPaymentReceipt(paymentId) {
    try {
        showLoading('Generating receipt...');
        
        const response = await API.generateReceipt(paymentId, 'text');
        
        hideLoading();
        
        if (response.status === 'ok') {
            API.printContent(response.data.receipt, 'Payment Receipt');
        } else {
            throw new Error(response.message);
        }
    } catch (error) {
        hideLoading();
        console.error('Failed to print receipt:', error);
        showToast('Failed to print receipt: ' + error.message, 'error');
    }
}

/**
 * Refresh functions
 */
async function refreshDashboard() {
    await loadDashboardData();
    showToast('Dashboard refreshed', 'success');
}

async function refreshStudents() {
    await loadStudentsData();
    showToast('Students refreshed', 'success');
}

/**
 * Setup auto-refresh
 */
function setupAutoRefresh() {
    // Refresh dashboard data every 2 minutes
    setInterval(async () => {
        if (currentSection === 'dashboard') {
            await loadDashboardData();
        }
    }, 2 * 60 * 1000);
}

/**
 * Student search and filter
 */
document.addEventListener('DOMContentLoaded', function() {
    const searchInput = document.getElementById('student_search');
    const statusFilter = document.getElementById('studentStatusFilter');
    
    if (searchInput) {
        searchInput.addEventListener('input', filterStudents);
    }
    
    if (statusFilter) {
        statusFilter.addEventListener('change', filterStudents);
    }
});

function filterStudents() {
    const searchTerm = document.getElementById('student_search').value.toLowerCase();
    const statusFilter = document.getElementById('studentStatusFilter').value;
    
    let filteredData = studentsData.filter(student => {
        const matchesSearch = student.fullName.toLowerCase().includes(searchTerm) ||
                            (student.studentNo && student.studentNo.toLowerCase().includes(searchTerm));
        
        const matchesStatus = !statusFilter || student.paymentStatus === statusFilter;
        
        return matchesSearch && matchesStatus;
    });
    
    displayStudentsTable(filteredData);
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