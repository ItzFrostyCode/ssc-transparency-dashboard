/***********************
 * Code.gs - Apps Script backend (Enhanced with full functionality)
 * Paste this into Apps Script (bound to your Google Sheet).
 *
 * Enhanced Functions:
 *  - setupDatabase()            // idempotent setup, safe to run multiple times
 *  - resetDatabase()            // reset all sheets while keeping Sheet1
 *  - createDatabaseSheets()     // auto-create all required sheets
 *  - doPost / doGet             // comprehensive API endpoints
 *  - Session management         // auto-logout, single session per user
 *  - Transaction safety         // locks, idempotency, validation
 *  - Concurrency control        // prevent duplicate operations
 *
 * API Endpoints:
 *  - login, logout, validateSession
 *  - createSection, editSection, getSections, deactivateSection
 *  - createTreasurer, editTreasurer, getTreasurers, deactivateTreasurer
 *  - getStudents, addStudent, removeStudent
 *  - recordPayment, getPayments, voidPayment
 *  - printSummary, generateReceipt
 *  - getAuditLog, getDashboardData
 *  - resetDatabase, initializeDatabase, checkDatabaseInit
 *
 * NOTE: Always make a copy of the spreadsheet before running destructive commands.
 ***********************/

// Configuration
var CONFIG = {
  SESSION_TIMEOUT_HOURS: 8,
  INACTIVITY_TIMEOUT_MINUTES: 10,
  LOCK_TIMEOUT_SECONDS: 30, // Increased for transaction safety
  PRINT_LOCK_TIMEOUT_SECONDS: 60,
  MAX_FILE_SIZE_MB: 5,
  ALLOWED_FILE_TYPES: ['image/jpeg', 'image/png', 'application/pdf'],
  API_BASE_URL: 'https://script.google.com/macros/s/AKfycbyKLtvOKIkbMQm0S1M3wwh4-0kZLTJ6lWnijDlZ0eQKqRVhT40Ry1WTd4bOhqNCOXqB/exec',
  
  // Transaction Safety Configuration
  PAYMENT_AMOUNT_MIN: 5,
  PAYMENT_AMOUNT_MULTIPLE: 5,
  MAX_PAYMENT_AMOUNT: 10000,
  IDEMPOTENCY_RETENTION_HOURS: 24,
  RECEIPT_NUMBER_PREFIX: 'R-',
  PAYMENT_ID_PREFIX: 'P'
};

function hashValue(value) {
  if (!value) return '';
  var rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8);
  return Utilities.base64Encode(rawHash);
}

/**
 * Enhanced Transaction Safety Functions
 */

/**
 * Validate payment amount according to business rules
 */
function validatePaymentAmount(amount) {
  if (!amount || isNaN(amount)) {
    return { valid: false, message: 'Amount must be a valid number' };
  }
  
  var numAmount = parseFloat(amount);
  
  if (numAmount <= 0) {
    return { valid: false, message: 'Amount must be greater than zero' };
  }
  
  if (numAmount < CONFIG.PAYMENT_AMOUNT_MIN) {
    return { valid: false, message: `Minimum amount is ${CONFIG.PAYMENT_AMOUNT_MIN}` };
  }
  
  if (numAmount > CONFIG.MAX_PAYMENT_AMOUNT) {
    return { valid: false, message: `Maximum amount is ${CONFIG.MAX_PAYMENT_AMOUNT}` };
  }
  
  if (numAmount % CONFIG.PAYMENT_AMOUNT_MULTIPLE !== 0) {
    return { valid: false, message: `Amount must be a multiple of ${CONFIG.PAYMENT_AMOUNT_MULTIPLE}` };
  }
  
  return { valid: true, message: 'Valid amount' };
}

/**
 * Check if physical receipt number is unique
 */
function validateUniqueReceiptNumber(receiptNo, excludePaymentId) {
  if (!receiptNo || receiptNo.trim() === '') {
    return { valid: false, message: 'Physical receipt number is required' };
  }
  
  var cleanReceiptNo = receiptNo.trim().toUpperCase();
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var paySheet = ss.getSheetByName('Payments');
  
  if (!paySheet) {
    return { valid: false, message: 'Payments sheet not found' };
  }
  
  var payRows = getDataRows(paySheet, 2, 12);
  
  for (var i = 0; i < payRows.length; i++) {
    var row = payRows[i];
    var paymentId = row[0];
    var existingReceiptNo = (row[7] || '').toString().trim().toUpperCase();
    var isVoided = row[10];
    
    // Skip voided payments and excluded payment ID
    if (isVoided || (excludePaymentId && String(paymentId) === String(excludePaymentId))) {
      continue;
    }
    
    if (existingReceiptNo === cleanReceiptNo) {
      return { 
        valid: false, 
        message: `Receipt number "${receiptNo}" already used in payment ${paymentId}` 
      };
    }
  }
  
  return { valid: true, message: 'Receipt number is unique' };
}

/**
 * Check if idempotency key has been used recently
 */
function validateIdempotencyKey(idempotencyKey) {
  if (!idempotencyKey || idempotencyKey.trim() === '') {
    return { valid: false, message: 'Idempotency key is required' };
  }
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var paySheet = ss.getSheetByName('Payments');
  
  if (!paySheet) {
    return { valid: false, message: 'Payments sheet not found' };
  }
  
  var cutoffTime = new Date(Date.now() - CONFIG.IDEMPOTENCY_RETENTION_HOURS * 60 * 60 * 1000);
  var payRows = getDataRows(paySheet, 2, 12);
  
  for (var i = 0; i < payRows.length; i++) {
    var row = payRows[i];
    var existingKey = row[9];
    var createdAt = new Date(row[6]);
    var isVoided = row[10];
    
    // Only check non-voided payments within retention period
    if (!isVoided && createdAt > cutoffTime && String(existingKey) === String(idempotencyKey)) {
      return { 
        valid: false, 
        message: 'Duplicate request detected',
        existingPaymentId: row[0]
      };
    }
  }
  
  return { valid: true, message: 'Idempotency key is unique' };
}

/**
 * Validate student eligibility for payment
 */
function validateStudentPaymentEligibility(studentId, amount, session) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var stuSheet = ss.getSheetByName('Students');
  var paySheet = ss.getSheetByName('Payments');
  
  if (!stuSheet || !paySheet) {
    return { valid: false, message: 'Required sheets not found' };
  }
  
  // Find student
  var stuRows = getDataRows(stuSheet, 2, 7);
  var student = null;
  
  for (var i = 0; i < stuRows.length; i++) {
    if (String(stuRows[i][0]) === String(studentId)) {
      student = {
        studentId: stuRows[i][0],
        studentNo: stuRows[i][1],
        fullName: stuRows[i][2],
        sectionId: stuRows[i][3],
        expectedAmount: stuRows[i][4] || 0,
        isActive: stuRows[i][5]
      };
      break;
    }
  }
  
  if (!student) {
    return { valid: false, message: 'Student not found' };
  }
  
  if (!student.isActive) {
    return { valid: false, message: 'Student is inactive' };
  }
  
  // Check section authorization for treasurers
  if (session.role === 'Treasurer' && String(student.sectionId) !== String(session.section)) {
    return { valid: false, message: 'Student not in your section' };
  }
  
  // Calculate current payments
  var payRows = getDataRows(paySheet, 2, 12);
  var totalPaid = 0;
  
  for (var j = 0; j < payRows.length; j++) {
    var row = payRows[j];
    var payStudentId = row[1];
    var payAmount = row[3] || 0;
    var isVoided = row[10];
    
    if (String(payStudentId) === String(studentId) && !isVoided) {
      totalPaid += parseFloat(payAmount);
    }
  }
  
  var newTotal = totalPaid + parseFloat(amount);
  var expectedAmount = parseFloat(student.expectedAmount);
  
  if (expectedAmount > 0 && newTotal > expectedAmount) {
    return { 
      valid: false, 
      message: `Payment would exceed expected amount. Expected: ${expectedAmount}, Already paid: ${totalPaid}, New total: ${newTotal}` 
    };
  }
  
  return { 
    valid: true, 
    message: 'Student eligible for payment',
    student: student,
    totalPaid: totalPaid,
    newTotal: newTotal
  };
}

/**
 * Generate unique receipt number with collision detection
 */
function generateUniqueReceiptNumber(paymentDate) {
  var dateStr = formatDate(new Date(paymentDate), 'YYYYMMDD');
  var maxAttempts = 100;
  
  for (var attempt = 0; attempt < maxAttempts; attempt++) {
    var sequence = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    var receiptNo = CONFIG.RECEIPT_NUMBER_PREFIX + dateStr + '-' + sequence;
    
    var validation = validateUniqueReceiptNumber(receiptNo);
    if (validation.valid) {
      return receiptNo;
    }
  }
  
  // Fallback to timestamp-based unique number
  var timestamp = Math.floor(Date.now() / 1000);
  return CONFIG.RECEIPT_NUMBER_PREFIX + dateStr + '-' + timestamp;
}

/**
 * Enhanced locking with retry mechanism
 */
function acquireLockWithRetry(lockKey, maxAttempts) {
  maxAttempts = maxAttempts || 3;
  
  for (var attempt = 0; attempt < maxAttempts; attempt++) {
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(CONFIG.LOCK_TIMEOUT_SECONDS * 1000);
      Logger.log('✅ Acquired lock for: ' + lockKey + ' (attempt ' + (attempt + 1) + ')');
      return lock;
    } catch (e) {
      Logger.log('⚠️ Failed to acquire lock for: ' + lockKey + ' (attempt ' + (attempt + 1) + '): ' + e.message);
      if (attempt === maxAttempts - 1) {
        Logger.log('❌ Max lock attempts exceeded for: ' + lockKey);
        return null;
      }
      // Brief delay before retry
      Utilities.sleep(100 * (attempt + 1));
    }
  }
  
  return null;
}

/**
 * Safely return data rows from startRow (1-based). Returns [] if no data.
 */
function getDataRows(sheet, startRow, numCols) {
  var last = sheet.getLastRow();
  if (!last || last < startRow) {
    return [];
  }
  var numRows = last - startRow + 1;
  return sheet.getRange(startRow, 1, numRows, numCols).getValues();
}

/**
 * Ensure a sheet exists and that the first row contains the given headers.
 */
function ensureSheetWithHeaders(ss, sheetName, headers) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  var currentHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  var needWrite = false;
  for (var i = 0; i < headers.length; i++) {
    if (!currentHeaders[i] || String(currentHeaders[i]).trim() !== headers[i]) {
      needWrite = true;
      break;
    }
  }
  if (needWrite) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sheet;
}

/**
 * Idempotent setup. Creates all expected sheets and headers, seeds departments,
 * and creates a default admin user if none exists.
 */
