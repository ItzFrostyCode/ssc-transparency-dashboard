/**
 * Authentication module for SSC Transparency Dashboard
 * Handles login, logout, session management, and API communication
 */

const API_BASE_URL = 'https://script.google.com/macros/s/AKfycbxV3HkBA2mNkrWLL3tHviMJGwzIzucZXqoh6xZa9iYR9ToUFIkuDFKGwBkqgJ0kqXGp/exec';

class AuthManager {
    constructor() {
        this.currentUser = null;
        this.sessionTimeout = null;
        this.inactivityTimeout = null;
        this.loadFromStorage();
        this.setupInactivityTracking();
    }

    /**
     * Login user with username and password
     */
    async login(username, password) {
        try {
            const response = await this.apiCall('login', {
                username: username,
                password: password
            });

            if (response.status === 'ok') {
                this.currentUser = response.data;
                this.saveToStorage();
                this.setupSessionTimeout();
                
                // Automatically redirect to appropriate dashboard
                this.redirectToDashboard();
                
                return {
                    success: true,
                    user: response.data
                };
            } else {
                return {
                    success: false,
                    message: response.message || 'Login failed'
                };
            }
        } catch (error) {
            console.error('Login error:', error);
            return {
                success: false,
                message: 'Network error. Please check your connection.'
            };
        }
    }

    /**
     * Redirect user to appropriate dashboard based on role
     */
    redirectToDashboard() {
        if (!this.currentUser) {
            this.redirectToLogin();
            return;
        }

        const role = this.currentUser.role;
        let targetUrl;

        switch (role) {
            case 'Admin':
                targetUrl = 'admin/dashboard.html';
                break;
            case 'Treasurer':
                targetUrl = 'treasurer/dashboard.html';
                break;
            default:
                console.error('Unknown role:', role);
                this.showNotification('Unknown user role. Contact administrator.', 'error');
                return;
        }

        // Handle relative paths based on current location
        const currentPath = window.location.pathname;
        
        if (currentPath.includes('/admin/') || currentPath.includes('/treasurer/')) {
            // Already in a subdirectory, go up one level
            window.location.href = '../' + targetUrl;
        } else {
            // At root level (index.html)
            window.location.href = targetUrl;
        }
    }

    /**
     * Logout current user
     */
    async logout() {
        try {
            if (this.currentUser && this.currentUser.token) {
                await this.apiCall('logout', {
                    token: this.currentUser.token
                });
            }
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            this.clearSession();
            window.location.href = '../index.html';
        }
    }

    /**
     * Validate current session
     */
    async validateSession() {
        if (!this.currentUser || !this.currentUser.token) {
            return false;
        }

        try {
            const response = await this.apiCall('validateSession', {
                token: this.currentUser.token
            });

            if (response.status === 'ok') {
                // Update user data if needed
                this.currentUser = { ...this.currentUser, ...response.data };
                this.saveToStorage();
                this.resetInactivityTimer();
                return true;
            } else {
                this.clearSession();
                return false;
            }
        } catch (error) {
            console.error('Session validation error:', error);
            this.clearSession();
            return false;
        }
    }

    /**
     * Check if user is logged in
     */
    isLoggedIn() {
        return this.currentUser && this.currentUser.token;
    }

    /**
     * Get current user data
     */
    getCurrentUser() {
        return this.currentUser;
    }

    /**
     * Get authorization token
     */
    getToken() {
        return this.currentUser ? this.currentUser.token : null;
    }

    /**
     * Check if user has specific role
     */
    hasRole(role) {
        return this.currentUser && this.currentUser.role === role;
    }

    /**
     * Check if user can access admin features
     */
    isAdmin() {
        return this.hasRole('Admin');
    }

    /**
     * Check if user is a treasurer
     */
    isTreasurer() {
        return this.hasRole('Treasurer');
    }

