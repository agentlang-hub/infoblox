#!/bin/bash

# Test helper function
assert_equals() {
    if [ "$1" = "$2" ]; then
        echo "✓ Test passed: $3"
    else
        echo "✗ Test failed: $3"
        echo "  Expected: $1"
        echo "  Got: $2"
        exit 1
    fi
}

echo "Running tests..."

# Auth credentials
AUTH_HEADER="Authorization: Basic $(echo -n "admin:infoblox" | base64)"

# Test GET /wapi/v2.13.1/network without auth
assert_equals "401" "$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/wapi/v2.13.1/network)" "GET /network without auth returns 401"

# Test GET /wapi/v2.13.1/network
response=$(curl -s -H "$AUTH_HEADER" http://localhost:3000/wapi/v2.13.1/network)
expected='{"result":[]}'
assert_equals "$expected" "$response" "GET /network returns empty array initially"

# Test POST /wapi/v2.13.1/network
response=$(curl -s -X POST http://localhost:3000/wapi/v2.13.1/network \
    -H "$AUTH_HEADER" \
    -H "Content-Type: application/json" \
    -d '{"network": "192.168.1.0/24"}')
network_id=$(echo $response | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
assert_equals "201" "$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/wapi/v2.13.1/network -X POST -H "$AUTH_HEADER" -H "Content-Type: application/json" -d '{"network": "192.168.1.0/24"}')" "POST /network returns 201"

# Test GET /wapi/v2.13.1/network/:id
response=$(curl -s -H "$AUTH_HEADER" http://localhost:3000/wapi/v2.13.1/network/$network_id)
assert_equals "200" "$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/wapi/v2.13.1/network/$network_id -H "$AUTH_HEADER")" "GET /network/:id returns 200"

# Test GET /wapi/v2.13.1/record:host
response=$(curl -s -H "$AUTH_HEADER" http://localhost:3000/wapi/v2.13.1/record:host)
expected='{"result":[]}'
assert_equals "$expected" "$response" "GET /record:host returns empty array initially"

# Test POST /wapi/v2.13.1/record:host
response=$(curl -s -X POST http://localhost:3000/wapi/v2.13.1/record:host \
    -H "$AUTH_HEADER" \
    -H "Content-Type: application/json" \
    -d '{"name": "test.example.com", "ipv4addr": "192.168.1.10"}')
assert_equals "201" "$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/wapi/v2.13.1/record:host -X POST -H "$AUTH_HEADER" -H "Content-Type: application/json" -d '{"name": "test.example.com", "ipv4addr": "192.168.1.10"}')" "POST /record:host returns 201"

# Test other DNS record types
for record_type in "aaaa" "cname" "mx" "txt" "ptr"; do
    # Test GET for each record type
    response=$(curl -s -H "$AUTH_HEADER" http://localhost:3000/wapi/v2.13.1/record:$record_type)
    expected='{"result":[]}'
    assert_equals "$expected" "$response" "GET /record:$record_type returns empty array initially"
    
    # Test POST for each record type
    test_data='{}'
    case $record_type in
        "aaaa") test_data='{"name": "test.example.com", "ipv6addr": "2001:db8::1"}';;
        "cname") test_data='{"name": "alias.example.com", "canonical": "target.example.com"}';;
        "mx") test_data='{"name": "example.com", "preference": 10, "mail_exchanger": "mail.example.com"}';;
        "txt") test_data='{"name": "example.com", "text": "v=spf1 include:_spf.example.com ~all"}';;
        "ptr") test_data='{"ptrdname": "host.example.com", "ipv4addr": "192.168.1.100"}';;
    esac
    
    response=$(curl -s -X POST http://localhost:3000/wapi/v2.13.1/record:$record_type \
        -H "$AUTH_HEADER" \
        -H "Content-Type: application/json" \
        -d "$test_data")
    assert_equals "201" "$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/wapi/v2.13.1/record:$record_type -X POST -H "$AUTH_HEADER" -H "Content-Type: application/json" -d "$test_data")" "POST /record:$record_type returns 201"
done

# Test 404 for non-existent endpoint
assert_equals "404" "$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH_HEADER" http://localhost:3000/not-found)" "Non-existent endpoint returns 404"

# Test invalid auth credentials
INVALID_AUTH="Authorization: Basic $(echo -n "wrong:credentials" | base64)"
assert_equals "401" "$(curl -s -o /dev/null -w "%{http_code}" -H "$INVALID_AUTH" http://localhost:3000/wapi/v2.13.1/network)" "Invalid credentials return 401"

echo "All tests completed successfully!"