function setupDatabase() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var sheetsToCreate = {
    'Settings': ['Key','Value'],
    'Departments': ['DepartmentID','DepartmentName'],
    'Sections': ['SectionID','SectionName','Department','CreatedBy','CreatedAt','IsActive'],
    'Students': ['StudentID','StudentNo','FullName','SectionID','Status','CreatedAt','ExpectedAmount'],
    'Treasurers': ['TreasurerID','FullName','Username','PasswordHash','Role','Department','Section','IsActive','CreatedAt','StartDate','EndDate'],
    'Payments': ['PaymentID','StudentID','SectionID','Amount','PaymentDate','EnteredBy','CreatedAt','PhysicalReceiptNo','ReceiptUrl','IdempotencyKey','IsVoided','CollectionDayID'],
    'CollectionDays': ['CollectionDayID','SectionID','CollectionDate','ExpectedAmount','ActualCollected','Status','CreatedBy','CreatedAt'],
    'CashHandovers': ['HandoverID','SectionID','TreasurerID','Amount','HandoverDate','CustodianName','PhotoUrl','Notes','CreatedAt'],
    'PrintJobs': ['JobID','SectionID','User','JobType','Status','StartedAt','FinishedAt','Details'],
    'Expenditure': ['ExpenseID','ExpenseDate','Purpose','Amount','ReceiptUrl','TreasurerID','EnteredBy','CreatedAt','Visibility'],
    'AuditLog': ['LogID','User','ActionType','Table','RecordID','Details','ActionTime','IPAddress'],
    'Sessions': ['SessionToken','User','Role','Department','Section','CreatedAt','ExpiresAt','LastActivity','IsActive']
  };

  // ensure sheets + headers
  var createdSheets = [];
  Object.keys(sheetsToCreate).forEach(function(name) {
    ensureSheetWithHeaders(ss, name, sheetsToCreate[name]);
    createdSheets.push(name);
  });

  // seed Departments if empty
  var deptSheet = ss.getSheetByName('Departments');
  var deptRows = getDataRows(deptSheet, 2, 2);
  if (!deptRows || deptRows.length === 0) {
    deptSheet.appendRow([1, 'ICT']);
    deptSheet.appendRow([2, 'HTM']);
    deptSheet.appendRow([3, 'SHS']);
  }

  // create default admin user in Treasurers if none exists
  var treasSheet = ss.getSheetByName('Treasurers');
  var treasRows = getDataRows(treasSheet, 2, 11);
  var adminExists = false;
  if (treasRows && treasRows.length > 0) {
    for (var i = 0; i < treasRows.length; i++) {
      var username = treasRows[i][2];
      if (String(username).toLowerCase() === 'admin') { 
        adminExists = true; 
        break; 
      }
    }
  }
  if (!adminExists) {
    var now = new Date();
    var pwdHash = hashValue('ssc2025'); // default password - change immediately in production
    treasSheet.appendRow(['T' + Math.floor(now.getTime()/1000), 'System Admin', 'admin', pwdHash, 'Admin', 'All', 'All', true, now, now, null]);
  }

  Logger.log('✅ setupDatabase(): completed. Sheets ensured: ' + createdSheets.join(', '));
  return { status: 'ok', message: 'Database setup completed', sheets: createdSheets };
}

/**
 * Reset Database - Clear all data sheets while preserving Sheet1
 * This function will:
 * 1. Keep the original "Sheet1" untouched
 * 2. Delete all database-related sheets
 * 3. Recreate fresh database structure
 * 4. Initialize with default data
 */
function resetDatabase() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var allSheets = ss.getSheets();
    
    // List of database sheets to reset (exclude Sheet1)
    var databaseSheets = [
      'Settings', 'Departments', 'Sections', 'Students', 'Treasurers', 
      'Payments', 'CollectionDays', 'CashHandovers', 'PrintJobs', 
      'Expenditure', 'AuditLog', 'Sessions'
    ];
    
    var deletedSheets = [];
    var preservedSheets = [];
    
    // Delete existing database sheets (but keep Sheet1)
    allSheets.forEach(function(sheet) {
      var sheetName = sheet.getName();
      if (databaseSheets.indexOf(sheetName) !== -1) {
        ss.deleteSheet(sheet);
        deletedSheets.push(sheetName);
      } else {
        preservedSheets.push(sheetName);
      }
    });
    
    // Clear script properties to reset initialization state
    var properties = PropertiesService.getScriptProperties();
    properties.deleteProperty('DB_INITIALIZED');
    properties.deleteProperty('INIT_DATE');
    properties.deleteProperty('INIT_ADMIN');
    
    // Recreate database structure
    var setupResult = setupDatabase();
    
    // Log the reset action
    logAction('SYSTEM', 'System', 'DATABASE_RESET', '', 
      'Database reset completed. Deleted: [' + deletedSheets.join(', ') + '] Preserved: [' + preservedSheets.join(', ') + ']');
    
    Logger.log('✅ resetDatabase(): completed. Deleted sheets: ' + deletedSheets.join(', ') + '. Preserved: ' + preservedSheets.join(', '));
    
    return {
      status: 'ok',
      message: 'Database reset completed successfully',
      data: {
        deletedSheets: deletedSheets,
        preservedSheets: preservedSheets,
        recreatedSheets: setupResult.sheets || [],
        timestamp: new Date().toISOString()
      }
    };
    
  } catch (error) {
    Logger.log('❌ resetDatabase() error: ' + error.toString());
    return {
      status: 'error',
      message: 'Database reset failed: ' + error.toString()
    };
  }
}

/**
 * Create Database Sheets - Auto-create all required database sheets
 * This function will:
 * 1. Check which sheets already exist
 * 2. Create only missing sheets
 * 3. Set up proper headers and formatting
 * 4. Preserve existing data
 */
function createDatabaseSheets() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var existingSheets = ss.getSheets().map(function(sheet) { return sheet.getName(); });
    
    var sheetsConfig = {
      'Settings': {
        headers: ['Key', 'Value'],
        description: 'System configuration settings'
      },
      'Departments': {
        headers: ['DepartmentID', 'DepartmentName'],
        description: 'Academic departments'
      },
      'Sections': {
        headers: ['SectionID', 'SectionName', 'Department', 'CreatedBy', 'CreatedAt', 'IsActive'],
        description: 'Student sections/classes'
      },
      'Students': {
        headers: ['StudentID', 'StudentNo', 'FullName', 'SectionID', 'Status', 'CreatedAt', 'ExpectedAmount'],
        description: 'Student records'
      },
      'Treasurers': {
        headers: ['TreasurerID', 'FullName', 'Username', 'PasswordHash', 'Role', 'Department', 'Section', 'IsActive', 'CreatedAt', 'StartDate', 'EndDate'],
        description: 'Treasurer and admin accounts'
      },
      'Payments': {
        headers: ['PaymentID', 'StudentID', 'SectionID', 'Amount', 'PaymentDate', 'EnteredBy', 'CreatedAt', 'PhysicalReceiptNo', 'ReceiptUrl', 'IdempotencyKey', 'IsVoided', 'CollectionDayID'],
        description: 'Payment transactions'
      },
      'CollectionDays': {
        headers: ['CollectionDayID', 'SectionID', 'CollectionDate', 'ExpectedAmount', 'ActualCollected', 'Status', 'CreatedBy', 'CreatedAt'],
        description: 'Collection day records'
      },
      'CashHandovers': {
        headers: ['HandoverID', 'SectionID', 'TreasurerID', 'Amount', 'HandoverDate', 'CustodianName', 'PhotoUrl', 'Notes', 'CreatedAt'],
        description: 'Cash handover records'
      },
      'PrintJobs': {
        headers: ['JobID', 'SectionID', 'User', 'JobType', 'Status', 'StartedAt', 'FinishedAt', 'Details'],
        description: 'Print job tracking'
      },
      'Expenditure': {
        headers: ['ExpenseID', 'ExpenseDate', 'Purpose', 'Amount', 'ReceiptUrl', 'TreasurerID', 'EnteredBy', 'CreatedAt', 'Visibility'],
        description: 'Expense records'
      },
      'AuditLog': {
        headers: ['LogID', 'User', 'ActionType', 'Table', 'RecordID', 'Details', 'ActionTime', 'IPAddress'],
        description: 'System audit trail'
      },
      'Sessions': {
        headers: ['SessionToken', 'User', 'Role', 'Department', 'Section', 'CreatedAt', 'ExpiresAt', 'LastActivity', 'IsActive'],
        description: 'User sessions'
      }
    };
    
    var createdSheets = [];
    var skippedSheets = [];
    
    // Create missing sheets
    Object.keys(sheetsConfig).forEach(function(sheetName) {
      if (existingSheets.indexOf(sheetName) === -1) {
        var config = sheetsConfig[sheetName];
        var sheet = ss.insertSheet(sheetName);
        
        // Add headers
        var headerRange = sheet.getRange(1, 1, 1, config.headers.length);
        headerRange.setValues([config.headers]);
        
        // Format headers with dark theme
        headerRange.setFontWeight('bold');
        headerRange.setBackground('#353535'); // Dark header background
        headerRange.setFontColor('#e0e0e0');  // Light text
        headerRange.setBorder(true, true, true, true, true, true, '#404040', SpreadsheetApp.BorderStyle.SOLID);
        
        // Auto-resize columns
        for (var i = 1; i <= config.headers.length; i++) {
          sheet.autoResizeColumn(i);
        }
        
        // Freeze header row
        sheet.setFrozenRows(1);
        
        // Add description as note to A1 cell
        sheet.getRange('A1').setNote('Sheet: ' + sheetName + '\nDescription: ' + config.description + '\nCreated: ' + new Date().toISOString());
        
        createdSheets.push(sheetName);
      } else {
        skippedSheets.push(sheetName);
      }
    });
    
    // Initialize with default data if sheets were created
    if (createdSheets.length > 0) {
      initializeDefaultData(ss, createdSheets);
    }
    
    Logger.log('✅ createDatabaseSheets(): Created: ' + createdSheets.join(', ') + '. Skipped (already exist): ' + skippedSheets.join(', '));
    
    return {
      status: 'ok',
      message: 'Database sheets creation completed',
      data: {
        createdSheets: createdSheets,
        skippedSheets: skippedSheets,
        totalSheets: Object.keys(sheetsConfig).length,
        timestamp: new Date().toISOString()
      }
    };
    
  } catch (error) {
    Logger.log('❌ createDatabaseSheets() error: ' + error.toString());
    return {
      status: 'error',
      message: 'Failed to create database sheets: ' + error.toString()
    };
  }
}

/**
 * Initialize default data for newly created sheets
 */
function initializeDefaultData(ss, createdSheets) {
  try {
    // Initialize Departments if created
    if (createdSheets.indexOf('Departments') !== -1) {
      var deptSheet = ss.getSheetByName('Departments');
      deptSheet.appendRow([1, 'ICT']);
      deptSheet.appendRow([2, 'HTM']);
      deptSheet.appendRow([3, 'SHS']);
    }
    
    // Initialize Settings if created
    if (createdSheets.indexOf('Settings') !== -1) {
      var settingsSheet = ss.getSheetByName('Settings');
      settingsSheet.appendRow(['SYSTEM_VERSION', '2.0']);
      settingsSheet.appendRow(['DATABASE_CREATED', new Date().toISOString()]);
      settingsSheet.appendRow(['LAST_RESET', new Date().toISOString()]);
      settingsSheet.appendRow(['SESSION_TIMEOUT_HOURS', '8']);
      settingsSheet.appendRow(['PAYMENT_AMOUNT_MIN', '5']);
      settingsSheet.appendRow(['PAYMENT_AMOUNT_MULTIPLE', '5']);
    }
    
    Logger.log('✅ initializeDefaultData(): Default data added to created sheets');
    
  } catch (error) {
    Logger.log('❌ initializeDefaultData() error: ' + error.toString());
  }
}

/**
 * Check Database Initialization Status
 */
function checkDatabaseInit() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheets = ss.getSheets().map(function(sheet) { return sheet.getName(); });
    
    var requiredSheets = ['Departments', 'Sections', 'Students', 'Treasurers', 'Payments', 'AuditLog', 'Sessions'];
    var missingSheets = requiredSheets.filter(function(sheet) { return sheets.indexOf(sheet) === -1; });
    
    var properties = PropertiesService.getScriptProperties();
    var isInitialized = properties.getProperty('DB_INITIALIZED');
    
    if (missingSheets.length > 0) {
      return {
        status: 'error',
        message: 'Database not initialized. Missing sheets: ' + missingSheets.join(', ')
      };
    }
    
    if (!isInitialized || isInitialized !== 'true') {
      return {
        status: 'error',
        message: 'Database not initialized. First-time setup required.'
      };
    }
    
    return {
      status: 'ok',
      message: 'Database is properly initialized',
      data: {
        sheets: sheets,
        initialized: true,
        timestamp: new Date().toISOString()
      }
    };
    
  } catch (error) {
    return {
      status: 'error',
      message: 'Database check failed: ' + error.toString()
    };
  }
}

/**
 * Initialize Database with first admin user (secure setup)
 */
