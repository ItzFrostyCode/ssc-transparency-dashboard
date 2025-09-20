/**
 * API module for SSC Transparency Dashboard
 * Handles all API communications with Google Apps Script backend
 */

class ApiManager {
    constructor() {
        this.baseUrl = 'https://script.google.com/macros/s/AKfycbyKLtvOKIkbMQm0S1M3wwh4-0kZLTJ6lWnijDlZ0eQKqRVhT40Ry1WTd4bOhqNCOXqB/exec';
        this.retryAttempts = 3;
        this.retryDelay = 1000;
    }

    /**
     * Make authenticated API call with retry logic
     */
    async call(action, data = {}, options = {}) {
        const payload = {
            action: action,
            ...data
        };

        // Add authentication token
        if (Auth && Auth.getToken()) {
            payload.token = Auth.getToken();
        }

        let lastError;
        for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
            try {
                const response = await fetch(this.baseUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(payload),
                    ...options
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const result = await response.json();
                
                // Handle authentication errors
                if (result.status === 'error' && this.isAuthError(result.message)) {
                    if (Auth) {
                        Auth.clearSession();
                        Auth.redirectToLogin();
                    }
                    throw new Error('Authentication required');
                }

                return result;

            } catch (error) {
                lastError = error;
                console.warn(`API call attempt ${attempt} failed:`, error.message);

                // Don't retry on auth errors or client errors
                if (this.isAuthError(error.message) || error.message.includes('HTTP 4')) {
                    break;
                }

                // Wait before retry (except on last attempt)
                if (attempt < this.retryAttempts) {
                    await this.delay(this.retryDelay * attempt);
                }
            }
        }

        throw lastError;
    }

    /**
     * Check if error is authentication related
     */
    isAuthError(message) {
        const authKeywords = ['unauthorized', 'session', 'token', 'login', 'expired'];
        return authKeywords.some(keyword => 
            message.toLowerCase().includes(keyword)
        );
    }

    /**
     * Delay utility for retries
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Section Management APIs
     */
    async getSections() {
        return this.call('getSections');
    }

    async createSection(sectionData) {
        return this.call('createSection', sectionData);
    }

    async editSection(sectionId, sectionData) {
        return this.call('editSection', { sectionId, ...sectionData });
    }

    async deactivateSection(sectionId) {
        return this.call('deactivateSection', { sectionId });
    }

    /**
     * Student Management APIs
     */
    async getStudents(sectionId = null) {
        return this.call('getStudents', sectionId ? { sectionId } : {});
    }

    async addStudent(studentData) {
        return this.call('addStudent', studentData);
    }

    async removeStudent(studentId) {
        return this.call('removeStudent', { studentId });
    }

    /**
     * Treasurer Management APIs
     */
    async getTreasurers() {
        return this.call('getTreasurers');
    }

    async createTreasurer(treasurerData) {
        return this.call('createTreasurer', treasurerData);
    }

    async editTreasurer(treasurerId, treasurerData) {
        return this.call('editTreasurer', { treasurerId, ...treasurerData });
    }

    async deactivateTreasurer(treasurerId) {
        return this.call('deactivateTreasurer', { treasurerId });
    }

    /**
     * Payment Management APIs
     */
    async recordPayment(paymentData) {
        // Generate idempotency key if not provided
        if (!paymentData.idempotencyKey) {
            paymentData.idempotencyKey = this.generateUUID();
        }
        return this.call('recordPayment', paymentData);
    }

    /**
     * Validate payment data without recording (for real-time validation)
     */
    async validatePaymentData(paymentData) {
        return this.call('validatePaymentData', paymentData);
    }

    async getPayments(filters = {}) {
        return this.call('getPayments', filters);
    }

    async voidPayment(paymentId, reason) {
        return this.call('voidPayment', { paymentId, reason });
    }

    /**
     * Dashboard and Reporting APIs
     */
    async getDashboardData(sectionId = null) {
        return this.call('getDashboardData', sectionId ? { sectionId } : {});
    }

    async printSummary(options = {}) {
        return this.call('printSummary', options);
    }

    async generateReceipt(paymentId, format = 'text') {
        return this.call('generateReceipt', { paymentId, format });
    }

    async generateDetailedReport(options = {}) {
        return this.call('generateDetailedReport', options);
    }

    async generateStudentReport(studentId, format = 'text') {
        return this.call('generateStudentReport', { studentId, format });
    }

    async exportExcel(sectionId = null, exportType = 'students') {
        return this.call('exportExcel', { sectionId, exportType });
    }

    async recordCashHandover(handoverData) {
        return this.call('recordCashHandover', handoverData);
    }

    /**
     * System APIs
     */
    async getDepartments() {
        return this.call('getDepartments');
    }

    async getAuditLog(filters = {}) {
        return this.call('getAuditLog', filters);
    }

