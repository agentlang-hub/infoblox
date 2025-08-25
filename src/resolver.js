const al_integmanager = await import(`${process.cwd()}/node_modules/agentlang/out/runtime/integrations.js`)

function getConfig(k) {
    return al_integmanager.getIntegrationConfig('infoblox', k)
}

// Generic HTTP functions
const makeRequest = async (endpoint, options = {}) => {

    const baseUrl = getConfig('baseUrl')
    const user = getConfig('user')
    const password = getConfig('password')
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
        throw new Error(`HTTP Error: ${response.status} - ${response.statusText}`);
    }

    return response;
};

const makeGetRequest = async (endpoint) => {
    console.log(`INFOBLOX RESOLVER: Querying DNS Entries: ${endpoint}\n`);
    
    const response = await makeRequest(endpoint, { method: 'GET' });
    const data = await response.json();
    return data.result;
};

const makePostRequest = async (endpoint, body) => {
    console.log(`INFOBLOX RESOLVER: Creating a new DNS Entry: ${endpoint}\n`);

    const response = await makeRequest(endpoint, {
        method: 'POST',
        body: JSON.stringify(body)
    });
    
    const data = await response.json();
    return data;
};

// AAAA Record functions
export const createAAAA = async (env, attributes) => {
    const data = {
        name: attributes.attributes.get('name'),
        ipv6addr: attributes.attributes.get('ipv6addr')
    };

    try {
        const result = await makePostRequest('/record:aaaa', data);
        return {
            name: data.name,
            ipv6addr: data.ipv6addr,
            id: result.id
        };
    } catch (error) {
        throw new Error(`Failed to create AAAA record: ${error.message}`);
    }
};

export const queryAAAA = async (env, id) => {
    try {
        return await makeGetRequest('/record:aaaa');
    } catch (error) {
        throw new Error(`Failed to query AAAA records: ${error.message}`);
    }
};

// CNAME Record functions
export const createCNAME = async (env, attributes) => {
    const data = {
        name: attributes.attributes.get('name'),
        canonical: attributes.attributes.get('canonical')
    };

    try {
        const result = await makePostRequest('/record:cname', data);
        return {
            name: data.name,
            canonical: data.canonical,
            id: result.id
        };
    } catch (error) {
        throw new Error(`Failed to create CNAME record: ${error.message}`);
    }
};

export const queryCNAME = async (env, name) => {
    try {
        return await makeGetRequest('/record:cname');
    } catch (error) {
        throw new Error(`Failed to query CNAME records: ${error.message}`);
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
        return {
            name: data.name,
            preference: data.preference,
            mail_exchanger: data.mail_exchanger,
            id: result.id
        };
    } catch (error) {
        throw new Error(`Failed to create MX record: ${error.message}`);
    }
};

export const queryMX = async (env, name) => {
    try {
        return await makeGetRequest('/record:mx');
    } catch (error) {
        throw new Error(`Failed to query MX records: ${error.message}`);
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
        return {
            name: data.name,
            ipv4addr: data.ipv4addr,
            ipv6addr: data.ipv6addr,
            id: result.id
        };
    } catch (error) {
        throw new Error(`Failed to create HOST record: ${error.message}`);
    }
};

export const queryHost = async (env, name) => {
    try {
        return await makeGetRequest('/record:host');
    } catch (error) {
        throw new Error(`Failed to query HOST records: ${error.message}`);
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
        return {
            name: data.name,
            text: data.text,
            id: result.id
        };
    } catch (error) {
        throw new Error(`Failed to create TXT record: ${error.message}`);
    }
};

export const queryTXT = async (env, name) => {
    try {
        return await makeGetRequest('/record:txt');
    } catch (error) {
        throw new Error(`Failed to query TXT records: ${error.message}`);
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
        return {
            ptrdname: data.ptrdname,
            ipv4addr: data.ipv4addr,
            id: result.id
        };
    } catch (error) {
        throw new Error(`Failed to create PTR record: ${error.message}`);
    }
};

export const queryPTR = async (env, name) => {
    try {
        return await makeGetRequest('/record:ptr');
    } catch (error) {
        throw new Error(`Failed to query PTR records: ${error.message}`);
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
            network: data.network,
            id: result.id
        };
    } catch (error) {
        throw new Error(`Failed to create network: ${error.message}`);
    }
};

export const queryNetwork = async (env, id) => {
    try {
        if (id) {
            // Query specific network by ID
            const response = await makeRequest(`/network/${id}`, { method: 'GET' });
            const data = await response.json();
            return [data]; // Return as array for consistency
        } else {
            // Query all networks
            return await makeGetRequest('/network');
        }
    } catch (error) {
        throw new Error(`Failed to query network: ${error.message}`);
    }
};