function initializeDatabase(data) {
  try {
    var adminName = data.adminName;
    var adminUsername = data.adminUsername;
    var adminPassword = data.adminPassword;
    
    // Validate input
    if (!adminName || !adminUsername || !adminPassword) {
      return {
        status: 'error',
        message: 'All fields are required for database initialization'
      };
    }
    
    if (adminPassword.length < 8) {
      return {
        status: 'error',
        message: 'Password must be at least 8 characters long'
      };
    }
    
    // Check if already initialized
    var properties = PropertiesService.getScriptProperties();
    var isInitialized = properties.getProperty('DB_INITIALIZED');
    
    if (isInitialized === 'true') {
      return {
        status: 'error',
        message: 'Database is already initialized'
      };
    }
    
    // Create database structure
    var createResult = createDatabaseSheets();
    if (createResult.status !== 'ok') {
      return createResult;
    }
    
    // Create first admin user
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var treasSheet = ss.getSheetByName('Treasurers');
    var now = new Date();
    var pwdHash = hashValue(adminPassword);
    var userId = 'T' + Math.floor(now.getTime()/1000);
    
    // Check if username already exists
    var treasRows = getDataRows(treasSheet, 2, 11);
    if (treasRows && treasRows.length > 0) {
      for (var i = 0; i < treasRows.length; i++) {
        if (String(treasRows[i][2]).toLowerCase() === adminUsername.toLowerCase()) {
          return {
            status: 'error',
            message: 'Username already exists'
          };
        }
      }
    }
    
    // Add admin user
    treasSheet.appendRow([userId, adminName, adminUsername, pwdHash, 'Admin', 'All', 'All', true, now, now, null]);
    
    // Mark database as initialized
    properties.setProperty('DB_INITIALIZED', 'true');
    properties.setProperty('INIT_DATE', now.toISOString());
    properties.setProperty('INIT_ADMIN', adminUsername);
    
    // Log initialization
    logAction('SYSTEM', adminUsername, 'DATABASE_INIT', 'Treasurers', userId, 'Database initialized with admin user: ' + adminUsername);
    
    Logger.log('✅ initializeDatabase(): Database initialized with admin user: ' + adminUsername);
    
    return {
      status: 'ok',
      message: 'Database initialized successfully',
      data: {
        adminUserId: userId,
        timestamp: now.toISOString()
      }
    };
    
  } catch (error) {
    Logger.log('❌ initializeDatabase() error: ' + error.toString());
    return {
      status: 'error',
      message: 'Database initialization failed: ' + error.toString()
    };
  }
}

/* ---------- HTTP endpoints ---------- */

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({ 
    status: 'ok', 
    message: 'SSC Collection Backend API',
    version: '2.0',
    timestamp: new Date().toISOString()
  }))
  .setMimeType(ContentService.MimeType.JSON)
  .setHeaders({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
}

function doPost(e) {
  // Handle CORS preflight request
  if (e.parameter && e.parameter.method === 'OPTIONS') {
    return ContentService.createTextOutput('')
      .setHeaders({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
  }
  
  try {
    var raw = e.postData && e.postData.contents ? e.postData.contents : '{}';
    var payload = JSON.parse(raw);
    var action = payload.action || (e.parameter && e.parameter.action) || '';
    
    // Log the request
    logAction('API_REQUEST', 'System', action, '', JSON.stringify({ action: action, timestamp: new Date() }));
    
    switch (action) {
      case 'login':
        return handleLogin(payload);
      case 'logout':
        return handleLogout(payload);
      case 'validateSession':
        return handleValidateSession(payload);
      case 'createSection':
        return handleCreateSection(payload);
      case 'editSection':
        return handleEditSection(payload);
      case 'getSections':
        return handleGetSections(payload);
      case 'deactivateSection':
        return handleDeactivateSection(payload);
      case 'createTreasurer':
        return handleCreateTreasurer(payload);
      case 'editTreasurer':
        return handleEditTreasurer(payload);
      case 'getTreasurers':
        return handleGetTreasurers(payload);
      case 'deactivateTreasurer':
        return handleDeactivateTreasurer(payload);
      case 'getStudents':
        return handleGetStudents(payload);
      case 'addStudent':
        return handleAddStudent(payload);
      case 'removeStudent':
        return handleRemoveStudent(payload);
      case 'recordPayment':
        return handleRecordPayment(payload);
      case 'validatePaymentData':
        return handleValidatePaymentData(payload);
      case 'getPayments':
        return handleGetPayments(payload);
      case 'voidPayment':
        return handleVoidPayment(payload);
      case 'printSummary':
        return handlePrintSummary(payload);
      case 'generateReceipt':
        return handleGenerateReceipt(payload);
      case 'generateDetailedReport':
        return handleGenerateDetailedReport(payload);
      case 'generateStudentReport':
        return handleGenerateStudentReport(payload);
      case 'exportExcel':
        return handleExportExcel(payload);
      case 'recordCashHandover':
        return handleRecordCashHandover(payload);
      case 'getAuditLog':
        return handleGetAuditLog(payload);
      case 'getDashboardData':
        return handleGetDashboardData(payload);
      case 'getDepartments':
        return handleGetDepartments(payload);
      case 'setupDatabase':
        return createSuccessResponse(setupDatabase());
      case 'resetDatabase':
        return createSuccessResponse(resetDatabase());
      case 'createDatabaseSheets':
        return createSuccessResponse(createDatabaseSheets());
      case 'checkDatabaseInit':
        return createSuccessResponse(checkDatabaseInit());
      case 'initializeDatabase':
        return createSuccessResponse(initializeDatabase(payload));
      case 'getDatabaseStatus':
        return createSuccessResponse(getDatabaseStatus());
      case 'manualDatabaseSetup':
        return createSuccessResponse({ message: 'Use Script Editor to run manualDatabaseSetup() function', status: 'manual_required' });
      case 'manualDatabaseReset':
        return createSuccessResponse({ message: 'Use Script Editor to run manualDatabaseReset() function', status: 'manual_required' });
      case 'getDatabaseInfo':
        return createSuccessResponse(getDatabaseInfo());
      default:
        return createErrorResponse('unknown action: ' + action);
    }
  } catch (err) {
    Logger.log('❌ doPost error: ' + String(err));
    return createErrorResponse(String(err));
  }
}

/* ---------- Utility Functions ---------- */

function createSuccessResponse(data) {
  return ContentService.createTextOutput(JSON.stringify({
    status: 'ok',
    data: data,
    timestamp: new Date().toISOString()
  }))
  .setMimeType(ContentService.MimeType.JSON)
  .setHeaders({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
}

function createErrorResponse(message) {
  return ContentService.createTextOutput(JSON.stringify({
    status: 'error',
    message: message,
    timestamp: new Date().toISOString()
  }))
  .setMimeType(ContentService.MimeType.JSON)
  .setHeaders({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
}

function validateSession(token) {
  if (!token) return null;
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sessSheet = ss.getSheetByName('Sessions');
  if (!sessSheet) return null;
  
  var rows = getDataRows(sessSheet, 2, 9);
  var now = new Date();
  
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var sessionToken = row[0];
    var user = row[1];
    var role = row[2];
    var department = row[3];
    var section = row[4];
    var expiresAt = new Date(row[6]);
    var lastActivity = new Date(row[7]);
    var isActive = row[8];
    
    if (String(sessionToken) === String(token) && isActive) {
      // Check if session expired
      if (now > expiresAt) {
        // Deactivate expired session
        var range = sessSheet.getRange(i + 2, 9);
        range.setValue(false);
        return null;
      }
      
      // Check inactivity timeout
      var inactivityLimit = new Date(now.getTime() - CONFIG.INACTIVITY_TIMEOUT_MINUTES * 60 * 1000);
      if (lastActivity < inactivityLimit) {
        // Deactivate inactive session
        var range = sessSheet.getRange(i + 2, 9);
        range.setValue(false);
        return null;
      }
      
      // Update last activity
      var range = sessSheet.getRange(i + 2, 8);
      range.setValue(now);
      
      return {
        user: user,
        role: role,
        department: department,
        section: section,
        token: token
      };
    }
  }
  
  return null;
}

function acquireLock(lockKey) {
  Logger.log('⚠️ acquireLock() is deprecated. Use acquireLockWithRetry() for better reliability.');
  return acquireLockWithRetry(lockKey, 1);
}

function logAction(actionType, user, table, recordId, details) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var auditSheet = ss.getSheetByName('AuditLog');
    if (!auditSheet) return;
    
    var logId = 'L' + Math.floor(new Date().getTime() / 1000) + Math.floor(Math.random() * 1000);
    auditSheet.appendRow([
      logId,
      user || 'System',
      actionType,
      table,
      recordId,
      details || '',
      new Date(),
      Session.getActiveUser().getEmail() || 'unknown'
    ]);
  } catch (e) {
    Logger.log('❌ Failed to log action: ' + String(e));
  }
}

/* ---------- Authentication Handlers ---------- */

function handleLogin(payload) {
  var username = payload.username || '';
  var password = payload.password || '';
  
  if (!username || !password) {
    return createErrorResponse('missing credentials');
  }
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var treasSheet = ss.getSheetByName('Treasurers');
  var sessSheet = ss.getSheetByName('Sessions');
  
  if (!treasSheet || !sessSheet) {
    return createErrorResponse('required sheets missing');
  }
  
  var rows = getDataRows(treasSheet, 2, 11);
  var inputHash = hashValue(password);
  
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var treasurerId = row[0];
    var fullname = row[1];
    var rowUsername = row[2];
    var rowHash = row[3];
    var role = row[4];
    var department = row[5];
    var section = row[6];
    var isActive = row[7];
    
    if (String(rowUsername) === String(username) && String(rowHash) === String(inputHash) && isActive) {
      // Deactivate any existing sessions for this user
      var sessRows = getDataRows(sessSheet, 2, 9);
      for (var j = 0; j < sessRows.length; j++) {
        if (String(sessRows[j][1]) === String(username) && sessRows[j][8]) {
          var range = sessSheet.getRange(j + 2, 9);
          range.setValue(false);
        }
      }
      
      // Create new session
      var token = Utilities.getUuid();
      var now = new Date();
      var expires = new Date(now.getTime() + CONFIG.SESSION_TIMEOUT_HOURS * 60 * 60 * 1000);
      
      sessSheet.appendRow([
        token,
        username,
        role,
        department,
        section,
        now,
        expires,
        now,
        true
      ]);
      
      logAction('LOGIN', username, 'Sessions', token, JSON.stringify({ role: role, department: department, section: section }));
      
      return createSuccessResponse({
        user: username,
        name: fullname,
        role: role,
        department: department,
        section: section,
        token: token,
        expiresAt: expires.toISOString()
      });
    }
  }
  
  return createErrorResponse('invalid username or password');
}

function handleLogout(payload) {
  var token = payload.token;
  if (!token) {
    return createErrorResponse('token required');
  }
  
  var session = validateSession(token);
  if (!session) {
    return createErrorResponse('invalid session');
  }
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sessSheet = ss.getSheetByName('Sessions');
  var rows = getDataRows(sessSheet, 2, 9);
  
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === String(token)) {
      var range = sessSheet.getRange(i + 2, 9);
      range.setValue(false);
      break;
    }
  }
  
  logAction('LOGOUT', session.user, 'Sessions', token, '');
  
  return createSuccessResponse({ message: 'logged out successfully' });
}

function handleValidateSession(payload) {
  var token = payload.token;
  var session = validateSession(token);
  
  if (!session) {
    return createErrorResponse('invalid or expired session');
  }
  
  return createSuccessResponse(session);
}

/* ---------- Section Management Handlers ---------- */

function handleCreateSection(payload) {
  var session = validateSession(payload.token);
  if (!session || session.role !== 'Admin') {
    return createErrorResponse('unauthorized');
  }
  
  var sectionName = (payload.sectionName || '').trim();
  var department = payload.department || 'ICT';
  var students = payload.students || [];
  
  if (!sectionName) {
    return createErrorResponse('sectionName required');
  }
  
  var lock = acquireLock('createSection');
  if (!lock) {
    return createErrorResponse('system busy, please try again');
  }
  
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var secSheet = ss.getSheetByName('Sections');
    var stuSheet = ss.getSheetByName('Students');
    
    // Check for duplicate section name
    var secRows = getDataRows(secSheet, 2, 6);
    for (var i = 0; i < secRows.length; i++) {
      if (String(secRows[i][1]).toLowerCase() === sectionName.toLowerCase() && secRows[i][5]) {
        lock.releaseLock();
        return createErrorResponse('section name already exists');
      }
    }
    
    var now = new Date();
    var newSectionId = 'S' + Math.floor(now.getTime() / 1000);
    
    // Create section
    secSheet.appendRow([newSectionId, sectionName, department, session.user, now, true]);
    
    // Add students
    var inserted = 0;
    var defaultExpectedAmount = 85; // Default expected amount per student
    
    for (var j = 0; j < students.length; j++) {
      var studentData = students[j];
      var studentNo = '';
      var fullName = '';
      
      if (typeof studentData === 'string') {
        // Parse "StudentNo | Name" or just "Name"
        var parts = studentData.split('|');
        if (parts.length === 2) {
          studentNo = parts[0].trim();
          fullName = parts[1].trim();
        } else {
          fullName = studentData.trim();
          studentNo = 'STU' + Math.floor(now.getTime() / 1000) + j;
        }
      } else if (typeof studentData === 'object') {
        studentNo = studentData.studentNo || 'STU' + Math.floor(now.getTime() / 1000) + j;
        fullName = studentData.fullName || '';
      }
      
      if (!fullName) continue;
      
      var studentId = 'ST' + Math.floor(now.getTime() / 1000) + j + Math.floor(Math.random() * 1000);
      stuSheet.appendRow([
        studentId,
        studentNo,
        fullName,
        newSectionId,
        'Active',
        now,
        defaultExpectedAmount
      ]);
      inserted++;
    }
    
    logAction('SECTION_CREATE', session.user, 'Sections', newSectionId, JSON.stringify({
      sectionName: sectionName,
      department: department,
      studentsCount: inserted
    }));
    
    lock.releaseLock();
    
    return createSuccessResponse({
      sectionId: newSectionId,
      createdStudents: inserted
    });
    
  } catch (e) {
    lock.releaseLock();
    throw e;
  }
}

