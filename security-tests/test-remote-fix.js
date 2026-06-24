const url = 'https://ekvzvjxwvjlgquvxfkqy.supabase.co/rest/v1/admin_users?select=*';
const visitorUrl = 'https://ekvzvjxwvjlgquvxfkqy.supabase.co/rest/v1/visitor_otps?select=*';

const headers = {
  'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVrdnp2anh3dmpsZ3F1dnhma3F5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMzI1NDgsImV4cCI6MjA5MzYwODU0OH0.fzmxDHQZ-jIJXTu88HgnMAdd58LBMgnD0vscYSRHWzI',
  'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVrdnp2anh3dmpsZ3F1dnhma3F5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMzI1NDgsImV4cCI6MjA5MzYwODU0OH0.fzmxDHQZ-jIJXTu88HgnMAdd58LBMgnD0vscYSRHWzI',
};

async function test() {
  try {
    console.log('Testing admin_users...');
    const res = await fetch(url, { headers });
    const data = await res.json();
    console.log('Admin Users response:', JSON.stringify(data, null, 2));

    console.log('\nTesting visitor_otps...');
    const res2 = await fetch(visitorUrl, { headers });
    const data2 = await res2.json();
    console.log('Visitor OTPs response:', JSON.stringify(data2, null, 2));
  } catch (err) {
    console.error(err);
  }
}

test();
