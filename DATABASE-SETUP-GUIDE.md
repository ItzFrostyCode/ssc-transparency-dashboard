# 🛢️ DATABASE SETUP & MANAGEMENT GUIDE

## 📋 Overview

Your SSC Transparency Dashboard now has comprehensive database management capabilities that:
- ✅ **Preserve Sheet1** - Never deletes your original sheet
- ✅ **Auto-create all required sheets** - Sets up the complete database structure
- ✅ **Reset safely** - Clear data while keeping structure
- ✅ **Dark theme styling** - Professional appearance for all sheets
- ✅ **Manual and automated setup** - Multiple ways to initialize

## 🚀 QUICK SETUP METHODS

### Method 1: Using the Database Management Interface (Easiest)

1. **Open the management interface**:
   ```
   https://yoursite.netlify.app/database-management.html
   ```

2. **Update the API URL** in the file (line 139):
   ```javascript
   const API_BASE_URL = 'YOUR_GOOGLE_APPS_SCRIPT_URL';
   ```

3. **Use the interface**:
   - Click "Setup Database" - Creates all sheets safely
   - Click "Initialize with Admin" - First-time setup with admin account
   - Monitor progress in the operation log

### Method 2: Run Manual Functions in Apps Script

1. **Open your Google Apps Script project**
2. **Add the updated Code.gs** (with all the new functions)
3. **Run these functions manually**:

   ```javascript
   // Check current status
   getDatabaseInfo()
   
   // Set up database (safe to run multiple times)
   manualDatabaseSetup()
   
   // Reset if needed (DESTRUCTIVE - deletes data)
   manualDatabaseReset()
   ```

### Method 3: API Calls from Frontend

Your frontend can now call these endpoints:
- `setupDatabase` - Create/ensure all sheets
- `createDatabaseSheets` - Create only missing sheets
- `checkDatabaseInit` - Check initialization status
- `initializeDatabase` - First-time setup with admin
- `resetDatabase` - Reset all data (keeps Sheet1)

## 📊 DATABASE STRUCTURE

The system will create these sheets automatically:

| Sheet Name | Purpose | Headers |
|------------|---------|---------|
| **Settings** | System configuration | Key, Value |
| **Departments** | Academic departments | DepartmentID, DepartmentName |
| **Sections** | Student sections/classes | SectionID, SectionName, Department, CreatedBy, CreatedAt, IsActive |
| **Students** | Student records | StudentID, StudentNo, FullName, SectionID, Status, CreatedAt, ExpectedAmount |
| **Treasurers** | User accounts | TreasurerID, FullName, Username, PasswordHash, Role, Department, Section, IsActive, CreatedAt, StartDate, EndDate |
| **Payments** | Payment transactions | PaymentID, StudentID, SectionID, Amount, PaymentDate, EnteredBy, CreatedAt, PhysicalReceiptNo, ReceiptUrl, IdempotencyKey, IsVoided, CollectionDayID |
| **CollectionDays** | Collection records | CollectionDayID, SectionID, CollectionDate, ExpectedAmount, ActualCollected, Status, CreatedBy, CreatedAt |
| **CashHandovers** | Cash handover tracking | HandoverID, SectionID, TreasurerID, Amount, HandoverDate, CustodianName, PhotoUrl, Notes, CreatedAt |
| **PrintJobs** | Print job tracking | JobID, SectionID, User, JobType, Status, StartedAt, FinishedAt, Details |
| **Expenditure** | Expense records | ExpenseID, ExpenseDate, Purpose, Amount, ReceiptUrl, TreasurerID, EnteredBy, CreatedAt, Visibility |
| **AuditLog** | System audit trail | LogID, User, ActionType, Table, RecordID, Details, ActionTime, IPAddress |
| **Sessions** | User sessions | SessionToken, User, Role, Department, Section, CreatedAt, ExpiresAt, LastActivity, IsActive |

## 🎨 DARK THEME STYLING

All created sheets feature:
- **Dark headers** (#353535 background)
- **Light text** (#e0e0e0 color)
- **Professional borders** (#404040)
- **Frozen header rows** for better navigation
- **Auto-resized columns** for optimal viewing
- **Descriptive notes** on each sheet

## ⚙️ FUNCTIONS REFERENCE

### Core Setup Functions

```javascript
// Create all database sheets (safe, preserves existing data)
setupDatabase()

// Create only missing sheets
createDatabaseSheets()

// Check if database is properly initialized
checkDatabaseInit()

// Initialize with first admin user (one-time only)
initializeDatabase({
  adminName: "Your Name",
  adminUsername: "admin",
  adminPassword: "securepassword"
})

// Reset database (DESTRUCTIVE - preserves only Sheet1)
resetDatabase()
```

### Manual Functions (Apps Script Editor)

```javascript
// Manual setup with detailed logging
manualDatabaseSetup()

// Manual reset with warnings
manualDatabaseReset()

// Get current database information
getDatabaseInfo()
```

## 🔒 SECURITY FEATURES

- **Sheet1 Protection** - Original sheet never deleted
- **Secure initialization** - Admin password hashing
- **One-time setup** - Prevents re-initialization
- **Audit logging** - All database changes tracked
- **Input validation** - Prevents invalid data

## 📱 USAGE SCENARIOS

### First-Time Setup
1. Run `manualDatabaseSetup()` in Apps Script
2. OR use the database management interface
3. System creates all required sheets with proper formatting

### Add Missing Sheets
1. Call `createDatabaseSheets()` 
2. Only creates sheets that don't exist
3. Preserves all existing data

### Reset for Testing
1. Call `resetDatabase()` 
2. Deletes all database sheets EXCEPT Sheet1
3. Recreates fresh structure with default data

### Production Initialization
1. Use `initializeDatabase()` with secure admin credentials
2. Creates admin user with proper password hashing
3. Marks system as initialized

## 🚨 IMPORTANT NOTES

### What's SAFE:
- ✅ `setupDatabase()` - Never deletes data
- ✅ `createDatabaseSheets()` - Only creates missing sheets
- ✅ `checkDatabaseInit()` - Read-only status check
- ✅ `manualDatabaseSetup()` - Safe setup with logging

### What's DESTRUCTIVE:
- ⚠️ `resetDatabase()` - Deletes ALL database sheets (keeps Sheet1)
- ⚠️ `manualDatabaseReset()` - Same as above with warnings

### What's Protected:
- 🛡️ **Sheet1** - NEVER deleted by any function
- 🛡️ **Existing data** - Setup functions preserve data
- 🛡️ **Admin security** - Passwords properly hashed

## 🔧 TROUBLESHOOTING

### "Database not initialized" Error
- Run `manualDatabaseSetup()` in Apps Script
- OR use database management interface
- Check that all required sheets exist

### Missing Sheets
- Run `createDatabaseSheets()` to add only missing ones
- Check Apps Script logs for any errors
- Verify Google Sheets permissions

### Reset Not Working
- Ensure you have edit permissions on the spreadsheet
- Check that Sheet1 exists (it's preserved)
- Review Apps Script execution logs

### API Errors
- Update API URL in your frontend files
- Verify Google Apps Script is deployed as web app
- Check that execution permissions are set to "Anyone"

## 🎉 SUCCESS INDICATORS

You'll know setup worked when:
- ✅ All 12 database sheets exist
- ✅ Headers are properly formatted with dark theme
- ✅ Default departments (ICT, HTM, SHS) are present
- ✅ Settings sheet has system configuration
- ✅ Audit log shows database initialization

Your database is now ready for the SSC Transparency Dashboard! 🚀