function handleGetSections(payload) {
  var session = validateSession(payload.token);
  if (!session) {
    return createErrorResponse('unauthorized');
  }
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var secSheet = ss.getSheetByName('Sections');
  var stuSheet = ss.getSheetByName('Students');
  
  var secRows = getDataRows(secSheet, 2, 6);
  var stuRows = getDataRows(stuSheet, 2, 7);
  
  var sections = [];
  
  for (var i = 0; i < secRows.length; i++) {
    var row = secRows[i];
    if (!row[5]) continue; // Skip inactive sections
    
    var sectionId = row[0];
    var studentCount = 0;
    var totalExpected = 0;
    
    // Count students in this section
    for (var j = 0; j < stuRows.length; j++) {
      if (String(stuRows[j][3]) === String(sectionId) && stuRows[j][4] === 'Active') {
        studentCount++;
        totalExpected += stuRows[j][6] || 0;
      }
    }
    
    sections.push({
      sectionId: sectionId,
      sectionName: row[1],
      department: row[2],
      createdBy: row[3],
      createdAt: row[4],
      studentCount: studentCount,
      totalExpected: totalExpected,
      isActive: row[5]
    });
  }
  
  return createSuccessResponse({ sections: sections });
}

/* ---------- Student Management Handlers ---------- */

function handleGetStudents(payload) {
  var session = validateSession(payload.token);
  if (!session) {
    return createErrorResponse('unauthorized');
  }
  
  var sectionFilter = payload.sectionId || (session.role === 'Treasurer' ? session.section : null);
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var stuSheet = ss.getSheetByName('Students');
  var paySheet = ss.getSheetByName('Payments');
  
  var stuRows = getDataRows(stuSheet, 2, 7);
  var payRows = getDataRows(paySheet, 2, 12);
  
  var students = [];
  
  for (var i = 0; i < stuRows.length; i++) {
    var row = stuRows[i];
    var studentId = row[0];
    var sectionId = row[3];
    
    // Filter by section if needed
    if (sectionFilter && String(sectionId) !== String(sectionFilter)) continue;
    if (row[4] !== 'Active') continue; // Skip inactive students
    
    // Calculate payments for this student
    var totalPaid = 0;
    var paymentCount = 0;
    var lastPaymentDate = null;
    
    for (var j = 0; j < payRows.length; j++) {
      if (String(payRows[j][1]) === String(studentId) && !payRows[j][10]) { // Not voided
        totalPaid += payRows[j][3] || 0;
        paymentCount++;
        var payDate = new Date(payRows[j][4]);
        if (!lastPaymentDate || payDate > lastPaymentDate) {
          lastPaymentDate = payDate;
        }
      }
    }
    
    var expectedAmount = row[6] || 0;
    var remaining = expectedAmount - totalPaid;
    
    students.push({
      studentId: studentId,
      studentNo: row[1],
      fullName: row[2],
      sectionId: sectionId,
      status: row[4],
      createdAt: row[5],
      expectedAmount: expectedAmount,
      totalPaid: totalPaid,
      remaining: Math.max(0, remaining),
      paymentCount: paymentCount,
      lastPaymentDate: lastPaymentDate ? lastPaymentDate.toISOString() : null,
      paymentStatus: remaining <= 0 ? 'PAID' : (totalPaid > 0 ? 'PARTIAL' : 'NOT_PAID')
    });
  }
  
  return createSuccessResponse({ students: students });
}

/* ---------- Payment Management Handlers ---------- */

function handleRecordPayment(payload) {
  var session = validateSession(payload.token);
  if (!session) {
    return createErrorResponse('unauthorized');
  }
  
  var studentId = payload.studentId;
  var amount = parseFloat(payload.amount);
  var physicalReceiptNo = (payload.physicalReceiptNo || '').trim();
  var idempotencyKey = payload.idempotencyKey || Utilities.getUuid();
  var paymentDate = payload.paymentDate ? new Date(payload.paymentDate) : new Date();
  var notes = (payload.notes || '').trim();
  
  // Step 1: Basic input validation
  if (!studentId || !amount || !physicalReceiptNo) {
    return createErrorResponse('studentId, amount, and physicalReceiptNo are required');
  }
  
  // Step 2: Enhanced amount validation
  var amountValidation = validatePaymentAmount(amount);
  if (!amountValidation.valid) {
    return createErrorResponse(amountValidation.message);
  }
  
  // Step 3: Idempotency key validation
  var idempotencyValidation = validateIdempotencyKey(idempotencyKey);
  if (!idempotencyValidation.valid) {
    if (idempotencyValidation.existingPaymentId) {
      // Return existing payment instead of error for true idempotency
      return createSuccessResponse({
        paymentId: idempotencyValidation.existingPaymentId,
        message: 'payment already recorded',
        duplicate: true
      });
    }
    return createErrorResponse(idempotencyValidation.message);
  }
  
  // Step 4: Physical receipt number validation
  var receiptValidation = validateUniqueReceiptNumber(physicalReceiptNo);
  if (!receiptValidation.valid) {
    return createErrorResponse(receiptValidation.message);
  }
  
  // Step 5: Acquire enhanced lock with retry
  var lock = acquireLockWithRetry('recordPayment_' + studentId, 3);
  if (!lock) {
    return createErrorResponse('System is busy processing another payment for this student. Please wait and try again.');
  }
  
  try {
    // Step 6: Student eligibility validation
    var eligibilityValidation = validateStudentPaymentEligibility(studentId, amount, session);
    if (!eligibilityValidation.valid) {
      lock.releaseLock();
      return createErrorResponse(eligibilityValidation.message);
    }
    
    var student = eligibilityValidation.student;
    
    // Step 7: Final duplicate checks within lock
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var paySheet = ss.getSheetByName('Payments');
    
    if (!paySheet) {
      lock.releaseLock();
      return createErrorResponse('Payments sheet not found');
    }
    
    // Re-check idempotency key within lock
    var payRows = getDataRows(paySheet, 2, 12);
    for (var j = 0; j < payRows.length; j++) {
      if (String(payRows[j][9]) === String(idempotencyKey)) {
        lock.releaseLock();
        return createSuccessResponse({
          paymentId: payRows[j][0],
          message: 'payment already recorded (detected in lock)',
          duplicate: true
        });
      }
    }
    
    // Re-check receipt number within lock
    for (var k = 0; k < payRows.length; k++) {
      var existingReceiptNo = (payRows[k][7] || '').toString().trim().toUpperCase();
      var isVoided = payRows[k][10];
      
      if (!isVoided && existingReceiptNo === physicalReceiptNo.toUpperCase()) {
        lock.releaseLock();
        return createErrorResponse(`Receipt number "${physicalReceiptNo}" already used in payment ${payRows[k][0]}`);
      }
    }
    
    // Step 8: Check for same-day duplicate payments
    var todayStr = paymentDate.toDateString();
    for (var l = 0; l < payRows.length; l++) {
      if (String(payRows[l][1]) === String(studentId) && 
          !payRows[l][10] && // Not voided
          new Date(payRows[l][4]).toDateString() === todayStr) {
        lock.releaseLock();
        return createErrorResponse('A payment for this student has already been recorded today. Use a different date or contact admin to void the existing payment.');
      }
    }
    
    // Step 9: Generate unique identifiers
    var now = new Date();
    var paymentId = CONFIG.PAYMENT_ID_PREFIX + Math.floor(now.getTime() / 1000) + Math.floor(Math.random() * 1000);
    var systemReceiptNo = generateUniqueReceiptNumber(paymentDate);
    
    // Step 10: Record payment atomically
    try {
      paySheet.appendRow([
        paymentId,
        studentId,
        student.sectionId,
        amount,
        paymentDate,
        session.user,
        now,
        physicalReceiptNo,
        '', // ReceiptUrl - for future file upload feature
        idempotencyKey,
        false, // IsVoided
        '', // CollectionDayID - for future collection day feature
        notes // Add notes field
      ]);
      
      // Step 11: Log successful transaction
      logAction('PAYMENT_RECORD', session.user, 'Payments', paymentId, JSON.stringify({
        studentId: studentId,
        studentName: student.fullName,
        amount: amount,
        physicalReceiptNo: physicalReceiptNo,
        systemReceiptNo: systemReceiptNo,
        paymentDate: paymentDate.toISOString(),
        previousTotal: eligibilityValidation.totalPaid,
        newTotal: eligibilityValidation.newTotal,
        idempotencyKey: idempotencyKey
      }));
      
      lock.releaseLock();
      
      return createSuccessResponse({
        paymentId: paymentId,
        receiptNo: systemReceiptNo,
        physicalReceiptNo: physicalReceiptNo,
        studentName: student.fullName,
        amount: amount,
        paymentDate: paymentDate.toISOString(),
        previousTotal: eligibilityValidation.totalPaid,
        newTotal: eligibilityValidation.newTotal,
        message: 'Payment recorded successfully'
      });
      
    } catch (writeError) {
      lock.releaseLock();
      Logger.log('❌ Failed to write payment record: ' + writeError.message);
      return createErrorResponse('Failed to save payment record. Please try again.');
    }
    
  } catch (e) {
    lock.releaseLock();
    Logger.log('❌ Payment recording error: ' + e.message);
    return createErrorResponse('Unexpected error occurred. Please try again or contact support.');
  }
}

function handleGetPayments(payload) {
  var session = validateSession(payload.token);
  if (!session) {
    return createErrorResponse('unauthorized');
  }
  
  var studentId = payload.studentId;
  var sectionFilter = payload.sectionId || (session.role === 'Treasurer' ? session.section : null);
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var paySheet = ss.getSheetByName('Payments');
  var stuSheet = ss.getSheetByName('Students');
  
  var payRows = getDataRows(paySheet, 2, 12);
  var stuRows = getDataRows(stuSheet, 2, 7);
  
  var payments = [];
  
  for (var i = 0; i < payRows.length; i++) {
    var row = payRows[i];
    var payStudentId = row[1];
    var paySectionId = row[2];
    
    // Filter by student if specified
    if (studentId && String(payStudentId) !== String(studentId)) continue;
    
    // Filter by section if needed
    if (sectionFilter && String(paySectionId) !== String(sectionFilter)) continue;
    
    // Get student info
    var studentInfo = null;
    for (var j = 0; j < stuRows.length; j++) {
      if (String(stuRows[j][0]) === String(payStudentId)) {
        studentInfo = {
          studentNo: stuRows[j][1],
          fullName: stuRows[j][2]
        };
        break;
      }
    }
    
    payments.push({
      paymentId: row[0],
      studentId: payStudentId,
      sectionId: paySectionId,
      amount: row[3],
      paymentDate: row[4],
      enteredBy: row[5],
      createdAt: row[6],
      physicalReceiptNo: row[7],
      receiptUrl: row[8],
      idempotencyKey: row[9],
      isVoided: row[10],
      collectionDayId: row[11],
      student: studentInfo
    });
  }
  
  // Sort by payment date descending
  payments.sort(function(a, b) {
    return new Date(b.paymentDate) - new Date(a.paymentDate);
  });
  
  return createSuccessResponse({ payments: payments });
}

