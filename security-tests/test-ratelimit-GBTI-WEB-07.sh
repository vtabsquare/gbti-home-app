#!/bin/bash

# Load environment variables
source .env

# Clean up key just in case
KEY=$(echo "$VITE_SUPABASE_PUBLISHABLE_KEY" | tr -d '\n' | tr -d '\r')
URL="$VITE_SUPABASE_URL/rest/v1/rpc/store_visitor_session"

echo "============================================================"
echo "GBTI-WEB-07: Testing IP-based rate limiting on store_visitor_session"
echo "Target URL: $URL"
echo "Limit: 10 requests per 15 minutes"
echo "============================================================"

for i in {1..12}; do
  # Run the POST request and capture the HTTP status code
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$URL" \
    -H "apikey: $KEY" \
    -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -H "X-Forwarded-For: 198.51.100.101" \
    -d "{\"p_email\":\"test_ratelimit_$i@example.com\", \"p_device_type\":\"desktop\", \"p_browser\":\"Chrome\", \"p_os\":\"Linux\", \"p_screen_width\":1920, \"p_screen_height\":1080, \"p_user_agent\":\"TestScript/1.0\"}")
  
  if [ "$HTTP_STATUS" == "200" ] || [ "$HTTP_STATUS" == "201" ] || [ "$HTTP_STATUS" == "204" ]; then
    echo "[Attempt $(printf "%02d" $i)] SUCCESS (HTTP $HTTP_STATUS) - Session created."
  else
    # Capture the actual error message
    ERROR_MSG=$(curl -s -X POST "$URL" \
      -H "apikey: $KEY" \
      -H "Authorization: Bearer $KEY" \
      -H "Content-Type: application/json" \
      -H "X-Forwarded-For: 198.51.100.101" \
      -d "{\"p_email\":\"test_ratelimit_$i@example.com\", \"p_device_type\":\"desktop\", \"p_browser\":\"Chrome\", \"p_os\":\"Linux\", \"p_screen_width\":1920, \"p_screen_height\":1080, \"p_user_agent\":\"TestScript/1.0\"}")
    
    echo "[Attempt $(printf "%02d" $i)] BLOCKED (HTTP $HTTP_STATUS) - Response: $ERROR_MSG"
  fi
done
