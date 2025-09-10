const al_integmanager = await import(`${process.cwd()}/node_modules/agentlang/out/runtime/integrations.js`)

function getConfig(k) {
    return al_integmanager.getIntegrationConfig('infoblox', k)
}

// Generic HTTP functions
const makeRequest = async (endpoint, options = {}) => {

    const baseUrl = getConfig('baseUrl') || process.env.INFOBLOX_BASE_URL
    const user = getConfig('user') || process.env.INFOBLOX_USERNAME
    const password = getConfig('password') || process.env.INFOBLOX_PASSWORD
    const authHeader = 'Basic ' + btoa(`${user}:${password}`)
    
    const url = `${baseUrl}${endpoint}`;
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': authHeader
        }
    };

    const config = { ...defaultOptions, ...options };
    
    // Remove Content-Type header for GET requests without body
    if (config.method === 'GET') {
        delete config.headers['Content-Type'];
    }

    const response = await fetch(url, config);

    if (!response.ok) {
        console.error(`HTTP Error: ${response.status} - ${response.statusText}`);
        return {"result": "error"};
    }

    return response;
};

const makeGetRequest = async (endpoint) => {
    console.log(`INFOBLOX RESOLVER: Querying DNS Entries: ${endpoint}\n`);
    
    const response = await makeRequest(endpoint, { method: 'GET' });
    const data = await response.json();
    return data
};

const makePostRequest = async (endpoint, body) => {
    console.log(`INFOBLOX RESOLVER: Creating a new DNS Entry: ${endpoint}\n`);

    const response = await makeRequest(endpoint, {
        method: 'POST',
        body: JSON.stringify(body)
    });
    
    if (response.status != 201 && response.status != 200) {
        throw new Error(`HTTP Error: ${response.status} - ${response.statusText}`);
    }

    return response;
};

// AAAA Record functions
export const createAAAA = async (env, attributes) => {
    const data = {
        name: attributes.attributes.get('name'),
        ipv6addr: attributes.attributes.get('ipv6addr')
    };

    try {
        const result = await makePostRequest('/record:aaaa', data);
        return {"result": "success"};
    } catch (error) {
        console.error(`Failed to create AAAA record: ${error.message}`);
        console.log("aaa", error);
        return {"result": "error"};
    }
};

export const queryAAAA = async (env, id) => {
    try {
        return await makeGetRequest('/record:aaaa');
    } catch (error) {
        console.log("aaa", error);
        console.error(`Failed to query AAAA records: ${error.message}`);
        return {"result": "error"};
    }
};

// CNAME Record functions
export const createCNAME = async (env, attributes) => {
    const data = {
        name: attributes.attributes.get('name'),
        canonical: attributes.attributes.get('canonical')
    };

    try {
        await makePostRequest('/record:cname', data);
        return {"result": "success"};
    } catch (error) {
        console.log("aaa", error);
        console.error(`Failed to create CNAME record: ${error.message}`);
        return {"result": "error"};
    }
};

export const queryCNAME = async (env, name) => {
    try {
        return await makeGetRequest('/record:cname');
    } catch (error) {
        console.error(`Failed to query CNAME records: ${error.message}`);
        return {"result": "error"};
    }
};

// MX Record functions
export const createMX = async (env, attributes) => {
    const data = {
        name: attributes.attributes.get('name'),
        preference: parseInt(attributes.attributes.get('preference')),
        mail_exchanger: attributes.attributes.get('mail_exchanger')
    };

    try {
        const result = await makePostRequest('/record:mx', data);
        return {"result": "success"};
    } catch (error) {
        console.error(`Failed to create MX record: ${error.message}`);
        return {"result": "error"};
    }
};

export const queryMX = async (env, name) => {
    try {
        return await makeGetRequest('/record:mx');
    } catch (error) {
        console.error(`Failed to query MX records: ${error.message}`);
        return {"result": "error"};
    }
};

// HOST Record functions
export const createHost = async (env, attributes) => {
    const data = {
        name: attributes.attributes.get('name'),
        ipv4addr: attributes.attributes.get('ipv4addr'),
        ipv6addr: attributes.attributes.get('ipv6addr')
    };

    try {
        const result = await makePostRequest('/record:host', data);
        return {"result": "success"};
    } catch (error) {
        console.error(`Failed to create HOST record: ${error.message}`);
        return {"result": "error"};
    }
};

export const queryHost = async (env, name) => {
    try {
        return await makeGetRequest('/record:host');
    } catch (error) {
        console.error(`Failed to query HOST records: ${error.message}`);
        return {"result": "error"};
    }
};

// TXT Record functions
export const createTXT = async (env, attributes) => {
    const data = {
        name: attributes.attributes.get('name'),
        text: attributes.attributes.get('text')
    };

    try {
        const result = await makePostRequest('/record:txt', data);
        return {"result": "success"};
    } catch (error) {
        console.error(`Failed to create TXT record: ${error.message}`);
        return {"result": "error"};
    }
};

export const queryTXT = async (env, name) => {
    try {
        return await makeGetRequest('/record:txt');
    } catch (error) {
        console.error(`Failed to query TXT records: ${error.message}`);
        return {"result": "error"};
    }
};

// PTR Record functions
export const createPTR = async (env, attributes) => {
    const data = {
        ptrdname: attributes.attributes.get('ptrdname'),
        ipv4addr: attributes.attributes.get('ipv4addr')
    };

    try {
        const result = await makePostRequest('/record:ptr', data);
        return {"result": "success"};
    } catch (error) {
        console.error(`Failed to create PTR record: ${error.message}`);
        return {"result": "error"};
    }
};

export const queryPTR = async (env, name) => {
    try {
        return await makeGetRequest('/record:ptr');
    } catch (error) {
        console.error(`Failed to query PTR records: ${error.message}`);
        return {"result": "error"};
    }
};

// Network functions
export const createNetwork = async (env, attributes) => {
    const data = {
        network: attributes.attributes.get('network')
    };

    try {
        const result = await makePostRequest('/network', data);
        return {
            "result": "success"
        };
    } catch (error) {
        console.error(`Failed to create network: ${error.message}`);
        return {"result": "error"};
    }
};

export const queryNetwork = async (env, id) => {
    try {
        if (id) {
            // Query specific network by ID
            const response = await makeRequest(`/network/${id}`, { method: 'GET' });
            const data = await response.json();
            return {"result": "success"};
        } else {
            // Query all networks
            return await makeGetRequest('/network');
        }
    } catch (error) {
        console.error(`Failed to query network: ${error.message}`);
        return {"result": "error"};
    }
};