/**
 * Validate payment data without recording it - for real-time form validation
 */
function handleValidatePaymentData(payload) {
  var session = validateSession(payload.token);
  if (!session) {
    return createErrorResponse('unauthorized');
  }
  
  var studentId = payload.studentId;
  var amount = parseFloat(payload.amount);
  var physicalReceiptNo = (payload.physicalReceiptNo || '').trim();
  var paymentDate = payload.paymentDate ? new Date(payload.paymentDate) : new Date();
  
  var validationResults = {
    overall: { valid: true, message: 'All validations passed' },
    amount: { valid: true, message: '' },
    receiptNumber: { valid: true, message: '' },
    student: { valid: true, message: '' },
    duplicate: { valid: true, message: '' }
  };
  
  // Validate amount
  if (amount) {
    var amountValidation = validatePaymentAmount(amount);
    validationResults.amount = amountValidation;
    if (!amountValidation.valid) {
      validationResults.overall.valid = false;
      validationResults.overall.message = amountValidation.message;
    }
  } else {
    validationResults.amount = { valid: false, message: 'Amount is required' };
    validationResults.overall.valid = false;
    validationResults.overall.message = 'Amount is required';
  }
  
  // Validate receipt number
  if (physicalReceiptNo) {
    var receiptValidation = validateUniqueReceiptNumber(physicalReceiptNo);
    validationResults.receiptNumber = receiptValidation;
    if (!receiptValidation.valid && validationResults.overall.valid) {
      validationResults.overall.valid = false;
      validationResults.overall.message = receiptValidation.message;
    }
  } else {
    validationResults.receiptNumber = { valid: false, message: 'Physical receipt number is required' };
    if (validationResults.overall.valid) {
      validationResults.overall.valid = false;
      validationResults.overall.message = 'Physical receipt number is required';
    }
  }
  
  // Validate student eligibility
  if (studentId && amount) {
    var eligibilityValidation = validateStudentPaymentEligibility(studentId, amount, session);
    validationResults.student = eligibilityValidation;
    if (!eligibilityValidation.valid && validationResults.overall.valid) {
      validationResults.overall.valid = false;
      validationResults.overall.message = eligibilityValidation.message;
    }
  } else if (!studentId) {
    validationResults.student = { valid: false, message: 'Student selection is required' };
    if (validationResults.overall.valid) {
      validationResults.overall.valid = false;
      validationResults.overall.message = 'Student selection is required';
    }
  }
  
  // Check for same-day duplicates
  if (studentId && paymentDate) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var paySheet = ss.getSheetByName('Payments');
    
    if (paySheet) {
      var payRows = getDataRows(paySheet, 2, 12);
      var todayStr = paymentDate.toDateString();
      
      for (var i = 0; i < payRows.length; i++) {
        if (String(payRows[i][1]) === String(studentId) && 
            !payRows[i][10] && // Not voided
            new Date(payRows[i][4]).toDateString() === todayStr) {
          validationResults.duplicate = { 
            valid: false, 
            message: 'A payment for this student has already been recorded today' 
          };
          if (validationResults.overall.valid) {
            validationResults.overall.valid = false;
            validationResults.overall.message = 'A payment for this student has already been recorded today';
          }
          break;
        }
      }
    }
  }
  
  return createSuccessResponse({
    validation: validationResults,
    canProceed: validationResults.overall.valid
  });
}

/* ---------- Dashboard Data Handler ---------- */

function handleGetDashboardData(payload) {
  var session = validateSession(payload.token);
  if (!session) {
    return createErrorResponse('unauthorized');
  }
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var stuSheet = ss.getSheetByName('Students');
  var paySheet = ss.getSheetByName('Payments');
  var secSheet = ss.getSheetByName('Sections');
  
  var sectionFilter = session.role === 'Treasurer' ? session.section : null;
  
  var stuRows = getDataRows(stuSheet, 2, 7);
  var payRows = getDataRows(paySheet, 2, 12);
  var secRows = getDataRows(secSheet, 2, 6);
  
  var totalStudents = 0;
  var totalExpected = 0;
  var totalCollected = 0;
  var fullyPaidCount = 0;
  var partialPaidCount = 0;
  var notPaidCount = 0;
  var sectionName = '';
  
  // Get section name if treasurer
  if (sectionFilter) {
    for (var s = 0; s < secRows.length; s++) {
      if (String(secRows[s][0]) === String(sectionFilter)) {
        sectionName = secRows[s][1];
        break;
      }
    }
  }
  
  // Calculate student statistics
  for (var i = 0; i < stuRows.length; i++) {
    var row = stuRows[i];
    var studentId = row[0];
    var studentSectionId = row[3];
    
    // Filter by section if needed
    if (sectionFilter && String(studentSectionId) !== String(sectionFilter)) continue;
    if (row[4] !== 'Active') continue;
    
    totalStudents++;
    var expectedAmount = row[6] || 0;
    totalExpected += expectedAmount;
    
    // Calculate payments for this student
    var studentPaid = 0;
    for (var j = 0; j < payRows.length; j++) {
      if (String(payRows[j][1]) === String(studentId) && !payRows[j][10]) { // Not voided
        studentPaid += payRows[j][3] || 0;
      }
    }
    
    totalCollected += studentPaid;
    
    if (studentPaid >= expectedAmount) {
      fullyPaidCount++;
    } else if (studentPaid > 0) {
      partialPaidCount++;
    } else {
      notPaidCount++;
    }
  }
  
  var remaining = totalExpected - totalCollected;
  var progress = totalExpected > 0 ? Math.round((totalCollected / totalExpected) * 100) : 0;
  
  var data = {
    section: sectionName || 'All Sections',
    treasurer: session.name || session.user,
    department: session.department,
    totalStudents: totalStudents,
    totalExpected: totalExpected,
    totalCollected: totalCollected,
    remaining: Math.max(0, remaining),
    progress: progress,
    fullyPaidCount: fullyPaidCount,
    partialPaidCount: partialPaidCount,
    notPaidCount: notPaidCount,
    lastSync: new Date().toISOString()
  };
  
  return createSuccessResponse(data);
}

/* ---------- Print Summary Handler ---------- */

function handlePrintSummary(payload) {
  var session = validateSession(payload.token);
  if (!session) {
    return createErrorResponse('unauthorized');
  }
  
  var sectionId = payload.sectionId || session.section;
  var period = payload.period || 'overall'; // 'monthly' or 'overall'
  var month = payload.month; // For monthly reports
  
  // Verify section access
  if (session.role === 'Treasurer' && String(sectionId) !== String(session.section)) {
    return createErrorResponse('unauthorized - not your section');
  }
  
  var lock = acquireLock('printSummary_' + sectionId);
  if (!lock) {
    return createErrorResponse('another user is printing. Try again in a few seconds.');
  }
  
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var printJobSheet = ss.getSheetByName('PrintJobs');
    
    // Check for existing print job
    var printRows = getDataRows(printJobSheet, 2, 8);
    var now = new Date();
    var lockTimeout = new Date(now.getTime() - CONFIG.PRINT_LOCK_TIMEOUT_SECONDS * 1000);
    
    for (var i = 0; i < printRows.length; i++) {
      var row = printRows[i];
      if (String(row[1]) === String(sectionId) && 
          row[3] === 'IN_PROGRESS' && 
          new Date(row[5]) > lockTimeout) {
        lock.releaseLock();
        return createErrorResponse('another user is printing. Try again in a few seconds.');
      }
    }
    
    // Create print job
    var jobId = 'PJ' + Math.floor(now.getTime() / 1000);
    printJobSheet.appendRow([
      jobId,
      sectionId,
      session.user,
      'SUMMARY',
      'IN_PROGRESS',
      now,
      null,
      JSON.stringify({ period: period, month: month })
    ]);
    
    // Get dashboard data for the summary
    var dashboardPayload = { token: payload.token, sectionId: sectionId };
    var dashboardResponse = handleGetDashboardData(dashboardPayload);
    var dashboardData = JSON.parse(dashboardResponse.getBlob().getDataAsString()).data;
    
    // Generate summary text
    var monthText = period === 'monthly' && month ? ' (' + month + ')' : '';
    var summary = [
      '-------------------------------',
      'Summary Report — Section: ' + dashboardData.section + monthText,
      'Fully Paid: ' + dashboardData.fullyPaidCount + '    Partial Paid: ' + dashboardData.partialPaidCount + '    Not Paid: ' + dashboardData.notPaidCount,
      'Total Expected: ₱' + formatNumber(dashboardData.totalExpected),
      'Total Collected: ₱' + formatNumber(dashboardData.totalCollected),
      'Remaining: ₱' + formatNumber(dashboardData.remaining),
      'Progress: ' + dashboardData.progress + '%',
      '-------------------------------',
      'Generated: ' + formatDate(now, 'YYYY-MM-DD HH:mm:ss'),
      'By: ' + session.user
    ].join('\n');
    
    // Mark print job as done
    for (var j = 0; j < printRows.length; j++) {
      if (String(printRows[j][0]) === String(jobId)) {
        var range = printJobSheet.getRange(j + 2, 5, 1, 2);
        range.setValues([['DONE', now]]);
        break;
      }
    }
    
    logAction('PRINT_SUMMARY', session.user, 'PrintJobs', jobId, JSON.stringify({
      sectionId: sectionId,
      period: period,
      month: month
    }));
    
    lock.releaseLock();
    
    return createSuccessResponse({
      jobId: jobId,
      summary: summary,
      data: dashboardData
    });
    
  } catch (e) {
    lock.releaseLock();
    throw e;
  }
}

/* ---------- Enhanced Receipt Generation Handler ---------- */

function handleGenerateReceipt(payload) {
  var session = validateSession(payload.token);
  if (!session) {
    return createErrorResponse('unauthorized');
  }
  
  var paymentId = payload.paymentId;
  var format = payload.format || 'text'; // 'text', 'html', 'json'
  
  if (!paymentId) {
    return createErrorResponse('paymentId is required');
  }
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var paySheet = ss.getSheetByName('Payments');
  var stuSheet = ss.getSheetByName('Students');
  var secSheet = ss.getSheetByName('Sections');
  
  // Find payment
  var payRows = getDataRows(paySheet, 2, 13);
  var payment = null;
  
  for (var i = 0; i < payRows.length; i++) {
    if (String(payRows[i][0]) === String(paymentId)) {
      payment = {
        paymentId: payRows[i][0],
        studentId: payRows[i][1],
        sectionId: payRows[i][2],
        amount: payRows[i][3],
        paymentDate: payRows[i][4],
        enteredBy: payRows[i][5],
        createdAt: payRows[i][6],
        physicalReceiptNo: payRows[i][7],
        receiptUrl: payRows[i][8],
        idempotencyKey: payRows[i][9],
        isVoided: payRows[i][10],
        collectionDayId: payRows[i][11],
        notes: payRows[i][12] || ''
      };
      break;
    }
  }
  
  if (!payment) {
    return createErrorResponse('payment not found');
  }
  
  if (payment.isVoided) {
    return createErrorResponse('cannot generate receipt for voided payment');
  }
  
  // Check authorization
  if (session.role === 'Treasurer' && String(payment.sectionId) !== String(session.section)) {
    return createErrorResponse('unauthorized - payment not in your section');
  }
  
  // Get student info
  var stuRows = getDataRows(stuSheet, 2, 7);
  var student = null;
  
  for (var j = 0; j < stuRows.length; j++) {
    if (String(stuRows[j][0]) === String(payment.studentId)) {
      student = {
        studentId: stuRows[j][0],
        studentNo: stuRows[j][1],
        fullName: stuRows[j][2],
        sectionId: stuRows[j][3],
        expectedAmount: stuRows[j][6] || 0
      };
      break;
    }
  }
  
  // Get section info
  var secRows = getDataRows(secSheet, 2, 6);
  var section = null;
  
  for (var k = 0; k < secRows.length; k++) {
    if (String(secRows[k][0]) === String(payment.sectionId)) {
      section = {
        sectionId: secRows[k][0],
        sectionName: secRows[k][1],
        department: secRows[k][2]
      };
      break;
    }
  }
  
  // Calculate running totals
  var totalPaid = 0;
  for (var l = 0; l < payRows.length; l++) {
    var row = payRows[l];
    if (String(row[1]) === String(payment.studentId) && !row[10]) {
      totalPaid += row[3] || 0;
    }
  }
  
  var remaining = Math.max(0, (student ? student.expectedAmount : 0) - totalPaid);
  
  var receiptData = {
    payment: payment,
    student: student,
    section: section,
    totals: {
      totalPaid: totalPaid,
      remaining: remaining,
      expectedAmount: student ? student.expectedAmount : 0
    },
    generatedAt: new Date().toISOString(),
    generatedBy: session.user
  };
  
  var receipt = '';
  
  if (format === 'text') {
    receipt = generateTextReceipt(receiptData);
  } else if (format === 'html') {
    receipt = generateHtmlReceipt(receiptData);
  } else {
    // Return raw data for custom formatting
    return createSuccessResponse(receiptData);
  }
  
  logAction('GENERATE_RECEIPT', session.user, 'Payments', paymentId, JSON.stringify({
    format: format,
    studentName: student ? student.fullName : 'Unknown'
  }));
  
  return createSuccessResponse({
    receipt: receipt,
    format: format,
    data: receiptData
  });
}

