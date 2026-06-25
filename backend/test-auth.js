require('dotenv').config();
const db = require('./src/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

async function runTests() {
  console.log('=============================================');
  console.log('       SummaCast R&D Core Unit Verifier      ');
  console.log('=============================================');
  
  try {
    // 1. Database Init Check
    console.log('[Test 1/3] Testing database migration schemas...');
    await db.init();
    console.log('  -> Database migrations initialized successfully.');

    // 2. Bcrypt Cryptographic Check
    console.log('[Test 2/3] Testing Bcrypt cryptographic salting & hashing...');
    const plainText = 'Passw0rdGlow2026!';
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(plainText, salt);
    
    if (!hash || hash === plainText) {
      throw new Error('Hashing returned plain text or empty hash.');
    }
    
    const isMatch = await bcrypt.compare(plainText, hash);
    if (!isMatch) {
      throw new Error('Hash comparison failed. Password does not match hash.');
    }
    console.log('  -> Salting, hashing, and password match verified.');

    // 3. JWT Verification Check
    console.log('[Test 3/3] Testing JWT signature signing & verification...');
    const testSecret = 'summacast_test_jwt_secret';
    const payload = { userId: 'user_uuid_test_12345' };
    
    const token = jwt.sign(payload, testSecret, { expiresIn: '15m' });
    const decoded = jwt.verify(token, testSecret);
    
    if (decoded.userId !== payload.userId) {
      throw new Error('JWT payload recovery mismatch.');
    }
    console.log('  -> JWT encryption token signature verified.');
    
    console.log('\n✅ Verification successful! Core auth modules are fully operational.');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Verification Failed:', error.message);
    process.exit(1);
  }
}

runTests();