    /**
     * Make authenticated API call
     */
    async apiCall(action, data = {}) {
        const payload = {
            action: action,
            ...data
        };

        // Add token if available
        if (this.currentUser && this.currentUser.token) {
            payload.token = this.currentUser.token;
        }

        const response = await fetch(API_BASE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        
        // Handle session expired
        if (result.status === 'error' && 
            (result.message.includes('session') || result.message.includes('unauthorized'))) {
            this.clearSession();
            this.redirectToLogin();
        }

        return result;
    }

    /**
     * Save session to localStorage
     */
    saveToStorage() {
        if (this.currentUser) {
            localStorage.setItem('ssc_session', JSON.stringify(this.currentUser));
            localStorage.setItem('ssc_last_activity', Date.now().toString());
        }
    }

    /**
     * Load session from localStorage
     */
    loadFromStorage() {
        try {
            const sessionData = localStorage.getItem('ssc_session');
            const lastActivity = localStorage.getItem('ssc_last_activity');
            
            if (sessionData && lastActivity) {
                const timeSinceActivity = Date.now() - parseInt(lastActivity);
                const maxInactivity = 10 * 60 * 1000; // 10 minutes
                
                if (timeSinceActivity < maxInactivity) {
                    this.currentUser = JSON.parse(sessionData);
                    this.setupSessionTimeout();
                } else {
                    this.clearSession();
                }
            }
        } catch (error) {
            console.error('Error loading session:', error);
            this.clearSession();
        }
    }

    /**
     * Clear session data
     */
    clearSession() {
        this.currentUser = null;
        localStorage.removeItem('ssc_session');
        localStorage.removeItem('ssc_last_activity');
        
        if (this.sessionTimeout) {
            clearTimeout(this.sessionTimeout);
            this.sessionTimeout = null;
        }
        
        if (this.inactivityTimeout) {
            clearTimeout(this.inactivityTimeout);
            this.inactivityTimeout = null;
        }
    }

    /**
     * Setup session timeout
     */
    setupSessionTimeout() {
        if (this.sessionTimeout) {
            clearTimeout(this.sessionTimeout);
        }

        if (this.currentUser && this.currentUser.expiresAt) {
            const expiryTime = new Date(this.currentUser.expiresAt).getTime();
            const currentTime = Date.now();
            const timeUntilExpiry = expiryTime - currentTime;

            if (timeUntilExpiry > 0) {
                this.sessionTimeout = setTimeout(() => {
                    this.handleSessionExpiry();
                }, timeUntilExpiry);
            } else {
                this.handleSessionExpiry();
            }
        }
    }

    /**
     * Setup inactivity tracking
     */
    setupInactivityTracking() {
        const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
        
        events.forEach(event => {
            document.addEventListener(event, () => {
                this.resetInactivityTimer();
            }, true);
        });

        this.resetInactivityTimer();
    }

    /**
     * Reset inactivity timer
     */
    resetInactivityTimer() {
        if (!this.isLoggedIn()) return;

        if (this.inactivityTimeout) {
            clearTimeout(this.inactivityTimeout);
        }

        // Update last activity
        localStorage.setItem('ssc_last_activity', Date.now().toString());

        // Set new inactivity timeout (10 minutes)
        this.inactivityTimeout = setTimeout(() => {
            this.handleInactivityTimeout();
        }, 10 * 60 * 1000);
    }

    /**
     * Handle session expiry
     */
    handleSessionExpiry() {
        this.showNotification('Your session has expired. Please log in again.', 'warning');
        setTimeout(() => {
            this.clearSession();
            this.redirectToLogin();
        }, 2000);
    }

    /**
     * Handle inactivity timeout
     */
    handleInactivityTimeout() {
        this.showNotification('You have been logged out due to inactivity.', 'info');
        setTimeout(() => {
            this.logout();
        }, 2000);
    }

    /**
     * Redirect to login page
     */
    redirectToLogin() {
        const currentPath = window.location.pathname;
        if (currentPath.includes('/admin/') || currentPath.includes('/treasurer/')) {
            window.location.href = '../index.html';
        } else if (!currentPath.endsWith('index.html') && !currentPath.endsWith('/')) {
            window.location.href = 'index.html';
        }
    }

    /**
     * Show notification to user
     */
    showNotification(message, type = 'info', duration = 3000) {
        // Try to use existing toast system if available
        if (typeof showToast === 'function') {
            showToast(message, type);
            return;
        }

        // Fallback notification system
        const notification = document.createElement('div');
        notification.className = `alert alert-${type}`;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 1100;
            min-width: 300px;
            max-width: 400px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        `;
        notification.textContent = message;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.remove();
        }, duration);
    }

    /**
     * Require authentication for page access
     */
    async requireAuth(requiredRole = null) {
        if (!this.isLoggedIn()) {
            this.redirectToLogin();
            return false;
        }

        // Validate session with server
        const isValid = await this.validateSession();
        if (!isValid) {
            this.redirectToLogin();
            return false;
        }

        // Check role if specified
        if (requiredRole && !this.hasRole(requiredRole)) {
            this.showNotification('Access denied. Insufficient permissions.', 'error');
            setTimeout(() => {
                this.logout();
            }, 2000);
            return false;
        }

        return true;
    }

    /**
     * Get formatted user display info
     */
    getUserDisplayInfo() {
        if (!this.currentUser) return null;

        return {
            name: this.currentUser.name || this.currentUser.user,
            role: this.currentUser.role,
            department: this.currentUser.department,
            section: this.currentUser.section,
            lastSync: new Date().toLocaleString()
        };
    }
}

// Create global instance
const Auth = new AuthManager();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AuthManager;
}