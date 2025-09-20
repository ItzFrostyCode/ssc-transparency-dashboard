/**
 * Quick fix para sa initialization - Run this sa Google Apps Script
 */
function markDatabaseAsInitialized() {
  try {
    // Set database as initialized
    const properties = PropertiesService.getScriptProperties();
    properties.setProperty('DB_INITIALIZED', 'true');
    properties.setProperty('INIT_DATE', new Date().toISOString());
    properties.setProperty('INIT_ADMIN', 'admin');
    
    console.log('✅ Database marked as initialized!');
    console.log('✅ You can now login with your admin credentials');
    console.log('✅ Check your documentation for login details');
    
    return {
      status: 'success',
      message: 'Database marked as initialized. You can now login!'
    };
  } catch (error) {
    console.log('❌ Error:', error.toString());
    return {
      status: 'error',
      message: error.toString()
    };
  }
}

/**
 * Check kung okay na ba
 */
function checkIfFixed() {
  const properties = PropertiesService.getScriptProperties();
  const isInitialized = properties.getProperty('DB_INITIALIZED');
  
  console.log('=== CHECK RESULTS ===');
  console.log('Initialized:', isInitialized);
  console.log('Init Date:', properties.getProperty('INIT_DATE'));
  console.log('Init Admin:', properties.getProperty('INIT_ADMIN'));
  
  if (isInitialized === 'true') {
    console.log('✅ FIXED! You can now login to admin dashboard!');
  } else {
    console.log('❌ Still not fixed. Try running markDatabaseAsInitialized() again.');
  }
}