    /**
     * Utility function to generate UUID
     */
    generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * Format currency for display
     */
    formatCurrency(amount) {
        return new Intl.NumberFormat('en-PH', {
            style: 'currency',
            currency: 'PHP',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(amount || 0);
    }

    /**
     * Format date for display
     */
    formatDate(date, options = {}) {
        if (!date) return '';
        
        const defaultOptions = {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        };

        return new Date(date).toLocaleDateString('en-PH', {
            ...defaultOptions,
            ...options
        });
    }

    /**
     * Validate payment amount (enhanced with backend rules)
     */
    validatePaymentAmount(amount) {
        const num = parseFloat(amount);
        
        if (isNaN(num)) {
            return {
                valid: false,
                message: 'Amount must be a valid number'
            };
        }

        if (num <= 0) {
            return {
                valid: false,
                message: 'Amount must be greater than zero'
            };
        }

        if (num < 5) {
            return {
                valid: false,
                message: 'Minimum amount is ₱5'
            };
        }

        if (num > 10000) {
            return {
                valid: false,
                message: 'Maximum amount is ₱10,000'
            };
        }

        if (num % 5 !== 0) {
            return {
                valid: false,
                message: 'Amount must be a multiple of 5'
            };
        }

        return { 
            valid: true,
            message: 'Valid amount'
        };
    }

    /**
     * Parse student data from CSV or text input
     */
    parseStudentData(input) {
        if (!input || typeof input !== 'string') {
            return [];
        }

        const lines = input.split('\n').filter(line => line.trim());
        const students = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // Try to parse "StudentNo | Name" format
            if (trimmed.includes('|')) {
                const parts = trimmed.split('|').map(p => p.trim());
                if (parts.length >= 2 && parts[1]) {
                    students.push({
                        studentNo: parts[0] || '',
                        fullName: parts[1]
                    });
                }
            } else {
                // Treat as just name
                students.push({
                    studentNo: '',
                    fullName: trimmed
                });
            }
        }

        return students;
    }

    /**
     * Get payment status based on amounts
     */
    getPaymentStatus(expectedAmount, totalPaid) {
        const remaining = expectedAmount - totalPaid;
        
        if (remaining <= 0) {
            return 'PAID';
        } else if (totalPaid > 0) {
            return 'PARTIAL';
        } else {
            return 'NOT_PAID';
        }
    }

    /**
     * Calculate progress percentage
     */
    calculateProgress(collected, expected) {
        if (!expected || expected === 0) return 0;
        return Math.round((collected / expected) * 100);
    }

    /**
     * Download data as CSV
     */
    downloadCSV(data, filename) {
        if (!data || !data.length) {
            console.warn('No data to download');
            return;
        }

        // Convert data to CSV
        const headers = Object.keys(data[0]);
        const csvContent = [
            headers.join(','),
            ...data.map(row => 
                headers.map(header => {
                    const value = row[header];
                    return typeof value === 'string' && value.includes(',') 
                        ? `"${value}"` 
                        : value;
                }).join(',')
            )
        ].join('\n');

        // Create and download file
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    /**
     * Print content with enhanced formatting
     */
    printContent(content, title = 'SSC Report', isHtml = false) {
        const printWindow = window.open('', '_blank');
        
        const formattedContent = isHtml ? content : `<pre>${content}</pre>`;
        
        printWindow.document.write(`
            <html>
                <head>
                    <title>${title}</title>
                    <style>
                        body { 
                            font-family: Arial, sans-serif; 
                            margin: 20px; 
                            line-height: 1.4;
                            color: #333;
                        }
                        pre { 
                            white-space: pre-wrap; 
                            font-family: 'Courier New', monospace;
                            font-size: 12px;
                        }
                        h1, h2, h3 { color: #2563eb; }
                        table { border-collapse: collapse; width: 100%; }
                        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                        th { background-color: #f8f9fa; }
                        @media print {
                            @page { margin: 0.5in; }
                            body { font-size: 11px; }
                        }
                    </style>
                </head>
                <body>
                    ${formattedContent}
                </body>
            </html>
        `);
        
        printWindow.document.close();
        
        // Auto-print after a short delay
        setTimeout(() => {
            printWindow.print();
        }, 500);
    }

    /**
     * Download content as file
     */
    downloadFile(content, filename, mimeType = 'text/plain') {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        URL.revokeObjectURL(url);
    }

    /**
     * Download CSV file
     */
    downloadCsv(csvData, filename) {
        this.downloadFile(csvData, filename, 'text/csv');
    }

    /**
     * Download HTML file
     */
    downloadHtml(htmlContent, filename) {
        const fullHtml = `
            <!DOCTYPE html>
            <html>
                <head>
                    <meta charset="UTF-8">
                    <title>SSC Report</title>
                    <style>
                        body { font-family: Arial, sans-serif; margin: 20px; line-height: 1.6; }
                        table { border-collapse: collapse; width: 100%; margin: 20px 0; }
                        th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
                        th { background-color: #f8f9fa; font-weight: bold; }
                        .header { text-align: center; margin-bottom: 30px; }
                        .summary { background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; }
                    </style>
                </head>
                <body>
                    ${htmlContent}
                </body>
            </html>
        `;
        
        this.downloadFile(fullHtml, filename, 'text/html');
    }
}

// Create global instance
const API = new ApiManager();