/* ---------- Detailed Report Generation Handler ---------- */

function handleGenerateDetailedReport(payload) {
  var session = validateSession(payload.token);
  if (!session) {
    return createErrorResponse('unauthorized');
  }
  
  var sectionId = payload.sectionId || session.section;
  var reportType = payload.reportType || 'summary'; // 'summary', 'detailed', 'student-list'
  var dateFrom = payload.dateFrom ? new Date(payload.dateFrom) : null;
  var dateTo = payload.dateTo ? new Date(payload.dateTo) : null;
  var format = payload.format || 'text'; // 'text', 'html', 'csv'
  
  // Authorization check
  if (session.role === 'Treasurer' && String(sectionId) !== String(session.section)) {
    return createErrorResponse('unauthorized - not your section');
  }
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var stuSheet = ss.getSheetByName('Students');
  var paySheet = ss.getSheetByName('Payments');
  var secSheet = ss.getSheetByName('Sections');
  
  // Get section info
  var secRows = getDataRows(secSheet, 2, 6);
  var sectionName = 'Unknown Section';
  var department = 'Unknown Department';
  
  for (var s = 0; s < secRows.length; s++) {
    if (String(secRows[s][0]) === String(sectionId)) {
      sectionName = secRows[s][1];
      department = secRows[s][2];
      break;
    }
  }
  
  // Get students in section
  var stuRows = getDataRows(stuSheet, 2, 7);
  var students = [];
  
  for (var i = 0; i < stuRows.length; i++) {
    var row = stuRows[i];
    if (String(row[3]) === String(sectionId) && row[4] === 'Active') {
      students.push({
        studentId: row[0],
        studentNo: row[1],
        fullName: row[2],
        expectedAmount: row[6] || 0,
        payments: []
      });
    }
  }
  
  // Get payments and associate with students
  var payRows = getDataRows(paySheet, 2, 13);
  var totalCollected = 0;
  var totalExpected = 0;
  
  for (var j = 0; j < students.length; j++) {
    var student = students[j];
    totalExpected += student.expectedAmount;
    
    for (var k = 0; k < payRows.length; k++) {
      var payRow = payRows[k];
      
      if (String(payRow[1]) === String(student.studentId) && !payRow[10]) { // Not voided
        var paymentDate = new Date(payRow[4]);
        
        // Date filtering
        if (dateFrom && paymentDate < dateFrom) continue;
        if (dateTo && paymentDate > dateTo) continue;
        
        var payment = {
          paymentId: payRow[0],
          amount: payRow[3],
          paymentDate: paymentDate,
          enteredBy: payRow[5],
          physicalReceiptNo: payRow[7],
          notes: payRow[12] || ''
        };
        
        student.payments.push(payment);
        totalCollected += payment.amount;
      }
    }
    
    // Calculate student totals
    student.totalPaid = student.payments.reduce((sum, p) => sum + p.amount, 0);
    student.remaining = Math.max(0, student.expectedAmount - student.totalPaid);
    student.status = student.totalPaid >= student.expectedAmount ? 'PAID' : 
                    (student.totalPaid > 0 ? 'PARTIAL' : 'NOT_PAID');
  }
  
  var reportData = {
    section: {
      sectionId: sectionId,
      sectionName: sectionName,
      department: department
    },
    summary: {
      totalStudents: students.length,
      totalExpected: totalExpected,
      totalCollected: totalCollected,
      remaining: Math.max(0, totalExpected - totalCollected),
      progress: totalExpected > 0 ? Math.round((totalCollected / totalExpected) * 100) : 0,
      fullyPaidCount: students.filter(s => s.status === 'PAID').length,
      partialPaidCount: students.filter(s => s.status === 'PARTIAL').length,
      notPaidCount: students.filter(s => s.status === 'NOT_PAID').length
    },
    students: students,
    filters: {
      dateFrom: dateFrom ? dateFrom.toISOString() : null,
      dateTo: dateTo ? dateTo.toISOString() : null,
      reportType: reportType
    },
    generatedAt: new Date().toISOString(),
    generatedBy: session.user
  };
  
  var report = '';
  
  if (format === 'text') {
    report = generateTextReport(reportData, reportType);
  } else if (format === 'html') {
    report = generateHtmlReport(reportData, reportType);
  } else if (format === 'csv') {
    report = generateCsvReport(reportData, reportType);
  } else {
    // Return raw data
    return createSuccessResponse(reportData);
  }
  
  logAction('GENERATE_REPORT', session.user, 'Sections', sectionId, JSON.stringify({
    reportType: reportType,
    format: format,
    dateFrom: dateFrom ? dateFrom.toISOString() : null,
    dateTo: dateTo ? dateTo.toISOString() : null
  }));
  
  return createSuccessResponse({
    report: report,
    format: format,
    data: reportData
  });
}

/* ---------- Student Report Handler ---------- */

function handleGenerateStudentReport(payload) {
  var session = validateSession(payload.token);
  if (!session) {
    return createErrorResponse('unauthorized');
  }
  
  var studentId = payload.studentId;
  var format = payload.format || 'text';
  
  if (!studentId) {
    return createErrorResponse('studentId is required');
  }
  
  // Use existing detailed report functionality with student filter
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var stuSheet = ss.getSheetByName('Students');
  
  // Get student to verify section
  var stuRows = getDataRows(stuSheet, 2, 7);
  var studentSectionId = null;
  
  for (var i = 0; i < stuRows.length; i++) {
    if (String(stuRows[i][0]) === String(studentId)) {
      studentSectionId = stuRows[i][3];
      break;
    }
  }
  
  if (!studentSectionId) {
    return createErrorResponse('student not found');
  }
  
  // Authorization check
  if (session.role === 'Treasurer' && String(studentSectionId) !== String(session.section)) {
    return createErrorResponse('unauthorized - student not in your section');
  }
  
  // Generate detailed report for the section, then filter for the student
  var detailedPayload = {
    token: payload.token,
    sectionId: studentSectionId,
    reportType: 'detailed',
    format: 'json'
  };
  
  var detailedResponse = handleGenerateDetailedReport(detailedPayload);
  var reportData = JSON.parse(detailedResponse.getBlob().getDataAsString()).data;
  
  // Filter for specific student
  var student = reportData.students.find(s => String(s.studentId) === String(studentId));
  
  if (!student) {
    return createErrorResponse('student not found in report');
  }
  
  var studentReportData = {
    student: student,
    section: reportData.section,
    generatedAt: new Date().toISOString(),
    generatedBy: session.user
  };
  
  var report = '';
  
  if (format === 'text') {
    report = generateTextStudentReport(studentReportData);
  } else if (format === 'html') {
    report = generateHtmlStudentReport(studentReportData);
  } else {
    return createSuccessResponse(studentReportData);
  }
  
  logAction('GENERATE_STUDENT_REPORT', session.user, 'Students', studentId, JSON.stringify({
    format: format,
    studentName: student.fullName
  }));
  
  return createSuccessResponse({
    report: report,
    format: format,
    data: studentReportData
  });
}

/* ---------- Excel Export Handler ---------- */

function handleExportExcel(payload) {
  var session = validateSession(payload.token);
  if (!session) {
    return createErrorResponse('unauthorized');
  }
  
  var sectionId = payload.sectionId || session.section;
  var exportType = payload.exportType || 'students'; // 'students', 'payments', 'summary'
  
  // Authorization check
  if (session.role === 'Treasurer' && String(sectionId) !== String(session.section)) {
    return createErrorResponse('unauthorized - not your section');
  }
  
  try {
    // Generate detailed report data
    var reportPayload = {
      token: payload.token,
      sectionId: sectionId,
      reportType: 'detailed',
      format: 'json'
    };
    
    var reportResponse = handleGenerateDetailedReport(reportPayload);
    var reportData = JSON.parse(reportResponse.getBlob().getDataAsString()).data;
    
    var csvData = '';
    
    if (exportType === 'students') {
      csvData = generateStudentsCsv(reportData);
    } else if (exportType === 'payments') {
      csvData = generatePaymentsCsv(reportData);
    } else if (exportType === 'summary') {
      csvData = generateSummaryCsv(reportData);
    }
    
    logAction('EXPORT_EXCEL', session.user, 'Sections', sectionId, JSON.stringify({
      exportType: exportType
    }));
    
    return createSuccessResponse({
      csvData: csvData,
      exportType: exportType,
      filename: `${reportData.section.sectionName}_${exportType}_${formatDate(new Date(), 'YYYYMMDD')}.csv`
    });
    
  } catch (error) {
    return createErrorResponse('Failed to generate export: ' + error.message);
  }
}

/* ---------- Report Formatting Functions ---------- */

function generateTextReceipt(receiptData) {
  var payment = receiptData.payment;
  var student = receiptData.student;
  var section = receiptData.section;
  var totals = receiptData.totals;
  
  return [
    '===============================',
    'SSC COLLECTION RECEIPT',
    '===============================',
    'Receipt ID: ' + payment.paymentId,
    'Physical Receipt: ' + payment.physicalReceiptNo,
    '',
    'Student: ' + (student ? student.fullName : 'Unknown'),
    'Student No: ' + (student ? student.studentNo : 'N/A'),
    'Section: ' + (section ? section.sectionName : 'Unknown'),
    'Department: ' + (section ? section.department : 'Unknown'),
    '',
    'Amount Paid: ₱' + formatNumber(payment.amount),
    'Payment Date: ' + formatDate(payment.paymentDate, 'YYYY-MM-DD'),
    'Entered By: ' + payment.enteredBy,
    '',
    '--- PAYMENT SUMMARY ---',
    'Total Expected: ₱' + formatNumber(totals.expectedAmount),
    'Total Paid: ₱' + formatNumber(totals.totalPaid),
    'Remaining: ₱' + formatNumber(totals.remaining),
    '',
    'Notes: ' + (payment.notes || 'None'),
    '',
    '===============================',
    'Generated: ' + formatDate(receiptData.generatedAt, 'YYYY-MM-DD HH:mm:ss'),
    'By: ' + receiptData.generatedBy,
    '===============================',
    '',
    'Thank you for your payment!',
    'Keep this receipt for your records.'
  ].join('\n');
}

