const BACKEND_URL = 'http://localhost:5000';
const WORKER_URL = 'http://localhost:8000';

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runIntegrationTest() {
  console.log('========================================================');
  console.log('        SummaCast R&D End-To-End Integration Test       ');
  console.log('========================================================\n');

  try {
    // 1. Health Checks
    console.log('[Step 1] Verifying server health endpoints...');
    const bHealth = await fetch(`${BACKEND_URL}/health`).then(r => r.json());
    console.log(`  -> Backend: OK (Mode: ${bHealth.db})`);
    
    const wHealth = await fetch(`${WORKER_URL}/health`).then(r => r.json());
    console.log(`  -> Worker: OK (Mock AI: ${wHealth.mock_ai})`);
    
    if (bHealth.status !== 'ok' || wHealth.status !== 'ok') {
      throw new Error('Health check failed for one of the services.');
    }

    // 2. Register Test Account
    console.log('\n[Step 2] Registering temporary verification account...');
    const testEmail = `integration_tester_${Date.now()}@test.com`;
    const testPass = 'GlowPass123!';
    
    const registerRes = await fetch(`${BACKEND_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPass })
    });
    
    if (!registerRes.ok) {
      const err = await registerRes.json();
      throw new Error(`Registration failed: ${err.error}`);
    }
    console.log(`  -> Account registered: ${testEmail}`);

    // 3. Log In Test Account
    console.log('\n[Step 3] Logging in to retrieve authorization JWT...');
    const loginRes = await fetch(`${BACKEND_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPass })
    });
    
    if (!loginRes.ok) {
      const err = await loginRes.json();
      throw new Error(`Login failed: ${err.error}`);
    }
    
    const loginData = await loginRes.json();
    const token = loginData.accessToken;
    console.log('  -> JWT retrieve successful. Auth Token loaded.');

    // 4. Submit Job Link
    console.log('\n[Step 4] Dispatching YouTube link for pipeline parsing...');
    const testYoutubeUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    const queueRes = await fetch(`${BACKEND_URL}/api/jobs/youtube`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ url: testYoutubeUrl })
    });

    if (!queueRes.ok) {
      const err = await queueRes.json();
      throw new Error(`Queue submission failed: ${err.error}`);
    }

    const queueData = await queueRes.json();
    const jobId = queueData.jobId;
    console.log(`  -> Job successfully queued! Job ID: ${jobId}`);

    // 5. Poll Job Lifecycle
    console.log('\n[Step 5] Polling job state transitions in database...');
    let attempts = 0;
    let completed = false;
    
    while (attempts < 20 && !completed) {
      attempts++;
      await wait(2000); // Poll every 2 seconds
      
      const statusRes = await fetch(`${BACKEND_URL}/api/jobs/${jobId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!statusRes.ok) {
        throw new Error(`Failed to poll status for Job ${jobId}`);
      }
      
      const job = await statusRes.json();
      console.log(`  -> [Poll #${attempts}] Status: ${job.status}`);
      
      if (job.status === 'COMPLETED') {
        completed = true;
        console.log('\n🎉 INTEGRATION TEST SUCCEEDED!');
        console.log('========================================================');
        console.log('Media Summary:');
        console.log(job.summary);
        console.log('\nChronological Chapters Extracted:');
        job.chapters.forEach(c => {
          console.log(`  [${c.timestamp}] ${c.title}`);
          c.bullets.forEach(b => console.log(`     • ${b}`));
        });
        console.log('========================================================');
        break;
      } else if (job.status === 'FAILED') {
        throw new Error(`Job processing failed on the worker side: ${job.raw_transcript}`);
      }
    }
    
    if (!completed) {
      throw new Error('Test timed out. Job took too long to complete.');
    }
    
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Integration Test Failed:', error.message);
    process.exit(1);
  }
}

// Give servers a brief moment to boot up before hitting endpoints
setTimeout(runIntegrationTest, 2000);