function generateHtmlReceipt(receiptData) {
  var payment = receiptData.payment;
  var student = receiptData.student;
  var section = receiptData.section;
  var totals = receiptData.totals;
  
  return `
    <div style="max-width: 400px; margin: 0 auto; font-family: 'Courier New', monospace; border: 2px solid #333; padding: 20px;">
      <div style="text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 15px;">
        <h2 style="margin: 0; font-size: 18px;">SSC COLLECTION RECEIPT</h2>
      </div>
      
      <div style="margin-bottom: 15px;">
        <strong>Receipt ID:</strong> ${payment.paymentId}<br>
        <strong>Physical Receipt:</strong> ${payment.physicalReceiptNo}<br>
      </div>
      
      <div style="margin-bottom: 15px; border-bottom: 1px solid #ccc; padding-bottom: 10px;">
        <strong>Student:</strong> ${student ? student.fullName : 'Unknown'}<br>
        <strong>Student No:</strong> ${student ? student.studentNo : 'N/A'}<br>
        <strong>Section:</strong> ${section ? section.sectionName : 'Unknown'}<br>
        <strong>Department:</strong> ${section ? section.department : 'Unknown'}<br>
      </div>
      
      <div style="margin-bottom: 15px; border-bottom: 1px solid #ccc; padding-bottom: 10px;">
        <div style="font-size: 20px; font-weight: bold; color: #2563eb;">
          Amount Paid: ₱${formatNumber(payment.amount)}
        </div>
        <strong>Payment Date:</strong> ${formatDate(payment.paymentDate, 'YYYY-MM-DD')}<br>
        <strong>Entered By:</strong> ${payment.enteredBy}<br>
      </div>
      
      <div style="margin-bottom: 15px; background-color: #f8f9fa; padding: 10px; border-radius: 5px;">
        <h4 style="margin: 0 0 10px 0; color: #666;">Payment Summary</h4>
        <strong>Total Expected:</strong> ₱${formatNumber(totals.expectedAmount)}<br>
        <strong>Total Paid:</strong> ₱${formatNumber(totals.totalPaid)}<br>
        <strong>Remaining:</strong> ₱${formatNumber(totals.remaining)}<br>
      </div>
      
      ${payment.notes ? `<div style="margin-bottom: 15px;"><strong>Notes:</strong> ${payment.notes}</div>` : ''}
      
      <div style="border-top: 2px solid #333; padding-top: 10px; font-size: 12px; color: #666; text-align: center;">
        Generated: ${formatDate(receiptData.generatedAt, 'YYYY-MM-DD HH:mm:ss')}<br>
        By: ${receiptData.generatedBy}<br><br>
        <em>Thank you for your payment!<br>Keep this receipt for your records.</em>
      </div>
    </div>
  `;
}

function generateTextReport(reportData, reportType) {
  var section = reportData.section;
  var summary = reportData.summary;
  var students = reportData.students;
  
  var report = [
    '=================================',
    'COLLECTION REPORT',
    '=================================',
    'Section: ' + section.sectionName,
    'Department: ' + section.department,
    'Report Type: ' + reportType.toUpperCase(),
    '',
    '--- SUMMARY ---',
    'Total Students: ' + summary.totalStudents,
    'Total Expected: ₱' + formatNumber(summary.totalExpected),
    'Total Collected: ₱' + formatNumber(summary.totalCollected),
    'Remaining: ₱' + formatNumber(summary.remaining),
    'Progress: ' + summary.progress + '%',
    '',
    'Status Breakdown:',
    '  Fully Paid: ' + summary.fullyPaidCount,
    '  Partial Paid: ' + summary.partialPaidCount,
    '  Not Paid: ' + summary.notPaidCount,
    '',
    '=================================',
    ''
  ];
  
  if (reportType === 'detailed') {
    report.push('--- STUDENT DETAILS ---');
    report.push('');
    
    students.forEach(function(student, index) {
      report.push((index + 1) + '. ' + student.fullName + ' (' + student.studentNo + ')');
      report.push('   Expected: ₱' + formatNumber(student.expectedAmount) + 
                  ' | Paid: ₱' + formatNumber(student.totalPaid) + 
                  ' | Status: ' + student.status);
      
      if (student.payments.length > 0) {
        report.push('   Payments:');
        student.payments.forEach(function(payment) {
          report.push('     - ₱' + formatNumber(payment.amount) + 
                     ' on ' + formatDate(payment.paymentDate, 'YYYY-MM-DD') + 
                     ' (Receipt: ' + payment.physicalReceiptNo + ')');
        });
      } else {
        report.push('   No payments recorded');
      }
      report.push('');
    });
  }
  
  report.push('Generated: ' + formatDate(reportData.generatedAt, 'YYYY-MM-DD HH:mm:ss'));
  report.push('By: ' + reportData.generatedBy);
  
  return report.join('\n');
}

function generateStudentsCsv(reportData) {
  var headers = ['Student No', 'Full Name', 'Expected Amount', 'Total Paid', 'Remaining', 'Status', 'Payment Count'];
  var rows = [headers.join(',')];
  
  reportData.students.forEach(function(student) {
    var row = [
      '"' + (student.studentNo || '') + '"',
      '"' + student.fullName + '"',
      student.expectedAmount,
      student.totalPaid,
      student.remaining,
      '"' + student.status + '"',
      student.payments.length
    ];
    rows.push(row.join(','));
  });
  
  return rows.join('\n');
}

function generatePaymentsCsv(reportData) {
  var headers = ['Payment ID', 'Student Name', 'Student No', 'Amount', 'Payment Date', 'Physical Receipt', 'Entered By', 'Notes'];
  var rows = [headers.join(',')];
  
  reportData.students.forEach(function(student) {
    student.payments.forEach(function(payment) {
      var row = [
        '"' + payment.paymentId + '"',
        '"' + student.fullName + '"',
        '"' + (student.studentNo || '') + '"',
        payment.amount,
        '"' + formatDate(payment.paymentDate, 'YYYY-MM-DD') + '"',
        '"' + payment.physicalReceiptNo + '"',
        '"' + payment.enteredBy + '"',
        '"' + (payment.notes || '') + '"'
      ];
      rows.push(row.join(','));
    });
  });
  
  return rows.join('\n');
}

function generateSummaryCsv(reportData) {
  var section = reportData.section;
  var summary = reportData.summary;
  
  var rows = [
    'Metric,Value',
    '"Section","' + section.sectionName + '"',
    '"Department","' + section.department + '"',
    '"Total Students",' + summary.totalStudents,
    '"Total Expected",' + summary.totalExpected,
    '"Total Collected",' + summary.totalCollected,
    '"Remaining",' + summary.remaining,
    '"Progress (%)",' + summary.progress,
    '"Fully Paid",' + summary.fullyPaidCount,
    '"Partial Paid",' + summary.partialPaidCount,
    '"Not Paid",' + summary.notPaidCount,
    '"Generated","' + formatDate(reportData.generatedAt, 'YYYY-MM-DD HH:mm:ss') + '"',
    '"Generated By","' + reportData.generatedBy + '"'
  ];
  
  return rows.join('\n');
}

function generateTextStudentReport(studentReportData) {
  var student = studentReportData.student;
  var section = studentReportData.section;
  
  var report = [
    '===============================',
    'STUDENT PAYMENT REPORT',
    '===============================',
    'Student: ' + student.fullName,
    'Student No: ' + student.studentNo,
    'Section: ' + section.sectionName,
    'Department: ' + section.department,
    '',
    '--- PAYMENT SUMMARY ---',
    'Expected Amount: ₱' + formatNumber(student.expectedAmount),
    'Total Paid: ₱' + formatNumber(student.totalPaid),
    'Remaining: ₱' + formatNumber(student.remaining),
    'Status: ' + student.status,
    'Payment Count: ' + student.payments.length,
    '',
    '--- PAYMENT HISTORY ---'
  ];
  
  if (student.payments.length > 0) {
    student.payments.forEach(function(payment, index) {
      report.push((index + 1) + '. ₱' + formatNumber(payment.amount) + 
                 ' on ' + formatDate(payment.paymentDate, 'YYYY-MM-DD'));
      report.push('   Receipt: ' + payment.physicalReceiptNo);
      report.push('   Entered by: ' + payment.enteredBy);
      if (payment.notes) {
        report.push('   Notes: ' + payment.notes);
      }
      report.push('');
    });
  } else {
    report.push('No payments recorded yet.');
    report.push('');
  }
  
  report.push('===============================');
  report.push('Generated: ' + formatDate(studentReportData.generatedAt, 'YYYY-MM-DD HH:mm:ss'));
  report.push('By: ' + studentReportData.generatedBy);
  
  return report.join('\n');
}

/* ---------- Utility Functions ---------- */

function formatDate(date, format) {
  var d = new Date(date);
  var year = d.getFullYear();
  var month = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  var hours = String(d.getHours()).padStart(2, '0');
  var minutes = String(d.getMinutes()).padStart(2, '0');
  var seconds = String(d.getSeconds()).padStart(2, '0');
  
  return format
    .replace('YYYY', year)
    .replace('MM', month)
    .replace('DD', day)
    .replace('HH', hours)
    .replace('mm', minutes)
    .replace('ss', seconds)
    .replace('YYYYMMDD', year + month + day);
}

function formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/* ---------- Additional Handlers ---------- */

function handleGetDepartments(payload) {
  var session = validateSession(payload.token);
  if (!session) {
    return createErrorResponse('unauthorized');
  }
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var deptSheet = ss.getSheetByName('Departments');
  var rows = getDataRows(deptSheet, 2, 2);
  
  var departments = [];
  for (var i = 0; i < rows.length; i++) {
    departments.push({
      id: rows[i][0],
      name: rows[i][1]
    });
  }
  
  return createSuccessResponse({ departments: departments });
}

function handleRecordCashHandover(payload) {
  var session = validateSession(payload.token);
  if (!session || session.role !== 'Treasurer') {
    return createErrorResponse('unauthorized');
  }
  
  var amount = parseFloat(payload.amount);
  var custodianName = payload.custodianName;
  var notes = payload.notes || '';
  
  if (!amount || !custodianName) {
    return createErrorResponse('amount and custodianName are required');
  }
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var handoverSheet = ss.getSheetByName('CashHandovers');
  
  var now = new Date();
  var handoverId = 'CH' + Math.floor(now.getTime() / 1000);
  
  handoverSheet.appendRow([
    handoverId,
    session.section,
    session.user,
    amount,
    now,
    custodianName,
    '', // PhotoUrl - to be filled if file uploaded
    notes,
    now
  ]);
  
  logAction('CASH_HANDOVER', session.user, 'CashHandovers', handoverId, JSON.stringify({
    amount: amount,
    custodianName: custodianName,
    notes: notes
  }));
  
  return createSuccessResponse({
    handoverId: handoverId,
    message: 'Cash handover recorded successfully'
  });
}

function handleGetAuditLog(payload) {
  var session = validateSession(payload.token);
  if (!session || session.role !== 'Admin') {
    return createErrorResponse('unauthorized');
  }
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var auditSheet = ss.getSheetByName('AuditLog');
  var rows = getDataRows(auditSheet, 2, 8);
  
  var logs = [];
  for (var i = rows.length - 1; i >= 0; i--) { // Latest first
    var row = rows[i];
    logs.push({
      logId: row[0],
      user: row[1],
      actionType: row[2],
      table: row[3],
      recordId: row[4],
      details: row[5],
      actionTime: row[6],
      ipAddress: row[7]
    });
    
    if (logs.length >= 100) break; // Limit to latest 100 entries
  }
  
  return createSuccessResponse({ logs: logs });
}

/* ---------- Additional Admin Functions ---------- */

function handleCreateTreasurer(payload) {
  var session = validateSession(payload.token);
  if (!session || session.role !== 'Admin') {
    return createErrorResponse('unauthorized');
  }
  
  var fullName = payload.fullName;
  var username = payload.username;
  var password = payload.password;
  var department = payload.department;
  var section = payload.section;
  var startDate = payload.startDate ? new Date(payload.startDate) : new Date();
  var endDate = payload.endDate ? new Date(payload.endDate) : null;
  
  if (!fullName || !username || !password || !department || !section) {
    return createErrorResponse('fullName, username, password, department, and section are required');
  }
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var treasSheet = ss.getSheetByName('Treasurers');
  
  // Check for duplicate username
  var rows = getDataRows(treasSheet, 2, 11);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][2]).toLowerCase() === username.toLowerCase() && rows[i][7]) {
      return createErrorResponse('username already exists');
    }
  }
  
  var now = new Date();
  var treasurerId = 'T' + Math.floor(now.getTime() / 1000);
  var passwordHash = hashValue(password);
  
  treasSheet.appendRow([
    treasurerId,
    fullName,
    username,
    passwordHash,
    'Treasurer',
    department,
    section,
    true,
    now,
    startDate,
    endDate
  ]);
  
  logAction('TREASURER_CREATE', session.user, 'Treasurers', treasurerId, JSON.stringify({
    fullName: fullName,
    username: username,
    department: department,
    section: section
  }));
  
  return createSuccessResponse({
    treasurerId: treasurerId,
    message: 'Treasurer created successfully'
  });
}

function handleGetTreasurers(payload) {
  var session = validateSession(payload.token);
  if (!session || session.role !== 'Admin') {
    return createErrorResponse('unauthorized');
  }
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var treasSheet = ss.getSheetByName('Treasurers');
  var rows = getDataRows(treasSheet, 2, 11);
  
  var treasurers = [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (!row[7]) continue; // Skip inactive
    
    treasurers.push({
      treasurerId: row[0],
      fullName: row[1],
      username: row[2],
      role: row[4],
      department: row[5],
      section: row[6],
      isActive: row[7],
      createdAt: row[8],
      startDate: row[9],
      endDate: row[10]
    });
  }
  
  return createSuccessResponse({ treasurers: treasurers });
}

/**
 * Verify password against hash (enhanced version from enhancement file)
 */
function verifyPassword(password, hashedPassword) {
  try {
    // Check if it's the old simple hash format
    if (!hashedPassword.includes(':')) {
      // Fallback to simple hash comparison for existing passwords
      return hashValue(password) === hashedPassword;
    }
    
    // New salt-based hash format
    var parts = hashedPassword.split(':');
    if (parts.length !== 2) return false;
    
    var salt = parts[0];
    var hash = parts[1];
    var testHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + password);
    var testHashString = testHash.map(byte => (byte < 0 ? byte + 256 : byte).toString(16).padStart(2, '0')).join('');
    
    return testHashString === hash;
  } catch (error) {
    Logger.log('Password verification error:', error);
    return false;
  }
}

/**
 * Enhanced password hashing with salt (from enhancement file)
 */
function hashPasswordWithSalt(password) {
  var salt = Utilities.getUuid().substring(0, 16);
  var hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + password);
  var hashString = hash.map(byte => (byte < 0 ? byte + 256 : byte).toString(16).padStart(2, '0')).join('');
  return salt + ':' + hashString;
}

/**
 * Get comprehensive database status for admin dashboard (from enhancement file)
 */
function getDatabaseStatus() {
  try {
    var properties = PropertiesService.getScriptProperties();
    var isInitialized = properties.getProperty('DB_INITIALIZED');
    var initDate = properties.getProperty('INIT_DATE');
    var initAdmin = properties.getProperty('INIT_ADMIN');
    
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheets = ss.getSheets().map(function(sheet) {
      return {
        name: sheet.getName(),
        rowCount: sheet.getLastRow(),
        columnCount: sheet.getLastColumn(),
        isHidden: sheet.isSheetHidden()
      };
    });
    
    // Check for required sheets
    var requiredSheets = ['Departments', 'Sections', 'Students', 'Treasurers', 'Payments', 'AuditLog', 'Sessions'];
    var missingSheets = requiredSheets.filter(function(sheetName) {
      return !sheets.find(function(sheet) { return sheet.name === sheetName; });
    });
    
    // Get total records count
    var totalStudents = 0;
    var totalPayments = 0;
    var totalTreasurers = 0;
    
    try {
      var stuSheet = ss.getSheetByName('Students');
      if (stuSheet) totalStudents = Math.max(0, stuSheet.getLastRow() - 1);
      
      var paySheet = ss.getSheetByName('Payments');
      if (paySheet) totalPayments = Math.max(0, paySheet.getLastRow() - 1);
      
      var treasSheet = ss.getSheetByName('Treasurers');
      if (treasSheet) totalTreasurers = Math.max(0, treasSheet.getLastRow() - 1);
    } catch (e) {
      Logger.log('Error getting record counts: ' + e.toString());
    }
    
    return {
      status: 'ok',
      data: {
        initialized: isInitialized === 'true',
        initDate: initDate,
        initAdmin: initAdmin,
        sheets: sheets,
        missingSheets: missingSheets,
        totalSheets: sheets.length,
        spreadsheetId: ss.getId(),
        spreadsheetName: ss.getName(),
        spreadsheetUrl: ss.getUrl(),
        recordCounts: {
          students: totalStudents,
          payments: totalPayments,
          treasurers: totalTreasurers
        },
        lastChecked: new Date().toISOString()
      }
    };
  } catch (error) {
    return {
      status: 'error',
      message: 'Failed to get database status: ' + error.toString()
    };
  }
}

/**
 * Manual database setup function for script editor execution
 */
function manualDatabaseSetup() {
  Logger.log('🔄 Starting manual database setup...');
  
  try {
    var result = setupDatabase();
    Logger.log('✅ Database setup completed: ' + result.message);
    
    var createResult = createDatabaseSheets();
    Logger.log('✅ Database sheets creation completed: ' + createResult.message);
    
    var statusResult = getDatabaseStatus();
    if (statusResult.status === 'ok') {
      var data = statusResult.data;
      Logger.log('📊 Database Status:');
      Logger.log('   - Initialized: ' + data.initialized);
      Logger.log('   - Total Sheets: ' + data.totalSheets);
      Logger.log('   - Missing Sheets: ' + (data.missingSheets.length > 0 ? data.missingSheets.join(', ') : 'None'));
      Logger.log('   - Students: ' + data.recordCounts.students);
      Logger.log('   - Payments: ' + data.recordCounts.payments);
      Logger.log('   - Treasurers: ' + data.recordCounts.treasurers);
    }
    
    Logger.log('🎉 Manual database setup completed successfully!');
    
  } catch (error) {
    Logger.log('❌ Manual database setup failed: ' + error.toString());
    throw error;
  }
}

/**
 * Manual database reset function for script editor execution
 */
function manualDatabaseReset() {
  Logger.log('⚠️  WARNING: Starting manual database reset...');
  Logger.log('⚠️  This will DELETE all database sheets except Sheet1!');
  Logger.log('⚠️  All data will be lost except what is in Sheet1!');
  
  try {
    var result = resetDatabase();
    Logger.log('✅ Database reset completed: ' + result.message);
    
    if (result.status === 'ok' && result.data) {
      Logger.log('📊 Reset Summary:');
      Logger.log('   - Deleted Sheets: ' + result.data.deletedSheets.join(', '));
      Logger.log('   - Preserved Sheets: ' + result.data.preservedSheets.join(', '));
      Logger.log('   - Recreated Sheets: ' + (result.data.recreatedSheets || []).join(', '));
      Logger.log('   - Reset Time: ' + result.data.timestamp);
    }
    
    Logger.log('🎉 Manual database reset completed successfully!');
    
  } catch (error) {
    Logger.log('❌ Manual database reset failed: ' + error.toString());
    throw error;
  }
}

/**
 * Get database information for debugging and status checking
 */
function getDatabaseInfo() {
  Logger.log('📋 Getting database information...');
  
  try {
    var statusResult = getDatabaseStatus();
    
    if (statusResult.status === 'ok') {
      var data = statusResult.data;
      
      Logger.log('=================================');
      Logger.log('DATABASE INFORMATION');
      Logger.log('=================================');
      Logger.log('Spreadsheet Name: ' + data.spreadsheetName);
      Logger.log('Spreadsheet ID: ' + data.spreadsheetId);
      Logger.log('Spreadsheet URL: ' + data.spreadsheetUrl);
      Logger.log('');
      Logger.log('Initialization Status:');
      Logger.log('  - Initialized: ' + data.initialized);
      Logger.log('  - Init Date: ' + (data.initDate || 'Not set'));
      Logger.log('  - Init Admin: ' + (data.initAdmin || 'Not set'));
      Logger.log('');
      Logger.log('Sheets (' + data.totalSheets + ' total):');
      data.sheets.forEach(function(sheet) {
        Logger.log('  - ' + sheet.name + ' (' + sheet.rowCount + ' rows, ' + sheet.columnCount + ' cols)' + (sheet.isHidden ? ' [HIDDEN]' : ''));
      });
      
      if (data.missingSheets.length > 0) {
        Logger.log('');
        Logger.log('Missing Required Sheets:');
        data.missingSheets.forEach(function(sheetName) {
          Logger.log('  - ' + sheetName);
        });
      }
      
      Logger.log('');
      Logger.log('Record Counts:');
      Logger.log('  - Students: ' + data.recordCounts.students);
      Logger.log('  - Payments: ' + data.recordCounts.payments);
      Logger.log('  - Treasurers: ' + data.recordCounts.treasurers);
      Logger.log('');
      Logger.log('Last Checked: ' + data.lastChecked);
      Logger.log('=================================');
      
      return data;
    } else {
      Logger.log('❌ Failed to get database status: ' + statusResult.message);
      return null;
    }
    
  } catch (error) {
    Logger.log('❌ getDatabaseInfo() error: ' + error.toString());
    return null;
  }
}

/**
 * Manual Database Setup Function - Can be run from Script Editor
 * Use this function when you want to manually set up the database from the Apps Script editor
 */
function manualDatabaseSetup() {
  Logger.log('🚀 Starting manual database setup...');
  
  try {
    // Step 1: Create/ensure all database sheets
    Logger.log('📋 Step 1: Creating database sheets...');
    var createResult = createDatabaseSheets();
    Logger.log('✅ Create sheets result: ' + JSON.stringify(createResult));
    
    // Step 2: Run full setup
    Logger.log('🔧 Step 2: Running full database setup...');
    var setupResult = setupDatabase();
    Logger.log('✅ Setup result: ' + JSON.stringify(setupResult));
    
    // Step 3: Log current status
    Logger.log('📊 Step 3: Checking database status...');
    var statusResult = checkDatabaseInit();
    Logger.log('📈 Status result: ' + JSON.stringify(statusResult));
    
    // Step 4: Show summary
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheets = ss.getSheets().map(function(sheet) { 
      return {
        name: sheet.getName(),
        rows: sheet.getLastRow(),
        cols: sheet.getLastColumn()
      };
    });
    
    Logger.log('📋 Current sheets: ' + JSON.stringify(sheets, null, 2));
    Logger.log('🎉 Manual database setup completed!');
    
    return {
      success: true,
      createResult: createResult,
      setupResult: setupResult,
      statusResult: statusResult,
      sheets: sheets
    };
    
  } catch (error) {
    Logger.log('❌ Manual database setup failed: ' + error.toString());
    return {
      success: false,
      error: error.toString()
    };
  }
}

/**
 * Manual Database Reset Function - Can be run from Script Editor
 * WARNING: This will delete all data except Sheet1
 */
function manualDatabaseReset() {
  Logger.log('⚠️ Starting manual database RESET...');
  Logger.log('⚠️ This will DELETE all data except Sheet1!');
  
  try {
    var resetResult = resetDatabase();
    Logger.log('✅ Reset result: ' + JSON.stringify(resetResult));
    
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheets = ss.getSheets().map(function(sheet) { return sheet.getName(); });
    Logger.log('📋 Remaining sheets: ' + sheets.join(', '));
    Logger.log('🔥 Manual database reset completed!');
    
    return resetResult;
    
  } catch (error) {
    Logger.log('❌ Manual database reset failed: ' + error.toString());
    return {
      success: false,
      error: error.toString()
    };
  }
}

/**
 * Quick Database Info - Check current status
 */
function getDatabaseInfo() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheets = ss.getSheets().map(function(sheet) { 
      return {
        name: sheet.getName(),
        rows: sheet.getLastRow(),
        cols: sheet.getLastColumn()
      };
    });
    
    var properties = PropertiesService.getScriptProperties();
    var isInitialized = properties.getProperty('DB_INITIALIZED');
    var initDate = properties.getProperty('INIT_DATE');
    var initAdmin = properties.getProperty('INIT_ADMIN');
    
    var info = {
      spreadsheetId: ss.getId(),
      spreadsheetName: ss.getName(),
      sheets: sheets,
      isInitialized: isInitialized === 'true',
      initDate: initDate,
      initAdmin: initAdmin,
      timestamp: new Date().toISOString()
    };
    
    Logger.log('📊 Database Info: ' + JSON.stringify(info, null, 2));
    return info;
    
  } catch (error) {
    Logger.log('❌ Get database info failed: ' + error.toString());
    return { error: error.toString() };
  }
}